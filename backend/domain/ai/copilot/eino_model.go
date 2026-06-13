package copilot

import (
	"context"
	"io"
	"strings"
	"time"

	"github.com/cloudwego/eino-ext/components/model/openai"
	einomodel "github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/proxy"
)

type EinoModelFactory struct {
	App core.App
}

func (f EinoModelFactory) NewStreamer(ctx context.Context, provider *ProviderConfig) (ModelStreamer, error) {
	config := &openai.ChatModelConfig{
		APIKey:  provider.APIKey,
		BaseURL: provider.Endpoint,
		Model:   provider.Model,
		Timeout: 90 * time.Second,
	}
	if provider.MaxCompletionTokens != nil && *provider.MaxCompletionTokens > 0 {
		config.MaxTokens = provider.MaxCompletionTokens
		config.MaxCompletionTokens = provider.MaxCompletionTokens
	}
	if f.App != nil {
		client, err := proxy.NewHTTPClient(f.App, "ai_providers.global", 90*time.Second, false)
		if err == nil {
			config.HTTPClient = &client
		}
	}
	model, err := openai.NewChatModel(ctx, config)
	if err != nil {
		return nil, err
	}
	return &einoStreamer{model: model}, nil
}

type einoStreamer struct {
	model einomodel.ToolCallingChatModel
}

func (s *einoStreamer) Stream(ctx context.Context, messages []*Message, onChunk func(string) error) (string, error) {
	stream, err := s.model.Stream(ctx, toEinoMessages(messages))
	if err != nil {
		return "", err
	}
	defer stream.Close()

	var builder strings.Builder
	for {
		chunk, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
		if chunk == nil || chunk.Content == "" {
			continue
		}
		builder.WriteString(chunk.Content)
		if onChunk != nil {
			if err := onChunk(chunk.Content); err != nil {
				return "", err
			}
		}
	}
	return builder.String(), nil
}

func toEinoMessages(messages []*Message) []*schema.Message {
	result := make([]*schema.Message, 0, len(messages))
	for _, message := range messages {
		if message == nil || strings.TrimSpace(message.Content) == "" {
			continue
		}
		result = append(result, &schema.Message{Role: toEinoRole(message.Role), Content: message.Content})
	}
	return result
}

func toEinoRole(role string) schema.RoleType {
	switch NormalizeRole(role) {
	case RoleSystem:
		return schema.System
	case RoleAssistant:
		return schema.Assistant
	default:
		return schema.User
	}
}
