package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/ai/copilot"
	"github.com/websoft9/appos/backend/domain/resource/aiproviders"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/infra/collections"
)

type fakeAICopilotFactory struct{}

func (fakeAICopilotFactory) NewStreamer(context.Context, *copilot.ProviderConfig) (copilot.ModelStreamer, error) {
	return fakeAICopilotStreamer{}, nil
}

type captureAICopilotFactory struct {
	seen **copilot.ProviderConfig
}

func (f captureAICopilotFactory) NewStreamer(_ context.Context, provider *copilot.ProviderConfig) (copilot.ModelStreamer, error) {
	if f.seen != nil {
		clone := *provider
		*f.seen = &clone
	}
	return fakeAICopilotStreamer{}, nil
}

type fakeAICopilotStreamer struct{}

func (fakeAICopilotStreamer) Stream(_ context.Context, messages []*copilot.Message, onChunk func(string) error) (string, error) {
	last := ""
	for _, message := range messages {
		if message.Role == copilot.RoleUser {
			last = message.Content
		}
	}
	parts := []string{"received: ", last}
	for _, part := range parts {
		if err := onChunk(part); err != nil {
			return "", err
		}
	}
	return strings.Join(parts, ""), nil
}

func TestAICopilotRouteStreamsAndPersistsMessages(t *testing.T) {
	oldFactory := aiCopilotModelFactory
	aiCopilotModelFactory = fakeAICopilotFactory{}
	t.Cleanup(func() { aiCopilotModelFactory = oldFactory })

	te := newTestEnv(t)
	defer te.cleanup()
	ensureConnectorSecretRuntime(t)
	seedAICopilotProvider(t, te)

	create := te.doAICopilot(t, http.MethodPost, "/api/ai/copilot/sessions", `{"title":""}`, true)
	if create.Code != http.StatusCreated {
		t.Fatalf("create session status %d body %s", create.Code, create.Body.String())
	}
	sessionID := stringFromJSON(t, create.Body.Bytes(), "id")
	if sessionID == "" {
		t.Fatalf("missing session id in %s", create.Body.String())
	}

	stream := te.doAICopilot(t, http.MethodPost, "/api/ai/copilot/sessions/"+sessionID+"/messages", `{"content":"check nginx"}`, true)
	if stream.Code != http.StatusOK {
		t.Fatalf("stream status %d body %s", stream.Code, stream.Body.String())
	}
	body := stream.Body.String()
	if !strings.Contains(body, "event: chunk") || !strings.Contains(body, "received: ") || !strings.Contains(body, "event: done") {
		t.Fatalf("unexpected stream body: %s", body)
	}

	messages := te.doAICopilot(t, http.MethodGet, "/api/ai/copilot/sessions/"+sessionID+"/messages", "", true)
	if messages.Code != http.StatusOK {
		t.Fatalf("messages status %d body %s", messages.Code, messages.Body.String())
	}
	messageBody := messages.Body.String()
	if !strings.Contains(messageBody, `"role":"user"`) || !strings.Contains(messageBody, `"role":"assistant"`) || !strings.Contains(messageBody, "received: check nginx") {
		t.Fatalf("unexpected messages body: %s", messageBody)
	}
}

func TestAICopilotRouteSupportsAttachmentsAndSessionLifecycle(t *testing.T) {
	oldFactory := aiCopilotModelFactory
	aiCopilotModelFactory = fakeAICopilotFactory{}
	t.Cleanup(func() { aiCopilotModelFactory = oldFactory })

	te := newTestEnv(t)
	defer te.cleanup()
	ensureConnectorSecretRuntime(t)
	seedAICopilotProvider(t, te)

	create := te.doAICopilot(t, http.MethodPost, "/api/ai/copilot/sessions", `{"title":"Draft"}`, true)
	if create.Code != http.StatusCreated {
		t.Fatalf("create session status %d body %s", create.Code, create.Body.String())
	}
	sessionID := stringFromJSON(t, create.Body.Bytes(), "id")

	update := te.doAICopilot(t, http.MethodPatch, "/api/ai/copilot/sessions/"+sessionID, `{"title":"Infra audit"}`, true)
	if update.Code != http.StatusOK {
		t.Fatalf("update session status %d body %s", update.Code, update.Body.String())
	}
	if !strings.Contains(update.Body.String(), `"title":"Infra audit"`) {
		t.Fatalf("unexpected update body: %s", update.Body.String())
	}

	stream := te.doAICopilot(t, http.MethodPost, "/api/ai/copilot/sessions/"+sessionID+"/messages", `{"content":"review this file","attachments":[{"name":"nginx.conf","mime_type":"text/plain","size":18,"text_content":"worker_processes auto;"}]}`, true)
	if stream.Code != http.StatusOK {
		t.Fatalf("stream status %d body %s", stream.Code, stream.Body.String())
	}
	body := stream.Body.String()
	if !strings.Contains(body, "nginx.conf") || !strings.Contains(body, "worker_processes auto") {
		t.Fatalf("unexpected attachment stream body: %s", body)
	}

	messages := te.doAICopilot(t, http.MethodGet, "/api/ai/copilot/sessions/"+sessionID+"/messages", "", true)
	if messages.Code != http.StatusOK {
		t.Fatalf("messages status %d body %s", messages.Code, messages.Body.String())
	}
	messageBody := messages.Body.String()
	if !strings.Contains(messageBody, "APPOS_CHAT_V1") || !strings.Contains(messageBody, "nginx.conf") {
		t.Fatalf("unexpected messages body: %s", messageBody)
	}

	deleted := te.doAICopilot(t, http.MethodDelete, "/api/ai/copilot/sessions/"+sessionID, "", true)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete session status %d body %s", deleted.Code, deleted.Body.String())
	}

	list := te.doAICopilot(t, http.MethodGet, "/api/ai/copilot/sessions", "", true)
	if list.Code != http.StatusOK {
		t.Fatalf("list sessions status %d body %s", list.Code, list.Body.String())
	}
	if strings.Contains(list.Body.String(), sessionID) {
		t.Fatalf("expected deleted session to disappear, got %s", list.Body.String())
	}
}

