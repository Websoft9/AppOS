package copilot

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/cloudwego/eino-ext/components/model/openai"
	einomodel "github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/infra/httpout"
)

type EinoModelFactory struct {
	App core.App
}

func (f EinoModelFactory) ValidateProvider(ctx context.Context, provider *ProviderConfig) error {
	if provider == nil {
		return fmt.Errorf("provider is required")
	}
	if strings.EqualFold(strings.TrimSpace(provider.Protocol), "anthropic") {
		return nil
	}
	if !IsOpenRouterEndpoint(provider.Endpoint) {
		return nil
	}
	var client *http.Client
	if f.App != nil {
		configuredClient, err := httpout.NewPolicyClient(f.App, "http.ai", 90*time.Second, false)
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
	protocol := strings.TrimSpace(strings.ToLower(provider.Protocol))
	if protocol == "anthropic" {
		return newAnthropicStreamer(f.providerHTTPClient(provider), provider), nil
	}
	baseURL := resolveOpenAIBaseURL(provider)
	config := &openai.ChatModelConfig{
		APIKey:  provider.APIKey,
		BaseURL: baseURL,
		Model:   provider.Model,
		Timeout: 90 * time.Second,
	}
	if provider.MaxCompletionTokens != nil && *provider.MaxCompletionTokens > 0 {
		config.MaxCompletionTokens = provider.MaxCompletionTokens
	}
	config.HTTPClient = withProviderHeaders(f.providerHTTPClient(provider), provider)
	model, err := openai.NewChatModel(ctx, config)
	if err != nil {
		return nil, err
	}
	return &einoStreamer{model: model}, nil
}

func (f EinoModelFactory) providerHTTPClient(provider *ProviderConfig) *http.Client {
	if f.App != nil {
		client, err := httpout.NewPolicyClient(f.App, "http.ai", 90*time.Second, false)
		if err == nil {
			return &client
		}
	}
	return nil
}

func resolveOpenAIBaseURL(provider *ProviderConfig) string {
	if provider == nil {
		return ""
	}
	endpoint := strings.TrimRight(strings.TrimSpace(provider.Endpoint), "/")
	if strings.EqualFold(strings.TrimSpace(provider.Protocol), "ollama") && !strings.HasSuffix(strings.ToLower(endpoint), "/v1") {
		return endpoint + "/v1"
	}
	return endpoint
}

type headerRoundTripper struct {
	base      http.RoundTripper
	headers   map[string]string
	overwrite map[string]struct{}
	remove    []string
}

func (t headerRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	for _, key := range t.remove {
		clone.Header.Del(key)
	}
	for key, value := range t.headers {
		if strings.TrimSpace(value) == "" {
			continue
		}
		if _, ok := t.overwrite[key]; !ok && clone.Header.Get(key) != "" {
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
	clone.Transport = headerRoundTripper{
		base:      base,
		headers:   headers,
		overwrite: providerHeaderOverwriteSet(provider),
		remove:    providerHeaderRemovalList(provider),
	}
	return &clone
}

func providerHeaders(provider *ProviderConfig) map[string]string {
	if provider == nil {
		return nil
	}
	headers := authSchemeHeaders(provider.APIKey, provider.AuthScheme)
	endpoint := strings.ToLower(strings.TrimSpace(provider.Endpoint))
	if strings.Contains(endpoint, "openrouter.ai") {
		referer := strings.TrimSpace(provider.HTTPReferer)
		if referer == "" {
			referer = "https://appos.local"
		}
		headers["HTTP-Referer"] = referer
		headers["X-Title"] = "AppOS"
	}
	if len(headers) == 0 {
		return nil
	}
	return headers
}

func providerHeaderOverwriteSet(provider *ProviderConfig) map[string]struct{} {
	if provider == nil {
		return nil
	}
	scheme := strings.TrimSpace(strings.ToLower(provider.AuthScheme))
	if scheme == "" || scheme == "bearer" {
		return nil
	}
	return map[string]struct{}{
		"Authorization": {},
		"x-api-key":     {},
	}
}

func providerHeaderRemovalList(provider *ProviderConfig) []string {
	if provider == nil {
		return nil
	}
	scheme := strings.TrimSpace(strings.ToLower(provider.AuthScheme))
	if scheme == "" || scheme == "bearer" {
		return nil
	}
	return []string{"Authorization", "x-api-key"}
}

func authSchemeHeaders(apiKey string, authScheme string) map[string]string {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return map[string]string{}
	}
	switch strings.TrimSpace(strings.ToLower(authScheme)) {
	case "", "bearer":
		return map[string]string{"Authorization": "Bearer " + apiKey}
	case "api_key":
		return map[string]string{"x-api-key": apiKey}
	case "basic":
		return map[string]string{"Authorization": "Basic " + apiKey}
	case "none":
		return map[string]string{}
	default:
		return map[string]string{"Authorization": "Bearer " + apiKey}
	}
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicRequest struct {
	Model     string             `json:"model"`
	System    string             `json:"system,omitempty"`
	Messages  []anthropicMessage `json:"messages"`
	MaxTokens int                `json:"max_tokens"`
	Stream    bool               `json:"stream"`
}

type anthropicStreamer struct {
	client   *http.Client
	provider *ProviderConfig
}

func newAnthropicStreamer(client *http.Client, provider *ProviderConfig) *anthropicStreamer {
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second}
	}
	return &anthropicStreamer{client: client, provider: provider}
}

func (s *anthropicStreamer) Stream(ctx context.Context, messages []*Message, onChunk func(string) error) (string, error) {
	requestBody := anthropicRequest{
		Model:     strings.TrimSpace(s.provider.Model),
		Messages:  anthropicMessages(messages),
		MaxTokens: anthropicMaxTokens(s.provider),
		Stream:    true,
	}
	if system := anthropicSystemPrompt(messages); system != "" {
		requestBody.System = system
	}
	payload, err := json.Marshal(requestBody)
	if err != nil {
		return "", err
	}
	endpoint := strings.TrimRight(strings.TrimSpace(s.provider.Endpoint), "/") + "/messages"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(payload)))
	if err != nil {
		return "", err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("accept", "text/event-stream")
	for key, value := range authSchemeHeaders(s.provider.APIKey, s.provider.AuthScheme) {
		if strings.TrimSpace(value) != "" {
			req.Header.Set(key, value)
		}
	}
	req.Header.Set("anthropic-version", resolveProviderAnthropicVersion(s.provider))
	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("provider returned non-200: %s: %s", http.StatusText(resp.StatusCode), string(body))
	}

	var builder strings.Builder
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var event map[string]any
		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			continue
		}
		delta, _ := event["delta"].(map[string]any)
		text := strings.TrimSpace(fmt.Sprint(delta["text"]))
		if text == "" || text == "<nil>" {
			continue
		}
		builder.WriteString(text)
		if onChunk != nil {
			if err := onChunk(text); err != nil {
				return "", err
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return builder.String(), nil
}

func anthropicMessages(messages []*Message) []anthropicMessage {
	result := make([]anthropicMessage, 0, len(messages))
	for _, message := range messages {
		if message == nil {
			continue
		}
		role := NormalizeRole(message.Role)
		if role == RoleSystem {
			continue
		}
		content := strings.TrimSpace(message.Content)
		if content == "" {
			continue
		}
		result = append(result, anthropicMessage{Role: role, Content: content})
	}
	return result
}

func anthropicSystemPrompt(messages []*Message) string {
	parts := make([]string, 0, 1)
	for _, message := range messages {
		if message == nil || NormalizeRole(message.Role) != RoleSystem {
			continue
		}
		content := strings.TrimSpace(message.Content)
		if content != "" {
			parts = append(parts, content)
		}
	}
	return strings.Join(parts, "\n\n")
}

func anthropicMaxTokens(provider *ProviderConfig) int {
	if provider != nil && provider.MaxCompletionTokens != nil && *provider.MaxCompletionTokens > 0 {
		return *provider.MaxCompletionTokens
	}
	return 4096
}

func resolveProviderAnthropicVersion(provider *ProviderConfig) string {
	if provider != nil {
		version := strings.TrimSpace(provider.APIVersion)
		if version != "" {
			return version
		}
	}
	return "2023-06-01"
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
