package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/config/sharedenv"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	"github.com/websoft9/appos/backend/domain/resource/accounts"
	"github.com/websoft9/appos/backend/domain/resource/aiproviders"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	"github.com/websoft9/appos/backend/domain/resource/instances"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

// ═══════════════════════════════════════════════════════════
// Test helpers
// ═══════════════════════════════════════════════════════════

// testEnv wraps a PocketBase test app with a seeded superuser.
type testEnv struct {
	app   *tests.TestApp
	token string
}

var (
	routesTestBaselineOnce sync.Once
	routesTestBaselineDir  string
	routesTestBaselineErr  error
)

const routesTestAdminEmail = "admin@test.com"

func TestMain(m *testing.M) {
	code := m.Run()
	if routesTestBaselineDir != "" {
		_ = os.RemoveAll(routesTestBaselineDir)
	}
	os.Exit(code)
}

func routesTestBaselineDataDir() (string, error) {
	routesTestBaselineOnce.Do(func() {
		app, err := tests.NewTestApp()
		if err != nil {
			routesTestBaselineErr = err
			return
		}

		suCol, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
		if err != nil {
			routesTestBaselineErr = err
			app.Cleanup()
			return
		}
		su := core.NewRecord(suCol)
		su.Set("email", routesTestAdminEmail)
		su.SetPassword("1234567890")
		if err := app.Save(su); err != nil {
			routesTestBaselineErr = err
			app.Cleanup()
			return
		}

		routesTestBaselineDir = app.DataDir()
		routesTestBaselineErr = app.ResetBootstrapState()
	})

	return routesTestBaselineDir, routesTestBaselineErr
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	oldAppConfigBasePath := appConfigBasePath
	appConfigBasePath = t.TempDir()
	t.Cleanup(func() {
		appConfigBasePath = oldAppConfigBasePath
	})

	baselineDir, err := routesTestBaselineDataDir()
	if err != nil {
		t.Fatal(err)
	}

	app, err := tests.NewTestApp(baselineDir)
	if err != nil {
		t.Fatal(err)
	}

	// Reuse the baseline superuser and mint a token in the cloned app.
	su, err := app.FindFirstRecordByData(core.CollectionNameSuperusers, "email", routesTestAdminEmail)
	if err != nil {
		app.Cleanup()
		t.Fatal(err)
	}

	token, err := su.NewStaticAuthToken(0)
	if err != nil {
		app.Cleanup()
		t.Fatal(err)
	}

	return &testEnv{app: app, token: token}
}

func (te *testEnv) cleanup() {
	te.app.Cleanup()
}

