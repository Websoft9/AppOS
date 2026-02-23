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

	_ "github.com/websoft9/appos/backend/internal/migrations"
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

// ═══════════════════════════════════════════════════════════
// Servers
// ═══════════════════════════════════════════════════════════

func TestServersCreateAndList(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	// Create server
	rec := te.do(t, http.MethodPost, "/api/ext/resources/servers",
		`{"name":"test-server","host":"192.168.1.1","port":22,"user":"root","auth_type":"password"}`, true)

	if rec.Code != http.StatusOK {
		t.Fatalf("create: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	if created["name"] != "test-server" {
		t.Errorf("expected name 'test-server', got %v", created["name"])
	}

	// List servers
	rec = te.do(t, http.MethodGet, "/api/ext/resources/servers", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	list := parseJSONArray(t, rec)
	if len(list) != 1 {
		t.Fatalf("expected 1 server, got %d", len(list))
	}
	if list[0]["host"] != "192.168.1.1" {
		t.Errorf("expected host '192.168.1.1', got %v", list[0]["host"])
	}
}

func TestServersRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodGet, "/api/ext/resources/servers", "", false)
	if rec.Code == http.StatusOK {
		t.Fatal("expected non-200 for unauthenticated request")
	}
}

// ═══════════════════════════════════════════════════════════
// Secrets
// ═══════════════════════════════════════════════════════════

func TestSecretsCreateValueMasked(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodPost, "/api/ext/resources/secrets",
		`{"name":"db-password","type":"password","value":"super-secret-123"}`, true)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	if created["value"] != "***" {
		t.Errorf("expected value '***', got %v", created["value"])
	}
}

