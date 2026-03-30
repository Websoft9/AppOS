package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/lifecycle/model"
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
	record.Set("key", name+"-key")
	record.Set("server_id", "local")
	record.Set("name", name)
	record.Set("lifecycle_state", string(model.AppStateRunningHealthy))
	record.Set("desired_state", string(model.DesiredStateRunning))
	record.Set("health_summary", string(model.HealthHealthy))
	record.Set("publication_summary", string(model.PublicationUnpublished))
	record.Set("state_reason", "seeded for apps route test")
	record.Set("installed_at", time.Now())
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}

	operationsCol, err := te.app.FindCollectionByNameOrId("app_operations")
	if err != nil {
		t.Fatal(err)
	}
	operation := core.NewRecord(operationsCol)
	operation.Set("app", record.Id)
	operation.Set("server_id", "local")
	operation.Set("operation_type", string(model.OperationTypeInstall))
	operation.Set("trigger_source", string(model.TriggerSourceManualOps))
	operation.Set("phase", string(model.OperationPhaseQueued))
	operation.Set("compose_project_name", name)
	operation.Set("project_dir", projectDir)
	operation.Set("rendered_compose", compose)
	operation.Set("queued_at", time.Now())
	operation.Set("spec_json", map[string]any{
		"project_dir": projectDir,
		"source":      string(model.TriggerSourceManualOps),
	})
	if err := te.app.Save(operation); err != nil {
		t.Fatal(err)
	}

	pipelineRunsCol, err := te.app.FindCollectionByNameOrId("pipeline_runs")
	if err != nil {
		t.Fatal(err)
	}
	pipelineRun := core.NewRecord(pipelineRunsCol)
	pipelineRun.Set("operation", operation.Id)
	pipelineRun.Set("pipeline_family", model.ProvisionPipeline)
	pipelineRun.Set("pipeline_definition_key", "provision.install.manual_compose")
	pipelineRun.Set("pipeline_version", "v1")
	pipelineRun.Set("current_phase", string(model.PipelinePhaseValidating))
	pipelineRun.Set("status", "active")
	pipelineRun.Set("node_count", 1)
	pipelineRun.Set("completed_node_count", 0)
	if err := te.app.Save(pipelineRun); err != nil {
		t.Fatal(err)
	}

	pipelineNodeRunsCol, err := te.app.FindCollectionByNameOrId("pipeline_node_runs")
	if err != nil {
		t.Fatal(err)
	}
	nodeRun := core.NewRecord(pipelineNodeRunsCol)
	nodeRun.Set("pipeline_run", pipelineRun.Id)
	nodeRun.Set("node_key", "validate_request")
	nodeRun.Set("node_type", "validation")
	nodeRun.Set("display_name", "Validate Request")
	nodeRun.Set("phase", string(model.PipelinePhaseValidating))
	nodeRun.Set("status", "pending")
	nodeRun.Set("retry_count", 0)
	nodeRun.Set("depends_on_json", []string{})
	if err := te.app.Save(nodeRun); err != nil {
		t.Fatal(err)
	}

	operation.Set("pipeline_run", pipelineRun.Id)
	if err := te.app.Save(operation); err != nil {
		t.Fatal(err)
	}

	record.Set("last_operation", operation.Id)
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}
	return record
}