// do performs an HTTP API request and returns the response recorder.
func (te *testEnv) do(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	registerAIProviderRoutes(&core.ServeEvent{Router: r})
	registerConnectorRoutes(&core.ServeEvent{Router: r})
	registerInstanceRoutes(&core.ServeEvent{Router: r})
	registerProviderAccountRoutes(&core.ServeEvent{Router: r})

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}

	req := httptest.NewRequest(method, url, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	if authenticated {
		req.Header.Set("Authorization", te.token)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestConnectorTemplatesRequireAuthAndList(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodGet, "/api/connectors/templates", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated list: expected 401, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodGet, "/api/connectors/templates", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("authenticated list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	templates := parseJSONArray(t, rec)
	if len(templates) == 0 {
		t.Fatalf("expected at least one connector template")
	}
	if templates[0]["id"] == nil {
		t.Fatalf("expected connector template to include id")
	}
}

func TestAIProviderTemplatesRequireAuthAndList(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodGet, "/api/ai-providers/templates", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated list: expected 401, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodGet, "/api/ai-providers/templates", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("authenticated list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	templates := parseJSONArray(t, rec)
	if len(templates) == 0 {
		t.Fatalf("expected at least one AI provider template")
	}
	foundXAI := false
	for _, template := range templates {
		if template["kind"] != aiproviders.KindLLM {
			t.Fatalf("expected AI provider template kind %q, got %v", aiproviders.KindLLM, template["kind"])
		}
		if template["id"] == "xai" {
			foundXAI = true
		}
	}
	if !foundXAI {
		t.Fatalf("expected xai AI provider template in list")
	}
}

func TestAIProviderTemplateGet(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodGet, "/api/ai-providers/templates/openai", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get openai AI provider template: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	template := parseJSON(t, rec)
	if template["id"] != "openai" {
		t.Fatalf("expected template id openai, got %v", template["id"])
	}
	if template["kind"] != aiproviders.KindLLM {
		t.Fatalf("expected template kind %q, got %v", aiproviders.KindLLM, template["kind"])
	}

	rec = te.do(t, http.MethodGet, "/api/ai-providers/templates/xai", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get xai AI provider template: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	template = parseJSON(t, rec)
	if template["id"] != "xai" {
		t.Fatalf("expected template id xai, got %v", template["id"])
	}

	rec = te.do(t, http.MethodGet, "/api/ai-providers/templates/not-found", "", true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected missing template to return 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAIProvidersCRUD(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newTestEnv(t)
	defer te.cleanup()
	secret := createRouteSecret(t, te, "global", "")
	otherSecret := createRouteSecret(t, te, "global", "")

	rec := te.do(t, http.MethodPost, "/api/ai-providers",
		`{"name":"workspace-openai","is_default":true,"template_id":"openai","credential":"`+secret.Id+`","config":{"defaultModel":"gpt-4.1-mini"}}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create AI provider: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	id := created["id"].(string)
	if created["endpoint"] != "https://api.openai.com/v1" {
		t.Fatalf("expected template default endpoint, got %v", created["endpoint"])
	}
	if created["auth_scheme"] != connectors.AuthSchemeBearer {
		t.Fatalf("expected template default auth scheme %q, got %v", connectors.AuthSchemeBearer, created["auth_scheme"])
	}
	if created["kind"] != aiproviders.KindLLM {
		t.Fatalf("expected kind %q, got %v", aiproviders.KindLLM, created["kind"])
	}

	rec = te.do(t, http.MethodGet, "/api/ai-providers/"+id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get AI provider: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodPut, "/api/ai-providers/"+id,
		`{"name":"workspace-anthropic","is_default":false,"template_id":"anthropic","endpoint":"https://api.anthropic.com","auth_scheme":"api_key","credential":"`+secret.Id+`","config":{"version":"2023-06-01"}}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("update AI provider: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	updated := parseJSON(t, rec)
	if updated["template_id"] != "anthropic" {
		t.Fatalf("expected template_id anthropic after update, got %v", updated["template_id"])
	}
	if updated["is_default"] != false {
		t.Fatalf("expected is_default false after update, got %v", updated["is_default"])
	}

	rec = te.do(t, http.MethodPost, "/api/ai-providers",
		`{"name":"fallback-openai","is_default":true,"template_id":"openai","credential":"`+otherSecret.Id+`"}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create second default AI provider: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	otherID := parseJSON(t, rec)["id"].(string)

	rec = te.do(t, http.MethodGet, "/api/ai-providers/"+id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get first AI provider after second default: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if parseJSON(t, rec)["is_default"] != false {
		t.Fatalf("expected first AI provider default flag to be cleared")
	}

	rec = te.do(t, http.MethodGet, "/api/ai-providers", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("list AI providers: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	list := parseJSONArray(t, rec)
	if len(list) != 2 {
		t.Fatalf("expected 2 AI providers, got %d", len(list))
	}

	rec = te.do(t, http.MethodPost, "/api/ai-providers",
		`{"name":"bad-provider","kind":"webhook","template_id":"openai"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unsupported AI provider kind: expected 400, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodDelete, "/api/ai-providers/"+id, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete AI provider: expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := te.app.FindRecordById("secrets", secret.Id); err == nil {
		t.Fatalf("expected deleted AI provider secret %s to be removed", secret.Id)
	}
	if _, err := te.app.FindRecordById("secrets", otherSecret.Id); err != nil {
		t.Fatalf("expected second AI provider secret %s to remain before provider delete: %v", otherSecret.Id, err)
	}
	rec = te.do(t, http.MethodDelete, "/api/ai-providers/"+otherID, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete second AI provider: expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := te.app.FindRecordById("secrets", otherSecret.Id); err == nil {
		t.Fatalf("expected deleted second AI provider secret %s to be removed", otherSecret.Id)
	}
}

func TestAIProvidersPersistEnabledModels(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newTestEnv(t)
	defer te.cleanup()
	secret := createRouteSecret(t, te, "global", "")

	rec := te.do(t, http.MethodPost, "/api/ai-providers",
		`{"name":"gateway-openrouter","template_id":"openrouter","credential":"`+secret.Id+`","enabled_models":["openai/gpt-4.1-mini","anthropic/claude-3.5-sonnet"]}`,
		true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create AI provider with enabled models: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	providerID := created["id"].(string)
	enabledModels, ok := created["enabled_models"].([]any)
	if !ok || len(enabledModels) != 2 {
		t.Fatalf("expected enabled_models in create response, got %#v", created["enabled_models"])
	}

	rec = te.do(t, http.MethodGet, "/api/ai-providers/"+providerID, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get AI provider: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	got := parseJSON(t, rec)
	enabledModels, ok = got["enabled_models"].([]any)
	if !ok || len(enabledModels) != 2 {
		t.Fatalf("expected enabled_models in get response, got %#v", got["enabled_models"])
	}

	rec = te.do(t, http.MethodPut, "/api/ai-providers/"+providerID,
		`{"name":"gateway-openrouter","template_id":"openrouter","credential":"`+secret.Id+`","enabled_models":["openai/gpt-4.1-mini"]}`,
		true)
	if rec.Code != http.StatusOK {
		t.Fatalf("update AI provider enabled models: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	updated := parseJSON(t, rec)
	enabledModels, ok = updated["enabled_models"].([]any)
	if !ok || len(enabledModels) != 1 || enabledModels[0] != "openai/gpt-4.1-mini" {
		t.Fatalf("expected enabled_models to update, got %#v", updated["enabled_models"])
	}
}

func TestFetchProviderModelsGoogleGeminiDirectEndpointUsesAPIKeyQueryAndFiltersGenerativeModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1beta/models" {
			t.Fatalf("expected path /v1beta/models, got %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("key"); got != "gemini-test-key" {
			t.Fatalf("expected api key query param, got %q", got)
		}
		if got := r.Header.Get("Authorization"); got != "" {
			t.Fatalf("expected no Authorization header for Gemini, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"models": [
			  {"name": "models/gemini-3.5-flash", "supportedGenerationMethods": ["generateContent", "streamGenerateContent"]},
			  {"name": "models/gemini-3.1-pro-preview", "supportedGenerationMethods": ["generateContent"]},
			  {"name": "models/text-embedding-004", "supportedGenerationMethods": ["embedContent"]}
			]
		}`))
	}))
	defer server.Close()

	result, err := fetchProviderModels(nil, context.Background(), server.URL+"/v1beta", "gemini-test-key", "api_key", "google-gemini", "")
	if err != nil {
		t.Fatalf("fetch gemini provider models: %v", err)
	}
	if len(result.Models) != 2 {
		t.Fatalf("expected 2 generative Gemini models, got %d: %#v", len(result.Models), result.Models)
	}
	ids := map[string]bool{}
	for _, model := range result.Models {
		ids[model.ID] = model.EnabledByDefault
	}
	if ids["gemini-3.1-pro-preview"] {
		t.Fatalf("expected gemini-3.1-pro-preview to remain opt-in, got %#v", result.Models)
	}
	if !ids["gemini-3.5-flash"] {
		t.Fatalf("expected gemini-3.5-flash enabled by default, got %#v", result.Models)
	}
}

func TestFetchProviderModelsGoogleGeminiOpenAIEndpointUsesBearerAuth(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1beta/openai/models" {
			t.Fatalf("expected path /v1beta/openai/models, got %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer gemini-test-key" {
			t.Fatalf("expected bearer auth for Gemini OpenAI endpoint, got %q", got)
		}
		if got := r.URL.Query().Get("key"); got != "" {
			t.Fatalf("expected no query api key for Gemini OpenAI endpoint, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"data": [
			  {"id": "gemini-3.5-flash"},
			  {"id": "gemini-3.1-pro-preview"}
			]
		}`))
	}))
	defer server.Close()

	result, err := fetchProviderModels(nil, context.Background(), server.URL+"/v1beta/openai", "gemini-test-key", "bearer", "google-gemini", "openai")
	if err != nil {
		t.Fatalf("fetch Gemini OpenAI-compatible models: %v", err)
	}
	if len(result.Models) != 2 {
		t.Fatalf("expected 2 Gemini OpenAI-compatible models, got %d: %#v", len(result.Models), result.Models)
	}
}

func TestFetchProviderModelsUsesConfiguredSocks5Proxy(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	ensureDockerSecretRuntime(t)

	modelServerHits := 0
	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		modelServerHits++
		if r.URL.Path != "/v1beta/models" {
			t.Fatalf("expected path /v1beta/models, got %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("key"); got != "gemini-test-key" {
			t.Fatalf("expected api key query param, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"models":[{"name":"models/gemini-3.5-flash","supportedGenerationMethods":["generateContent"]}]}`))
	}))
	defer modelServer.Close()
	_, modelServerPort, err := net.SplitHostPort(strings.TrimPrefix(modelServer.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	proxiedEndpoint := "http://model-through-proxy.test:" + modelServerPort + "/v1beta"

	proxyHits := 0
	proxiedTargets := make(chan string, 1)
	proxyListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer proxyListener.Close()
	go func() {
		for {
			conn, acceptErr := proxyListener.Accept()
			if acceptErr != nil {
				return
			}
			go func(conn net.Conn) {
				defer conn.Close()
				proxyHits++
				head := make([]byte, 2)
				if _, err := io.ReadFull(conn, head); err != nil {
					return
				}
				if head[0] != 0x05 {
					return
				}
				methods := make([]byte, int(head[1]))
				if _, err := io.ReadFull(conn, methods); err != nil {
					return
				}
				if _, err := conn.Write([]byte{0x05, 0x00}); err != nil {
					return
				}

				requestHead := make([]byte, 4)
				if _, err := io.ReadFull(conn, requestHead); err != nil {
					return
				}
				if requestHead[0] != 0x05 || requestHead[1] != 0x01 {
					return
				}

				var host string
				switch requestHead[3] {
				case 0x01:
					addr := make([]byte, 4)
					if _, err := io.ReadFull(conn, addr); err != nil {
						return
					}
					host = net.IP(addr).String()
				case 0x03:
					length := make([]byte, 1)
					if _, err := io.ReadFull(conn, length); err != nil {
						return
					}
					name := make([]byte, int(length[0]))
					if _, err := io.ReadFull(conn, name); err != nil {
						return
					}
					host = string(name)
				case 0x04:
					addr := make([]byte, 16)
					if _, err := io.ReadFull(conn, addr); err != nil {
						return
					}
					host = net.IP(addr).String()
				default:
					return
				}
				portBytes := make([]byte, 2)
				if _, err := io.ReadFull(conn, portBytes); err != nil {
					return
				}
				port := int(portBytes[0])<<8 | int(portBytes[1])
				target := net.JoinHostPort(host, fmt.Sprintf("%d", port))
				select {
				case proxiedTargets <- target:
				default:
				}

				dialTarget := target
				if host == "model-through-proxy.test" {
					dialTarget = strings.TrimPrefix(modelServer.URL, "http://")
				}
				upstream, err := net.Dial("tcp", dialTarget)
				if err != nil {
					_, _ = conn.Write([]byte{0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
					return
				}
				defer upstream.Close()
				if _, err := conn.Write([]byte{0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0}); err != nil {
					return
				}

				copyDone := make(chan struct{}, 1)
				go func() {
					_, _ = io.Copy(upstream, conn)
					if tcpConn, ok := upstream.(*net.TCPConn); ok {
						_ = tcpConn.CloseWrite()
					}
					copyDone <- struct{}{}
				}()
				_, _ = io.Copy(conn, upstream)
				<-copyDone
			}(conn)
		}
	}()

	proxyConnector := createDockerRouteConnector(t, te, connectors.SaveInput{
		Name:       "SOCKS5 Proxy",
		Kind:       connectors.KindProxy,
		TemplateID: "socks5-proxy",
		Endpoint:   "socks5://" + proxyListener.Addr().String(),
		Config:     map[string]any{"protocol": "socks5"},
	})
	if err := sysconfig.SetGroup(te.app, "proxy", "network", map[string]any{
		"source":            "external",
		"enabled":           true,
		"socks5ConnectorId": proxyConnector.Id,
		"httpConnectorId":   "",
		"httpsConnectorId":  "",
	}); err != nil {
		t.Fatal(err)
	}
	if err := sysconfig.SetGroup(te.app, "proxy", "policies", map[string]any{
		"items": []map[string]any{{
			"consumerKey": "http.ai",
			"mode":        "always",
		}},
	}); err != nil {
		t.Fatal(err)
	}

	result, err := fetchProviderModels(te.app, context.Background(), proxiedEndpoint, "gemini-test-key", "api_key", "google-gemini", "")
	if err != nil {
		t.Fatalf("fetch gemini provider models via socks5 proxy: %v", err)
	}
	if proxyHits == 0 {
		t.Fatal("expected SOCKS5 proxy to receive the AI provider request")
	}
	if modelServerHits != 1 {
		t.Fatalf("expected model server to receive exactly one request, got %d", modelServerHits)
	}
	select {
	case target := <-proxiedTargets:
		if target != net.JoinHostPort("model-through-proxy.test", modelServerPort) {
			t.Fatalf("expected proxy target to include model server address, got %q", target)
		}
	default:
		t.Fatal("expected SOCKS5 proxy to capture the upstream target")
	}
	if len(result.Models) != 1 || result.Models[0].ID != "gemini-3.5-flash" {
		t.Fatalf("unexpected proxied fetch result: %#v", result.Models)
	}
}

func TestGoogleGemini1926ProxyConsumerEnrollmentControlsProxyUsage(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newTestEnv(t)
	defer te.cleanup()

	modelServerHits := 0
	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		modelServerHits++
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"models":[{"name":"models/gemini-3.5-flash","displayName":"Gemini 3.5 Flash","supportedGenerationMethods":["generateContent"]}]}`)
	}))
	defer modelServer.Close()

	proxiedEndpoint := "http://model-through-proxy.test/v1beta"
	proxyHits := 0
	proxyListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer proxyListener.Close()

	go func() {
		for {
			conn, acceptErr := proxyListener.Accept()
			if acceptErr != nil {
				return
			}
			go func(conn net.Conn) {
				defer conn.Close()
				proxyHits++
				greeting := make([]byte, 2)
				if _, err := io.ReadFull(conn, greeting); err != nil {
					return
				}
				methods := make([]byte, int(greeting[1]))
				if _, err := io.ReadFull(conn, methods); err != nil {
					return
				}
				if _, err := conn.Write([]byte{0x05, 0x00}); err != nil {
					return
				}

				header := make([]byte, 4)
				if _, err := io.ReadFull(conn, header); err != nil {
					return
				}
				if header[3] != 0x03 {
					return
				}
				length := make([]byte, 1)
				if _, err := io.ReadFull(conn, length); err != nil {
					return
				}
				name := make([]byte, int(length[0]))
				if _, err := io.ReadFull(conn, name); err != nil {
					return
				}
				host := string(name)
				portBytes := make([]byte, 2)
				if _, err := io.ReadFull(conn, portBytes); err != nil {
					return
				}
				port := int(portBytes[0])<<8 | int(portBytes[1])
				dialTarget := net.JoinHostPort(host, fmt.Sprintf("%d", port))
				if host == "model-through-proxy.test" {
					dialTarget = strings.TrimPrefix(modelServer.URL, "http://")
				}
				upstream, err := net.Dial("tcp", dialTarget)
				if err != nil {
					_, _ = conn.Write([]byte{0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
					return
				}
				defer upstream.Close()
				if _, err := conn.Write([]byte{0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0}); err != nil {
					return
				}
				copyDone := make(chan struct{}, 1)
				go func() {
					_, _ = io.Copy(upstream, conn)
					if tcpConn, ok := upstream.(*net.TCPConn); ok {
						_ = tcpConn.CloseWrite()
					}
					copyDone <- struct{}{}
				}()
				_, _ = io.Copy(conn, upstream)
				<-copyDone
			}(conn)
		}
	}()

	proxyConnector := createDockerRouteConnector(t, te, connectors.SaveInput{
		Name:       "SOCKS5 Proxy",
		Kind:       connectors.KindProxy,
		TemplateID: "socks5-proxy",
		Endpoint:   "socks5://" + proxyListener.Addr().String(),
		Config:     map[string]any{"protocol": "socks5"},
	})
	if err := sysconfig.SetGroup(te.app, "proxy", "network", map[string]any{
		"source":            "external",
		"enabled":           true,
		"socks5ConnectorId": proxyConnector.Id,
		"httpConnectorId":   "",
		"httpsConnectorId":  "",
	}); err != nil {
		t.Fatal(err)
	}
	if err := sysconfig.SetGroup(te.app, "proxy", "policies", map[string]any{
		"items": []map[string]any{{
			"consumerKey": "http.ai",
			"mode":        "disabled",
		}},
	}); err != nil {
		t.Fatal(err)
	}

	if _, err := fetchProviderModels(te.app, context.Background(), proxiedEndpoint, "gemini-test-key", "api_key", "google-gemini", ""); err == nil {
		t.Fatal("expected direct request without consumer enrollment to fail for proxy-only host")
	}
	if proxyHits != 0 {
		t.Fatalf("expected no proxy traffic while http.ai is disabled, got %d hits", proxyHits)
	}

	if err := sysconfig.SetGroup(te.app, "proxy", "policies", map[string]any{
		"items": []map[string]any{{
			"consumerKey": "http.ai",
			"mode":        "always",
		}},
	}); err != nil {
		t.Fatal(err)
	}

	result, err := fetchProviderModels(te.app, context.Background(), proxiedEndpoint, "gemini-test-key", "api_key", "google-gemini", "")
	if err != nil {
		t.Fatalf("expected proxied gemini fetch after enabling consumer enrollment: %v", err)
	}
	if proxyHits == 0 {
		t.Fatal("expected proxy hit after enabling http.ai policy")
	}
	if modelServerHits != 1 {
		t.Fatalf("expected exactly one successful model server hit, got %d", modelServerHits)
	}
	if len(result.Models) != 1 || result.Models[0].ID != "gemini-3.5-flash" {
		t.Fatalf("unexpected gemini models payload: %#v", result.Models)
	}
}

func TestResolveAWSBedrockModelsURL(t *testing.T) {
	url, err := resolveAWSBedrockModelsURL("https://bedrock-mantle.us-east-1.api.aws/openai/v1")
	if err != nil {
		t.Fatalf("resolve bedrock-mantle models URL: %v", err)
	}
	if url != "https://bedrock-mantle.us-east-1.api.aws/openai/v1/models" {
		t.Fatalf("bedrock-mantle should keep the OpenAI-compatible path, got: %s", url)
	}

	url, err = resolveAWSBedrockModelsURL("https://bedrock-runtime.eu-west-1.amazonaws.com/openai/v1")
	if err != nil {
		t.Fatalf("resolve AWS Bedrock runtime models URL: %v", err)
	}
	if url != "https://bedrock.eu-west-1.amazonaws.com/foundation-models" {
		t.Fatalf("unexpected AWS Bedrock runtime models URL: %s", url)
	}
}

func TestBuildFetchModelsResponseAWSBedrockFiltersTextModels(t *testing.T) {
	parsed := map[string]any{
		"modelSummaries": []any{
			map[string]any{"modelId": "anthropic.claude-3-5-sonnet-20240620-v1:0", "providerName": "Anthropic", "outputModalities": []any{"TEXT"}},
			map[string]any{"modelId": "amazon.nova-pro-v1:0", "providerName": "Amazon", "outputModalities": []any{"TEXT", "IMAGE"}},
			map[string]any{"modelId": "amazon.titan-image-v1", "providerName": "Amazon", "outputModalities": []any{"IMAGE"}},
		},
	}
	defaultEnabled := map[string]struct{}{
		"anthropic.claude-3-5-sonnet-20240620-v1:0": {},
		"amazon.nova-pro-v1:0":                      {},
	}
	result := buildFetchModelsResponse(parsed, defaultEnabled, "aws-bedrock")
	if len(result.Models) != 2 {
		t.Fatalf("expected 2 text-output Bedrock models, got %d: %#v", len(result.Models), result.Models)
	}
	if result.Models[0].ID != "anthropic.claude-3-5-sonnet-20240620-v1:0" || !result.Models[0].EnabledByDefault {
		t.Fatalf("expected anthropic.claude-3-5-sonnet-20240620-v1:0 enabled by default, got %#v", result.Models[0])
	}
	if result.Models[1].ID != "amazon.nova-pro-v1:0" || !result.Models[1].EnabledByDefault {
		t.Fatalf("expected amazon.nova-pro-v1:0 enabled by default, got %#v", result.Models[1])
	}
}

func TestAIProviderDefaultsAndChatModels(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newTestEnv(t)
	defer te.cleanup()
	secret := createRouteSecret(t, te, "global", "")

	createBody := func(name string) string {
		return `{"name":"` + name + `","template_id":"openrouter","credential":"` + secret.Id + `","endpoint":"https://openrouter.ai/api/v1","enabled_models":["openai/gpt-4.1-mini"]}`
	}

	rec := te.do(t, http.MethodPost, "/api/ai-providers", createBody("OpenRouter Alpha"), true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create first gateway provider: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	firstID := parseJSON(t, rec)["id"].(string)

	rec = te.do(t, http.MethodPost, "/api/ai-providers", createBody("OpenRouter Beta"), true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create second gateway provider: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	secondID := parseJSON(t, rec)["id"].(string)

	rec = te.do(t, http.MethodGet, "/api/ai-providers/chat-models", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get chat models before defaults: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	chatModelsPayload := parseJSON(t, rec)
	items, ok := chatModelsPayload["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("expected a single merged chat model, got %#v", chatModelsPayload["items"])
	}
	firstItem, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("expected chat model item object, got %#v", items[0])
	}
	if firstItem["provider_id"] != firstID {
		t.Fatalf("expected earliest provider to win before defaults, got %v", firstItem["provider_id"])
	}
	if firstItem["label"] != "openai/gpt-4.1-mini · OpenRouter" {
		t.Fatalf("expected gateway label, got %v", firstItem["label"])
	}
	if firstItem["max_completion_tokens"] != float64(31100) {
		t.Fatalf("expected max_completion_tokens 31100, got %#v", firstItem["max_completion_tokens"])
	}

	rec = te.do(t, http.MethodPut, "/api/ai-providers/defaults", `{"items":[{"endpoint":"https://openrouter.ai/api/v1","provider_id":"`+secondID+`"}]}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("save AI provider defaults: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	defaultsPayload := parseJSON(t, rec)
	defaultItems, ok := defaultsPayload["items"].([]any)
	if !ok || len(defaultItems) != 1 {
		t.Fatalf("expected one defaults row, got %#v", defaultsPayload["items"])
	}

	rec = te.do(t, http.MethodGet, "/api/ai-providers/defaults", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get AI provider defaults: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	defaultsPayload = parseJSON(t, rec)
	defaultItems, ok = defaultsPayload["items"].([]any)
	if !ok || len(defaultItems) != 1 {
		t.Fatalf("expected persisted defaults rows, got %#v", defaultsPayload["items"])
	}
	defaultItem, ok := defaultItems[0].(map[string]any)
	if !ok || defaultItem["provider_id"] != secondID {
		t.Fatalf("expected persisted default provider %s, got %#v", secondID, defaultsPayload["items"])
	}

	rec = te.do(t, http.MethodGet, "/api/ai-providers/chat-models", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get chat models after defaults: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	chatModelsPayload = parseJSON(t, rec)
	items, ok = chatModelsPayload["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("expected a single merged chat model after defaults, got %#v", chatModelsPayload["items"])
	}
	selectedItem, ok := items[0].(map[string]any)
	if !ok || selectedItem["provider_id"] != secondID {
		t.Fatalf("expected configured provider to win after defaults, got %#v", chatModelsPayload["items"])
	}
}

func TestConnectorTemplateGet(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodGet, "/api/connectors/templates/generic-webhook", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get generic-webhook template: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	template := parseJSON(t, rec)
	if template["id"] != "generic-webhook" {
		t.Fatalf("expected template id generic-webhook, got %v", template["id"])
	}
	if template["kind"] != "webhook" {
		t.Fatalf("expected template kind webhook, got %v", template["kind"])
	}
	if template["defaultAuthScheme"] != connectors.AuthSchemeBearer {
		t.Fatalf("expected template default auth scheme %q, got %v", connectors.AuthSchemeBearer, template["defaultAuthScheme"])
	}

	rec = te.do(t, http.MethodGet, "/api/connectors/templates/generic-http-gateway", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get generic-http-gateway template: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	template = parseJSON(t, rec)
	if template["kind"] != connectors.KindHTTPGateway {
		t.Fatalf("expected template kind %q, got %v", connectors.KindHTTPGateway, template["kind"])
	}
	if template["defaultAuthScheme"] != connectors.AuthSchemeBearer {
		t.Fatalf("expected template default auth scheme %q, got %v", connectors.AuthSchemeBearer, template["defaultAuthScheme"])
	}

	rec = te.do(t, http.MethodGet, "/api/connectors/templates/not-found", "", true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected missing template to return 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestConnectorsListByKindFilter(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodPost, "/api/connectors",
		`{"name":"ops-webhook","kind":"webhook","template_id":"generic-webhook","endpoint":"https://hooks.example.com/deploy","auth_scheme":"bearer"}`,
		true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create webhook connector: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodPost, "/api/connectors",
		`{"name":"smtp-prod","kind":"smtp","template_id":"generic-smtp","endpoint":"smtp://smtp.example.com:587","auth_scheme":"basic"}`,
		true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create smtp connector: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodGet, "/api/connectors?kind=webhook,mcp", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("filter connectors: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	list := parseJSONArray(t, rec)
	if len(list) != 1 {
		t.Fatalf("expected 1 filtered connector, got %d", len(list))
	}
	if list[0]["kind"] != "webhook" {
		t.Fatalf("expected webhook connector, got %v", list[0]["kind"])
	}
}

func TestConnectorsCRUD(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodPost, "/api/connectors",
		`{"name":"workspace-webhook","kind":"webhook","template_id":"generic-webhook","endpoint":"https://hooks.example.com/workspace","config":{"event":"deploy.finished"}}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create connector: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	id := created["id"].(string)
	if created["endpoint"] != "https://hooks.example.com/workspace" {
		t.Fatalf("expected template default endpoint, got %v", created["endpoint"])
	}
	if created["auth_scheme"] != connectors.AuthSchemeBearer {
		t.Fatalf("expected template default auth scheme %q, got %v", connectors.AuthSchemeBearer, created["auth_scheme"])
	}

	rec = te.do(t, http.MethodGet, "/api/connectors/"+id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get connector: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	got := parseJSON(t, rec)
	if got["template_id"] != "generic-webhook" {
		t.Fatalf("expected template_id generic-webhook, got %v", got["template_id"])
	}

	rec = te.do(t, http.MethodPut, "/api/connectors/"+id,
		`{"name":"workspace-webhook-updated","kind":"webhook","template_id":"generic-webhook","endpoint":"https://hooks.example.com/updated","auth_scheme":"none","config":{"event":"deploy.succeeded"}}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("update connector: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	updated := parseJSON(t, rec)
	if updated["template_id"] != "generic-webhook" {
		t.Fatalf("expected template_id generic-webhook after update, got %v", updated["template_id"])
	}

	rec = te.do(t, http.MethodPost, "/api/connectors",
		`{"name":"fallback-webhook","kind":"webhook","template_id":"generic-webhook","endpoint":"https://hooks.example.com/fallback"}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create second connector: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	otherID := parseJSON(t, rec)["id"].(string)

	rec = te.do(t, http.MethodGet, "/api/connectors", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("list connectors: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	list := parseJSONArray(t, rec)
	if len(list) != 2 {
		t.Fatalf("expected 2 connectors, got %d", len(list))
	}

	rec = te.do(t, http.MethodPost, "/api/connectors",
		`{"name":"bad-webhook","kind":"webhook","template_id":"openai"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("mismatched template kind: expected 400, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodDelete, "/api/connectors/"+id, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete connector: expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	rec = te.do(t, http.MethodDelete, "/api/connectors/"+otherID, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete second connector: expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestInstanceTemplatesRequireAuthAndList(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodGet, "/api/instances/templates", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated list: expected 401, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodGet, "/api/instances/templates", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("authenticated list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	templates := parseJSONArray(t, rec)
	if len(templates) == 0 {
		t.Fatalf("expected at least one instance template")
	}
	if templates[0]["id"] == nil {
		t.Fatalf("expected instance template to include id")
	}
	foundDatabaseLayout := false
	for _, template := range templates {
		if template["layoutPreset"] == "database_connection" {
			foundDatabaseLayout = true
			if template["endpointShape"] != "host_port" {
				t.Fatalf("expected database layout template endpointShape host_port, got %v", template["endpointShape"])
			}
			if template["credentialPresentation"] != "secret_or_inline" {
				t.Fatalf("expected database layout template credentialPresentation secret_or_inline, got %v", template["credentialPresentation"])
			}
			break
		}
	}
	if !foundDatabaseLayout {
		t.Fatalf("expected at least one instance template with database_connection layoutPreset")
	}
}

func TestInstanceTemplateGet(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodGet, "/api/instances/templates/generic-postgres", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get postgres template: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	template := parseJSON(t, rec)
	if template["id"] != "generic-postgres" {
		t.Fatalf("expected template id generic-postgres, got %v", template["id"])
	}
	if template["kind"] != instances.KindPostgresCompatible {
		t.Fatalf("expected template kind %q, got %v", instances.KindPostgresCompatible, template["kind"])
	}
	if template["layoutPreset"] != "database_connection" {
		t.Fatalf("expected layoutPreset database_connection, got %v", template["layoutPreset"])
	}
	if template["endpointShape"] != "host_port" {
		t.Fatalf("expected endpointShape host_port, got %v", template["endpointShape"])
	}
	if template["defaultPort"] != float64(5432) {
		t.Fatalf("expected defaultPort 5432, got %v", template["defaultPort"])
	}
	if template["credentialPresentation"] != "secret_or_inline" {
		t.Fatalf("expected credentialPresentation secret_or_inline, got %v", template["credentialPresentation"])
	}
	if template["credentialLabel"] != "password" {
		t.Fatalf("expected credentialLabel password, got %v", template["credentialLabel"])
	}
	fields, ok := template["fields"].([]any)
	if !ok || len(fields) == 0 {
		t.Fatalf("expected template fields, got %v", template["fields"])
	}
	foundUsernameField := false
	foundTimeoutField := false
	foundSSLEnabledField := false
	foundCertificateField := false
	for _, raw := range fields {
		field, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if field["id"] == "username" {
			foundUsernameField = true
		}
		if field["id"] == "connect_timeout" {
			foundTimeoutField = true
		}
		if field["id"] == "ssl_enabled" {
			foundSSLEnabledField = true
		}
		if field["id"] == "ssl_ca_certificate" {
			foundCertificateField = true
			if field["type"] != "certificate_ref" {
				t.Fatalf("expected ssl_ca_certificate type certificate_ref, got %v", field["type"])
			}
			showWhen, ok := field["showWhen"].(map[string]any)
			if !ok || showWhen["field"] != "ssl_mode" {
				t.Fatalf("expected ssl_ca_certificate showWhen to target ssl_mode, got %v", field["showWhen"])
			}
		}
	}
	if !foundUsernameField {
		t.Fatalf("expected postgres template to declare username field explicitly")
	}
	if !foundTimeoutField {
		t.Fatalf("expected postgres template to declare connect_timeout field explicitly")
	}
	if !foundSSLEnabledField {
		t.Fatalf("expected postgres template to declare ssl_enabled field explicitly")
	}
	if !foundCertificateField {
		t.Fatalf("expected postgres template to include ssl_ca_certificate field")
	}
	traits, ok := template["traits"].([]any)
	if !ok || len(traits) == 0 {
		t.Fatalf("expected template traits, got %v", template["traits"])
	}
	hasSQLTrait := false
	for _, trait := range traits {
		if trait == "sql" {
			hasSQLTrait = true
			break
		}
	}
	if !hasSQLTrait {
		t.Fatalf("expected generic-postgres traits to include sql, got %v", template["traits"])
	}

	rec = te.do(t, http.MethodGet, "/api/instances/templates/not-found", "", true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected missing template to return 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestInstanceTemplateMetadataVariants(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodGet, "/api/instances/templates/generic-influxdb", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get influxdb template: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	influxTemplate := parseJSON(t, rec)
	if influxTemplate["credentialLabel"] != "credential" {
		t.Fatalf("expected influxdb credentialLabel credential, got %v", influxTemplate["credentialLabel"])
	}
	influxFields, ok := influxTemplate["fields"].([]any)
	if !ok || len(influxFields) == 0 {
		t.Fatalf("expected influxdb fields, got %v", influxTemplate["fields"])
	}
	foundOrganizationField := false
	foundBucketField := false
	foundUsernameField := false
	for _, raw := range influxFields {
		field, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		switch field["id"] {
		case "organization":
			foundOrganizationField = true
		case "bucket":
			foundBucketField = true
		case "username":
			foundUsernameField = true
		}
	}
	if !foundOrganizationField || !foundBucketField {
		t.Fatalf("expected influxdb template to expose organization and bucket fields, got %v", influxTemplate["fields"])
	}
	if foundUsernameField {
		t.Fatalf("expected influxdb token-style template without username field, got %v", influxTemplate["fields"])
	}

	rec = te.do(t, http.MethodGet, "/api/instances/templates/generic-kafka", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get kafka template: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	kafkaTemplate := parseJSON(t, rec)
	if kafkaTemplate["credentialLabel"] != "password" {
		t.Fatalf("expected kafka credentialLabel password, got %v", kafkaTemplate["credentialLabel"])
	}
	if kafkaTemplate["defaultProtocolHint"] != "kafka" {
		t.Fatalf("expected kafka defaultProtocolHint kafka, got %v", kafkaTemplate["defaultProtocolHint"])
	}

	rec = te.do(t, http.MethodGet, "/api/instances/templates/generic-s3", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get s3 template: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	s3Template := parseJSON(t, rec)
	if s3Template["credentialPresentation"] != "secret_or_inline" {
		t.Fatalf("expected s3 credentialPresentation secret_or_inline, got %v", s3Template["credentialPresentation"])
	}
	s3Fields, ok := s3Template["fields"].([]any)
	if !ok || len(s3Fields) == 0 {
		t.Fatalf("expected s3 fields, got %v", s3Template["fields"])
	}
	foundAccessKeyID := false
	foundPathStyle := false
	for _, raw := range s3Fields {
		field, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		switch field["id"] {
		case "accessKeyId":
			foundAccessKeyID = true
		case "forcePathStyle":
			foundPathStyle = true
		}
	}
	if !foundAccessKeyID || !foundPathStyle {
		t.Fatalf("expected s3 template to expose access key and path-style controls, got %v", s3Template["fields"])
	}
}

func TestInstancesCRUD(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodPost, "/api/instances",
		`{"name":"primary-rabbit","kind":"amqp-compatible","template_id":"generic-rabbitmq"}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create instance: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	id := created["id"].(string)
	if created["endpoint"] != "amqp://rabbitmq.internal:5672" {
		t.Fatalf("expected template default endpoint, got %v", created["endpoint"])
	}
	if created["template_id"] != "generic-rabbitmq" {
		t.Fatalf("expected template_id generic-rabbitmq, got %v", created["template_id"])
	}
	createdTraits, ok := created["traits"].([]any)
	if !ok || len(createdTraits) == 0 {
		t.Fatalf("expected created instance traits, got %v", created["traits"])
	}

	rec = te.do(t, http.MethodGet, "/api/instances/"+id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get instance: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	got := parseJSON(t, rec)
	gotTraits, ok := got["traits"].([]any)
	if !ok || len(gotTraits) == 0 {
		t.Fatalf("expected fetched instance traits, got %v", got["traits"])
	}

	rec = te.do(t, http.MethodPut, "/api/instances/"+id,
		`{"name":"primary-postgres","kind":"postgres-compatible","template_id":"generic-postgres","endpoint":"postgres://db.internal:5432/app","config":{"database":"app","username":"appuser"}}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("update instance: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	updated := parseJSON(t, rec)
	if updated["kind"] != instances.KindPostgresCompatible {
		t.Fatalf("expected updated kind %q, got %v", instances.KindPostgresCompatible, updated["kind"])
	}
	updatedTraits, ok := updated["traits"].([]any)
	if !ok || len(updatedTraits) == 0 {
		t.Fatalf("expected updated instance traits, got %v", updated["traits"])
	}
	if updated["template_id"] != "generic-postgres" {
		t.Fatalf("expected updated template_id generic-postgres, got %v", updated["template_id"])
	}

	rec = te.do(t, http.MethodPost, "/api/instances",
		`{"name":"primary-redis","kind":"redis-compatible","template_id":"generic-redis","endpoint":"redis://cache.internal:6379"}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create second instance: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	otherID := parseJSON(t, rec)["id"].(string)

	rec = te.do(t, http.MethodGet, "/api/instances?kind=postgres-compatible,kafka-compatible", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("filter instances: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	list := parseJSONArray(t, rec)
	if len(list) != 1 {
		t.Fatalf("expected 1 filtered instance, got %d", len(list))
	}
	if list[0]["kind"] != instances.KindPostgresCompatible {
		t.Fatalf("expected postgres instance, got %v", list[0]["kind"])
	}
	listTraits, ok := list[0]["traits"].([]any)
	if !ok || len(listTraits) == 0 {
		t.Fatalf("expected filtered instance traits, got %v", list[0]["traits"])
	}

	rec = te.do(t, http.MethodPost, "/api/instances",
		`{"name":"bad-instance","kind":"redis-compatible","template_id":"generic-postgres"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("mismatched template kind: expected 400, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodPost, "/api/instances",
		`{"name":"primary-postgres","kind":"redis-compatible","template_id":"generic-redis"}`, true)
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate instance name: expected 409, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodDelete, "/api/instances/"+id, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete instance: expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	rec = te.do(t, http.MethodDelete, "/api/instances/"+otherID, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete second instance: expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestInstanceReachability(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen probe target: %v", err)
	}
	defer listener.Close()

	closedListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve closed probe target: %v", err)
	}
	closedAddr := closedListener.Addr().String()
	_ = closedListener.Close()

	rec := te.do(t, http.MethodPost, "/api/instances",
		fmt.Sprintf(`{"name":"reachable-redis","kind":"redis-compatible","template_id":"generic-redis","endpoint":"%s"}`,
			listener.Addr().String(),
		), true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create reachable instance: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	reachableID := parseJSON(t, rec)["id"].(string)

	rec = te.do(t, http.MethodPost, "/api/instances",
		fmt.Sprintf(`{"name":"offline-redis","kind":"redis-compatible","template_id":"generic-redis","endpoint":"%s"}`,
			closedAddr,
		), true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create offline instance: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	offlineID := parseJSON(t, rec)["id"].(string)

	rec = te.do(t, http.MethodPost, "/api/instances/reachability",
		fmt.Sprintf(`{"ids":["%s","%s"]}`, reachableID, offlineID), true)
	if rec.Code != http.StatusOK {
		t.Fatalf("probe instance reachability: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	rows := parseJSONArray(t, rec)
	if len(rows) != 2 {
		t.Fatalf("expected 2 reachability rows, got %d", len(rows))
	}

	byID := map[string]map[string]any{}
	for _, row := range rows {
		byID[row["id"].(string)] = row
	}

	if byID[reachableID]["status"] != "online" {
		t.Fatalf("expected reachable instance online, got %v", byID[reachableID]["status"])
	}
	if byID[offlineID]["status"] != "offline" {
		t.Fatalf("expected offline instance offline, got %v", byID[offlineID]["status"])
	}
	if _, ok := byID[offlineID]["reason"]; !ok {
		t.Fatal("expected offline instance to include reason")
	}
}

func TestAIProviderReachabilityAndAvailability(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	availableServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"gpt-4o-mini"}]}`))
	}))
	defer availableServer.Close()

	unavailableServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer unavailableServer.Close()

	rec := te.do(t, http.MethodPost, "/api/ai-providers",
		fmt.Sprintf(`{"name":"reachable-available","kind":"llm","template_id":"openai","endpoint":"%s","auth_scheme":"none"}`,
			availableServer.URL,
		), true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create available provider: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	availableID := parseJSON(t, rec)["id"].(string)

	rec = te.do(t, http.MethodPost, "/api/ai-providers",
		fmt.Sprintf(`{"name":"reachable-unavailable","kind":"llm","template_id":"openai","endpoint":"%s","auth_scheme":"none"}`,
			unavailableServer.URL,
		), true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create unavailable provider: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	unavailableID := parseJSON(t, rec)["id"].(string)

	rec = te.do(t, http.MethodGet, "/api/ai-providers/reachability?ids="+availableID+","+unavailableID, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("probe ai provider reachability: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	reachabilityRows := parseJSON(t, rec)["items"].([]any)
	if len(reachabilityRows) != 2 {
		t.Fatalf("expected 2 reachability rows, got %d", len(reachabilityRows))
	}
	reachabilityByID := map[string]map[string]any{}
	for _, row := range reachabilityRows {
		entry := row.(map[string]any)
		reachabilityByID[entry["id"].(string)] = entry
	}
	if reachabilityByID[availableID]["status"] != "reachable" {
		t.Fatalf("expected available provider reachable, got %v", reachabilityByID[availableID]["status"])
	}
	if reachabilityByID[unavailableID]["status"] != "reachable" {
		t.Fatalf("expected unavailable provider still reachable, got %v", reachabilityByID[unavailableID]["status"])
	}

	rec = te.do(t, http.MethodGet, "/api/ai-providers/availability?ids="+availableID+","+unavailableID, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("probe ai provider availability: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	availabilityRows := parseJSON(t, rec)["items"].([]any)
	if len(availabilityRows) != 2 {
		t.Fatalf("expected 2 availability rows, got %d", len(availabilityRows))
	}
	availabilityByID := map[string]map[string]any{}
	for _, row := range availabilityRows {
		entry := row.(map[string]any)
		availabilityByID[entry["id"].(string)] = entry
	}
	if availabilityByID[availableID]["status"] != "available" {
		t.Fatalf("expected available provider available, got %v", availabilityByID[availableID]["status"])
	}
	if availabilityByID[unavailableID]["status"] != "unavailable" {
		t.Fatalf("expected unavailable provider unavailable, got %v", availabilityByID[unavailableID]["status"])
	}
	if _, ok := availabilityByID[unavailableID]["reason"]; !ok {
		t.Fatal("expected unavailable provider to include reason")
	}

	// Verify monitor_latest_status projection for ai_provider target type.
	monitorRecords, err := te.app.FindRecordsByFilter(
		"monitor_latest_status",
		"target_type = {:targetType}",
		"-updated",
		0, 0,
		map[string]any{"targetType": "ai_provider"},
	)
	if err != nil {
		t.Fatalf("failed to query monitor_latest_status: %v", err)
	}
	if len(monitorRecords) < 2 {
		t.Fatalf("expected at least 2 monitor records for ai_provider, got %d", len(monitorRecords))
	}
	monitorByTargetID := map[string]*core.Record{}
	for _, record := range monitorRecords {
		monitorByTargetID[record.GetString("target_id")] = record
	}
	availableMonitor := monitorByTargetID[availableID]
	if availableMonitor == nil {
		t.Fatal("expected monitor record for available provider")
	}
	if availableMonitor.GetString("status") != "healthy" {
		t.Fatalf("expected available provider monitor status 'healthy', got %q", availableMonitor.GetString("status"))
	}
	unavailableMonitor := monitorByTargetID[unavailableID]
	if unavailableMonitor == nil {
		t.Fatal("expected monitor record for unavailable provider")
	}
	if unavailableMonitor.GetString("status") != "degraded" {
		t.Fatalf("expected unavailable provider monitor status 'degraded', got %q", unavailableMonitor.GetString("status"))
	}
}

func TestConnectorReachabilityReturnsProbeStatus(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodPost, "/api/connectors",
		`{"name":"unreachable-webhook","kind":"webhook","template_id":"generic-webhook","endpoint":"https://127.255.255.255:65535/hook","auth_scheme":"none"}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create connector: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	connectorID := parseJSON(t, rec)["id"].(string)

	rec = te.do(t, http.MethodGet, "/api/connectors/reachability?ids="+connectorID, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("probe connector reachability: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	respJSON := parseJSON(t, rec)
	items, ok := respJSON["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("expected 1 reachability item, got %d", len(items))
	}
	item := items[0].(map[string]any)
	if item["status"] != "unreachable" {
		t.Fatalf("expected probe status 'unreachable', got %q", item["status"])
	}
	if _, ok := item["lastCheckedAt"].(string); !ok {
		t.Fatal("expected lastCheckedAt in probe response")
	}
	if _, ok := item["reason"].(string); !ok {
		t.Fatal("expected reason in probe response")
	}
}

func TestProviderAccountTemplatesRequireAuthAndList(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodGet, "/api/provider-accounts/templates", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated list: expected 401, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodGet, "/api/provider-accounts/templates", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("authenticated list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	templates := parseJSONArray(t, rec)
	if len(templates) == 0 {
		t.Fatalf("expected at least one provider account template")
	}
	if templates[0]["id"] == nil {
		t.Fatalf("expected provider account template to include id")
	}
}

func TestProviderAccountTemplateGet(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodGet, "/api/provider-accounts/templates/generic-aws-account", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get provider account template: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	template := parseJSON(t, rec)
	if template["id"] != "generic-aws-account" {
		t.Fatalf("expected template id generic-aws-account, got %v", template["id"])
	}
	if template["kind"] != accounts.KindAWS {
		t.Fatalf("expected template kind %q, got %v", accounts.KindAWS, template["kind"])
	}

	rec = te.do(t, http.MethodGet, "/api/provider-accounts/templates/not-found", "", true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected missing template to return 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestProviderAccountsCRUD(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newTestEnv(t)
	defer te.cleanup()
	secret := createRouteSecret(t, te, "global", "")

	rec := te.do(t, http.MethodPost, "/api/provider-accounts",
		`{"name":"primary-aws","kind":"aws","template_id":"generic-aws-account","identifier":"123456789012","config":{"region":"us-east-1"}}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create provider account: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	accountID := created["id"].(string)
	id := created["id"].(string)
	if created["template_id"] != "generic-aws-account" {
		t.Fatalf("expected template_id generic-aws-account, got %v", created["template_id"])
	}
	if created["identifier"] != "123456789012" {
		t.Fatalf("expected identifier 123456789012, got %v", created["identifier"])
	}

	rec = te.do(t, http.MethodGet, "/api/provider-accounts/"+id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get provider account: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodPut, "/api/provider-accounts/"+id,
		`{"name":"github-installation","kind":"github","template_id":"github-app-installation","identifier":"987654","config":{"organization":"websoft9"}}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("update provider account: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	updated := parseJSON(t, rec)
	if updated["kind"] != accounts.KindGitHub {
		t.Fatalf("expected updated kind %q, got %v", accounts.KindGitHub, updated["kind"])
	}
	if updated["template_id"] != "github-app-installation" {
		t.Fatalf("expected updated template_id github-app-installation, got %v", updated["template_id"])
	}

	rec = te.do(t, http.MethodPost, "/api/provider-accounts",
		`{"name":"cf-account","kind":"cloudflare","template_id":"cloudflare-account","identifier":"cf-123"}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create second provider account: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	otherID := parseJSON(t, rec)["id"].(string)

	rec = te.do(t, http.MethodPost, "/api/provider-accounts",
		`{"name":"missing-identifier","kind":"aws","template_id":"generic-aws-account"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing identifier: expected 400, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodGet, "/api/provider-accounts?kind=github,gcp", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("filter provider accounts: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	list := parseJSONArray(t, rec)
	if len(list) != 1 {
		t.Fatalf("expected 1 filtered provider account, got %d", len(list))
	}
	if list[0]["kind"] != accounts.KindGitHub {
		t.Fatalf("expected github provider account, got %v", list[0]["kind"])
	}

	rec = te.do(t, http.MethodPost, "/api/instances",
		`{"name":"redis-with-account","kind":"redis-compatible","template_id":"generic-redis","provider_account":"`+accountID+`"}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create instance with provider account: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	instanceCreated := parseJSON(t, rec)
	instanceID := instanceCreated["id"].(string)
	if instanceCreated["provider_account"] != accountID {
		t.Fatalf("expected instance provider_account %q", accountID)
	}

	rec = te.do(t, http.MethodPost, "/api/connectors",
		`{"name":"smtp-with-account","kind":"smtp","template_id":"generic-smtp","provider_account":"`+accountID+`"}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create connector with provider account: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	connectorCreated := parseJSON(t, rec)
	connectorID := connectorCreated["id"].(string)
	if connectorCreated["provider_account"] != accountID {
		t.Fatalf("expected connector provider_account %q", accountID)
	}

	rec = te.do(t, http.MethodPost, "/api/ai-providers",
		`{"name":"llm-with-account","template_id":"openai","credential":"`+secret.Id+`","provider_account":"`+accountID+`"}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create AI provider with provider account: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	aiProviderCreated := parseJSON(t, rec)
	aiProviderID := aiProviderCreated["id"].(string)
	if aiProviderCreated["provider_account"] != accountID {
		t.Fatalf("expected AI provider provider_account %q", accountID)
	}

	rec = te.do(t, http.MethodPost, "/api/provider-accounts",
		`{"name":"bad-provider-account","kind":"aws","template_id":"github-app-installation"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("mismatched template kind: expected 400, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodPost, "/api/provider-accounts",
		`{"name":"github-installation","kind":"aws","template_id":"generic-aws-account","identifier":"acct-dup"}`, true)
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate provider account name: expected 409, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodDelete, "/api/provider-accounts/"+id, "", true)
	if rec.Code != http.StatusConflict {
		t.Fatalf("delete referenced provider account: expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
	deleteConflict := parseJSON(t, rec)
	if deleteConflict["message"] != "provider account is still referenced; remove related instances, AI providers, or connectors first" {
		t.Fatalf("unexpected delete conflict message: %v", deleteConflict["message"])
	}
	deleteConflictData, ok := deleteConflict["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected delete conflict data object, got %T", deleteConflict["data"])
	}
	if deleteConflictData["reason_code"] != "provider_account_referenced" {
		t.Fatalf("unexpected delete conflict reason_code: %v", deleteConflictData["reason_code"])
	}

	rec = te.do(t, http.MethodDelete, "/api/connectors/"+connectorID, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete referencing connector: expected 204, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodDelete, "/api/ai-providers/"+aiProviderID, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete referencing AI provider: expected 204, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodDelete, "/api/instances/"+instanceID, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete referencing instance: expected 204, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodDelete, "/api/provider-accounts/"+id, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete provider account: expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	rec = te.do(t, http.MethodDelete, "/api/provider-accounts/"+otherID, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete second provider account: expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
}

func parseJSON(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var result map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatal("failed to parse JSON:", err)
	}
	return result
}

func parseJSONArray(t *testing.T, rec *httptest.ResponseRecorder) []map[string]any {
	t.Helper()
	var result []map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatal("failed to parse JSON array:", err)
	}
	return result
}

func createServerRecord(t *testing.T, te *testEnv, name, host string, port int, user, authType string) *core.Record {
	t.Helper()

	serversCol, err := te.app.FindCollectionByNameOrId("servers")
	if err != nil {
		t.Fatal(err)
	}

	record := core.NewRecord(serversCol)
	record.Set("name", name)
	record.Set("host", host)
	record.Set("port", port)
	record.Set("user", user)
	record.Set("is_enabled", true)
	record.Set("auth_type", authType)

	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}

	return record
}

// ═══════════════════════════════════════════════════════════
// Servers
// ═══════════════════════════════════════════════════════════

func TestServersCreateAndList(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	created := createServerRecord(t, te, "test-server", "192.168.1.1", 22, "root", "password")
	if created.GetString("name") != "test-server" {
		t.Errorf("expected name 'test-server', got %v", created.GetString("name"))
	}

	serversCol, err := te.app.FindCollectionByNameOrId("servers")
	if err != nil {
		t.Fatal(err)
	}
	list, err := te.app.FindRecordsByFilter(serversCol, "", "", 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 server, got %d", len(list))
	}
	if list[0].GetString("host") != "192.168.1.1" {
		t.Errorf("expected host '192.168.1.1', got %v", list[0].GetString("host"))
	}
}

func TestServersRouteRemovedFromExt(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodGet, "/api/ext/resources/servers", "", true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after ext server route removal, got %d", rec.Code)
	}
}

func TestDatabasesRouteRemovedFromExt(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodGet, "/api/ext/resources/databases", "", true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after ext database route removal, got %d", rec.Code)
	}
}

func TestCloudAccountsRouteRemovedFromExt(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodGet, "/api/ext/resources/cloud-accounts", "", true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after ext cloud accounts route removal, got %d", rec.Code)
	}
}

// ═══════════════════════════════════════════════════════════
// Env Sets (native PocketBase API — no custom ext routes)
// ═══════════════════════════════════════════════════════════

// TestEnvSetsNativeAPI verifies that env_sets and env_set_vars are accessible
// via PocketBase native Records API (no custom ext routes needed).
func TestEnvSetsNativeAPI(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	// Create env_set via native API
	rec := te.do(t, http.MethodPost, "/api/collections/"+sharedenv.SetCollection+"/records",
		`{"name":"staging-env","description":"Staging vars"}`, true)

	if rec.Code != http.StatusOK {
		t.Fatalf("create env_set: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	setId := created["id"].(string)

	// Create env_set_var via native API
	rec = te.do(t, http.MethodPost, "/api/collections/"+sharedenv.VarCollection+"/records",
		`{"set":"`+setId+`","key":"DB_HOST","value":"localhost","is_secret":false}`, true)

	if rec.Code != http.StatusOK {
		t.Fatalf("create env_set_var: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// List env_set_vars filtered by set
	rec = te.do(t, http.MethodGet, "/api/collections/"+sharedenv.VarCollection+"/records?filter=set%3D'"+setId+"'", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("list env_set_vars: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	got := parseJSON(t, rec)
	totalItems, ok := got["totalItems"].(float64)
	if !ok || totalItems != 1 {
		t.Fatalf("expected 1 env_set_var, got %v", got["totalItems"])
	}
}
