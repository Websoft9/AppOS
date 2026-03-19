package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func (te *testEnv) doApps(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	g := r.Group("/api")
	g.Bind(apis.RequireAuth())
	registerAppsRoutes(g)

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

func seedAppInstance(t *testing.T, te *testEnv, name string) *core.Record {
	t.Helper()
	projectDir := t.TempDir()
	compose := "services:\n  web:\n    image: nginx:alpine\n"
	if err := os.WriteFile(filepath.Join(projectDir, "docker-compose.yml"), []byte(compose), 0o644); err != nil {
		t.Fatal(err)
	}
	col, err := te.app.FindCollectionByNameOrId("app_instances")
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(col)
	record.Set("server_id", "local")
	record.Set("name", name)
	record.Set("project_dir", projectDir)
	record.Set("source", "manualops")
	record.Set("status", "installed")
	record.Set("runtime_status", "running")
	record.Set("last_deployment_status", "success")
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}
	return record
}

func TestAppInstancesListAndDetail(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := seedAppInstance(t, te, "demo-app")

	rec := te.doApps(t, http.MethodGet, "/api/apps", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	items := parseJSONArray(t, rec)
	if len(items) != 1 {
		t.Fatalf("expected 1 app instance, got %d", len(items))
	}
	if items[0]["name"] != "demo-app" {
		t.Fatalf("expected demo-app, got %v", items[0]["name"])
	}

	rec = te.doApps(t, http.MethodGet, "/api/apps/"+record.Id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	item := parseJSON(t, rec)
	if item["project_dir"] != record.GetString("project_dir") {
		t.Fatalf("expected project dir, got %v", item["project_dir"])
	}
	if item["status"] != "installed" {
		t.Fatalf("expected installed, got %v", item["status"])
	}
}

func TestAppInstanceRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doApps(t, http.MethodGet, "/api/apps", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAppInstanceMissingID(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doApps(t, http.MethodPost, "/api/apps/missing/start", "", true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAppInstanceConfigRollback(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := seedAppInstance(t, te, "demo-app")
	original := "services:\n  web:\n    image: nginx:alpine\n"
	updated := "services:\n  web:\n    image: caddy:alpine\n"

	rec := te.doApps(t, http.MethodPut, "/api/apps/"+record.Id+"/config", `{"content":`+jsonString(updated)+`}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("save: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	saved := parseJSON(t, rec)
	if saved["rollback_available"] != true {
		t.Fatalf("expected rollback point after save, got %v", saved["rollback_available"])
	}

	rec = te.doApps(t, http.MethodPost, "/api/apps/"+record.Id+"/config/rollback", `{}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("rollback: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	rolledBack := parseJSON(t, rec)
	if rolledBack["content"] != original {
		t.Fatalf("expected original compose after rollback, got %v", rolledBack["content"])
	}
	content, err := os.ReadFile(filepath.Join(record.GetString("project_dir"), "docker-compose.yml"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != original {
		t.Fatalf("expected compose file restored, got %q", string(content))
	}
	stored, err := te.app.FindRecordById("app_instances", record.Id)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(stored.Get("config_rollback_snapshot"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "caddy:alpine") {
		t.Fatalf("expected rollback snapshot to hold replaced config, got %s", string(raw))
	}
}

func TestAppInstanceDeployCreatesQueuedDeploymentForExistingProject(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := seedAppInstance(t, te, "demo-app")
	rec := te.doApps(t, http.MethodPost, "/api/apps/"+record.Id+"/deploy", `{"action":"upgrade"}`, true)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("deploy: expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	if created["status"] != "queued" {
		t.Fatalf("expected queued deployment, got %v", created["status"])
	}
	if created["project_dir"] != record.GetString("project_dir") {
		t.Fatalf("expected existing project dir, got %v", created["project_dir"])
	}
	if created["compose_project_name"] != record.GetString("name") {
		t.Fatalf("expected existing compose project name, got %v", created["compose_project_name"])
	}
	if created["source"] != record.GetString("source") {
		t.Fatalf("expected source %s, got %v", record.GetString("source"), created["source"])
	}
	if created["enqueued"] != false {
		t.Fatalf("expected enqueued false without worker client, got %v", created["enqueued"])
	}
	deployment, err := te.app.FindRecordById("deployments", created["id"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if deployment.GetString("project_dir") != record.GetString("project_dir") {
		t.Fatalf("expected stored project dir %s, got %s", record.GetString("project_dir"), deployment.GetString("project_dir"))
	}
}
