package routes

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/config/sharedenv"
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

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}

	// Seed a superuser for API auth
	suCol, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		app.Cleanup()
		t.Fatal(err)
	}
	su := core.NewRecord(suCol)
	su.Set("email", "admin@test.com")
	su.SetPassword("1234567890")
	if err := app.Save(su); err != nil {
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

	g := r.Group("/api/ext")
	registerResourceRoutes(g)
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
	if created["auth_scheme"] != connectors.AuthSchemeAPIKey {
		t.Fatalf("expected template default auth scheme %q, got %v", connectors.AuthSchemeAPIKey, created["auth_scheme"])
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
		`{"name":"fallback-openai","is_default":true,"template_id":"openai","credential":"`+secret.Id+`"}`, true)
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
	rec = te.do(t, http.MethodDelete, "/api/ai-providers/"+otherID, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete second AI provider: expected 204, got %d: %s", rec.Code, rec.Body.String())
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
		`{"name":"workspace-webhook","kind":"webhook","is_default":true,"template_id":"generic-webhook","endpoint":"https://hooks.example.com/workspace","config":{"event":"deploy.finished"}}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create connector: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	id := created["id"].(string)
	if created["endpoint"] != "https://hooks.example.com/workspace" {
		t.Fatalf("expected template default endpoint, got %v", created["endpoint"])
	}
	if created["auth_scheme"] != connectors.AuthSchemeNone {
		t.Fatalf("expected template default auth scheme %q, got %v", connectors.AuthSchemeNone, created["auth_scheme"])
	}
	if created["is_default"] != true {
		t.Fatalf("expected is_default true, got %v", created["is_default"])
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
		`{"name":"workspace-webhook-updated","kind":"webhook","is_default":false,"template_id":"generic-webhook","endpoint":"https://hooks.example.com/updated","auth_scheme":"none","config":{"event":"deploy.succeeded"}}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("update connector: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	updated := parseJSON(t, rec)
	if updated["template_id"] != "generic-webhook" {
		t.Fatalf("expected template_id generic-webhook after update, got %v", updated["template_id"])
	}
	if updated["is_default"] != false {
		t.Fatalf("expected is_default false after update, got %v", updated["is_default"])
	}

	rec = te.do(t, http.MethodPost, "/api/connectors",
		`{"name":"fallback-webhook","kind":"webhook","is_default":true,"template_id":"generic-webhook","endpoint":"https://hooks.example.com/fallback"}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create second default connector: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	otherID := parseJSON(t, rec)["id"].(string)

	rec = te.do(t, http.MethodGet, "/api/connectors/"+id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get first connector after second default: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if parseJSON(t, rec)["is_default"] != false {
		t.Fatalf("expected first connector default flag to be cleared")
	}

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
	if template["kind"] != instances.KindPostgres {
		t.Fatalf("expected template kind %q, got %v", instances.KindPostgres, template["kind"])
	}

	rec = te.do(t, http.MethodGet, "/api/instances/templates/not-found", "", true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected missing template to return 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestInstancesCRUD(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodPost, "/api/instances",
		`{"name":"local-ollama","kind":"ollama","template_id":"generic-ollama","config":{"model":"llama3.1"}}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create instance: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	id := created["id"].(string)
	if created["endpoint"] != "http://localhost:11434" {
		t.Fatalf("expected template default endpoint, got %v", created["endpoint"])
	}
	if created["template_id"] != "generic-ollama" {
		t.Fatalf("expected template_id generic-ollama, got %v", created["template_id"])
	}

	rec = te.do(t, http.MethodGet, "/api/instances/"+id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get instance: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodPut, "/api/instances/"+id,
		`{"name":"primary-postgres","kind":"postgres","template_id":"generic-postgres","endpoint":"postgres://db.internal:5432/app","config":{"database":"app","username":"appuser"}}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("update instance: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	updated := parseJSON(t, rec)
	if updated["kind"] != instances.KindPostgres {
		t.Fatalf("expected updated kind %q, got %v", instances.KindPostgres, updated["kind"])
	}
	if updated["template_id"] != "generic-postgres" {
		t.Fatalf("expected updated template_id generic-postgres, got %v", updated["template_id"])
	}

	rec = te.do(t, http.MethodPost, "/api/instances",
		`{"name":"primary-redis","kind":"redis","template_id":"generic-redis","endpoint":"redis://cache.internal:6379"}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create second instance: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	otherID := parseJSON(t, rec)["id"].(string)

	rec = te.do(t, http.MethodGet, "/api/instances?kind=postgres,kafka", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("filter instances: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	list := parseJSONArray(t, rec)
	if len(list) != 1 {
		t.Fatalf("expected 1 filtered instance, got %d", len(list))
	}
	if list[0]["kind"] != instances.KindPostgres {
		t.Fatalf("expected postgres instance, got %v", list[0]["kind"])
	}

	rec = te.do(t, http.MethodPost, "/api/instances",
		`{"name":"bad-instance","kind":"redis","template_id":"generic-postgres"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("mismatched template kind: expected 400, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodPost, "/api/instances",
		`{"name":"primary-postgres","kind":"redis","template_id":"generic-redis"}`, true)
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
		fmt.Sprintf(`{"name":"reachable-redis","kind":"redis","template_id":"generic-redis","endpoint":"%s"}`,
			listener.Addr().String(),
		), true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create reachable instance: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	reachableID := parseJSON(t, rec)["id"].(string)

	rec = te.do(t, http.MethodPost, "/api/instances",
		fmt.Sprintf(`{"name":"offline-redis","kind":"redis","template_id":"generic-redis","endpoint":"%s"}`,
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
		`{"name":"redis-with-account","kind":"redis","template_id":"generic-redis","provider_account":"`+accountID+`"}`, true)
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
