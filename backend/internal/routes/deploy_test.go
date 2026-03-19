package routes

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
)

func (te *testEnv) doDeploy(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	g := r.Group("/api")
	g.Bind(apis.RequireAuth())
	registerDeployRoutes(g)

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

func TestDeploymentManualComposeCreateListDetail(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	compose := "services:\n  web:\n    image: nginx:alpine\n"
	rec := te.doDeploy(t, http.MethodPost, "/api/deployments/manual-compose", `{"project_name":"Demo App","compose":`+jsonString(compose)+`}`, true)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("create: expected 202, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	id := created["id"].(string)
	if created["status"] != "queued" {
		t.Fatalf("expected queued status, got %v", created["status"])
	}
	if created["source"] != "manualops" {
		t.Fatalf("expected manualops source, got %v", created["source"])
	}

	rec = te.doDeploy(t, http.MethodGet, "/api/deployments/"+id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	detail := parseJSON(t, rec)
	if detail["adapter"] != "manual-compose" {
		t.Fatalf("expected adapter manual-compose, got %v", detail["adapter"])
	}
	if detail["has_execution_log"] != false {
		t.Fatalf("expected has_execution_log false before worker execution, got %v", detail["has_execution_log"])
	}

	rec = te.doDeploy(t, http.MethodGet, "/api/deployments/"+id+"/logs", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("logs: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	logs := parseJSON(t, rec)
	if logs["execution_log"] != "" {
		t.Fatalf("expected empty execution log before worker execution, got %v", logs["execution_log"])
	}

	rec = te.doDeploy(t, http.MethodGet, "/api/deployments", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	list := parseJSONArray(t, rec)
	if len(list) != 1 {
		t.Fatalf("expected 1 deployment, got %d", len(list))
	}
	if list[0]["id"] != id {
		t.Fatalf("expected deployment id %s, got %v", id, list[0]["id"])
	}
}

func TestDeploymentManualComposeValidation(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doDeploy(t, http.MethodPost, "/api/deployments/manual-compose", `{"compose":"version: '3'"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid compose, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDeploymentGitComposeCreate(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("services:\n  web:\n    image: nginx:alpine\n"))
	}))
	defer server.Close()

	rec := te.doDeploy(
		t,
		http.MethodPost,
		"/api/deployments/git-compose",
		`{"repository_url":"https://github.com/example/demo","compose_path":"docker-compose.yml","ref":"main","raw_url":`+jsonString(server.URL)+`}`,
		true,
	)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("git create: expected 202, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	if created["source"] != "gitops" {
		t.Fatalf("expected gitops source, got %v", created["source"])
	}
	if created["adapter"] != "git-compose" {
		t.Fatalf("expected git-compose adapter, got %v", created["adapter"])
	}
	if _, ok := created["lifecycle"]; !ok {
		t.Fatal("expected lifecycle in deployment response")
	}
	if spec, ok := created["spec"].(map[string]any); !ok || spec["source"] != "gitops" {
		t.Fatalf("expected gitops spec, got %v", created["spec"])
	}
}

func TestDeploymentGitComposeWithHeaderAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer top-secret" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte("services:\n  web:\n    image: nginx:alpine\n"))
	}))
	defer server.Close()

	rec := te.doDeploy(
		t,
		http.MethodPost,
		"/api/deployments/git-compose",
		`{"repository_url":"https://github.com/example/private","compose_path":"docker-compose.yml","raw_url":`+jsonString(server.URL)+`,"auth_header_name":"Authorization","auth_header_value":"Bearer top-secret"}`,
		true,
	)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("git private create: expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
}

func jsonString(value string) string {
	data, _ := json.Marshal(value)
	return string(data)
}