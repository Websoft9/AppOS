package routes

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/config/sharedenv"
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
	registerConnectorRoutes(&core.ServeEvent{Router: r})
	registerInstanceRoutes(&core.ServeEvent{Router: r})

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

func TestConnectorTemplateGet(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodGet, "/api/connectors/templates/openai", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get openai template: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	template := parseJSON(t, rec)
	if template["id"] != "openai" {
		t.Fatalf("expected template id openai, got %v", template["id"])
	}
	if template["kind"] != "llm" {
		t.Fatalf("expected template kind llm, got %v", template["kind"])
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
		`{"name":"openai-prod","kind":"llm","template_id":"openai","endpoint":"https://api.openai.com/v1","auth_scheme":"api_key"}`,
		true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create llm connector: expected 201, got %d: %s", rec.Code, rec.Body.String())
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
		`{"name":"workspace-openai","kind":"llm","is_default":true,"template_id":"openai","credential":"","config":{"defaultModel":"gpt-4.1-mini"}}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create connector: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	id := created["id"].(string)
	if created["endpoint"] != "https://api.openai.com/v1" {
		t.Fatalf("expected template default endpoint, got %v", created["endpoint"])
	}
	if created["auth_scheme"] != connectors.AuthSchemeAPIKey {
		t.Fatalf("expected template default auth scheme %q, got %v", connectors.AuthSchemeAPIKey, created["auth_scheme"])
	}
	if created["is_default"] != true {
		t.Fatalf("expected is_default true, got %v", created["is_default"])
	}

	rec = te.do(t, http.MethodGet, "/api/connectors/"+id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get connector: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	got := parseJSON(t, rec)
	if got["template_id"] != "openai" {
		t.Fatalf("expected template_id openai, got %v", got["template_id"])
	}

	rec = te.do(t, http.MethodPut, "/api/connectors/"+id,
		`{"name":"workspace-anthropic","kind":"llm","is_default":false,"template_id":"anthropic","endpoint":"https://api.anthropic.com","auth_scheme":"api_key","config":{"version":"2023-06-01"}}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("update connector: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	updated := parseJSON(t, rec)
	if updated["template_id"] != "anthropic" {
		t.Fatalf("expected template_id anthropic after update, got %v", updated["template_id"])
	}
	if updated["is_default"] != false {
		t.Fatalf("expected is_default false after update, got %v", updated["is_default"])
	}

	rec = te.do(t, http.MethodPost, "/api/connectors",
		`{"name":"fallback-openai","kind":"llm","is_default":true,"template_id":"openai"}`, true)
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

	rec = te.do(t, http.MethodDelete, "/api/instances/"+id, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete instance: expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	rec = te.do(t, http.MethodDelete, "/api/instances/"+otherID, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete second instance: expected 204, got %d: %s", rec.Code, rec.Body.String())
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

// ═══════════════════════════════════════════════════════════
// Databases
// ═══════════════════════════════════════════════════════════

func TestDatabasesCRUD(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	// Create
	rec := te.do(t, http.MethodPost, "/api/ext/resources/databases",
		`{"name":"prod-mysql","type":"mysql","host":"db.example.com","port":3306,"db_name":"myapp","user":"admin"}`, true)

	if rec.Code != http.StatusOK {
		t.Fatalf("create: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	id := created["id"].(string)

	// Get
	rec = te.do(t, http.MethodGet, "/api/ext/resources/databases/"+id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	got := parseJSON(t, rec)
	if got["type"] != "mysql" {
		t.Errorf("expected type 'mysql', got %v", got["type"])
	}

	// Update
	rec = te.do(t, http.MethodPut, "/api/ext/resources/databases/"+id,
		`{"name":"prod-mysql-updated","type":"mysql","host":"db2.example.com","port":3307,"db_name":"myapp","user":"admin"}`, true)

	if rec.Code != http.StatusOK {
		t.Fatalf("update: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	updated := parseJSON(t, rec)
	if updated["host"] != "db2.example.com" {
		t.Errorf("expected host 'db2.example.com', got %v", updated["host"])
	}

	// Delete
	rec = te.do(t, http.MethodDelete, "/api/ext/resources/databases/"+id, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete: expected 204, got %d: %s", rec.Code, rec.Body.String())
	}

	// Verify deleted
	rec = te.do(t, http.MethodGet, "/api/ext/resources/databases/"+id, "", true)
	if rec.Code == http.StatusOK {
		t.Fatal("expected non-200 for deleted record")
	}
}

// ═══════════════════════════════════════════════════════════
// Cloud Accounts
// ═══════════════════════════════════════════════════════════

func TestCloudAccountsCreateAndList(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodPost, "/api/ext/resources/cloud-accounts",
		`{"name":"aws-prod","provider":"aws","access_key_id":"AKIAIOSFODNN7EXAMPLE","region":"us-east-1"}`, true)

	if rec.Code != http.StatusOK {
		t.Fatalf("create: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.do(t, http.MethodGet, "/api/ext/resources/cloud-accounts", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	list := parseJSONArray(t, rec)
	if len(list) != 1 {
		t.Fatalf("expected 1 cloud account, got %d", len(list))
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
