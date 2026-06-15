package copilot

import (
	"context"
	"fmt"
	"io"
	"net/http"
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

func (f EinoModelFactory) ValidateProvider(ctx context.Context, provider *ProviderConfig) error {
	if provider == nil {
		return fmt.Errorf("provider is required")
	}
	if !IsOpenRouterEndpoint(provider.Endpoint) {
		return nil
	}
	var client *http.Client
	if f.App != nil {
		configuredClient, err := proxy.NewHTTPClient(f.App, "ai_providers.global", 90*time.Second, false)
		if err == nil {
			client = &configuredClient
		}
	}
	return ValidateOpenRouterCredential(ctx, client, provider.Endpoint, providerHeaders(provider), provider.APIKey)
}

func (f EinoModelFactory) NewStreamer(ctx context.Context, provider *ProviderConfig) (ModelStreamer, error) {
	if provider == nil {
		return nil, fmt.Errorf("provider is required")
	}
	config := &openai.ChatModelConfig{
		APIKey:  provider.APIKey,
		BaseURL: provider.Endpoint,
		Model:   provider.Model,
		Timeout: 90 * time.Second,
	}
	if provider.MaxCompletionTokens != nil && *provider.MaxCompletionTokens > 0 {
		config.MaxCompletionTokens = provider.MaxCompletionTokens
	}
	if f.App != nil {
		client, err := proxy.NewHTTPClient(f.App, "ai_providers.global", 90*time.Second, false)
		if err == nil {
			config.HTTPClient = withProviderHeaders(&client, provider)
		}
	} else {
		config.HTTPClient = withProviderHeaders(nil, provider)
	}
	model, err := openai.NewChatModel(ctx, config)
	if err != nil {
		return nil, err
	}
	return &einoStreamer{model: model}, nil
}

type headerRoundTripper struct {
	base    http.RoundTripper
	headers map[string]string
}

func (t headerRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	for key, value := range t.headers {
		if strings.TrimSpace(value) == "" || clone.Header.Get(key) != "" {
			continue
		}
		clone.Header.Set(key, value)
	}
	return t.base.RoundTrip(clone)
}

func withProviderHeaders(client *http.Client, provider *ProviderConfig) *http.Client {
	if provider == nil {
		if client != nil {
			return client
		}
		return &http.Client{Timeout: 90 * time.Second}
	}
	headers := providerHeaders(provider)
	if len(headers) == 0 {
		if client != nil {
			return client
		}
		return &http.Client{Timeout: 90 * time.Second}
	}
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second}
	}
	clone := *client
	base := clone.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	clone.Transport = headerRoundTripper{base: base, headers: headers}
	return &clone
}

func providerHeaders(provider *ProviderConfig) map[string]string {
	if provider == nil {
		return nil
	}
	endpoint := strings.ToLower(strings.TrimSpace(provider.Endpoint))
	if !strings.Contains(endpoint, "openrouter.ai") {
		return nil
	}
	referer := strings.TrimSpace(provider.HTTPReferer)
	if referer == "" {
		referer = "https://appos.local"
	}
	return map[string]string{
		"HTTP-Referer": referer,
		"X-Title":      "AppOS",
	}
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
