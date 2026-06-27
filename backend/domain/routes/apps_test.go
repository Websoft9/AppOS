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
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
	"github.com/websoft9/appos/backend/domain/lifecycle/projection"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitorstore "github.com/websoft9/appos/backend/domain/monitor/status/store"
)

func seedPrimaryExposure(t *testing.T, te *testEnv, appRecord *core.Record, publicationState string, healthState string) *core.Record {
	t.Helper()
	exposuresCol, err := te.app.FindCollectionByNameOrId("app_exposures")
	if err != nil {
		t.Fatal(err)
	}
	exposure := core.NewRecord(exposuresCol)
	exposure.Set("app", appRecord.Id)
	exposure.Set("exposure_type", "domain")
	exposure.Set("is_primary", true)
	exposure.Set("domain", "demo.local")
	exposure.Set("path", "/")
	exposure.Set("target_port", 8080)
	exposure.Set("publication_state", publicationState)
	exposure.Set("health_state", healthState)
	exposure.Set("last_verified_at", time.Now())
	if err := te.app.Save(exposure); err != nil {
		t.Fatal(err)
	}
	appRecord.Set("primary_exposure", exposure.Id)
	if err := te.app.Save(appRecord); err != nil {
		t.Fatal(err)
	}
	return exposure
}

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
	if err := os.WriteFile(filepath.Join(projectDir, "docker-compose.yml"), []byte(compose), 0o600); err != nil {
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
	record.Set("template_key", name+"-catalog")
	record.Set("lifecycle_state", string(model.AppStateRunningHealthy))
	record.Set("desired_state", string(model.DesiredStateRunning))
	record.Set("health_summary", string(model.HealthHealthy))
	record.Set("publication_summary", string(model.PublicationUnpublished))
	record.Set("channel", string(model.ChannelCustom))
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
	operation.Set("trigger", string(model.TriggerManual))
	operation.Set("execution_mode", string(model.ExecutionModeCompose))
	operation.Set("phase", string(model.OperationPhaseQueued))
	operation.Set("compose_project_name", name)
	operation.Set("project_dir", projectDir)
	operation.Set("rendered_compose", compose)
	operation.Set("queued_at", time.Now())
	operation.Set("spec_json", map[string]any{
		"project_dir":    projectDir,
		"channel":        string(model.ChannelCustom),
		"execution_mode": string(model.ExecutionModeCompose),
		"metadata": map[string]any{
			"prefill_context": map[string]any{
				"app_key": name + "-catalog",
			},
		},
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

func seedManagedAppInstanceForServer(t *testing.T, te *testEnv, serverID string, name string) *core.Record {
	t.Helper()

	projectDir := t.TempDir()
	compose := "services:\n  web:\n    image: nginx:alpine\n"
	if err := os.WriteFile(filepath.Join(projectDir, "docker-compose.yml"), []byte(compose), 0o600); err != nil {
		t.Fatal(err)
	}
	col, err := te.app.FindCollectionByNameOrId("app_instances")
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(col)
	record.Set("key", name+"-key")
	record.Set("server_id", serverID)
	record.Set("name", name)
	record.Set("template_key", name+"-catalog")
	record.Set("lifecycle_state", string(model.AppStateRunningHealthy))
	record.Set("desired_state", string(model.DesiredStateRunning))
	record.Set("health_summary", string(model.HealthHealthy))
	record.Set("publication_summary", string(model.PublicationUnpublished))
	record.Set("channel", string(model.ChannelCustom))
	record.Set("state_reason", "seeded for offline managed apps route test")
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
	operation.Set("server_id", serverID)
	operation.Set("operation_type", string(model.OperationTypeInstall))
	operation.Set("trigger", string(model.TriggerManual))
	operation.Set("execution_mode", string(model.ExecutionModeCompose))
	operation.Set("phase", string(model.OperationPhaseQueued))
	operation.Set("compose_project_name", name)
	operation.Set("project_dir", projectDir)
	operation.Set("rendered_compose", compose)
	operation.Set("queued_at", time.Now())
	operation.Set("spec_json", map[string]any{
		"project_dir":    projectDir,
		"channel":        string(model.ChannelCustom),
		"execution_mode": string(model.ExecutionModeCompose),
		"metadata": map[string]any{
			"prefill_context": map[string]any{
				"app_key": name + "-catalog",
			},
		},
	})
	if err := te.app.Save(operation); err != nil {
		t.Fatal(err)
	}

	record.Set("last_operation", operation.Id)
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}
	return record
}

func TestAppInstancesListAndDetail(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
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
	if items[0]["catalog_app_key"] != "demo-app-catalog" {
		t.Fatalf("expected catalog_app_key demo-app-catalog, got %v", items[0]["catalog_app_key"])
	}
	if items[0]["server_name"] != "Local" {
		t.Fatalf("expected server_name Local, got %v", items[0]["server_name"])
	}
	if items[0]["template_icon_url"] == "" {
		t.Fatalf("expected template_icon_url demo-app-catalog, got %v", items[0]["template_icon_url"])
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
	if item["catalog_app_key"] != "demo-app-catalog" {
		t.Fatalf("expected detail catalog_app_key demo-app-catalog, got %v", item["catalog_app_key"])
	}
	if item["server_name"] != "Local" {
		t.Fatalf("expected detail server_name Local, got %v", item["server_name"])
	}
	if item["template_icon_url"] == "" {
		t.Fatalf("expected detail template_icon_url demo-app-catalog, got %v", item["template_icon_url"])
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
	if selector["operation_type"] != string(model.OperationTypeInstall) {
		t.Fatalf("unexpected current pipeline selector: %v", selector)
	}
	if _, exists := selector["channel"]; exists {
		t.Fatalf("expected current pipeline selector to omit channel, got %v", selector)
	}
}

func TestAppInstancesCatalogAppKeyFallsBackToOperationSpec(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := seedAppInstance(t, te, "legacy-app")
	record.Set("template_key", "")
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}

	rec := te.doApps(t, http.MethodGet, "/api/apps", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	items := parseJSONArray(t, rec)
	if len(items) != 1 {
		t.Fatalf("expected 1 app instance, got %d", len(items))
	}
	if items[0]["catalog_app_key"] != "legacy-app-catalog" {
		t.Fatalf("expected fallback catalog_app_key legacy-app-catalog, got %v", items[0]["catalog_app_key"])
	}

	rec = te.doApps(t, http.MethodGet, "/api/apps/"+record.Id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	item := parseJSON(t, rec)
	if item["catalog_app_key"] != "legacy-app-catalog" {
		t.Fatalf("expected detail fallback catalog_app_key legacy-app-catalog, got %v", item["catalog_app_key"])
	}
}

func TestAppInstancesListFallsBackWhenDirectServerAccessIsUnavailable(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	server := createServerRecord(t, te, "direct-offline", "10.0.0.99", 22, "root", "password")
	server.Set("connect_type", "direct")
	server.Set("access_status", "unavailable")
	server.Set("access_reason", "control_unreachable")
	server.Set("access_checked_at", "2026-06-25 10:00:00.000Z")
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	record := seedManagedAppInstanceForServer(t, te, server.Id, "offline-app")

	rec := te.doApps(t, http.MethodGet, "/api/apps", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	items := parseJSONArray(t, rec)
	if len(items) != 1 {
		t.Fatalf("expected 1 app instance, got %d", len(items))
	}
	if items[0]["id"] != record.Id {
		t.Fatalf("expected app %s, got %v", record.Id, items[0]["id"])
	}
	if items[0]["runtime_status"] != "unknown" {
		t.Fatalf("expected runtime_status unknown, got %v", items[0]["runtime_status"])
	}
	if items[0]["instance_state"] != string(projection.InstanceStateUnknown) {
		t.Fatalf("expected list instance_state unknown, got %v", items[0]["instance_state"])
	}
	if items[0]["runtime_reason"] != "Server is unreachable from the control plane." {
		t.Fatalf("expected control-plane runtime reason, got %v", items[0]["runtime_reason"])
	}
	if items[0]["server_connection_status"] != "unreachable" {
		t.Fatalf("expected server_connection_status unreachable, got %v", items[0]["server_connection_status"])
	}
	if items[0]["server_connection_reason"] != "Server is unreachable from the control plane." {
		t.Fatalf("expected server_connection_reason, got %v", items[0]["server_connection_reason"])
	}
	if items[0]["server_name"] != "direct-offline" {
		t.Fatalf("expected server_name direct-offline, got %v", items[0]["server_name"])
	}

	detailRec := te.doApps(t, http.MethodGet, "/api/apps/"+record.Id, "", true)
	if detailRec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", detailRec.Code, detailRec.Body.String())
	}
	item := parseJSON(t, detailRec)
	if item["runtime_status"] != "unknown" {
		t.Fatalf("expected detail runtime_status unknown, got %v", item["runtime_status"])
	}
	if item["runtime_reason"] != "Server is unreachable from the control plane." {
		t.Fatalf("expected detail control-plane runtime reason, got %v", item["runtime_reason"])
	}
	if item["server_connection_status"] != "unreachable" {
		t.Fatalf("expected detail server_connection_status unreachable, got %v", item["server_connection_status"])
	}
	if item["server_connection_reason"] != "Server is unreachable from the control plane." {
		t.Fatalf("expected detail server_connection_reason, got %v", item["server_connection_reason"])
	}
}

func TestAppInstancesListFallsBackWhenMonitorProjectsServerUnreachable(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	server := createServerRecord(t, te, "monitor-unreachable", "10.0.0.100", 22, "root", "password")
	server.Set("connect_type", "direct")
	server.Set("access_status", "available")
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	zeroFailures := 0
	if _, err := monitorstore.UpsertLatestStatus(te.app, monitorstore.LatestStatusUpsert{
		TargetType:          monitor.TargetTypeServer,
		TargetID:            server.Id,
		DisplayName:         server.GetString("name"),
		Status:              monitor.StatusUnreachable,
		Reason:              "control plane timed out",
		SignalSource:        monitor.SignalSourceAppOS,
		LastTransitionAt:    now,
		LastFailureAt:       &now,
		LastReportedAt:      &now,
		ConsecutiveFailures: &zeroFailures,
		Summary:             map[string]any{"reason_code": "control_unreachable"},
	}); err != nil {
		t.Fatal(err)
	}

	record := seedManagedAppInstanceForServer(t, te, server.Id, "monitor-offline-app")

	rec := te.doApps(t, http.MethodGet, "/api/apps/"+record.Id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	item := parseJSON(t, rec)
	if item["runtime_status"] != "unknown" {
		t.Fatalf("expected runtime_status unknown, got %v", item["runtime_status"])
	}
	if item["instance_state"] != string(projection.InstanceStateUnknown) {
		t.Fatalf("expected instance_state unknown, got %v", item["instance_state"])
	}
	if item["runtime_reason"] != "Server is unreachable." {
		t.Fatalf("expected projected unreachable runtime reason, got %v", item["runtime_reason"])
	}
	if item["server_connection_status"] != "unreachable" {
		t.Fatalf("expected server_connection_status unreachable, got %v", item["server_connection_status"])
	}
	if item["server_connection_reason"] != "Server is unreachable." {
		t.Fatalf("expected server_connection_reason unreachable, got %v", item["server_connection_reason"])
	}
	if item["state_reason"] != "Server is unreachable." {
		t.Fatalf("expected effective state_reason from runtime fallback, got %v", item["state_reason"])
	}
}

func TestAppInstanceDetailUsesPrimaryExposureAndAppMonitorEvidence(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := seedManagedAppInstanceForServer(t, te, "local", "evidence-app")
	seedPrimaryExposure(t, te, record, "published", "degraded")
	now := time.Now().UTC()
	zeroFailures := 0
	if _, err := monitorstore.UpsertLatestStatus(te.app, monitorstore.LatestStatusUpsert{
		TargetType:          monitor.TargetTypeApp,
		TargetID:            record.Id,
		DisplayName:         record.GetString("name"),
		Status:              monitor.StatusDegraded,
		Reason:              "restarting",
		SignalSource:        monitor.SignalSourceAppOS,
		LastTransitionAt:    now,
		LastFailureAt:       &now,
		LastReportedAt:      &now,
		ConsecutiveFailures: &zeroFailures,
		Summary: map[string]any{
			"runtime_status":      "restarting",
			"health_summary":      "degraded",
			"publication_summary": "published",
		},
	}); err != nil {
		t.Fatal(err)
	}

	rec := te.doApps(t, http.MethodGet, "/api/apps/"+record.Id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	item := parseJSON(t, rec)
	if item["runtime_status"] != "restarting" {
		t.Fatalf("expected restarting runtime_status, got %v", item["runtime_status"])
	}
	if item["health_summary"] != string(model.HealthDegraded) {
		t.Fatalf("expected degraded health_summary, got %v", item["health_summary"])
	}
	if item["publication_summary"] != string(model.PublicationDegraded) {
		t.Fatalf("expected degraded publication_summary from primary exposure, got %v", item["publication_summary"])
	}
	if item["instance_state"] != string(projection.InstanceStateDegraded) {
		t.Fatalf("expected instance_state degraded, got %v", item["instance_state"])
	}
	if _, exists := item["lifecycle_state"]; exists {
		t.Fatalf("expected lifecycle_state to be omitted from app detail response, got %v", item["lifecycle_state"])
	}
	if item["status"] != "installed" {
		t.Fatalf("expected installed status, got %v", item["status"])
	}
	if item["state_reason"] != "runtime restarting" {
		t.Fatalf("expected effective state_reason runtime restarting, got %v", item["state_reason"])
	}
	if item["runtime_reason"] != nil {
		t.Fatalf("expected no runtime_reason when app monitor evidence is present, got %v", item["runtime_reason"])
	}
}

func TestAppInstanceDetailUsesCurrentPipelineForEffectiveLifecycle(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := seedAppInstance(t, te, "updating-app")
	record.Set("lifecycle_state", string(model.AppStateRunningHealthy))
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}
	operations, err := te.app.FindRecordsByFilter("app_operations", "app = {:appID}", "-updated", 1, 0, map[string]any{"appID": record.Id})
	if err != nil || len(operations) == 0 {
		t.Fatalf("find seeded operation: %v", err)
	}
	operation := operations[0]
	operation.Set("operation_type", string(model.OperationTypeUpgrade))
	if err := te.app.Save(operation); err != nil {
		t.Fatal(err)
	}
	pipelineRuns, err := te.app.FindRecordsByFilter("pipeline_runs", "operation = {:operationID}", "-updated", 1, 0, map[string]any{"operationID": operation.Id})
	if err != nil || len(pipelineRuns) == 0 {
		t.Fatalf("find seeded pipeline run: %v", err)
	}
	pipelineRun := pipelineRuns[0]
	pipelineRun.Set("status", "active")
	pipelineRun.Set("current_phase", string(model.PipelinePhaseExecuting))
	if err := te.app.Save(pipelineRun); err != nil {
		t.Fatal(err)
	}

	rec := te.doApps(t, http.MethodGet, "/api/apps/"+record.Id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	item := parseJSON(t, rec)
	if item["instance_state"] != string(projection.InstanceStateUpdating) {
		t.Fatalf("expected instance_state updating from current pipeline, got %v", item["instance_state"])
	}
	if _, exists := item["lifecycle_state"]; exists {
		t.Fatalf("expected lifecycle_state to be omitted from app detail response, got %v", item["lifecycle_state"])
	}
	if item["state_reason"] != "upgrade in progress" {
		t.Fatalf("expected effective state_reason upgrade in progress, got %v", item["state_reason"])
	}
}

func TestAppInstanceDetailIgnoresCompletedPipelineWithRetainedPhase(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := seedAppInstance(t, te, "completed-pipeline-app")
	record.Set("lifecycle_state", string(model.AppStateRunningHealthy))
	record.Set("health_summary", string(model.HealthHealthy))
	record.Set("state_reason", "operation completed")
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}
	operations, err := te.app.FindRecordsByFilter("app_operations", "app = {:appID}", "-updated", 1, 0, map[string]any{"appID": record.Id})
	if err != nil || len(operations) == 0 {
		t.Fatalf("find seeded operation: %v", err)
	}
	operation := operations[0]
	operation.Set("operation_type", string(model.OperationTypeUpgrade))
	if err := te.app.Save(operation); err != nil {
		t.Fatal(err)
	}
	pipelineRuns, err := te.app.FindRecordsByFilter("pipeline_runs", "operation = {:operationID}", "-updated", 1, 0, map[string]any{"operationID": operation.Id})
	if err != nil || len(pipelineRuns) == 0 {
		t.Fatalf("find seeded pipeline run: %v", err)
	}
	pipelineRun := pipelineRuns[0]
	pipelineRun.Set("status", "completed")
	pipelineRun.Set("current_phase", string(model.PipelinePhaseExecuting))
	if err := te.app.Save(pipelineRun); err != nil {
		t.Fatal(err)
	}

	rec := te.doApps(t, http.MethodGet, "/api/apps/"+record.Id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	item := parseJSON(t, rec)
	if item["instance_state"] != string(projection.InstanceStateRunning) {
		t.Fatalf("expected instance_state running when pipeline is completed, got %v", item["instance_state"])
	}
	if item["state_reason"] != "operation completed" {
		t.Fatalf("expected stored completed reason, got %v", item["state_reason"])
	}
	currentPipeline, ok := item["current_pipeline"].(map[string]any)
	if !ok {
		t.Fatalf("expected current_pipeline map in detail, got %T", item["current_pipeline"])
	}
	if currentPipeline["status"] != "completed" {
		t.Fatalf("expected completed current pipeline status, got %v", currentPipeline["status"])
	}
	if currentPipeline["current_phase"] != string(model.PipelinePhaseExecuting) {
		t.Fatalf("expected retained executing phase in current pipeline, got %v", currentPipeline["current_phase"])
	}
}

func TestAppInstanceDetailQueuedUninstallUsesCanonicalUninstalling(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := seedAppInstance(t, te, "uninstalling-app")
	record.Set("lifecycle_state", string(model.AppStateRunningHealthy))
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}
	operations, err := te.app.FindRecordsByFilter("app_operations", "app = {:appID}", "-updated", 1, 0, map[string]any{"appID": record.Id})
	if err != nil || len(operations) == 0 {
		t.Fatalf("find seeded operation: %v", err)
	}
	operation := operations[0]
	operation.Set("operation_type", string(model.OperationTypeUninstall))
	if err := te.app.Save(operation); err != nil {
		t.Fatal(err)
	}
	pipelineRuns, err := te.app.FindRecordsByFilter("pipeline_runs", "operation = {:operationID}", "-updated", 1, 0, map[string]any{"operationID": operation.Id})
	if err != nil || len(pipelineRuns) == 0 {
		t.Fatalf("find seeded pipeline run: %v", err)
	}
	pipelineRun := pipelineRuns[0]
	pipelineRun.Set("status", "active")
	pipelineRun.Set("current_phase", string(model.PipelinePhaseExecuting))
	if err := te.app.Save(pipelineRun); err != nil {
		t.Fatal(err)
	}

	rec := te.doApps(t, http.MethodGet, "/api/apps/"+record.Id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	item := parseJSON(t, rec)
	if item["instance_state"] != string(projection.InstanceStateUninstalling) {
		t.Fatalf("expected instance_state uninstalling, got %v", item["instance_state"])
	}
	if item["state_reason"] != "uninstall in progress" {
		t.Fatalf("expected effective state_reason uninstall in progress, got %v", item["state_reason"])
	}
}

func TestAppInstanceDetailDesiredStoppedRemainsStoppedWhenRuntimeUnavailable(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	server := createServerRecord(t, te, "stopped-offline", "10.0.0.101", 22, "root", "password")
	server.Set("connect_type", "direct")
	server.Set("access_status", "available")
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	record := seedManagedAppInstanceForServer(t, te, server.Id, "stopped-app")
	record.Set("lifecycle_state", string(model.AppStateStopped))
	record.Set("desired_state", string(model.DesiredStateStopped))
	record.Set("health_summary", string(model.HealthStopped))
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	zeroFailures := 0
	if _, err := monitorstore.UpsertLatestStatus(te.app, monitorstore.LatestStatusUpsert{
		TargetType:          monitor.TargetTypeServer,
		TargetID:            server.Id,
		DisplayName:         server.GetString("name"),
		Status:              monitor.StatusUnreachable,
		Reason:              "control plane timed out",
		SignalSource:        monitor.SignalSourceAppOS,
		LastTransitionAt:    now,
		LastFailureAt:       &now,
		LastReportedAt:      &now,
		ConsecutiveFailures: &zeroFailures,
		Summary:             map[string]any{"reason_code": "control_unreachable"},
	}); err != nil {
		t.Fatal(err)
	}

	rec := te.doApps(t, http.MethodGet, "/api/apps/"+record.Id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	item := parseJSON(t, rec)
	if item["runtime_status"] != "unknown" {
		t.Fatalf("expected runtime_status unknown, got %v", item["runtime_status"])
	}
	if item["instance_state"] != string(projection.InstanceStateStopped) {
		t.Fatalf("expected instance_state stopped, got %v", item["instance_state"])
	}
	if item["state_reason"] != "Server is unreachable." {
		t.Fatalf("expected state_reason runtime fallback, got %v", item["state_reason"])
	}
	if item["server_connection_status"] != "unreachable" {
		t.Fatalf("expected server_connection_status unreachable, got %v", item["server_connection_status"])
	}
}

func TestAppInstanceDetailResolvesFromUnifiedRawSources(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := seedAppInstance(t, te, "raw-sources-app")
	record.Set("lifecycle_state", string(model.AppStateRunningHealthy))
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}
	seedPrimaryExposure(t, te, record, "published", "degraded")
	operations, err := te.app.FindRecordsByFilter("app_operations", "app = {:appID}", "-updated", 1, 0, map[string]any{"appID": record.Id})
	if err != nil || len(operations) == 0 {
		t.Fatalf("find seeded operation: %v", err)
	}
	operation := operations[0]
	operation.Set("operation_type", string(model.OperationTypeUpgrade))
	if err := te.app.Save(operation); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	zeroFailures := 0
	if _, err := monitorstore.UpsertLatestStatus(te.app, monitorstore.LatestStatusUpsert{
		TargetType:          monitor.TargetTypeApp,
		TargetID:            record.Id,
		DisplayName:         record.GetString("name"),
		Status:              monitor.StatusDegraded,
		Reason:              "restarting",
		SignalSource:        monitor.SignalSourceAppOS,
		LastTransitionAt:    now,
		LastFailureAt:       &now,
		LastReportedAt:      &now,
		ConsecutiveFailures: &zeroFailures,
		Summary: map[string]any{
			"runtime_status":      "restarting",
			"health_summary":      "degraded",
			"publication_summary": "published",
		},
	}); err != nil {
		t.Fatal(err)
	}

	rec := te.doApps(t, http.MethodGet, "/api/apps/"+record.Id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	item := parseJSON(t, rec)
	if item["runtime_status"] != "restarting" {
		t.Fatalf("expected restarting runtime_status, got %v", item["runtime_status"])
	}
	if item["health_summary"] != string(model.HealthDegraded) {
		t.Fatalf("expected degraded health_summary, got %v", item["health_summary"])
	}
	if item["instance_state"] != string(projection.InstanceStateUpdating) {
		t.Fatalf("expected instance_state updating from unified raw sources, got %v", item["instance_state"])
	}
	if item["publication_summary"] != string(model.PublicationDegraded) {
		t.Fatalf("expected degraded publication_summary, got %v", item["publication_summary"])
	}
	if _, exists := item["lifecycle_state"]; exists {
		t.Fatalf("expected lifecycle_state to be omitted from app detail response, got %v", item["lifecycle_state"])
	}
	if item["state_reason"] != "upgrade in progress" {
		t.Fatalf("expected effective state_reason upgrade in progress, got %v", item["state_reason"])
	}
	if item["runtime_reason"] != nil {
		t.Fatalf("expected no runtime_reason when monitor summary exists, got %v", item["runtime_reason"])
	}
}

func TestAppInstanceDetailUsesMonitorReasonWhenSummaryIsSparse(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := seedAppInstance(t, te, "sparse-monitor-app")
	record.Set("lifecycle_state", string(model.AppStateRunningHealthy))
	record.Set("last_operation", "")
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	zeroFailures := 0
	if _, err := monitorstore.UpsertLatestStatus(te.app, monitorstore.LatestStatusUpsert{
		TargetType:          monitor.TargetTypeApp,
		TargetID:            record.Id,
		DisplayName:         record.GetString("name"),
		Status:              monitor.StatusDegraded,
		Reason:              "health check timeout",
		SignalSource:        monitor.SignalSourceAppOS,
		LastTransitionAt:    now,
		LastFailureAt:       &now,
		LastReportedAt:      &now,
		ConsecutiveFailures: &zeroFailures,
		Summary:             map[string]any{},
	}); err != nil {
		t.Fatal(err)
	}

	rec := te.doApps(t, http.MethodGet, "/api/apps/"+record.Id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	item := parseJSON(t, rec)
	if item["instance_state"] != string(projection.InstanceStateDegraded) {
		t.Fatalf("expected instance_state degraded from monitor status, got %v", item["instance_state"])
	}
	if item["health_summary"] != string(model.HealthDegraded) {
		t.Fatalf("expected degraded health_summary from monitor status, got %v", item["health_summary"])
	}
	if item["state_reason"] != "health check timeout" {
		t.Fatalf("expected state_reason from monitor reason, got %v", item["state_reason"])
	}
	if item["runtime_reason"] != nil {
		t.Fatalf("expected no runtime_reason from sparse app monitor status, got %v", item["runtime_reason"])
	}
	if item["runtime_status"] != "running" {
		t.Fatalf("expected runtime_status to fall back to current healthy projection, got %v", item["runtime_status"])
	}
	if _, exists := item["lifecycle_state"]; exists {
		t.Fatalf("expected lifecycle_state to be omitted from app detail response, got %v", item["lifecycle_state"])
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

func TestAppInstanceManagedServerRuntimeRoutesRequireConnectivity(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	server := createServerRecord(t, te, "route-offline", "10.0.0.120", 22, "root", "password")
	server.Set("connect_type", "direct")
	server.Set("access_status", "unavailable")
	server.Set("access_reason", "control_unreachable")
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}
	record := seedManagedAppInstanceForServer(t, te, server.Id, "offline-routes-app")

	tests := []struct {
		name   string
		method string
		url    string
		body   string
	}{
		{name: "logs", method: http.MethodGet, url: "/api/apps/" + record.Id + "/logs"},
		{name: "config-get", method: http.MethodGet, url: "/api/apps/" + record.Id + "/config"},
		{name: "config-validate", method: http.MethodPost, url: "/api/apps/" + record.Id + "/config/validate", body: `{"content":"services:{}"}`},
		{name: "config-write", method: http.MethodPut, url: "/api/apps/" + record.Id + "/config", body: `{"content":"services:{}"}`},
		{name: "start", method: http.MethodPost, url: "/api/apps/" + record.Id + "/start"},
		{name: "upgrade", method: http.MethodPost, url: "/api/apps/" + record.Id + "/upgrade"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := te.doApps(t, tc.method, tc.url, tc.body, true)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
			}
			body := parseJSON(t, rec)
			if body["message"] != "Server is unreachable from the control plane." {
				t.Fatalf("expected connectivity reason, got %v", body["message"])
			}
		})
	}
}

func TestAppInstanceConfigRollback(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
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
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
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
	if created["channel"] != string(model.ChannelCustom) {
		t.Fatalf("expected channel %s, got %v", model.ChannelCustom, created["channel"])
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

func TestAppInstanceAccessHintsUpdate(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := seedAppInstance(t, te, "demo-app")
	rec := te.doApps(t, http.MethodPut, "/api/apps/"+record.Id+"/access", `{"access_username":"admin","access_secret_hint":"initial password from welcome page","access_retrieval_method":"Use the setup wizard output after first install","access_notes":"Rotate after first login"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["access_username"] != "admin" {
		t.Fatalf("expected access_username admin, got %v", body["access_username"])
	}
	stored, err := te.app.FindRecordById("app_instances", record.Id)
	if err != nil {
		t.Fatal(err)
	}
	if stored.GetString("access_secret_hint") != "initial password from welcome page" {
		t.Fatalf("expected access_secret_hint persisted, got %q", stored.GetString("access_secret_hint"))
	}
	if stored.GetString("access_retrieval_method") != "Use the setup wizard output after first install" {
		t.Fatalf("expected access_retrieval_method persisted, got %q", stored.GetString("access_retrieval_method"))
	}
	if stored.GetString("access_notes") != "Rotate after first login" {
		t.Fatalf("expected access_notes persisted, got %q", stored.GetString("access_notes"))
	}

	rec = te.doApps(t, http.MethodGet, "/api/apps/"+record.Id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	detail := parseJSON(t, rec)
	if detail["access_username"] != "admin" {
		t.Fatalf("expected access_username in detail response, got %v", detail["access_username"])
	}
}

func TestAppInstanceDetailDerivesAccessEndpointsFromLatestOperation(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := seedAppInstance(t, te, "wordpress-9613")
	operations, err := te.app.FindRecordsByFilter("app_operations", "app = {:appID}", "-updated", 1, 0, map[string]any{"appID": record.Id})
	if err != nil || len(operations) == 0 {
		t.Fatalf("find seeded operation: %v", err)
	}
	operation := operations[0]
	operation.Set("spec_json", map[string]any{
		"metadata": map[string]any{
			"template_context": map[string]any{
				"exposures": []map[string]any{{
					"label":    "Web",
					"service":  "wordpress",
					"port":     80,
					"protocol": "http",
					"default":  true,
				}},
			},
		},
	})
	operation.Set("rendered_compose", "services:\n  wordpress:\n    image: wordpress:6.9\n    ports:\n      - 9059:80\n")
	if err := te.app.Save(operation); err != nil {
		t.Fatal(err)
	}

	rec := te.doApps(t, http.MethodGet, "/api/apps/"+record.Id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	items, ok := body["access_endpoints"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("expected derived access endpoint, got %T: %v", body["access_endpoints"], body["access_endpoints"])
	}
	endpoint, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("expected access endpoint object, got %T: %v", items[0], items[0])
	}
	if endpoint["service"] != "wordpress" || endpoint["serverPort"] != float64(9059) || endpoint["port"] != float64(80) {
		t.Fatalf("unexpected derived endpoint: %v", endpoint)
	}
	if _, exists := endpoint["url"]; exists {
		t.Fatalf("derived endpoint must not include url: %v", endpoint)
	}
}

func TestAppInstanceLifecycleActionsCreateQueuedOperations(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
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
