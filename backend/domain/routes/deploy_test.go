package routes

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sharedenv"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	"github.com/websoft9/appos/backend/domain/deploy"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
	lifecyclesvc "github.com/websoft9/appos/backend/domain/lifecycle/service"
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

func (te *testEnv) doOperationsWithToken(t *testing.T, method, url, body, token string) *httptest.ResponseRecorder {
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
	if strings.TrimSpace(token) != "" {
		req.Header.Set("Authorization", token)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func (te *testEnv) doRegisteredRoute(t *testing.T, method, url, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	Register(&core.ServeEvent{App: te.app, Router: r})

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
	for key, value := range headers {
		req.Header.Set(key, value)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestRegisterRejectsQueryTokenForPlainHTTPAPI(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doRegisteredRoute(t, http.MethodGet, "/api/catalog/categories?token="+te.token, "", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for plain HTTP query-token auth, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestOperationLogStreamAllowsQueryTokenAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doOperations(t, http.MethodGet, "/api/actions/missing-id/stream?token="+te.token, "", false)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after query-token auth reached stream handler, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestOperationManualComposeCreateListDetail(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
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
	if created["channel"] != string(model.ChannelCustom) {
		t.Fatalf("expected custom channel, got %v", created["channel"])
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
	if selector["operation_type"] != string(model.OperationTypeInstall) || selector["execution_mode"] != string(model.ExecutionModeCompose) {
		t.Fatalf("unexpected pipeline selector: %v", selector)
	}
	if _, exists := selector["channel"]; exists {
		t.Fatalf("expected pipeline selector to omit channel, got %v", selector)
	}
	if created["spec"].(map[string]any)["operation_type"] != string(model.OperationTypeInstall) {
		t.Fatalf("expected install operation type, got %v", created["spec"].(map[string]any)["operation_type"])
	}

	rec = te.doOperations(t, http.MethodGet, "/api/actions/"+id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	detail := parseJSON(t, rec)
	if detail["execution_mode"] != string(model.ExecutionModeCompose) {
		t.Fatalf("expected compose execution mode, got %v", detail["execution_mode"])
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
	if detailSelector["execution_mode"] != string(model.ExecutionModeCompose) {
		t.Fatalf("unexpected detail pipeline selector: %v", detailSelector)
	}
	if _, exists := detailSelector["channel"]; exists {
		t.Fatalf("expected detail pipeline selector to omit channel, got %v", detailSelector)
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

func TestOperationListSupportsPaginatedResponses(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
	te := newTestEnv(t)
	defer te.cleanup()

	compose := "services:\n  web:\n    image: nginx:alpine\n"
	first := te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose", `{"project_name":"Alpha App","compose":`+jsonString(compose)+`}`, true)
	if first.Code != http.StatusAccepted {
		t.Fatalf("first create: expected 202, got %d: %s", first.Code, first.Body.String())
	}
	second := te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose", `{"project_name":"Beta App","compose":`+jsonString(compose)+`}`, true)
	if second.Code != http.StatusAccepted {
		t.Fatalf("second create: expected 202, got %d: %s", second.Code, second.Body.String())
	}

	rec := te.doOperations(t, http.MethodGet, "/api/actions?page=1&perPage=1&q=beta", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("paginated list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	payload := parseJSON(t, rec)
	if payload["page"] != float64(1) {
		t.Fatalf("expected page 1, got %v", payload["page"])
	}
	if payload["perPage"] != float64(1) {
		t.Fatalf("expected perPage 1, got %v", payload["perPage"])
	}
	if payload["totalItems"] != float64(1) {
		t.Fatalf("expected totalItems 1, got %v", payload["totalItems"])
	}
	if payload["totalPages"] != float64(1) {
		t.Fatalf("expected totalPages 1, got %v", payload["totalPages"])
	}
	items, ok := payload["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("expected one paginated item, got %T len=%d", payload["items"], len(items))
	}
	item, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("expected paginated item payload, got %T", items[0])
	}
	if item["compose_project_name"] != "beta-app" {
		t.Fatalf("expected beta-app in paginated response, got %v", item["compose_project_name"])
	}

	legacyRec := te.doOperations(t, http.MethodGet, "/api/actions", "", true)
	if legacyRec.Code != http.StatusOK {
		t.Fatalf("legacy list: expected 200, got %d: %s", legacyRec.Code, legacyRec.Body.String())
	}
	legacy := parseJSONArray(t, legacyRec)
	if len(legacy) != 2 {
		t.Fatalf("expected legacy list array with 2 items, got %d", len(legacy))
	}
}

func TestOperationListLegacyResponseIsNotCappedAtOneHundred(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
	te := newTestEnv(t)
	defer te.cleanup()

	compose := "services:\n  web:\n    image: nginx:alpine\n"
	for index := 0; index < 101; index++ {
		projectName := fmt.Sprintf("Legacy Cap %03d", index)
		rec := te.doOperations(
			t,
			http.MethodPost,
			"/api/actions/install/manual-compose",
			`{"project_name":"`+projectName+`","compose":`+jsonString(compose)+`}`,
			true,
		)
		if rec.Code != http.StatusAccepted {
			t.Fatalf("create %d: expected 202, got %d: %s", index, rec.Code, rec.Body.String())
		}
	}

	legacyRec := te.doOperations(t, http.MethodGet, "/api/actions", "", true)
	if legacyRec.Code != http.StatusOK {
		t.Fatalf("legacy list: expected 200, got %d: %s", legacyRec.Code, legacyRec.Body.String())
	}
	legacy := parseJSONArray(t, legacyRec)
	if len(legacy) != 101 {
		t.Fatalf("expected legacy list array with 101 items, got %d", len(legacy))
	}
}

func TestOperationQueuedCancelImmediatelyTerminalizesForAuthenticatedUser(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
	te := newTestEnv(t)
	defer te.cleanup()

	compose := "services:\n  web:\n    image: nginx:alpine\n"
	createRec := te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose", `{"project_name":"Cancel Demo","compose":`+jsonString(compose)+`}`, true)
	if createRec.Code != http.StatusAccepted {
		t.Fatalf("create: expected 202, got %d: %s", createRec.Code, createRec.Body.String())
	}
	created := parseJSON(t, createRec)
	operationID := created["id"].(string)
	pipelineID := created["pipeline"].(map[string]any)["id"].(string)

	userToken := createRegularUserToken(t, te)
	cancelRec := te.doOperationsWithToken(t, http.MethodPost, "/api/actions/"+operationID+"/cancel", "", userToken)
	if cancelRec.Code != http.StatusOK {
		t.Fatalf("cancel: expected 200, got %d: %s", cancelRec.Code, cancelRec.Body.String())
	}
	body := parseJSON(t, cancelRec)
	if body["status"] != deploy.StatusCancelled {
		t.Fatalf("expected cancelled status, got %v", body["status"])
	}

	opRecord, err := te.app.FindRecordById("app_operations", operationID)
	if err != nil {
		t.Fatal(err)
	}
	if opRecord.GetString("terminal_status") != "cancelled" {
		t.Fatalf("expected terminal_status cancelled, got %q", opRecord.GetString("terminal_status"))
	}
	if opRecord.GetString("error_message") != "operation cancelled before execution started" {
		t.Fatalf("expected cancel error message, got %q", opRecord.GetString("error_message"))
	}

	pipelineRecord, err := te.app.FindRecordById("pipeline_runs", pipelineID)
	if err != nil {
		t.Fatal(err)
	}
	if pipelineRecord.GetString("status") != "cancelled" {
		t.Fatalf("expected cancelled pipeline, got %q", pipelineRecord.GetString("status"))
	}

	nodeRunsCol, err := te.app.FindCollectionByNameOrId("pipeline_node_runs")
	if err != nil {
		t.Fatal(err)
	}
	nodeRuns, err := te.app.FindRecordsByFilter(nodeRunsCol, "pipeline_run = '"+pipelineID+"'", "created", 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, nodeRun := range nodeRuns {
		if nodeRun.GetString("status") != "cancelled" {
			t.Fatalf("expected all node runs cancelled, got %s=%q", nodeRun.GetString("node_key"), nodeRun.GetString("status"))
		}
	}
}

func TestOperationExecutingForceFailImmediatelyTerminalizesForAuthenticatedUser(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
	te := newTestEnv(t)
	defer te.cleanup()

	compose := "services:\n  web:\n    image: nginx:alpine\n"
	createRec := te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose", `{"project_name":"Force Fail Demo","compose":`+jsonString(compose)+`}`, true)
	if createRec.Code != http.StatusAccepted {
		t.Fatalf("create: expected 202, got %d: %s", createRec.Code, createRec.Body.String())
	}
	created := parseJSON(t, createRec)
	operationID := created["id"].(string)
	pipelineID := created["pipeline"].(map[string]any)["id"].(string)

	opRecord, err := te.app.FindRecordById("app_operations", operationID)
	if err != nil {
		t.Fatal(err)
	}
	opRecord.Set("phase", string(model.OperationPhaseExecuting))
	if err := te.app.Save(opRecord); err != nil {
		t.Fatal(err)
	}

	pipelineRecord, err := te.app.FindRecordById("pipeline_runs", pipelineID)
	if err != nil {
		t.Fatal(err)
	}
	pipelineRecord.Set("status", "active")
	pipelineRecord.Set("current_phase", string(model.PipelinePhaseExecuting))
	if err := te.app.Save(pipelineRecord); err != nil {
		t.Fatal(err)
	}

	nodeRunsCol, err := te.app.FindCollectionByNameOrId("pipeline_node_runs")
	if err != nil {
		t.Fatal(err)
	}
	nodeRuns, err := te.app.FindRecordsByFilter(nodeRunsCol, "pipeline_run = '"+pipelineID+"'", "created", 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(nodeRuns) < 2 {
		t.Fatalf("expected seeded node runs, got %d", len(nodeRuns))
	}
	nodeRuns[0].Set("status", "running")
	if err := te.app.Save(nodeRuns[0]); err != nil {
		t.Fatal(err)
	}

	userToken := createRegularUserToken(t, te)
	forceFailRec := te.doOperationsWithToken(t, http.MethodPost, "/api/actions/"+operationID+"/force-fail", "", userToken)
	if forceFailRec.Code != http.StatusOK {
		t.Fatalf("force-fail: expected 200, got %d: %s", forceFailRec.Code, forceFailRec.Body.String())
	}
	body := parseJSON(t, forceFailRec)
	if body["status"] != deploy.StatusFailed {
		t.Fatalf("expected failed status, got %v", body["status"])
	}

	opRecord, err = te.app.FindRecordById("app_operations", operationID)
	if err != nil {
		t.Fatal(err)
	}
	if opRecord.GetString("terminal_status") != "failed" {
		t.Fatalf("expected terminal_status failed, got %q", opRecord.GetString("terminal_status"))
	}
	if opRecord.GetString("failure_reason") != "execution_error" {
		t.Fatalf("expected execution_error reason, got %q", opRecord.GetString("failure_reason"))
	}
	if opRecord.GetString("error_message") != "operation force-failed by operator" {
		t.Fatalf("expected force-fail error message, got %q", opRecord.GetString("error_message"))
	}

	pipelineRecord, err = te.app.FindRecordById("pipeline_runs", pipelineID)
	if err != nil {
		t.Fatal(err)
	}
	if pipelineRecord.GetString("status") != "failed" {
		t.Fatalf("expected failed pipeline, got %q", pipelineRecord.GetString("status"))
	}
	if pipelineRecord.GetString("failed_node_key") != nodeRuns[0].GetString("node_key") {
		t.Fatalf("expected failed_node_key %q, got %q", nodeRuns[0].GetString("node_key"), pipelineRecord.GetString("failed_node_key"))
	}

	nodeRuns, err = te.app.FindRecordsByFilter(nodeRunsCol, "pipeline_run = '"+pipelineID+"'", "created", 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	if nodeRuns[0].GetString("status") != "failed" {
		t.Fatalf("expected running node to fail, got %q", nodeRuns[0].GetString("status"))
	}
	for _, nodeRun := range nodeRuns[1:] {
		if nodeRun.GetString("status") != "cancelled" {
			t.Fatalf("expected pending node run cancelled, got %s=%q", nodeRun.GetString("node_key"), nodeRun.GetString("status"))
		}
	}
}

func TestOperationTemplateCheckAndCreateWordPress(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
	te := newTestEnv(t)
	defer te.cleanup()
	ensureDockerSecretRuntime(t)
	secret := createDockerRouteSecret(t, te, "super-secret")
	payload := fmt.Sprintf(`{"project_name":"My Blog","template_key":"wordpress","input_values":{"db_password":"secretRef:%s"}}`, secret.Id)

	checkRec := te.doOperations(t, http.MethodPost, "/api/actions/install/template/check", payload, true)
	if checkRec.Code != http.StatusOK {
		t.Fatalf("check: expected 200, got %d: %s", checkRec.Code, checkRec.Body.String())
	}

	createRec := te.doOperations(t, http.MethodPost, "/api/actions/install/template", payload, true)
	if createRec.Code != http.StatusAccepted {
		t.Fatalf("create: expected 202, got %d: %s", createRec.Code, createRec.Body.String())
	}
	created := parseJSON(t, createRec)
	if created["channel"] != string(model.ChannelStore) {
		t.Fatalf("expected store channel, got %v", created["channel"])
	}
	if created["execution_mode"] != string(model.ExecutionModeCompose) {
		t.Fatalf("expected compose execution mode, got %v", created["execution_mode"])
	}
	opRecord, err := te.app.FindRecordById("app_operations", created["id"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if opRecord.GetString("compose_project_name") != "my-blog" {
		t.Fatalf("expected normalized compose project name, got %q", opRecord.GetString("compose_project_name"))
	}
	renderedCompose := opRecord.GetString("rendered_compose")
	if !strings.Contains(renderedCompose, "image: wordpress:6.9") || strings.Contains(renderedCompose, "${") {
		t.Fatalf("expected fully rendered wordpress compose, got %q", renderedCompose)
	}
	appRecord, err := te.app.FindRecordById("app_instances", opRecord.GetString("app"))
	if err != nil {
		t.Fatal(err)
	}
	if appRecord.GetString("template_key") != "wordpress" {
		t.Fatalf("expected wordpress template_key, got %q", appRecord.GetString("template_key"))
	}
	assertAccessEndpoint(t, appRecord.Get("access_endpoints"), "wordpress", 80, 9001, "http", true)
}

func TestOperationTemplateCreateOdoo(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
	te := newTestEnv(t)
	defer te.cleanup()
	ensureDockerSecretRuntime(t)
	secret := createDockerRouteSecret(t, te, "odoo-secret")
	payload := fmt.Sprintf(`{"project_name":"ERP Demo","template_key":"odoo","input_values":{"version":"18.0","db_password":"secretRef:%s"},"exposure":{"exposure_type":"port","is_primary":true,"target_port":9010}}`, secret.Id)

	rec := te.doOperations(t, http.MethodPost, "/api/actions/install/template", payload, true)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	opRecord, err := te.app.FindRecordById("app_operations", created["id"].(string))
	if err != nil {
		t.Fatal(err)
	}
	renderedCompose := opRecord.GetString("rendered_compose")
	if !strings.Contains(renderedCompose, "image: odoo:18.0") || !strings.Contains(renderedCompose, "9010:8069") {
		t.Fatalf("expected rendered odoo compose to honor overrides, got %q", renderedCompose)
	}
	appRecord, err := te.app.FindRecordById("app_instances", opRecord.GetString("app"))
	if err != nil {
		t.Fatal(err)
	}
	assertAccessEndpoint(t, appRecord.Get("access_endpoints"), "odoo", 8069, 9010, "http", true)
}

func TestOperationTemplateCreateCanDisablePrimaryPublishedPort(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
	te := newTestEnv(t)
	defer te.cleanup()
	ensureDockerSecretRuntime(t)
	secret := createDockerRouteSecret(t, te, "wp-secret")
	payload := fmt.Sprintf(`{"project_name":"Private Blog","template_key":"wordpress","input_values":{"db_password":"secretRef:%s"},"exposure":{"exposure_type":"internal_only","is_primary":true}}`, secret.Id)

	rec := te.doOperations(t, http.MethodPost, "/api/actions/install/template", payload, true)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	opRecord, err := te.app.FindRecordById("app_operations", created["id"].(string))
	if err != nil {
		t.Fatal(err)
	}
	renderedCompose := opRecord.GetString("rendered_compose")
	if strings.Contains(renderedCompose, ":80") {
		t.Fatalf("expected rendered wordpress compose to remove published ports, got %q", renderedCompose)
	}
	appRecord, err := te.app.FindRecordById("app_instances", opRecord.GetString("app"))
	if err != nil {
		t.Fatal(err)
	}
	if endpoints := accessEndpointItems(t, appRecord.Get("access_endpoints")); len(endpoints) != 0 {
		t.Fatalf("expected internal-only install to persist no access endpoints, got %v", endpoints)
	}
}

func assertAccessEndpoint(t *testing.T, raw any, service string, port int, serverPort int, protocol string, defaultEndpoint bool) {
	t.Helper()
	items := accessEndpointItems(t, raw)
	if len(items) != 1 {
		t.Fatalf("expected 1 access endpoint, got %d: %v", len(items), items)
	}
	endpoint := items[0]
	if endpoint["service"] != service || endpoint["protocol"] != protocol || endpoint["default"] != defaultEndpoint {
		t.Fatalf("unexpected access endpoint identity: %v", endpoint)
	}
	if intFromEndpoint(endpoint["port"]) != port || intFromEndpoint(endpoint["serverPort"]) != serverPort {
		t.Fatalf("unexpected access endpoint ports: %v", endpoint)
	}
	if _, exists := endpoint["url"]; exists {
		t.Fatalf("access endpoint must not persist url: %v", endpoint)
	}
	if _, exists := endpoint["id"]; exists {
		t.Fatalf("access endpoint must not persist id: %v", endpoint)
	}
}

func accessEndpointItems(t *testing.T, raw any) []map[string]any {
	t.Helper()
	if raw == nil {
		return nil
	}
	data, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("marshal access_endpoints %T: %v", raw, err)
	}
	var items []map[string]any
	if err := json.Unmarshal(data, &items); err != nil {
		t.Fatalf("decode access_endpoints %T: %v; data=%s", raw, err, string(data))
	}
	return items
}

func intFromEndpoint(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case float64:
		return int(typed)
	default:
		return 0
	}
}

func TestOperationDetailIncludesNodeExecutionLogs(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
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
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
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
	message := strings.ToLower(body["message"].(string))
	if !strings.Contains(message, "preflight") {
		t.Fatalf("expected preflight conflict message, got %v", body["message"])
	}
}

func TestOperationManualComposeResolutionPayload(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
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

func TestOperationInstallNameAvailability(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
	te := newTestEnv(t)
	defer te.cleanup()

	compose := "services:\n  web:\n    image: nginx:alpine\n"
	rec := te.doOperations(t, http.MethodPost, "/api/actions/install/name-availability", `{"project_name":"Demo App"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("name availability: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["ok"] != true {
		t.Fatalf("expected ok=true before creation, got %v", body["ok"])
	}
	if body["normalized_name"] != "demo-app" {
		t.Fatalf("expected normalized name demo-app, got %v", body["normalized_name"])
	}

	rec = te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose", `{"project_name":"Demo App","compose":`+jsonString(compose)+`}`, true)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("create: expected 202, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.doOperations(t, http.MethodPost, "/api/actions/install/name-availability", `{"project_name":"Demo App"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("name availability after create: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body = parseJSON(t, rec)
	if body["ok"] != false {
		t.Fatalf("expected ok=false after duplicate create, got %v", body["ok"])
	}
	if !strings.Contains(strings.ToLower(body["message"].(string)), "already exists") {
		t.Fatalf("expected duplicate message, got %v", body["message"])
	}
}

func TestOperationManualComposeCheck(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
	te := newTestEnv(t)
	defer te.cleanup()

	compose := "services:\n  web:\n    image: nginx:alpine\n"
	rec := te.doOperations(
		t,
		http.MethodPost,
		"/api/actions/install/manual-compose/check",
		`{"project_name":"Resolver Demo","compose":`+jsonString(compose)+`,"env":{"APP_ENV":"prod"}}`,
		true,
	)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["ok"] != true {
		t.Fatalf("expected ok=true, got %v", body["ok"])
	}
	if body["compose_project_name"] != "resolver-demo" {
		t.Fatalf("expected normalized compose project name resolver-demo, got %v", body["compose_project_name"])
	}
	checks, ok := body["checks"].(map[string]any)
	if !ok {
		t.Fatalf("expected checks map, got %T", body["checks"])
	}
	composeCheck, ok := checks["compose"].(map[string]any)
	if !ok || composeCheck["ok"] != true {
		t.Fatalf("expected compose check ok=true, got %v", checks["compose"])
	}
	portsCheck, ok := checks["ports"].(map[string]any)
	if !ok {
		t.Fatalf("expected ports check map, got %T", checks["ports"])
	}
	if portsCheck["status"] != "not_applicable" {
		t.Fatalf("expected not_applicable ports status, got %v", portsCheck["status"])
	}
	appNameCheck, ok := checks["app_name"].(map[string]any)
	if !ok || appNameCheck["ok"] != true {
		t.Fatalf("expected app_name check ok=true, got %v", checks["app_name"])
	}
	if _, ok := checks["container_names"].(map[string]any); !ok {
		t.Fatalf("expected container_names check map, got %T", checks["container_names"])
	}
	if _, ok := checks["docker_availability"].(map[string]any); !ok {
		t.Fatalf("expected docker_availability check map, got %T", checks["docker_availability"])
	}
	diskCheck, ok := checks["disk_space"].(map[string]any)
	if !ok {
		t.Fatalf("expected disk_space check map, got %T", checks["disk_space"])
	}
	if _, ok := diskCheck["min_free_bytes"]; !ok {
		t.Fatalf("expected disk_space.min_free_bytes field, got %v", diskCheck)
	}
	if diskCheck["required_app_bytes"] != float64(0) {
		t.Fatalf("expected disk_space.required_app_bytes=0, got %v", diskCheck["required_app_bytes"])
	}
}

func TestOperationManualComposeCheckMatchesCreateNormalization(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
	te := newTestEnv(t)
	defer te.cleanup()

	compose := "services:\n  web:\n    image: nginx:alpine\n"
	payload := `{"project_name":"Resolver Demo","compose":` + jsonString(compose) + `,"env":{"APP_ENV":"prod","HTTP_PORT":8080,"FEATURE_X":true},"exposure":{"domain":"demo.local","target_port":8080},"metadata":{"channel":"stable","candidate_kind":"store-prefill","prefill_context":{"mode":"target","source":"library","app_key":"wordpress","app_name":"WordPress"}}}`

	rec := te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose/check", payload, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("manual check: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	checked := parseJSON(t, rec)
	checkSpec, ok := checked["spec"].(map[string]any)
	if !ok {
		t.Fatalf("expected check spec map, got %T", checked["spec"])
	}

	rec = te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose", payload, true)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("manual create: expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	createSpec, ok := created["spec"].(map[string]any)
	if !ok {
		t.Fatalf("expected create spec map, got %T", created["spec"])
	}

	if checked["compose_project_name"] != created["compose_project_name"] {
		t.Fatalf("expected matching compose_project_name, got check=%v create=%v", checked["compose_project_name"], created["compose_project_name"])
	}
	if checkSpec["project_name"] != createSpec["project_name"] {
		t.Fatalf("expected matching project_name, got check=%v create=%v", checkSpec["project_name"], createSpec["project_name"])
	}
	if checkSpec["channel"] != createSpec["channel"] || checkSpec["execution_mode"] != createSpec["execution_mode"] {
		t.Fatalf("expected matching channel/execution_mode, got check=%v/%v create=%v/%v", checkSpec["channel"], checkSpec["execution_mode"], createSpec["channel"], createSpec["execution_mode"])
	}

	checkEnv, ok := checkSpec["resolved_env"].(map[string]any)
	if !ok {
		t.Fatalf("expected check resolved_env map, got %T", checkSpec["resolved_env"])
	}
	createEnv, ok := createSpec["resolved_env"].(map[string]any)
	if !ok {
		t.Fatalf("expected create resolved_env map, got %T", createSpec["resolved_env"])
	}
	if checkEnv["APP_ENV"] != createEnv["APP_ENV"] || checkEnv["HTTP_PORT"] != createEnv["HTTP_PORT"] || checkEnv["FEATURE_X"] != createEnv["FEATURE_X"] {
		t.Fatalf("expected matching resolved_env, got check=%v create=%v", checkEnv, createEnv)
	}

	checkExposure, ok := checkSpec["exposure_intent"].(map[string]any)
	if !ok {
		t.Fatalf("expected check exposure_intent map, got %T", checkSpec["exposure_intent"])
	}
	createExposure, ok := createSpec["exposure_intent"].(map[string]any)
	if !ok {
		t.Fatalf("expected create exposure_intent map, got %T", createSpec["exposure_intent"])
	}
	if checkExposure["domain"] != createExposure["domain"] || checkExposure["target_port"] != createExposure["target_port"] {
		t.Fatalf("expected matching exposure_intent, got check=%v create=%v", checkExposure, createExposure)
	}

	checkMetadata, ok := checkSpec["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected check metadata map, got %T", checkSpec["metadata"])
	}
	createMetadata, ok := createSpec["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected create metadata map, got %T", createSpec["metadata"])
	}
	if checkMetadata["channel"] != createMetadata["channel"] || checkMetadata["candidate_kind"] != createMetadata["candidate_kind"] {
		t.Fatalf("expected matching metadata, got check=%v create=%v", checkMetadata, createMetadata)
	}
	checkPrefill, ok := checkMetadata["prefill_context"].(map[string]any)
	if !ok {
		t.Fatalf("expected check prefill_context map, got %T", checkMetadata["prefill_context"])
	}
	createPrefill, ok := createMetadata["prefill_context"].(map[string]any)
	if !ok {
		t.Fatalf("expected create prefill_context map, got %T", createMetadata["prefill_context"])
	}
	if checkPrefill["app_key"] != createPrefill["app_key"] || checkPrefill["mode"] != createPrefill["mode"] || checkPrefill["source"] != createPrefill["source"] {
		t.Fatalf("expected matching prefill_context, got check=%v create=%v", checkPrefill, createPrefill)
	}
	checkOrigin, ok := checkMetadata["origin_context"].(map[string]any)
	if !ok {
		t.Fatalf("expected check origin_context map, got %T", checkMetadata["origin_context"])
	}
	createOrigin, ok := createMetadata["origin_context"].(map[string]any)
	if !ok {
		t.Fatalf("expected create origin_context map, got %T", createMetadata["origin_context"])
	}
	if checkOrigin["channel"] != createOrigin["channel"] || checkOrigin["execution_mode"] != createOrigin["execution_mode"] {
		t.Fatalf("expected matching origin_context, got check=%v create=%v", checkOrigin, createOrigin)
	}
}

func TestOperationManualComposeCheckMatchesCreateRuntimeInputNormalization(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
	te := newTestEnv(t)
	defer te.cleanup()

	envSetsCol, err := te.app.FindCollectionByNameOrId(sharedenv.SetCollection)
	if err != nil {
		t.Fatalf("find env_sets collection: %v", err)
	}
	envSetRecord := core.NewRecord(envSetsCol)
	envSetRecord.Set("name", "shared-demo")
	envSetRecord.Set("description", "shared runtime inputs")
	if err := te.app.Save(envSetRecord); err != nil {
		t.Fatalf("create env_set: %v", err)
	}

	envSetVarsCol, err := te.app.FindCollectionByNameOrId(sharedenv.VarCollection)
	if err != nil {
		t.Fatalf("find env_set_vars collection: %v", err)
	}
	envVarRecord := core.NewRecord(envSetVarsCol)
	envVarRecord.Set("set", envSetRecord.Id)
	envVarRecord.Set("key", "APP_ENV")
	envVarRecord.Set("value", "from-shared-set")
	envVarRecord.Set("is_secret", false)
	if err := te.app.Save(envVarRecord); err != nil {
		t.Fatalf("create env_set_var: %v", err)
	}

	compose := "services:\n  web:\n    image: nginx:alpine\n"
	payload := `{"project_name":"Resolver Demo","compose":` + jsonString(compose) + `,"env":{"APP_ENV":"inline-dev"},"runtime_inputs":{"env":[{"name":"APP_ENV","kind":"shared-import","set_id":"` + envSetRecord.Id + `","var_id":"` + envVarRecord.Id + `"}],"files":[{"kind":"mount-file","name":"config.yaml","source_path":"./src/config.yaml","mount_path":"./src/config.yaml","uploaded":true},{"kind":"source-package","name":"app.tar.gz","source_path":"./src/app.tar.gz","uploaded":true}]}}`

	rec := te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose/check", payload, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("manual check: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	checked := parseJSON(t, rec)
	checkSpec, ok := checked["spec"].(map[string]any)
	if !ok {
		t.Fatalf("expected check spec map, got %T", checked["spec"])
	}

	rec = te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose", payload, true)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("manual create: expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	createSpec, ok := created["spec"].(map[string]any)
	if !ok {
		t.Fatalf("expected create spec map, got %T", created["spec"])
	}

	checkEnv, ok := checkSpec["resolved_env"].(map[string]any)
	if !ok {
		t.Fatalf("expected check resolved_env map, got %T", checkSpec["resolved_env"])
	}
	createEnv, ok := createSpec["resolved_env"].(map[string]any)
	if !ok {
		t.Fatalf("expected create resolved_env map, got %T", createSpec["resolved_env"])
	}
	if checkEnv["APP_ENV"] != "from-shared-set" || createEnv["APP_ENV"] != "from-shared-set" {
		t.Fatalf("expected shared env import to override inline value, got check=%v create=%v", checkEnv, createEnv)
	}

	checkMetadata, ok := checkSpec["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected check metadata map, got %T", checkSpec["metadata"])
	}
	createMetadata, ok := createSpec["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected create metadata map, got %T", createSpec["metadata"])
	}
	checkRuntimeInputs, ok := checkMetadata["runtime_inputs"].(map[string]any)
	if !ok {
		t.Fatalf("expected check runtime_inputs map, got %T", checkMetadata["runtime_inputs"])
	}
	createRuntimeInputs, ok := createMetadata["runtime_inputs"].(map[string]any)
	if !ok {
		t.Fatalf("expected create runtime_inputs map, got %T", createMetadata["runtime_inputs"])
	}
	checkRuntimeEnv, ok := checkRuntimeInputs["env"].([]any)
	if !ok || len(checkRuntimeEnv) != 1 {
		t.Fatalf("expected normalized check runtime env array, got %v", checkRuntimeInputs["env"])
	}
	createRuntimeEnv, ok := createRuntimeInputs["env"].([]any)
	if !ok || len(createRuntimeEnv) != 1 {
		t.Fatalf("expected normalized create runtime env array, got %v", createRuntimeInputs["env"])
	}
	checkRuntimeEnvItem := checkRuntimeEnv[0].(map[string]any)
	createRuntimeEnvItem := createRuntimeEnv[0].(map[string]any)
	if checkRuntimeEnvItem["source_key"] != "APP_ENV" || createRuntimeEnvItem["source_key"] != "APP_ENV" {
		t.Fatalf("expected normalized source_key for shared import, got check=%v create=%v", checkRuntimeEnvItem, createRuntimeEnvItem)
	}
	checkRuntimeFiles, ok := checkRuntimeInputs["files"].([]any)
	if !ok || len(checkRuntimeFiles) != 2 {
		t.Fatalf("expected normalized check runtime file array, got %v", checkRuntimeInputs["files"])
	}
	createRuntimeFiles, ok := createRuntimeInputs["files"].([]any)
	if !ok || len(createRuntimeFiles) != 2 {
		t.Fatalf("expected normalized create runtime file array, got %v", createRuntimeInputs["files"])
	}
	checkMountFile := checkRuntimeFiles[0].(map[string]any)
	if checkMountFile["kind"] != "mount-file" || checkMountFile["source_path"] != "./src/config.yaml" || checkMountFile["mount_path"] != "./src/config.yaml" || checkMountFile["uploaded"] != true {
		t.Fatalf("expected normalized mount-file payload to survive, got %v", checkMountFile)
	}
	checkSourcePackage := checkRuntimeFiles[1].(map[string]any)
	if checkSourcePackage["kind"] != "source-package" || checkSourcePackage["source_path"] != "./src/app.tar.gz" || checkSourcePackage["uploaded"] != true {
		t.Fatalf("expected normalized source-package payload to survive, got %v", checkSourcePackage)
	}
	if _, exists := checkSourcePackage["mount_path"]; exists {
		t.Fatalf("expected source-package mount_path to stay omitted, got %v", checkSourcePackage)
	}
	createMountFile := createRuntimeFiles[0].(map[string]any)
	createSourcePackage := createRuntimeFiles[1].(map[string]any)
	if !reflect.DeepEqual(checkMountFile, createMountFile) || !reflect.DeepEqual(checkSourcePackage, createSourcePackage) {
		t.Fatalf("expected file runtime inputs to match exactly, got check=%v create=%v", checkRuntimeFiles, createRuntimeFiles)
	}
	if !reflect.DeepEqual(checkRuntimeInputs, createRuntimeInputs) {
		t.Fatalf("expected matching runtime_inputs, got check=%v create=%v", checkRuntimeInputs, createRuntimeInputs)
	}
	if created["secret_refs"] != nil || checked["secret_refs"] != nil {
		t.Fatalf("expected no secret_refs for plain shared env input, got check=%v create=%v", checked["secret_refs"], created["secret_refs"])
	}
}

func TestOperationManualComposeRejectsInvalidRuntimeFileInputs(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	server := createServerRecord(t, te, "runtime-inputs-edge", "127.0.0.1", 22, "root", "password")

	compose := "services:\n  web:\n    image: nginx:alpine\n"
	payload := `{"server_id":"` + server.Id + `","project_name":"Resolver Demo","compose":` + jsonString(compose) + `,"runtime_inputs":{"files":[{"kind":"mount-file","name":"config.yaml","source_path":"./src/config.yaml"}]}}`

	checkRec := te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose/check", payload, true)
	if checkRec.Code != http.StatusBadRequest {
		t.Fatalf("manual check: expected 400, got %d: %s", checkRec.Code, checkRec.Body.String())
	}
	checkBody := parseJSON(t, checkRec)
	if !strings.Contains(checkBody["message"].(string), "runtime_inputs.files[0]: mount-file requires mount_path") {
		t.Fatalf("expected invalid runtime file message, got %v", checkBody["message"])
	}

	createRec := te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose", payload, true)
	if createRec.Code != http.StatusBadRequest {
		t.Fatalf("manual create: expected 400, got %d: %s", createRec.Code, createRec.Body.String())
	}
	createBody := parseJSON(t, createRec)
	if checkBody["message"] != createBody["message"] {
		t.Fatalf("expected matching runtime file validation message, got check=%v create=%v", checkBody["message"], createBody["message"])
	}
}

func TestOperationManualComposeCheckMatchesCreateSourceBuildNormalization(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
	te := newTestEnv(t)
	defer te.cleanup()

	compose := "services:\n  web:\n    image: nginx:alpine\n"
	payload := `{"project_name":"Source Build Demo","compose":` + jsonString(compose) + `,"source_build":{"source_kind":"uploaded-package","source_ref":"upload://app.tar.gz","workspace_ref":"workspace://operations/source-build-demo/source","builder_strategy":"buildpacks","artifact_publication":{"mode":"local","image_name":"apps/source-build-demo"}}}`

	rec := te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose/check", payload, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("manual check: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	checked := parseJSON(t, rec)
	checkSpec, ok := checked["spec"].(map[string]any)
	if !ok {
		t.Fatalf("expected check spec map, got %T", checked["spec"])
	}

	rec = te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose", payload, true)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("manual create: expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	createSpec, ok := created["spec"].(map[string]any)
	if !ok {
		t.Fatalf("expected create spec map, got %T", created["spec"])
	}

	if checkSpec["mode"] != "source-build" || createSpec["mode"] != "source-build" {
		t.Fatalf("expected source-build mode in check/create spec, got check=%v create=%v", checkSpec["mode"], createSpec["mode"])
	}
	if created["execution_mode"] != string(model.ExecutionModeBuild) {
		t.Fatalf("expected build execution mode, got %v", created["execution_mode"])
	}
	if created["pipeline_definition_key"] != "provision.install.source_build" {
		t.Fatalf("expected source-build pipeline definition key, got %v", created["pipeline_definition_key"])
	}
	checkSourceBuild, ok := checkSpec["source_build"].(map[string]any)
	if !ok {
		t.Fatalf("expected check source_build map, got %T", checkSpec["source_build"])
	}
	createSourceBuild, ok := createSpec["source_build"].(map[string]any)
	if !ok {
		t.Fatalf("expected create source_build map, got %T", createSpec["source_build"])
	}
	if !reflect.DeepEqual(checkSourceBuild, createSourceBuild) {
		t.Fatalf("expected matching source_build payload, got check=%v create=%v", checkSourceBuild, createSourceBuild)
	}
	artifactPublication, ok := createSourceBuild["artifact_publication"].(map[string]any)
	if !ok {
		t.Fatalf("expected artifact_publication map, got %T", createSourceBuild["artifact_publication"])
	}
	if artifactPublication["mode"] != "local" || artifactPublication["image_name"] != "apps/source-build-demo" {
		t.Fatalf("unexpected artifact_publication payload: %v", artifactPublication)
	}
}

func TestOperationManualComposeRejectsInvalidSourceBuildInputs(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	server := createServerRecord(t, te, "source-build-edge", "127.0.0.1", 22, "root", "password")

	compose := "services:\n  web:\n    image: nginx:alpine\n"
	payload := `{"server_id":"` + server.Id + `","project_name":"Source Build Demo","compose":` + jsonString(compose) + `,"source_build":{"source_kind":"uploaded-package","source_ref":"upload://app.tar.gz","workspace_ref":"workspace://operations/source-build-demo/source","artifact_publication":{"mode":"push","image_name":"apps/source-build-demo"}}}`

	checkRec := te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose/check", payload, true)
	if checkRec.Code != http.StatusBadRequest {
		t.Fatalf("manual check: expected 400, got %d: %s", checkRec.Code, checkRec.Body.String())
	}
	checkBody := parseJSON(t, checkRec)
	if !strings.Contains(checkBody["message"].(string), "source_build.builder_strategy is required") {
		t.Fatalf("expected invalid source_build message, got %v", checkBody["message"])
	}

	createRec := te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose", payload, true)
	if createRec.Code != http.StatusBadRequest {
		t.Fatalf("manual create: expected 400, got %d: %s", createRec.Code, createRec.Body.String())
	}
	createBody := parseJSON(t, createRec)
	if checkBody["message"] != createBody["message"] {
		t.Fatalf("expected matching source_build validation message, got check=%v create=%v", checkBody["message"], createBody["message"])
	}
}

func TestOperationGitComposeCheckUsesConfiguredDefaults(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
	te := newTestEnv(t)
	defer te.cleanup()

	if err := sysconfig.SetGroup(te.app, "deploy", "git-defaults", map[string]any{
		"defaultRef":         "release",
		"defaultComposePath": "deploy/custom-compose.yml",
	}); err != nil {
		t.Fatal(err)
	}

	requestedPath := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPath = r.URL.Path
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("services:\n  web:\n    image: nginx:alpine\n"))
	}))
	defer server.Close()

	payload := `{"repository_url":` + jsonString(server.URL+`/owner/repo`) + `,"project_name":"Git Defaults Demo"}`
	rec := te.doOperations(t, http.MethodPost, "/api/actions/install/git-compose/check", payload, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("git compose check: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if requestedPath != "/owner/repo/raw/branch/release/deploy/custom-compose.yml" {
		t.Fatalf("expected configured git defaults path, got %q", requestedPath)
	}
}

func TestOperationManualComposeCheckDetectsDuplicateAppName(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
	te := newTestEnv(t)
	defer te.cleanup()

	compose := "services:\n  web:\n    image: nginx:alpine\n"
	rec := te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose", `{"project_name":"Demo App","compose":`+jsonString(compose)+`}`, true)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("first create: expected 202, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.doOperations(t, http.MethodPost, "/api/actions/install/manual-compose/check", `{"project_name":"Demo App","compose":`+jsonString(compose)+`}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("duplicate check: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["ok"] != false {
		t.Fatalf("expected ok=false for duplicate app name, got %v", body["ok"])
	}
	checks := body["checks"].(map[string]any)
	appNameCheck := checks["app_name"].(map[string]any)
	if appNameCheck["ok"] != false {
		t.Fatalf("expected app_name check ok=false, got %v", appNameCheck["ok"])
	}
	if !strings.Contains(strings.ToLower(appNameCheck["message"].(string)), "already exists") {
		t.Fatalf("expected duplicate message, got %v", appNameCheck["message"])
	}
}

func TestExtractComposePublishedPorts(t *testing.T) {
	compose := `services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
      - "127.0.0.1:8443:443"
      - "5353:53/udp"
  api:
    image: nginx:alpine
    ports:
      - target: 3000
        published: 3001
        protocol: tcp
      - target: 9000
        published: "9001"
        protocol: udp
`

	ports, err := lifecyclesvc.ExtractComposePublishedPortsForTest(compose)
	if err != nil {
		t.Fatalf("expected valid compose ports, got error: %v", err)
	}
	if len(ports) != 5 {
		t.Fatalf("expected 5 published host ports, got %d: %#v", len(ports), ports)
	}
	expected := []lifecyclesvc.InstallPreflightPublishedPort{
		{Port: 3001, Protocol: "tcp"},
		{Port: 8080, Protocol: "tcp"},
		{Port: 8443, Protocol: "tcp"},
		{Port: 5353, Protocol: "udp"},
		{Port: 9001, Protocol: "udp"},
	}
	for index, port := range expected {
		if ports[index] != port {
			t.Fatalf("expected port %v at index %d, got %v", port, index, ports[index])
		}
	}
}

func TestOperationGitComposeCreate(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
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
	if created["channel"] != string(model.ChannelGit) {
		t.Fatalf("expected git channel, got %v", created["channel"])
	}
	if created["execution_mode"] != string(model.ExecutionModeCompose) {
		t.Fatalf("expected compose execution mode, got %v", created["execution_mode"])
	}
	if created["pipeline_family"] != "provision" {
		t.Fatalf("expected provision pipeline family, got %v", created["pipeline_family"])
	}
	if created["pipeline_family_internal"] != "ProvisionPipeline" {
		t.Fatalf("expected internal provision pipeline family, got %v", created["pipeline_family_internal"])
	}
	if created["pipeline_definition_key"] != "provision.install.manual_compose" {
		t.Fatalf("expected compose definition key, got %v", created["pipeline_definition_key"])
	}
	pipeline, ok := created["pipeline"].(map[string]any)
	if !ok {
		t.Fatalf("expected pipeline map, got %T", created["pipeline"])
	}
	if pipeline["family"] != "provision" || pipeline["definition_key"] != "provision.install.manual_compose" {
		t.Fatalf("unexpected git pipeline payload: %v", pipeline)
	}
	selector, ok := created["pipeline_selector"].(map[string]any)
	if !ok {
		t.Fatalf("expected pipeline_selector map, got %T", created["pipeline_selector"])
	}
	if selector["operation_type"] != string(model.OperationTypeInstall) || selector["execution_mode"] != string(model.ExecutionModeCompose) {
		t.Fatalf("unexpected pipeline selector: %v", selector)
	}
	if _, exists := selector["channel"]; exists {
		t.Fatalf("expected pipeline selector to omit channel, got %v", selector)
	}
	if _, ok := created["lifecycle"]; !ok {
		t.Fatal("expected lifecycle in operation response")
	}
	if spec, ok := created["spec"].(map[string]any); !ok || spec["channel"] != string(model.ChannelGit) {
		t.Fatalf("expected git channel spec, got %v", created["spec"])
	}
	if spec, ok := created["spec"].(map[string]any); !ok || spec["operation_type"] != string(model.OperationTypeInstall) {
		t.Fatalf("expected install operation type, got %v", created["spec"])
	}
}

func TestOperationGitComposeCheckMatchesCreateNormalization(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
	te := newTestEnv(t)
	defer te.cleanup()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("services:\n  web:\n    image: nginx:alpine\n"))
	}))
	defer server.Close()

	payload := `{"repository_url":"https://github.com/example/demo","compose_path":"docker-compose.yml","ref":"main","raw_url":` + jsonString(server.URL) + `,"env":{"APP_ENV":"prod","FEATURE_X":true},"exposure":{"domain":"demo.local","target_port":8080},"metadata":{"channel":"stable"}}`

	rec := te.doOperations(t, http.MethodPost, "/api/actions/install/git-compose/check", payload, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("git check: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	checked := parseJSON(t, rec)
	checkSpec, ok := checked["spec"].(map[string]any)
	if !ok {
		t.Fatalf("expected check spec map, got %T", checked["spec"])
	}

	rec = te.doOperations(t, http.MethodPost, "/api/actions/install/git-compose", payload, true)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("git create: expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	createSpec, ok := created["spec"].(map[string]any)
	if !ok {
		t.Fatalf("expected create spec map, got %T", created["spec"])
	}

	if checked["compose_project_name"] != created["compose_project_name"] {
		t.Fatalf("expected matching compose_project_name, got check=%v create=%v", checked["compose_project_name"], created["compose_project_name"])
	}
	if checkSpec["project_name"] != createSpec["project_name"] {
		t.Fatalf("expected matching project_name, got check=%v create=%v", checkSpec["project_name"], createSpec["project_name"])
	}
	if checkSpec["channel"] != createSpec["channel"] || checkSpec["execution_mode"] != createSpec["execution_mode"] {
		t.Fatalf("expected matching channel/execution_mode, got check=%v/%v create=%v/%v", checkSpec["channel"], checkSpec["execution_mode"], createSpec["channel"], createSpec["execution_mode"])
	}

	checkEnv, ok := checkSpec["resolved_env"].(map[string]any)
	if !ok {
		t.Fatalf("expected check resolved_env map, got %T", checkSpec["resolved_env"])
	}
	createEnv, ok := createSpec["resolved_env"].(map[string]any)
	if !ok {
		t.Fatalf("expected create resolved_env map, got %T", createSpec["resolved_env"])
	}
	if checkEnv["APP_ENV"] != createEnv["APP_ENV"] || checkEnv["FEATURE_X"] != createEnv["FEATURE_X"] {
		t.Fatalf("expected matching resolved_env, got check=%v create=%v", checkEnv, createEnv)
	}

	checkExposure, ok := checkSpec["exposure_intent"].(map[string]any)
	if !ok {
		t.Fatalf("expected check exposure_intent map, got %T", checkSpec["exposure_intent"])
	}
	createExposure, ok := createSpec["exposure_intent"].(map[string]any)
	if !ok {
		t.Fatalf("expected create exposure_intent map, got %T", createSpec["exposure_intent"])
	}
	if checkExposure["domain"] != createExposure["domain"] || checkExposure["target_port"] != createExposure["target_port"] {
		t.Fatalf("expected matching exposure_intent, got check=%v create=%v", checkExposure, createExposure)
	}

	checkMetadata, ok := checkSpec["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected check metadata map, got %T", checkSpec["metadata"])
	}
	createMetadata, ok := createSpec["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected create metadata map, got %T", createSpec["metadata"])
	}
	if checkMetadata["repository_url"] != createMetadata["repository_url"] || checkMetadata["raw_url"] != createMetadata["raw_url"] || checkMetadata["channel"] != createMetadata["channel"] {
		t.Fatalf("expected matching metadata, got check=%v create=%v", checkMetadata, createMetadata)
	}
	checkOrigin, ok := checkMetadata["origin_context"].(map[string]any)
	if !ok {
		t.Fatalf("expected check origin_context map, got %T", checkMetadata["origin_context"])
	}
	createOrigin, ok := createMetadata["origin_context"].(map[string]any)
	if !ok {
		t.Fatalf("expected create origin_context map, got %T", createMetadata["origin_context"])
	}
	if checkOrigin["channel"] != createOrigin["channel"] || checkOrigin["execution_mode"] != createOrigin["execution_mode"] {
		t.Fatalf("expected matching origin_context, got check=%v create=%v", checkOrigin, createOrigin)
	}
	checkPayload, ok := checkMetadata["candidate_payload"].(map[string]any)
	if !ok {
		t.Fatalf("expected check candidate_payload map, got %T", checkMetadata["candidate_payload"])
	}
	createPayload, ok := createMetadata["candidate_payload"].(map[string]any)
	if !ok {
		t.Fatalf("expected create candidate_payload map, got %T", createMetadata["candidate_payload"])
	}
	if checkPayload["repository_url"] != createPayload["repository_url"] || checkPayload["compose_path"] != createPayload["compose_path"] || checkPayload["raw_url"] != createPayload["raw_url"] {
		t.Fatalf("expected matching candidate_payload, got check=%v create=%v", checkPayload, createPayload)
	}
}

func TestOperationGitComposeWithHeaderAuth(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
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
