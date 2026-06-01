package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	userMessageEnvelopeStart = "[[APPOS_CHAT_V1]]"
	userMessageEnvelopeEnd   = "[[/APPOS_CHAT_V1]]"
)

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


func (s *Service) SendMessage(ctx context.Context, sessionID, ownerID, content string, attachments []MessageAttachment, onChunk func(string) error) (*Message, error) {
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
	messages = prepareMessagesForModel(messages)
	provider, err := s.resolver.ResolveDefault(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	streamer, err := s.factory.NewStreamer(ctx, provider)
	if err != nil {
		return nil, coded(CodeRuntimeFailed, "failed to initialize AI runtime", err)
	}
	assistantContent, err := streamer.Stream(ctx, messages, onChunk)
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

func prepareMessagesForModel(messages []*Message) []*Message {
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
	return prepared
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
