package copilot

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const (
	userMessageEnvelopeStart      = "[[APPOS_CHAT_V1]]"
	userMessageEnvelopeEnd        = "[[/APPOS_CHAT_V1]]"
	defaultChatWindowMessages     = 20
	defaultInputTokenBudget       = 24000
	maxInputTokenBudget           = 48000
	minInputTokenBudget           = 2048
	defaultCompletionTokenReserve = 4096
	chatTokenSafetyMargin         = 1024
	conversationSummaryIntro      = "Conversation summary from earlier turns:"
	conversationSummaryMaxItems   = 12
	conversationSummaryMaxChars   = 2400
	openRouterRetryTokenMargin    = 64
)

var openRouterAffordRegex = regexp.MustCompile(`can only afford ([0-9]+)`) 

type Repository interface {
	CreateSession(ctx context.Context, ownerID, title string) (*Session, error)
	ListSessions(ctx context.Context, ownerID string) ([]*Session, error)
	GetSession(ctx context.Context, sessionID, ownerID string) (*Session, error)
	UpdateSession(ctx context.Context, sessionID, ownerID, title string) (*Session, error)
	DeleteSession(ctx context.Context, sessionID, ownerID string) error
	ListMessages(ctx context.Context, sessionID string) ([]*Message, error)
	AppendMessage(ctx context.Context, sessionID, role, content, status string) (*Message, error)
	TouchSession(ctx context.Context, sessionID, title string) error
}

type userMessageEnvelope struct {
	Text        string              `json:"text"`
	Attachments []MessageAttachment `json:"attachments,omitempty"`
}

type ProviderResolver interface {
	ResolveDefault(ctx context.Context, actorID string) (*ProviderConfig, error)
	ResolveSelection(ctx context.Context, actorID, providerID string) (*ProviderConfig, error)
}

type ModelFactory interface {
	NewStreamer(ctx context.Context, provider *ProviderConfig) (ModelStreamer, error)
}

type ModelStreamer interface {
	Stream(ctx context.Context, messages []*Message, onChunk func(string) error) (string, error)
}

type Service struct {
	repo     Repository
	resolver ProviderResolver
	factory  ModelFactory
}

func NewService(repo Repository, resolver ProviderResolver, factory ModelFactory) *Service {
	return &Service{repo: repo, resolver: resolver, factory: factory}
}

func (s *Service) CreateSession(ctx context.Context, ownerID, title string) (*Session, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = "New chat"
	}
	return s.repo.CreateSession(ctx, ownerID, title)
}

func (s *Service) ListSessions(ctx context.Context, ownerID string) ([]*Session, error) {
	return s.repo.ListSessions(ctx, ownerID)
}

func (s *Service) UpdateSession(ctx context.Context, sessionID, ownerID, title string) (*Session, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return nil, coded(CodeInvalidRequest, "session title is required", nil)
	}
	session, err := s.repo.UpdateSession(ctx, sessionID, ownerID, title)
	if err != nil {
		return nil, coded(CodeSessionNotFound, "chat session not found", err)
	}
	return session, nil
}

func (s *Service) DeleteSession(ctx context.Context, sessionID, ownerID string) error {
	if err := s.repo.DeleteSession(ctx, sessionID, ownerID); err != nil {
		return coded(CodeSessionNotFound, "chat session not found", err)
	}
	return nil
}

func (s *Service) ListMessages(ctx context.Context, sessionID, ownerID string) ([]*Message, error) {
	if _, err := s.repo.GetSession(ctx, sessionID, ownerID); err != nil {
		return nil, coded(CodeSessionNotFound, "chat session not found", err)
	}
	return s.repo.ListMessages(ctx, sessionID)
}

