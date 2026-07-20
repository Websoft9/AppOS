package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/workflow"
	"github.com/websoft9/appos/backend/infra/persistence"
)

func doWorkflow(t *testing.T, te *testEnv, method, url, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}
	registerWorkflowRoutes(&core.ServeEvent{Router: r})
	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestWorkflowCRUDAndRunRoutes(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	userToken := createRegularUserToken(t, te)
	createBody := `{"definition_yaml":"name: sample\ndefault_server_id: srv_1\ntriggers:\n  - type: cron\n    schedule: '0 6 * * *'\nnodes:\n  - key: collect\n    type: shell\n    config:\n      command: echo ok\n","default_server_id":"srv_1","is_enabled":true}`

	rec := doWorkflow(t, te, http.MethodPost, "/api/workflows", createBody, userToken)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for regular user create, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = doWorkflow(t, te, http.MethodPost, "/api/workflows", createBody, te.token)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 create, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	id := created["id"].(string)

	rec = doWorkflow(t, te, http.MethodGet, "/api/workflows", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 list, got %d: %s", rec.Code, rec.Body.String())
	}
	items := parseJSONArray(t, rec)
	if len(items) != 1 {
		t.Fatalf("expected 1 workflow, got %d", len(items))
	}

	asynqClient = nil
	rec = doWorkflow(t, te, http.MethodPost, "/api/workflows/"+id+"/run", `{}`, te.token)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 without asynq client, got %d: %s", rec.Code, rec.Body.String())
	}

	repo := persistence.NewWorkflowRepository(te.app)
	runs, err := repo.ListRunsByWorkflow(context.Background(), id)
	if err != nil {
		t.Fatalf("ListRunsByWorkflow: %v", err)
	}
	if len(runs) != 1 {
		t.Fatalf("expected one prepared run, got %d", len(runs))
	}
	owner, err := te.app.FindFirstRecordByData("_superusers", "email", routesTestAdminEmail)
	if err != nil {
		t.Fatalf("find seeded superuser: %v", err)
	}
	if runs[0].ExecutionOwnerID != owner.Id {
		t.Fatalf("expected execution owner %q, got %q", owner.Id, runs[0].ExecutionOwnerID)
	}
	nodes, err := repo.ListNodeRunsByRun(context.Background(), runs[0].ID)
	if err != nil {
		t.Fatalf("ListNodeRunsByRun: %v", err)
	}
	if len(nodes) != 1 {
		t.Fatalf("expected one node run, got %d", len(nodes))
	}

	rec = doWorkflow(t, te, http.MethodGet, "/api/workflow-runs/"+runs[0].ID+"/nodes", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 node list, got %d: %s", rec.Code, rec.Body.String())
	}

	status := workflow.NodeStatusManualGate
	_, err = repo.UpdateNodeRun(context.Background(), nodes[0].ID, workflow.UpdateNodeRunInput{Status: &status})
	if err != nil {
		t.Fatalf("UpdateNodeRun: %v", err)
	}
	runStatus := workflow.RunStatusManualGate
	_, err = repo.UpdateRun(context.Background(), runs[0].ID, workflow.UpdateRunInput{Status: &runStatus})
	if err != nil {
		t.Fatalf("UpdateRun: %v", err)
	}
	rec = doWorkflow(t, te, http.MethodPost, "/api/workflow-runs/"+runs[0].ID+"/approve/"+nodes[0].NodeKey, "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 approve, got %d: %s", rec.Code, rec.Body.String())
	}
	approved := parseJSON(t, rec)
	if approved["status"] != workflow.NodeStatusSucceeded {
		t.Fatalf("expected succeeded node status, got %v", approved["status"])
	}

	rec = doWorkflow(t, te, http.MethodPost, "/api/workflow-runs/"+runs[0].ID+"/cancel", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 cancel, got %d: %s", rec.Code, rec.Body.String())
	}
	cancelled := parseJSON(t, rec)
	if cancelled["status"] != workflow.RunStatusCancelled {
		t.Fatalf("expected cancelled run status, got %v", cancelled["status"])
	}
}

