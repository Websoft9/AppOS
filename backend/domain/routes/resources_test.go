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
	rec := te.do(t, http.MethodPost, "/api/collections/env_sets/records",
		`{"name":"staging-env","description":"Staging vars"}`, true)

	if rec.Code != http.StatusOK {
		t.Fatalf("create env_set: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	setId := created["id"].(string)

	// Create env_set_var via native API
	rec = te.do(t, http.MethodPost, "/api/collections/env_set_vars/records",
		`{"set":"`+setId+`","key":"DB_HOST","value":"localhost","is_secret":false}`, true)

	if rec.Code != http.StatusOK {
		t.Fatalf("create env_set_var: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// List env_set_vars filtered by set
	rec = te.do(t, http.MethodGet, "/api/collections/env_set_vars/records?filter=set%3D'"+setId+"'", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("list env_set_vars: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	got := parseJSON(t, rec)
	totalItems, ok := got["totalItems"].(float64)
	if !ok || totalItems != 1 {
		t.Fatalf("expected 1 env_set_var, got %v", got["totalItems"])
	}
}
