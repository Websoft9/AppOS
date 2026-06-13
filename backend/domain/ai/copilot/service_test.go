package copilot

import (
	"context"
	"errors"
	"testing"
)

func TestPrepareMessagesForModelTrimsOlderConversation(t *testing.T) {
	messages := []*Message{{Role: RoleSystem, Content: "system guidance"}}
	for index := 0; index < 30; index++ {
		messages = append(messages, &Message{Role: RoleUser, Content: "user message content " + string(rune('a'+(index%26)))})
		messages = append(messages, &Message{Role: RoleAssistant, Content: "assistant reply content " + string(rune('a'+(index%26)))})
	}

	provider := &ProviderConfig{ContextSize: 4096, MaxCompletionTokens: intPtr(1024)}
	prepared := prepareMessagesForModel(messages, provider)
	if len(prepared) >= len(messages) {
		t.Fatalf("expected prepared messages to trim history, got %d from %d", len(prepared), len(messages))
	}
	if len(prepared) == 0 || prepared[0].Role != RoleSystem {
		t.Fatalf("expected first prepared message to preserve system role, got %#v", prepared)
	}
	if len(prepared) < 2 || prepared[1].Role != RoleSystem {
		t.Fatalf("expected second prepared message to be a synthetic summary, got %#v", prepared)
	}
	if prepared[1].Content == "" || prepared[1].Content[:len(conversationSummaryIntro)] != conversationSummaryIntro {
		t.Fatalf("expected synthetic summary message, got %#v", prepared[1])
	}
	last := prepared[len(prepared)-1]
	if last == nil || last.Content != messages[len(messages)-1].Content {
		t.Fatalf("expected most recent message to be retained, got %#v", last)
	}
}

func TestPrepareMessagesForModelRendersAttachmentEnvelopeBeforeTrim(t *testing.T) {
	messages := []*Message{{
		Role:    RoleUser,
		Content: encodeUserMessage("review file", []MessageAttachment{{Name: "nginx.conf", TextContent: "worker_processes auto;"}}),
	}}

	prepared := prepareMessagesForModel(messages, &ProviderConfig{})
	if len(prepared) != 1 {
		t.Fatalf("expected one prepared message, got %d", len(prepared))
	}
	if prepared[0].Content == messages[0].Content {
		t.Fatalf("expected attachment envelope to be rendered for model input")
	}
	if prepared[0].Content == "" {
		t.Fatal("expected rendered content to be non-empty")
	}
}

func intPtr(value int) *int {
	return &value
}

type retryTestRepo struct {
	messages []*Message
}

func (r *retryTestRepo) CreateSession(context.Context, string, string) (*Session, error) { return nil, nil }
func (r *retryTestRepo) ListSessions(context.Context, string) ([]*Session, error) { return nil, nil }
func (r *retryTestRepo) GetSession(context.Context, string, string) (*Session, error) {
	return &Session{ID: "session-1", Title: "New chat"}, nil
}
func (r *retryTestRepo) UpdateSession(context.Context, string, string, string) (*Session, error) { return nil, nil }
func (r *retryTestRepo) DeleteSession(context.Context, string, string) error { return nil }
func (r *retryTestRepo) ListMessages(context.Context, string) ([]*Message, error) { return r.messages, nil }
func (r *retryTestRepo) AppendMessage(_ context.Context, sessionID, role, content, status string) (*Message, error) {
	message := &Message{ID: role + "-msg", SessionID: sessionID, Role: role, Content: content, Status: status}
	r.messages = append(r.messages, message)
	return message, nil
}
func (r *retryTestRepo) TouchSession(context.Context, string, string) error { return nil }

type retryTestResolver struct {
	provider *ProviderConfig
}

func (r retryTestResolver) ResolveDefault(context.Context, string) (*ProviderConfig, error) {
	return r.provider, nil
}

func (r retryTestResolver) ResolveSelection(context.Context, string, string) (*ProviderConfig, error) {
	return r.provider, nil
}

type retryTestFactory struct {
	providers []*ProviderConfig
	streamers []ModelStreamer
	index     int
}

func (f *retryTestFactory) NewStreamer(_ context.Context, provider *ProviderConfig) (ModelStreamer, error) {
	clone := *provider
	f.providers = append(f.providers, &clone)
	streamer := f.streamers[f.index]
	f.index++
	return streamer, nil
}

type retryTestStreamer struct {
	content string
	err     error
}

func (s retryTestStreamer) Stream(context.Context, []*Message, func(string) error) (string, error) {
	if s.err != nil {
		return "", s.err
	}
	return s.content, nil
}

func TestSendMessageRetriesOpenRouterOnAffordableMaxTokens(t *testing.T) {
	repo := &retryTestRepo{messages: []*Message{}}
	provider := &ProviderConfig{
		Endpoint:            "https://openrouter.ai/api/v1",
		Model:               "qwen/qwen3.7-plus",
		APIKey:              "test-key",
		MaxCompletionTokens: intPtr(31100),
	}
	factory := &retryTestFactory{streamers: []ModelStreamer{
		retryTestStreamer{err: errors.New("error, status code: 402, status: 402 Payment Required, message: This request requires more credits, or fewer max_tokens. You requested up to 31100 tokens, but can only afford 31053.")},
		retryTestStreamer{content: "ok"},
	}}
	service := NewService(repo, retryTestResolver{provider: provider}, factory)

	assistant, err := service.SendMessage(context.Background(), "session-1", "user-1", "hello", "", "", nil, nil)
	if err != nil {
		t.Fatalf("expected retry to succeed, got error: %v", err)
	}
	if assistant == nil || assistant.Content != "ok" {
		t.Fatalf("expected assistant content ok, got %#v", assistant)
	}
	if len(factory.providers) != 2 {
		t.Fatalf("expected two streamer initializations, got %d", len(factory.providers))
	}
	if factory.providers[0].MaxCompletionTokens == nil || *factory.providers[0].MaxCompletionTokens != 31100 {
		t.Fatalf("expected initial cap 31100, got %#v", factory.providers[0].MaxCompletionTokens)
	}
	if factory.providers[1].MaxCompletionTokens == nil || *factory.providers[1].MaxCompletionTokens != 30989 {
		t.Fatalf("expected retried cap 30989, got %#v", factory.providers[1].MaxCompletionTokens)
	}
}