func TestAICopilotRouteReportsProviderSetupRequired(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	create := te.doAICopilot(t, http.MethodPost, "/api/ai/copilot/sessions", `{}`, true)
	if create.Code != http.StatusCreated {
		t.Fatalf("create session status %d body %s", create.Code, create.Body.String())
	}
	sessionID := stringFromJSON(t, create.Body.Bytes(), "id")

	stream := te.doAICopilot(t, http.MethodPost, "/api/ai/copilot/sessions/"+sessionID+"/messages", `{"content":"hello"}`, true)
	if stream.Code != http.StatusOK {
		t.Fatalf("stream status %d body %s", stream.Code, stream.Body.String())
	}
	if !strings.Contains(stream.Body.String(), copilot.CodeProviderSetupRequired) {
		t.Fatalf("expected provider setup error event, got %s", stream.Body.String())
	}
}

func TestAICopilotRouteUsesSelectedProviderAndModel(t *testing.T) {
	var seen *copilot.ProviderConfig
	oldFactory := aiCopilotModelFactory
	aiCopilotModelFactory = captureAICopilotFactory{seen: &seen}
	t.Cleanup(func() { aiCopilotModelFactory = oldFactory })

	te := newTestEnv(t)
	defer te.cleanup()
	ensureConnectorSecretRuntime(t)
	seedAICopilotProvider(t, te)
	selectedProviderID := seedNamedAICopilotProvider(t, te, "OpenRouter", false, "https://openrouter.ai/api/v1", "openai/gpt-4.1-mini")

	create := te.doAICopilot(t, http.MethodPost, "/api/ai/copilot/sessions", `{"title":""}`, true)
	if create.Code != http.StatusCreated {
		t.Fatalf("create session status %d body %s", create.Code, create.Body.String())
	}
	sessionID := stringFromJSON(t, create.Body.Bytes(), "id")

	body := `{"content":"route through selected provider","provider_id":"` + selectedProviderID + `","model":"anthropic/claude-3.5-sonnet"}`
	stream := te.doAICopilot(t, http.MethodPost, "/api/ai/copilot/sessions/"+sessionID+"/messages", body, true)
	if stream.Code != http.StatusOK {
		t.Fatalf("stream status %d body %s", stream.Code, stream.Body.String())
	}
	if seen == nil {
		t.Fatalf("expected factory to capture provider config")
	}
	if seen.Name != "OpenRouter" {
		t.Fatalf("expected selected provider name OpenRouter, got %s", seen.Name)
	}
	if seen.Endpoint != "https://openrouter.ai/api/v1" {
		t.Fatalf("expected selected provider endpoint, got %s", seen.Endpoint)
	}
	if seen.Model != "anthropic/claude-3.5-sonnet" {
		t.Fatalf("expected request model override, got %s", seen.Model)
	}
}

func (te *testEnv) doAICopilot(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()
	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}
	registerAICopilotRoutes(&core.ServeEvent{Router: r})
	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if authenticated {
		req.Header.Set("Authorization", te.token)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func seedAICopilotProvider(t *testing.T, te *testEnv) {
	t.Helper()
	seedNamedAICopilotProvider(t, te, "DeepSeek", true, "https://api.deepseek.com/v1", "deepseek-chat")
}

func seedNamedAICopilotProvider(t *testing.T, te *testEnv, name string, isDefault bool, endpoint string, model string) string {
	t.Helper()
	secretCol, err := te.app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	enc, err := secrets.EncryptPayload(map[string]any{"apiKey": "test-key"})
	if err != nil {
		t.Fatal(err)
	}
	secret := core.NewRecord(secretCol)
	secret.Set("name", strings.ToLower(strings.ReplaceAll(name, " ", "-"))+"-secret")
	secret.Set("type", "api_key")
	secret.Set("template_id", secrets.TemplateSingleValue)
	secret.Set("scope", "global")
	secret.Set("access_mode", "use_only")
	secret.Set("status", "active")
	secret.Set("version", 1)
	secret.Set("payload_encrypted", enc)
	if err := te.app.Save(secret); err != nil {
		t.Fatal(err)
	}

	providerCol, err := te.app.FindCollectionByNameOrId(collections.AIProviders)
	if err != nil {
		t.Fatal(err)
	}
	provider := core.NewRecord(providerCol)
	provider.Set("name", name)
	provider.Set("kind", aiproviders.KindLLM)
	provider.Set("is_default", isDefault)
	provider.Set("template_id", "deepseek")
	provider.Set("endpoint", endpoint)
	provider.Set("auth_scheme", connectors.AuthSchemeBearer)
	provider.Set("credential", secret.Id)
	provider.Set("config", map[string]any{"defaultModel": model})
	if err := te.app.Save(provider); err != nil {
		t.Fatal(err)
	}
	return provider.Id
}

func stringFromJSON(t *testing.T, data []byte, key string) string {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("decode json: %v", err)
	}
	value, _ := payload[key].(string)
	return value
}