func TestSecretsGetReturnsDecrypted(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	// Create a secret
	rec := te.do(t, http.MethodPost, "/api/ext/resources/secrets",
		`{"name":"api-key","type":"api_key","value":"my-secret-value"}`, true)

	if rec.Code != http.StatusOK {
		t.Fatalf("create: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	id := created["id"].(string)

	// Get should return decrypted value
	rec = te.do(t, http.MethodGet, "/api/ext/resources/secrets/"+id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	got := parseJSON(t, rec)
	if got["value"] != "my-secret-value" {
		t.Errorf("expected decrypted value 'my-secret-value', got %v", got["value"])
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
// Certificates
// ═══════════════════════════════════════════════════════════

func TestCertificatesCreateAndDelete(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodPost, "/api/ext/resources/certificates",
		`{"name":"wildcard-cert","domain":"*.example.com","auto_renew":true}`, true)

	if rec.Code != http.StatusOK {
		t.Fatalf("create: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	id := created["id"].(string)

	rec = te.do(t, http.MethodDelete, "/api/ext/resources/certificates/"+id, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete: expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ═══════════════════════════════════════════════════════════
// Env Groups
// ═══════════════════════════════════════════════════════════

func TestEnvGroupsCreateWithVars(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodPost, "/api/ext/resources/env-groups",
		`{"name":"staging-env","description":"Staging vars","vars":[{"key":"DB_HOST","value":"localhost","is_secret":false},{"key":"DB_PASS","value":"secret","is_secret":true}]}`, true)

	if rec.Code != http.StatusOK {
		t.Fatalf("create: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	id := created["id"].(string)

	// Get should include vars
	rec = te.do(t, http.MethodGet, "/api/ext/resources/env-groups/"+id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	got := parseJSON(t, rec)
	vars, ok := got["vars"].([]any)
	if !ok {
		t.Fatal("expected 'vars' to be an array")
	}
	if len(vars) != 2 {
		t.Fatalf("expected 2 vars, got %d", len(vars))
	}
}

// ═══════════════════════════════════════════════════════════
// Resource Groups
// ═══════════════════════════════════════════════════════════

func TestResourceGroupsListAndCreate(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	// Create a group
	rec := te.do(t, http.MethodPost, "/api/ext/resources/groups",
		`{"name":"production","description":"Production resources"}`, true)

	if rec.Code != http.StatusOK {
		t.Fatalf("create: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	if created["name"] != "production" {
		t.Errorf("expected name 'production', got %v", created["name"])
	}

	// List groups (includes the seeded 'default' group + the one we created)
	rec = te.do(t, http.MethodGet, "/api/ext/resources/groups", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	list := parseJSONArray(t, rec)
	if len(list) < 2 {
		t.Fatalf("expected at least 2 groups (default + production), got %d", len(list))
	}

	// Each item should have a resource_count field
	for _, item := range list {
		if _, ok := item["resource_count"]; !ok {
			t.Error("expected 'resource_count' field in group list response")
		}
	}
}

func TestResourceGroupsGetAndUpdate(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	// Create
	rec := te.do(t, http.MethodPost, "/api/ext/resources/groups",
		`{"name":"staging","description":"Staging env"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("create: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	id := created["id"].(string)

	// Get
	rec = te.do(t, http.MethodGet, "/api/ext/resources/groups/"+id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	got := parseJSON(t, rec)
	if got["description"] != "Staging env" {
		t.Errorf("expected description 'Staging env', got %v", got["description"])
	}

	// Update
	rec = te.do(t, http.MethodPut, "/api/ext/resources/groups/"+id,
		`{"name":"staging-updated","description":"Updated staging"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("update: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	updated := parseJSON(t, rec)
	if updated["name"] != "staging-updated" {
		t.Errorf("expected name 'staging-updated', got %v", updated["name"])
	}
}

func TestResourceGroupsDeleteBlockedForDefault(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	// List to find the default group
	rec := te.do(t, http.MethodGet, "/api/ext/resources/groups", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	list := parseJSONArray(t, rec)
	var defaultId string
	for _, g := range list {
		if g["is_default"] == true {
			defaultId = g["id"].(string)
			break
		}
	}
	if defaultId == "" {
		t.Fatal("no default group found")
	}

	// Attempt to delete default group — should fail
	rec = te.do(t, http.MethodDelete, "/api/ext/resources/groups/"+defaultId, "", true)
	if rec.Code == http.StatusNoContent {
		t.Fatal("expected delete of default group to be blocked (non-204)")
	}
}

func TestResourceGroupsCrossTypeListAndBatch(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	// Create a custom group
	rec := te.do(t, http.MethodPost, "/api/ext/resources/groups",
		`{"name":"infra","description":"Infrastructure group"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("create group: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	group := parseJSON(t, rec)
	groupId := group["id"].(string)

	// Create a server
	rec = te.do(t, http.MethodPost, "/api/ext/resources/servers",
		`{"name":"infra-server","host":"10.0.0.1","port":22,"user":"root","auth_type":"password"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("create server: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	server := parseJSON(t, rec)
	serverId := server["id"].(string)

	// Batch add server to the infra group
	batchBody := `{"action":"add","items":[{"type":"servers","id":"` + serverId + `"}]}`
	rec = te.do(t, http.MethodPost, "/api/ext/resources/groups/"+groupId+"/resources/batch", batchBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("batch add: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Cross-type list should include the server
	rec = te.do(t, http.MethodGet, "/api/ext/resources/groups/"+groupId+"/resources", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("cross-type list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	resources := parseJSONArray(t, rec)
	if len(resources) != 1 {
		t.Fatalf("expected 1 resource in group, got %d", len(resources))
	}
	if resources[0]["type"] != "servers" {
		t.Errorf("expected type 'servers', got %v", resources[0]["type"])
	}
	if resources[0]["name"] != "infra-server" {
		t.Errorf("expected name 'infra-server', got %v", resources[0]["name"])
	}

	// Batch remove server from the infra group
	batchBody = `{"action":"remove","items":[{"type":"servers","id":"` + serverId + `"}]}`
	rec = te.do(t, http.MethodPost, "/api/ext/resources/groups/"+groupId+"/resources/batch", batchBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("batch remove: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Cross-type list should now be empty
	rec = te.do(t, http.MethodGet, "/api/ext/resources/groups/"+groupId+"/resources", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("cross-type list after remove: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	resources = parseJSONArray(t, rec)
	if len(resources) != 0 {
		t.Fatalf("expected 0 resources after remove, got %d", len(resources))
	}
}

func TestResourceGroupDeleteNonDefault(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	// Create a non-default group
	rec := te.do(t, http.MethodPost, "/api/ext/resources/groups",
		`{"name":"temp-group","description":"Temporary"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("create: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	id := created["id"].(string)

	// Delete should succeed
	rec = te.do(t, http.MethodDelete, "/api/ext/resources/groups/"+id, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete: expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
}