func (s *Service) SendMessage(ctx context.Context, sessionID, ownerID, content, providerID, model string, attachments []MessageAttachment, onChunk func(string) error) (*Message, error) {
	content = strings.TrimSpace(content)
	attachments = normalizeAttachments(attachments)
	if content == "" && len(attachments) == 0 {
		return nil, coded(CodeInvalidRequest, "message content is required", nil)
	}
	session, err := s.repo.GetSession(ctx, sessionID, ownerID)
	if err != nil {
		return nil, coded(CodeSessionNotFound, "chat session not found", err)
	}
	storedContent := encodeUserMessage(content, attachments)
	if _, err := s.repo.AppendMessage(ctx, sessionID, RoleUser, storedContent, "completed"); err != nil {
		return nil, err
	}
	title := titleFromSession(session.Title, content, attachments)
	if err := s.repo.TouchSession(ctx, sessionID, title); err != nil {
		return nil, err
	}

	messages, err := s.repo.ListMessages(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	var provider *ProviderConfig
	if strings.TrimSpace(providerID) != "" {
		provider, err = s.resolver.ResolveSelection(ctx, ownerID, providerID)
	} else {
		provider, err = s.resolver.ResolveDefault(ctx, ownerID)
	}
	if err != nil {
		return nil, err
	}
	if model != "" {
		provider.Model = model
	}
	if strings.TrimSpace(provider.Model) == "" {
		return nil, coded(CodeInvalidRequest, "model is required — specify one in the request or configure a default on the provider", nil)
	}
	messages = prepareMessagesForModel(messages, provider)
	assistantContent, err := s.streamAssistantMessage(ctx, provider, messages, onChunk)
	if err != nil {
		return nil, coded(CodeRuntimeFailed, "AI runtime request failed", err)
	}
	assistantContent = strings.TrimSpace(assistantContent)
	if assistantContent == "" {
		return nil, coded(CodeRuntimeFailed, "AI runtime returned an empty response", nil)
	}
	assistant, err := s.repo.AppendMessage(ctx, sessionID, RoleAssistant, assistantContent, "completed")
	if err != nil {
		return nil, err
	}
	if err := s.repo.TouchSession(ctx, sessionID, title); err != nil {
		return nil, err
	}
	return assistant, nil
}

func (s *Service) streamAssistantMessage(ctx context.Context, provider *ProviderConfig, messages []*Message, onChunk func(string) error) (string, error) {
	streamer, err := s.factory.NewStreamer(ctx, provider)
	if err != nil {
		return "", coded(CodeRuntimeFailed, "failed to initialize AI runtime", err)
	}
	chunkCount := 0
	countingOnChunk := func(chunk string) error {
		chunkCount++
		if onChunk != nil {
			return onChunk(chunk)
		}
		return nil
	}
	assistantContent, streamErr := streamer.Stream(ctx, messages, countingOnChunk)
	if streamErr == nil {
		return assistantContent, nil
	}
	if chunkCount == 0 {
		if retryProvider, ok := reducedOpenRouterProvider(provider, streamErr); ok {
			retryStreamer, retryInitErr := s.factory.NewStreamer(ctx, retryProvider)
			if retryInitErr != nil {
				return "", retryInitErr
			}
			return retryStreamer.Stream(ctx, messages, onChunk)
		}
	}
	return "", streamErr
}

func reducedOpenRouterProvider(provider *ProviderConfig, err error) (*ProviderConfig, bool) {
	if provider == nil || err == nil {
		return nil, false
	}
	endpoint := strings.ToLower(strings.TrimSpace(provider.Endpoint))
	message := err.Error()
	match := openRouterAffordRegex.FindStringSubmatch(message)
	if len(match) != 2 || (!strings.Contains(endpoint, "openrouter.ai") && !strings.Contains(strings.ToLower(message), "payment required")) {
		return nil, false
	}
	affordable, parseErr := strconv.Atoi(match[1])
	if parseErr != nil || affordable <= 0 {
		return nil, false
	}
	retryLimit := affordable - openRouterRetryTokenMargin
	if retryLimit <= 0 {
		retryLimit = affordable
	}
	if retryLimit <= 0 {
		return nil, false
	}
	if provider.MaxCompletionTokens != nil && *provider.MaxCompletionTokens <= retryLimit {
		return nil, false
	}
	clone := *provider
	clone.MaxCompletionTokens = intValuePtr(retryLimit)
	return &clone, true
}

func intValuePtr(value int) *int {
	return &value
}

func titleFromSession(current, content string, attachments []MessageAttachment) string {
	if strings.TrimSpace(current) != "" && current != "New chat" {
		return current
	}
	content = strings.Join(strings.Fields(content), " ")
	if content == "" && len(attachments) > 0 {
		content = strings.TrimSpace(attachments[0].Name)
	}
	if len(content) > 60 {
		return content[:60]
	}
	if content == "" {
		return "New chat"
	}
	return content
}

func normalizeAttachments(items []MessageAttachment) []MessageAttachment {
	attachments := make([]MessageAttachment, 0, len(items))
	for _, item := range items {
		name := strings.TrimSpace(item.Name)
		mimeType := strings.TrimSpace(item.MimeType)
		textContent := strings.TrimSpace(item.TextContent)
		recordID := strings.TrimSpace(item.RecordID)
		if name == "" {
			continue
		}
		attachments = append(attachments, MessageAttachment{
			Name:        name,
			MimeType:    mimeType,
			Size:        item.Size,
			TextContent: textContent,
			RecordID:    recordID,
		})
	}
	return attachments
}

func encodeUserMessage(content string, attachments []MessageAttachment) string {
	if len(attachments) == 0 {
		return content
	}
	payload, err := json.Marshal(userMessageEnvelope{Text: content, Attachments: attachments})
	if err != nil {
		return content
	}
	return userMessageEnvelopeStart + string(payload) + userMessageEnvelopeEnd
}

func decodeUserMessage(content string) (userMessageEnvelope, bool) {
	trimmed := strings.TrimSpace(content)
	if !strings.HasPrefix(trimmed, userMessageEnvelopeStart) || !strings.HasSuffix(trimmed, userMessageEnvelopeEnd) {
		return userMessageEnvelope{}, false
	}
	body := strings.TrimPrefix(trimmed, userMessageEnvelopeStart)
	body = strings.TrimSuffix(body, userMessageEnvelopeEnd)
	var envelope userMessageEnvelope
	if err := json.Unmarshal([]byte(body), &envelope); err != nil {
		return userMessageEnvelope{}, false
	}
	envelope.Text = strings.TrimSpace(envelope.Text)
	envelope.Attachments = normalizeAttachments(envelope.Attachments)
	return envelope, true
}

func prepareMessagesForModel(messages []*Message, provider *ProviderConfig) []*Message {
	prepared := make([]*Message, 0, len(messages))
	for _, message := range messages {
		if message == nil || message.Role != RoleUser {
			prepared = append(prepared, message)
			continue
		}
		envelope, ok := decodeUserMessage(message.Content)
		if !ok {
			prepared = append(prepared, message)
			continue
		}
		clone := *message
		clone.Content = renderUserMessageForModel(envelope)
		prepared = append(prepared, &clone)
	}
	return trimMessagesForModel(prepared, provider)
}

func trimMessagesForModel(messages []*Message, provider *ProviderConfig) []*Message {
	if len(messages) <= defaultChatWindowMessages {
		if estimateMessagesTokens(messages) <= inputTokenBudget(provider) {
			return messages
		}
	}

	systemMessages := make([]*Message, 0, 1)
	conversation := make([]*Message, 0, len(messages))
	for _, message := range messages {
		if message == nil || strings.TrimSpace(message.Content) == "" {
			continue
		}
		if NormalizeRole(message.Role) == RoleSystem {
			systemMessages = append(systemMessages, message)
			continue
		}
		conversation = append(conversation, message)
	}

	budget := inputTokenBudget(provider)
	trimmed := make([]*Message, 0, len(systemMessages)+defaultChatWindowMessages)
	trimmed = append(trimmed, systemMessages...)
	remaining := budget - estimateMessagesTokens(systemMessages)
	if remaining < minInputTokenBudget {
		remaining = minInputTokenBudget
	}

	selected := make([]*Message, 0, defaultChatWindowMessages)
	used := 0
	cutIndex := len(conversation)
	for index := len(conversation) - 1; index >= 0; index-- {
		message := conversation[index]
		tokens := estimateMessageTokens(message)
		if len(selected) >= defaultChatWindowMessages || (used+tokens > remaining && len(selected) > 0) {
			cutIndex = index + 1
			break
		}
		selected = append(selected, message)
		used += tokens
		cutIndex = index
	}
	if cutIndex > 0 {
		summary := summarizeMessages(conversation[:cutIndex])
		if summary != nil {
			trimmed = append(trimmed, summary)
		}
	}
	for index := len(selected) - 1; index >= 0; index-- {
		trimmed = append(trimmed, selected[index])
	}
	if len(trimmed) == 0 {
		return messages
	}
	return trimmed
}

func inputTokenBudget(provider *ProviderConfig) int {
	budget := defaultInputTokenBudget
	if provider != nil && provider.ContextSize > 0 {
		reserve := defaultCompletionTokenReserve
		if provider.MaxCompletionTokens != nil && *provider.MaxCompletionTokens > 0 {
			reserve = *provider.MaxCompletionTokens
		}
		calculated := provider.ContextSize - reserve - chatTokenSafetyMargin
		if calculated > 0 {
			budget = calculated
		}
	}
	if budget < minInputTokenBudget {
		return minInputTokenBudget
	}
	if budget > maxInputTokenBudget {
		return maxInputTokenBudget
	}
	return budget
}

func estimateMessagesTokens(messages []*Message) int {
	total := 0
	for _, message := range messages {
		total += estimateMessageTokens(message)
	}
	return total
}

func estimateMessageTokens(message *Message) int {
	if message == nil {
		return 0
	}
	content := strings.TrimSpace(message.Content)
	if content == "" {
		return 0
	}
	return len([]rune(content))/4 + 32
}

func summarizeMessages(messages []*Message) *Message {
	if len(messages) == 0 {
		return nil
	}
	entries := make([]string, 0, conversationSummaryMaxItems)
	charBudget := conversationSummaryMaxChars
	for _, message := range messages {
		if message == nil {
			continue
		}
		role := NormalizeRole(message.Role)
		if role == RoleSystem {
			continue
		}
		content := strings.Join(strings.Fields(strings.TrimSpace(message.Content)), " ")
		if content == "" {
			continue
		}
		if len([]rune(content)) > 180 {
			contentRunes := []rune(content)
			content = string(contentRunes[:180]) + "..."
		}
		entry := fmt.Sprintf("- %s: %s", role, content)
		entryLen := len([]rune(entry))
		if len(entries) >= conversationSummaryMaxItems || (charBudget-entryLen < 0 && len(entries) > 0) {
			break
		}
		entries = append(entries, entry)
		charBudget -= entryLen
	}
	if len(entries) == 0 {
		return nil
	}
	return &Message{
		Role:    RoleSystem,
		Content: conversationSummaryIntro + "\n" + strings.Join(entries, "\n"),
		Status:  "completed",
	}
}

func renderUserMessageForModel(envelope userMessageEnvelope) string {
	if len(envelope.Attachments) == 0 {
		return envelope.Text
	}
	var builder strings.Builder
	if envelope.Text != "" {
		builder.WriteString("User request:\n")
		builder.WriteString(envelope.Text)
		builder.WriteString("\n\n")
	}
	builder.WriteString("Attached files:\n")
	for index, attachment := range envelope.Attachments {
		builder.WriteString(fmt.Sprintf("%d. %s", index+1, attachment.Name))
		meta := make([]string, 0, 3)
		if attachment.MimeType != "" {
			meta = append(meta, attachment.MimeType)
		}
		if attachment.Size > 0 {
			meta = append(meta, fmt.Sprintf("%d bytes", attachment.Size))
		}
		if attachment.RecordID != "" {
			meta = append(meta, fmt.Sprintf("record %s", attachment.RecordID))
		}
		if len(meta) > 0 {
			builder.WriteString(" (")
			builder.WriteString(strings.Join(meta, ", "))
			builder.WriteString(")")
		}
		builder.WriteString("\n")
		if attachment.TextContent != "" {
			builder.WriteString("Content:\n")
			builder.WriteString(attachment.TextContent)
			builder.WriteString("\n")
		}
	}
	return strings.TrimSpace(builder.String())
}