func seedAppOperation(t *testing.T, te *testEnv, appRecord *core.Record) *core.Record {
	t.Helper()

	operation, err := te.app.FindRecordById("app_operations", appRecord.GetString("last_operation"))
	if err != nil {
		t.Fatal(err)
	}

	return operation
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
	currentPipeline, ok := items[0]["current_pipeline"].(map[string]any)
	if !ok {
		t.Fatalf("expected current_pipeline map in list, got %T", items[0]["current_pipeline"])
	}
	if currentPipeline["definition_key"] != "provision.install.manual_compose" {
		t.Fatalf("expected current pipeline definition key, got %v", currentPipeline["definition_key"])
	}

	rec = te.doApps(t, http.MethodGet, "/api/apps/"+record.Id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	item := parseJSON(t, rec)
	operation := seedAppOperation(t, te, record)
	if item["project_dir"] != operation.GetString("project_dir") {
		t.Fatalf("expected project dir, got %v", item["project_dir"])
	}
	if item["status"] != "installed" {
		t.Fatalf("expected installed, got %v", item["status"])
	}
	currentPipeline, ok = item["current_pipeline"].(map[string]any)
	if !ok {
		t.Fatalf("expected current_pipeline map in detail, got %T", item["current_pipeline"])
	}
	if currentPipeline["family"] != "provision" {
		t.Fatalf("expected provision current pipeline family, got %v", currentPipeline["family"])
	}
	selector, ok := currentPipeline["selector"].(map[string]any)
	if !ok {
		t.Fatalf("expected current pipeline selector map, got %T", currentPipeline["selector"])
	}
	if selector["operation_type"] != string(model.OperationTypeInstall) || selector["source"] != string(model.TriggerSourceManualOps) {
		t.Fatalf("unexpected current pipeline selector: %v", selector)
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
	operation := seedAppOperation(t, te, record)
	content, err := os.ReadFile(filepath.Join(operation.GetString("project_dir"), "docker-compose.yml"))
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
	snapshot, ok := getAppConfigRollbackSnapshot(stored)
	if !ok {
		t.Fatal("expected rollback snapshot to be available")
	}
	if !strings.Contains(snapshot.Content, "caddy:alpine") {
		t.Fatalf("expected rollback snapshot to hold replaced config, got %s", snapshot.Content)
	}
}

func TestAppInstanceUpgradeCreatesQueuedOperationForExistingProject(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := seedAppInstance(t, te, "demo-app")
	rec := te.doApps(t, http.MethodPost, "/api/apps/"+record.Id+"/upgrade", "", true)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("upgrade: expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	operation := seedAppOperation(t, te, record)
	if created["status"] != string(model.OperationPhaseQueued) {
		t.Fatalf("expected queued operation, got %v", created["status"])
	}
	if created["project_dir"] != operation.GetString("project_dir") {
		t.Fatalf("expected existing project dir, got %v", created["project_dir"])
	}
	if created["compose_project_name"] != record.GetString("name") {
		t.Fatalf("expected existing compose project name, got %v", created["compose_project_name"])
	}
	if created["source"] != operation.GetString("trigger_source") {
		t.Fatalf("expected source %s, got %v", operation.GetString("trigger_source"), created["source"])
	}
	if created["enqueued"] != false {
		t.Fatalf("expected enqueued false without worker client, got %v", created["enqueued"])
	}
	createdOperation, err := te.app.FindRecordById("app_operations", created["id"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if createdOperation.GetString("project_dir") != operation.GetString("project_dir") {
		t.Fatalf("expected stored project dir %s, got %s", operation.GetString("project_dir"), createdOperation.GetString("project_dir"))
	}
}

func TestAppInstanceLifecycleActionsCreateQueuedOperations(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tests := []struct {
		name                  string
		method                string
		urlSuffix             string
		expectedOperationType string
		assertSpec            func(t *testing.T, operation *core.Record)
	}{
		{name: "start", method: http.MethodPost, urlSuffix: "/start", expectedOperationType: string(model.OperationTypeStart)},
		{name: "stop", method: http.MethodPost, urlSuffix: "/stop", expectedOperationType: string(model.OperationTypeStop)},
		{name: "restart", method: http.MethodPost, urlSuffix: "/restart", expectedOperationType: string(model.OperationTypeRestart)},
		{
			name:                  "uninstall",
			method:                http.MethodDelete,
			urlSuffix:             "?removeVolumes=true",
			expectedOperationType: string(model.OperationTypeUninstall),
			assertSpec: func(t *testing.T, operation *core.Record) {
				t.Helper()
				spec := mustRouteJSONMap(t, operation.Get("spec_json"))
				metadata := spec["metadata"].(map[string]any)
				if metadata["remove_volumes"] != true {
					t.Fatalf("expected remove_volumes metadata true, got %v", metadata["remove_volumes"])
				}
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			record := seedAppInstance(t, te, "demo-app-"+tc.name)
			baseline := seedAppOperation(t, te, record)

			url := "/api/apps/" + record.Id + tc.urlSuffix
			if tc.method == http.MethodDelete {
				url = "/api/apps/" + record.Id + tc.urlSuffix
			}
			rec := te.doApps(t, tc.method, url, "", true)
			if rec.Code != http.StatusAccepted {
				t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
			}
			created := parseJSON(t, rec)
			if created["status"] != string(model.OperationPhaseQueued) {
				t.Fatalf("expected queued operation, got %v", created["status"])
			}
			if created["project_dir"] != baseline.GetString("project_dir") {
				t.Fatalf("expected existing project dir %s, got %v", baseline.GetString("project_dir"), created["project_dir"])
			}
			operation, err := te.app.FindRecordById("app_operations", created["id"].(string))
			if err != nil {
				t.Fatal(err)
			}
			if operation.GetString("operation_type") != tc.expectedOperationType {
				t.Fatalf("expected operation_type %s, got %s", tc.expectedOperationType, operation.GetString("operation_type"))
			}
			storedApp, err := te.app.FindRecordById("app_instances", record.Id)
			if err != nil {
				t.Fatal(err)
			}
			if storedApp.GetString("last_operation") != operation.Id {
				t.Fatalf("expected last_operation to update to %s, got %s", operation.Id, storedApp.GetString("last_operation"))
			}
			if tc.assertSpec != nil {
				tc.assertSpec(t, operation)
			}
		})
	}
}

func mustRouteJSONMap(t *testing.T, value any) map[string]any {
	t.Helper()
	if direct, ok := value.(map[string]any); ok {
		return direct
	}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal json field: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("unmarshal json field: %v", err)
	}
	return parsed
}
