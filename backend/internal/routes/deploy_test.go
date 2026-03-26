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
	"github.com/websoft9/appos/backend/internal/lifecycle/model"
)

func (te *testEnv) doOperations(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	g := r.Group("/api")
	g.Bind(apis.RequireAuth())
	registerOperationRoutes(g)

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

func TestOperationManualComposeCreateListDetail(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	compose := "services:\n  web:\n    image: nginx:alpine\n"
	rec := te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose", `{"project_name":"Demo App","compose":`+jsonString(compose)+`}`, true)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("create: expected 202, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	id := created["id"].(string)
	if created["status"] != string(model.OperationPhaseQueued) {
		t.Fatalf("expected queued status, got %v", created["status"])
	}
	if created["source"] != string(model.TriggerSourceManualOps) {
		t.Fatalf("expected manualops source, got %v", created["source"])
	}
	if created["pipeline_family"] != "provision" {
		t.Fatalf("expected provision pipeline family, got %v", created["pipeline_family"])
	}
	if created["pipeline_family_internal"] != "ProvisionPipeline" {
		t.Fatalf("expected internal provision pipeline family, got %v", created["pipeline_family_internal"])
	}
	if created["pipeline_definition_key"] != "provision.install.manual_compose" {
		t.Fatalf("expected manual compose definition key, got %v", created["pipeline_definition_key"])
	}
	pipeline, ok := created["pipeline"].(map[string]any)
	if !ok {
		t.Fatalf("expected pipeline map, got %T", created["pipeline"])
	}
	if pipeline["family"] != "provision" || pipeline["family_internal"] != "ProvisionPipeline" {
		t.Fatalf("unexpected pipeline family payload: %v", pipeline)
	}
	if pipeline["definition_key"] != "provision.install.manual_compose" {
		t.Fatalf("unexpected pipeline definition payload: %v", pipeline)
	}
	selector, ok := created["pipeline_selector"].(map[string]any)
	if !ok {
		t.Fatalf("expected pipeline_selector map, got %T", created["pipeline_selector"])
	}
	if selector["operation_type"] != string(model.OperationTypeInstall) || selector["source"] != string(model.TriggerSourceManualOps) || selector["adapter"] != string(model.AdapterManualCompose) {
		t.Fatalf("unexpected pipeline selector: %v", selector)
	}
	if created["spec"].(map[string]any)["operation_type"] != string(model.OperationTypeInstall) {
		t.Fatalf("expected install operation type, got %v", created["spec"].(map[string]any)["operation_type"])
	}

	rec = te.doOperations(t, http.MethodGet, "/api/actions/"+id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	detail := parseJSON(t, rec)
	if detail["adapter"] != string(model.AdapterManualCompose) {
		t.Fatalf("expected adapter manual-compose, got %v", detail["adapter"])
	}
	if detail["pipeline_family"] != "provision" {
		t.Fatalf("expected normalized family in detail, got %v", detail["pipeline_family"])
	}
	if detail["pipeline_definition_key"] != "provision.install.manual_compose" {
		t.Fatalf("expected manual compose definition key in detail, got %v", detail["pipeline_definition_key"])
	}
	detailPipeline, ok := detail["pipeline"].(map[string]any)
	if !ok {
		t.Fatalf("expected detail pipeline map, got %T", detail["pipeline"])
	}
	if detailPipeline["definition_key"] != "provision.install.manual_compose" {
		t.Fatalf("unexpected detail pipeline payload: %v", detailPipeline)
	}
	detailSelector, ok := detail["pipeline_selector"].(map[string]any)
	if !ok {
		t.Fatalf("expected detail pipeline_selector map, got %T", detail["pipeline_selector"])
	}
	if detailSelector["source"] != string(model.TriggerSourceManualOps) || detailSelector["adapter"] != string(model.AdapterManualCompose) {
		t.Fatalf("unexpected detail pipeline selector: %v", detailSelector)
	}
	if detail["has_execution_log"] != false {
		t.Fatalf("expected has_execution_log false before worker execution, got %v", detail["has_execution_log"])
	}
	steps, ok := detail["steps"].([]any)
	if !ok || len(steps) == 0 {
		t.Fatalf("expected steps array in detail, got %T", detail["steps"])
	}

	rec = te.doOperations(t, http.MethodGet, "/api/actions/"+id+"/logs", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("logs: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	logs := parseJSON(t, rec)
	if logs["execution_log"] != "" {
		t.Fatalf("expected empty execution log before worker execution, got %v", logs["execution_log"])
	}

	rec = te.doOperations(t, http.MethodGet, "/api/actions", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	list := parseJSONArray(t, rec)
	if len(list) != 1 {
		t.Fatalf("expected 1 operation, got %d", len(list))
	}
	if list[0]["id"] != id {
		t.Fatalf("expected operation id %s, got %v", id, list[0]["id"])
	}

	pipelineID, ok := pipeline["id"].(string)
	if !ok || pipelineID == "" {
		t.Fatalf("expected pipeline id, got %v", pipeline["id"])
	}

	rec = te.doOperations(t, http.MethodGet, "/api/pipelines", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("pipelines list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	pipelines := parseJSONArray(t, rec)
	if len(pipelines) != 1 {
		t.Fatalf("expected 1 pipeline, got %d", len(pipelines))
	}
	if pipelines[0]["id"] != pipelineID {
		t.Fatalf("expected pipeline id %s, got %v", pipelineID, pipelines[0]["id"])
	}
	if pipelines[0]["operation_id"] != id {
		t.Fatalf("expected pipeline operation id %s, got %v", id, pipelines[0]["operation_id"])
	}
	if pipelines[0]["family"] != "provision" {
		t.Fatalf("expected provision family in pipeline list, got %v", pipelines[0]["family"])
	}

	rec = te.doOperations(t, http.MethodGet, "/api/pipelines/"+pipelineID, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("pipeline detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	pipelineDetail := parseJSON(t, rec)
	if pipelineDetail["definition_key"] != "provision.install.manual_compose" {
		t.Fatalf("expected manual compose pipeline detail key, got %v", pipelineDetail["definition_key"])
	}
	if pipelineDetail["current_phase"] != string(model.PipelinePhaseValidating) {
		t.Fatalf("expected validating current phase, got %v", pipelineDetail["current_phase"])
	}
	if pipelineDetail["status"] != "active" {
		t.Fatalf("expected active pipeline status, got %v", pipelineDetail["status"])
	}
}

func TestOperationDetailIncludesNodeExecutionLogs(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	compose := "services:\n  web:\n    image: nginx:alpine\n"
	rec := te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose", `{"project_name":"Node Logs Demo","compose":`+jsonString(compose)+`}`, true)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("create: expected 202, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	id := created["id"].(string)
	pipeline := created["pipeline"].(map[string]any)
	pipelineID := pipeline["id"].(string)

	nodeRunsCol, err := te.app.FindCollectionByNameOrId("pipeline_node_runs")
	if err != nil {
		t.Fatal(err)
	}
	nodeRuns, err := te.app.FindRecordsByFilter(nodeRunsCol, "pipeline_run = '"+pipelineID+"'", "created", 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	var nodeRun *core.Record
	for _, candidate := range nodeRuns {
		if candidate.GetString("node_key") == "render_runtime_config" {
			nodeRun = candidate
			break
		}
	}
	if nodeRun == nil {
		t.Fatal("expected seeded render_runtime_config node run")
	}
	nodeRun.Set("execution_log", "2026-03-26T08:00:00Z render config\n2026-03-26T08:00:02Z write env vars")
	if err := te.app.Save(nodeRun); err != nil {
		t.Fatal(err)
	}

	rec = te.doOperations(t, http.MethodGet, "/api/actions/"+id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	detail := parseJSON(t, rec)
	steps, ok := detail["steps"].([]any)
	if !ok {
		t.Fatalf("expected steps array, got %T", detail["steps"])
	}
	matched := false
	for _, raw := range steps {
		step, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if step["key"] == "render_runtime_config" {
			matched = true
			if step["execution_log"] != "2026-03-26T08:00:00Z render config\n2026-03-26T08:00:02Z write env vars" {
				t.Fatalf("unexpected node execution log payload: %v", step["execution_log"])
			}
		}
	}
	if !matched {
		t.Fatal("expected render_runtime_config step in detail response")
	}
}

func TestOperationManualComposeValidation(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose", `{"compose":"version: '3'"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid compose, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestOperationManualComposeRejectsDuplicateAppName(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	compose := "services:\n  web:\n    image: nginx:alpine\n"
	rec := te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose", `{"project_name":"Demo App","compose":`+jsonString(compose)+`}`, true)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("first create: expected 202, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose", `{"project_name":"Demo App","compose":`+jsonString(compose)+`}`, true)
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate create: expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if !strings.Contains(strings.ToLower(body["message"].(string)), "already exists") {
		t.Fatalf("expected duplicate app name message, got %v", body["message"])
	}
}

func TestOperationManualComposeResolutionPayload(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	compose := "services:\n  web:\n    image: nginx:alpine\n"
	rec := te.doOperations(
		t,
		http.MethodPost,
		"/api/actions/install/manual-compose",
		`{"project_name":"Resolver Demo","compose":`+jsonString(compose)+`,"env":{"APP_ENV":"prod","HTTP_PORT":8080,"FEATURE_X":true},"exposure":{"domain":"demo.local","target_port":8080}}`,
		true,
	)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	spec, ok := created["spec"].(map[string]any)
	if !ok {
		t.Fatalf("expected spec map, got %T", created["spec"])
	}
	resolvedEnv, ok := spec["resolved_env"].(map[string]any)
	if !ok {
		t.Fatalf("expected resolved_env map, got %T", spec["resolved_env"])
	}
	if resolvedEnv["APP_ENV"] != "prod" || resolvedEnv["HTTP_PORT"] != "8080" || resolvedEnv["FEATURE_X"] != "true" {
		t.Fatalf("unexpected resolved_env payload: %v", resolvedEnv)
	}
	exposureIntent, ok := spec["exposure_intent"].(map[string]any)
	if !ok {
		t.Fatalf("expected exposure_intent map, got %T", spec["exposure_intent"])
	}
	if exposureIntent["exposure_type"] != "domain" || exposureIntent["domain"] != "demo.local" {
		t.Fatalf("unexpected exposure intent: %v", exposureIntent)
	}
	if exposureIntent["target_port"] != float64(8080) {
		t.Fatalf("expected target_port 8080, got %v", exposureIntent["target_port"])
	}
	if created["compose_project_name"] != "resolver-demo" {
		t.Fatalf("expected normalized compose project name resolver-demo, got %v", created["compose_project_name"])
	}
}

func TestOperationGitComposeCreate(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("services:\n  web:\n    image: nginx:alpine\n"))
	}))
	defer server.Close()

	rec := te.doOperations(
		t,
		http.MethodPost,
		"/api/actions/install/git-compose",
		`{"repository_url":"https://github.com/example/demo","compose_path":"docker-compose.yml","ref":"main","raw_url":`+jsonString(server.URL)+`}`,
		true,
	)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("git create: expected 202, got %d: %s", rec.Code, rec.Body.String())
	}

	created := parseJSON(t, rec)
	if created["source"] != string(model.TriggerSourceGitOps) {
		t.Fatalf("expected gitops source, got %v", created["source"])
	}
	if created["adapter"] != string(model.AdapterGitCompose) {
		t.Fatalf("expected git-compose adapter, got %v", created["adapter"])
	}
	if created["pipeline_family"] != "provision" {
		t.Fatalf("expected provision pipeline family, got %v", created["pipeline_family"])
	}
	if created["pipeline_family_internal"] != "ProvisionPipeline" {
		t.Fatalf("expected internal provision pipeline family, got %v", created["pipeline_family_internal"])
	}
	if created["pipeline_definition_key"] != "provision.install.git_compose" {
		t.Fatalf("expected git compose definition key, got %v", created["pipeline_definition_key"])
	}
	pipeline, ok := created["pipeline"].(map[string]any)
	if !ok {
		t.Fatalf("expected pipeline map, got %T", created["pipeline"])
	}
	if pipeline["family"] != "provision" || pipeline["definition_key"] != "provision.install.git_compose" {
		t.Fatalf("unexpected git pipeline payload: %v", pipeline)
	}
	selector, ok := created["pipeline_selector"].(map[string]any)
	if !ok {
		t.Fatalf("expected pipeline_selector map, got %T", created["pipeline_selector"])
	}
	if selector["operation_type"] != string(model.OperationTypeInstall) || selector["source"] != string(model.TriggerSourceGitOps) || selector["adapter"] != string(model.AdapterGitCompose) {
		t.Fatalf("unexpected pipeline selector: %v", selector)
	}
	if _, ok := created["lifecycle"]; !ok {
		t.Fatal("expected lifecycle in operation response")
	}
	if spec, ok := created["spec"].(map[string]any); !ok || spec["source"] != string(model.TriggerSourceGitOps) {
		t.Fatalf("expected gitops spec, got %v", created["spec"])
	}
	if spec, ok := created["spec"].(map[string]any); !ok || spec["operation_type"] != string(model.OperationTypeInstall) {
		t.Fatalf("expected install operation type, got %v", created["spec"])
	}
}

func TestOperationGitComposeWithHeaderAuth(t *testing.T) {
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

	rec := te.doOperations(
		t,
		http.MethodPost,
		"/api/actions/install/git-compose",
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