func TestWorkflowRunCancelReturnsPersistedTruth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()
	owner, err := te.app.FindFirstRecordByData("_superusers", "email", routesTestAdminEmail)
	if err != nil {
		t.Fatalf("find seeded superuser: %v", err)
	}

	repo := persistence.NewWorkflowRepository(te.app)
	workflowRecord, err := repo.CreateDefinition(context.Background(), workflow.CreateDefinitionInput{
		Name:             "cancel-me",
		Description:      "",
		IsEnabled:        true,
		DefinitionYAML:   "name: cancel-me\ndefault_server_id: srv_1\nnodes:\n  - key: a\n    type: shell\n    config:\n      command: echo hi\n",
		DefaultServerID:  "srv_1",
		CreatedBy:        owner.Id,
		TriggerTypesJSON: "[]",
		NodeCount:        1,
		HasAINodes:       false,
	})
	if err != nil {
		t.Fatalf("CreateDefinition: %v", err)
	}
	run, _, err := repo.CreatePreparedRun(context.Background(), workflow.CreateRunInput{
		WorkflowID:       workflowRecord.ID,
		DefinitionYAML:   workflowRecord.DefinitionYAML,
		Status:           workflow.RunStatusRunning,
		TriggerType:      workflow.TriggerManual,
		ExecutionOwnerID: owner.Id,
		RequestedBy:      owner.Id,
		RequestedByEmail: owner.GetString("email"),
		ParamsJSON:       `{}`,
		ResolvedServerID: workflowRecord.DefaultServerID,
		OverlapPolicy:    workflow.OverlapPolicySkip,
	}, []workflow.NodeRunSeed{{NodeKey: "a", NodeType: workflow.NodeTypeShell, DisplayName: "a", DependsOnJSON: "[]", Status: workflow.NodeStatusRunning}})
	if err != nil {
		t.Fatalf("CreatePreparedRun: %v", err)
	}

	rec := doWorkflow(t, te, http.MethodPost, "/api/workflow-runs/"+run.ID+"/cancel", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 cancel, got %d: %s", rec.Code, rec.Body.String())
	}
	updated := parseJSON(t, rec)
	if updated["status"] != workflow.RunStatusCancelled {
		t.Fatalf("expected cancelled status, got %v", updated["status"])
	}
	if strings.TrimSpace(updated["ended_at"].(string)) == "" {
		t.Fatal("expected ended_at to be set")
	}
}

func TestWorkflowRoutesRejectInvalidDefinition(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()
	rec := doWorkflow(t, te, http.MethodPost, "/api/workflows", `{"definition_yaml":"name: bad\nnodes:\n  - key: a\n    type: shell\n    config:\n      command: echo hi\n"}`, te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 invalid definition, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestWorkflowReadRoutesRequireSuperuser(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()
	userToken := createRegularUserToken(t, te)
	rec := doWorkflow(t, te, http.MethodGet, "/api/workflows", "", userToken)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for regular user read, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestWorkflowRoutesCreateResponseJSONShape(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()
	rec := doWorkflow(t, te, http.MethodPost, "/api/workflows", `{"definition_yaml":"name: sample\ndefault_server_id: srv_1\nnodes:\n  - key: a\n    type: shell\n    config:\n      command: echo hi\n","default_server_id":"srv_1"}`, te.token)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 create, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["definition_yaml"] == nil {
		t.Fatal("expected definition_yaml in response")
	}
}

func TestWorkflowRunListReturnsPreparedRun(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()
	createBody := `{"definition_yaml":"name: sample\ndefault_server_id: srv_1\nnodes:\n  - key: a\n    type: shell\n    config:\n      command: echo hi\n","default_server_id":"srv_1","is_enabled":true}`
	rec := doWorkflow(t, te, http.MethodPost, "/api/workflows", createBody, te.token)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 create, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	id := created["id"].(string)
	asynqClient = nil
	_ = doWorkflow(t, te, http.MethodPost, "/api/workflows/"+id+"/run", `{}`, te.token)
	rec = doWorkflow(t, te, http.MethodGet, "/api/workflows/"+id+"/runs", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 run list, got %d: %s", rec.Code, rec.Body.String())
	}
	runs := parseJSONArray(t, rec)
	if len(runs) != 1 {
		t.Fatalf("expected 1 run, got %d", len(runs))
	}
}
