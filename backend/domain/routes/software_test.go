package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/software"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
	"github.com/websoft9/appos/backend/infra/collections"
)

func (te *testEnv) doSoftware(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	servers := r.Group("/api/servers")
	servers.Bind(apis.RequireAuth())
	registerSoftwareRoutes(servers)

	local := r.Group("/api/software")
	local.Bind(apis.RequireAuth())
	registerLocalSoftwareRoutes(local)

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

// TestValidSoftwareActionsMap verifies that the validSoftwareActions map covers
// all supported Action constants and maps to the correct values.
func TestValidSoftwareActionsMap(t *testing.T) {
	expected := map[string]software.Action{
		"install":   software.ActionInstall,
		"upgrade":   software.ActionUpgrade,
		"start":     software.ActionStart,
		"stop":      software.ActionStop,
		"restart":   software.ActionRestart,
		"verify":    software.ActionVerify,
		"reinstall": software.ActionReinstall,
		"uninstall": software.ActionUninstall,
	}
	for key, want := range expected {
		got, ok := validSoftwareActions[key]
		if !ok {
			t.Errorf("validSoftwareActions missing key %q", key)
			continue
		}
		if got != want {
			t.Errorf("validSoftwareActions[%q] = %q, want %q", key, got, want)
		}
	}
	// No extra keys allowed.
	if len(validSoftwareActions) != len(expected) {
		t.Errorf("validSoftwareActions has %d entries, want %d", len(validSoftwareActions), len(expected))
	}
}

// TestEscapeSoftwareFilterValue verifies that single quotes are escaped to prevent
// PocketBase filter injection.
func TestEscapeSoftwareFilterValue(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"srv-1", "srv-1"},
		{"docker", "docker"},
		{"'; DROP TABLE software_operations; --", "\\'; DROP TABLE software_operations; --"},
	}
	for _, c := range cases {
		got := escapeSoftwareFilterValue(c.input)
		if got != c.want {
			t.Errorf("escapeSoftwareFilterValue(%q) = %q, want %q", c.input, got, c.want)
		}
	}
}

// TestSoftwareComponentSummaryResponseFields verifies the shape of the response struct.
func TestSoftwareComponentSummaryResponseFields(t *testing.T) {
	resp := softwareComponentListItem{
		SoftwareComponentSummary: software.SoftwareComponentSummary{
			ComponentKey:      software.ComponentKeyDocker,
			Label:             "Docker",
			TemplateKind:      software.TemplateKindPackage,
			AvailableActions:  []software.Action{software.ActionInstall, software.ActionVerify},
			InstalledState:    software.InstalledStateInstalled,
			InstallSource:     software.InstallSourceManaged,
			SourceEvidence:    "apt:docker-ce",
			VerificationState: software.VerificationStateHealthy,
		},
		TargetType: software.TargetTypeServer,
	}
	if resp.ComponentKey != software.ComponentKeyDocker {
		t.Errorf("unexpected component_key: %q", resp.ComponentKey)
	}
	if resp.InstalledState != software.InstalledStateInstalled {
		t.Errorf("unexpected installed_state: %q", resp.InstalledState)
	}
	if resp.InstallSource != software.InstallSourceManaged {
		t.Errorf("unexpected install_source: %q", resp.InstallSource)
	}
}

func TestSoftwareComponentListItemJSONIncludesDetectSourceFields(t *testing.T) {
	resp := softwareComponentListItem{
		SoftwareComponentSummary: software.SoftwareComponentSummary{
			ComponentKey:      software.ComponentKeyDocker,
			Label:             "Docker",
			TemplateKind:      software.TemplateKindPackage,
			InstalledState:    software.InstalledStateInstalled,
			DetectedVersion:   "27.0.1",
			InstallSource:     software.InstallSourceForeignPackage,
			SourceEvidence:    "apt:docker.io",
			VerificationState: software.VerificationStateDegraded,
			AvailableActions:  []software.Action{software.ActionVerify, software.ActionReinstall},
		},
		TargetType: software.TargetTypeServer,
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}

	var body map[string]any
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if body["install_source"] != "foreign_package" {
		t.Fatalf("expected install_source foreign_package, got %#v", body["install_source"])
	}
	if body["source_evidence"] != "apt:docker.io" {
		t.Fatalf("expected source_evidence apt:docker.io, got %#v", body["source_evidence"])
	}
}

func TestSoftwareComponentDetailResponseJSONIncludesDetectSourceFields(t *testing.T) {
	resp := softwareComponentDetailResponse{
		SoftwareComponentDetail: software.SoftwareComponentDetail{
			SoftwareComponentSummary: software.SoftwareComponentSummary{
				ComponentKey:      software.ComponentKeyDocker,
				Label:             "Docker",
				TemplateKind:      software.TemplateKindPackage,
				InstalledState:    software.InstalledStateInstalled,
				DetectedVersion:   "27.0.1",
				InstallSource:     software.InstallSourceManual,
				SourceEvidence:    "binary:/usr/local/bin/docker",
				VerificationState: software.VerificationStateHealthy,
			},
			ServiceName: "docker.service",
		},
		TargetType: software.TargetTypeServer,
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}

	var body map[string]any
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if body["install_source"] != "manual" {
		t.Fatalf("expected install_source manual, got %#v", body["install_source"])
	}
	if body["source_evidence"] != "binary:/usr/local/bin/docker" {
		t.Fatalf("expected source_evidence binary path, got %#v", body["source_evidence"])
	}
}

// TestCapabilityComponentMapCoveredByServerCatalog verifies that every capability in
// CapabilityComponentMap resolves to a component_key present in the server catalog.
// This is the integration invariant between the server catalog and the capability surface.
func TestCapabilityComponentMapCoveredByServerCatalog(t *testing.T) {
	cat, err := swcatalog.LoadServerCatalog()
	if err != nil {
		t.Fatalf("LoadServerCatalog: %v", err)
	}
	catalogKeys := make(map[software.ComponentKey]bool)
	for _, e := range cat.Components {
		catalogKeys[e.ComponentKey] = true
	}
	for cap, key := range software.CapabilityComponentMap {
		if !catalogKeys[key] {
			t.Errorf("capability %q maps to %q which is absent from server catalog", cap, key)
		}
	}
}

// TestSoftwareCapabilityResponseReady verifies the Ready flag logic:
// installed=installed AND verification=healthy → ready=true.
func TestSoftwareCapabilityResponseReady(t *testing.T) {
	cases := []struct {
		installed    software.InstalledState
		verification software.VerificationState
		wantReady    bool
	}{
		{software.InstalledStateInstalled, software.VerificationStateHealthy, true},
		{software.InstalledStateInstalled, software.VerificationStateDegraded, false},
		{software.InstalledStateInstalled, software.VerificationStateUnknown, false},
		{software.InstalledStateNotInstalled, software.VerificationStateHealthy, false},
		{software.InstalledStateUnknown, software.VerificationStateUnknown, false},
	}
	for _, c := range cases {
		ready := c.installed == software.InstalledStateInstalled &&
			c.verification == software.VerificationStateHealthy
		if ready != c.wantReady {
			t.Errorf("installed=%q verification=%q: ready=%v, want %v",
				c.installed, c.verification, ready, c.wantReady)
		}
	}
}

func TestSoftwareActionAcceptedResponseShape(t *testing.T) {
	resp := software.AsyncCommandResponse{
		Accepted:    true,
		OperationID: "op-123",
		Phase:       software.OperationPhaseAccepted,
		Message:     "install accepted",
	}
	if !resp.Accepted {
		t.Fatal("expected accepted=true")
	}
	if resp.OperationID == "" {
		t.Fatal("expected operation_id to be populated")
	}
	if resp.Phase != software.OperationPhaseAccepted {
		t.Fatalf("expected phase=accepted, got %q", resp.Phase)
	}
}

func TestSoftwareComponentSummaryShouldNotHardcodePackageTemplate(t *testing.T) {
	cat, err := swcatalog.LoadServerCatalog()
	if err != nil {
		t.Fatalf("LoadServerCatalog: %v", err)
	}
	reg, err := swcatalog.LoadTemplateRegistry()
	if err != nil {
		t.Fatalf("LoadTemplateRegistry: %v", err)
	}
	for _, entry := range cat.Components {
		tpl, ok := reg.Templates[entry.TemplateRef]
		if !ok {
			t.Fatalf("missing template ref %q", entry.TemplateRef)
		}
		if entry.ComponentKey == software.ComponentKeyMonitorAgent && tpl.TemplateKind != software.TemplateKindPackage {
			t.Fatalf("appos-monitor-collector should resolve to package template, got %q", tpl.TemplateKind)
		}
	}
}

func TestSoftwareRoutesRequireAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doSoftware(t, http.MethodGet, "/api/servers/srv-1/software", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected server software list to require auth, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.doSoftware(t, http.MethodGet, "/api/software/local", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected local software list to require auth, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSoftwareFlatRoutesPreserveLiteralEndpoints(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	col, err := te.app.FindCollectionByNameOrId(collections.SoftwareOperations)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(col)
	record.Set("server_id", "srv-1")
	record.Set("component_key", "docker")
	record.Set("action", "verify")
	record.Set("phase", "accepted")
	record.Set("terminal_status", "none")
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}

	rec := te.doSoftware(t, http.MethodGet, "/api/servers/srv-1/software/operations", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected operations route 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	items, ok := body["items"].([]any)
	if !ok || len(items) == 0 {
		t.Fatalf("expected operations items payload, got %#v", body["items"])
	}

	rec = te.doSoftware(t, http.MethodGet, "/api/servers/srv-1/software/capabilities", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected capabilities route 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body = parseJSON(t, rec)
	if _, ok := body["items"].([]any); !ok {
		t.Fatalf("expected capability items payload, got %#v", body["items"])
	}

	rec = te.doSoftware(t, http.MethodGet, "/api/servers/srv-1/software/operations/"+record.Id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected operation detail route 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body = parseJSON(t, rec)
	if body["id"] != record.Id {
		t.Fatalf("expected operation detail id %q, got %#v", record.Id, body["id"])
	}
}

func TestSoftwareInventoryRoutesExposeFlatServerAndLocalScopes(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doSoftware(t, http.MethodGet, "/api/servers/srv-1/software/docker", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected server component route 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["component_key"] != "docker" {
		t.Fatalf("expected component_key docker, got %#v", body["component_key"])
	}
	if body["target_type"] != "server" {
		t.Fatalf("expected target_type server, got %#v", body["target_type"])
	}

	rec = te.doSoftware(t, http.MethodGet, "/api/software/local", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected local software list 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body = parseJSON(t, rec)
	if body["target_id"] != "appos-local" {
		t.Fatalf("expected local target id appos-local, got %#v", body["target_id"])
	}
	localItems, ok := body["items"].([]any)
	if !ok || len(localItems) == 0 {
		t.Fatalf("expected non-empty local items payload, got %#v", body["items"])
	}

	rec = te.doSoftware(t, http.MethodGet, "/api/software/local/docker", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected local component route 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body = parseJSON(t, rec)
	if body["component_key"] != "docker" {
		t.Fatalf("expected local component_key docker, got %#v", body["component_key"])
	}
	if body["target_type"] != "local" {
		t.Fatalf("expected local target_type local, got %#v", body["target_type"])
	}
}

func TestSupportedServerCatalogRoutesExposeReadOnlyCatalogSurface(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doSoftware(t, http.MethodGet, "/api/software/server-catalog", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected supported server catalog list 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	items, ok := body["items"].([]any)
	if !ok || len(items) == 0 {
		t.Fatalf("expected supported server catalog items, got %#v", body["items"])
	}
	first, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("expected first supported software entry object, got %#v", items[0])
	}
	if _, ok := first["installed_state"]; ok {
		t.Fatalf("supported server catalog should not expose installed_state, got %#v", first["installed_state"])
	}
	if _, ok := first["verification_state"]; ok {
		t.Fatalf("supported server catalog should not expose verification_state, got %#v", first["verification_state"])
	}
	if _, ok := first["supported_actions"].([]any); !ok {
		t.Fatalf("expected supported_actions array, got %#v", first["supported_actions"])
	}
	if first["description"] == "" {
		t.Fatalf("expected supported software description, got %#v", first["description"])
	}
	if _, ok := first["readiness_requirements"].([]any); !ok {
		t.Fatalf("expected readiness_requirements array, got %#v", first["readiness_requirements"])
	}
	if _, ok := first["visibility"].([]any); !ok {
		t.Fatalf("expected visibility array, got %#v", first["visibility"])
	}

	rec = te.doSoftware(t, http.MethodGet, "/api/software/server-catalog/docker", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected supported server catalog detail 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body = parseJSON(t, rec)
	if body["component_key"] != "docker" {
		t.Fatalf("expected docker supported software detail, got %#v", body["component_key"])
	}
	if body["capability"] != "container_runtime" {
		t.Fatalf("expected capability container_runtime, got %#v", body["capability"])
	}
	if _, ok := body["readiness_requirements"].([]any); !ok {
		t.Fatalf("expected detail readiness_requirements array, got %#v", body["readiness_requirements"])
	}
	if _, ok := body["visibility"].([]any); !ok {
		t.Fatalf("expected detail visibility array, got %#v", body["visibility"])
	}

	rec = te.doSoftware(t, http.MethodGet, "/api/software/server-catalog/not-a-component", "", true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected missing supported server catalog detail 404, got %d: %s", rec.Code, rec.Body.String())
	}
	body = parseJSON(t, rec)
	if body["error"] != "component_not_found" {
		t.Fatalf("expected component_not_found error, got %#v", body["error"])
	}
}

func TestSoftwareOperationGetReturns404ForMissingOrMismatchedServer(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	col, err := te.app.FindCollectionByNameOrId(collections.SoftwareOperations)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(col)
	record.Set("server_id", "srv-1")
	record.Set("component_key", "docker")
	record.Set("action", "verify")
	record.Set("phase", "accepted")
	record.Set("terminal_status", "none")
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}

	rec := te.doSoftware(t, http.MethodGet, "/api/servers/srv-2/software/operations/"+record.Id, "", true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected mismatched server operation detail to return 404, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["error"] != "operation_not_found" {
		t.Fatalf("expected operation_not_found error, got %#v", body["error"])
	}

	rec = te.doSoftware(t, http.MethodGet, "/api/servers/srv-1/software/operations/missing-op", "", true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected missing operation detail to return 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSoftwareOperationListSupportsComponentFilter(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	col, err := te.app.FindCollectionByNameOrId(collections.SoftwareOperations)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		serverID     string
		componentKey string
	}{
		{serverID: "srv-1", componentKey: "docker"},
		{serverID: "srv-1", componentKey: "appos-monitor-collector"},
		{serverID: "srv-2", componentKey: "docker"},
	} {
		record := core.NewRecord(col)
		record.Set("server_id", item.serverID)
		record.Set("component_key", item.componentKey)
		record.Set("action", "verify")
		record.Set("phase", "accepted")
		record.Set("terminal_status", "none")
		if err := te.app.Save(record); err != nil {
			t.Fatal(err)
		}
	}

	rec := te.doSoftware(t, http.MethodGet, "/api/servers/srv-1/software/operations?component=docker", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected filtered operation list 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	items, ok := body["items"].([]any)
	if !ok {
		t.Fatalf("expected operations items payload, got %#v", body["items"])
	}
	if len(items) != 1 {
		t.Fatalf("expected exactly one filtered operation, got %d", len(items))
	}
	item, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("expected operation object, got %#v", items[0])
	}
	if item["component_key"] != "docker" {
		t.Fatalf("expected docker operation, got %#v", item["component_key"])
	}
	if item["server_id"] != "srv-1" {
		t.Fatalf("expected srv-1 operation, got %#v", item["server_id"])
	}
}

func TestSoftwareComponentRoutesReturn404ForUnknownComponent(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doSoftware(t, http.MethodGet, "/api/servers/srv-1/software/not-a-component", "", true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected unknown server component to return 404, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["error"] != "component_not_found" {
		t.Fatalf("expected component_not_found for server component, got %#v", body["error"])
	}

	rec = te.doSoftware(t, http.MethodGet, "/api/software/local/not-a-component", "", true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected unknown local component to return 404, got %d: %s", rec.Code, rec.Body.String())
	}
	body = parseJSON(t, rec)
	if body["error"] != "component_not_found" {
		t.Fatalf("expected component_not_found for local component, got %#v", body["error"])
	}
}

func TestSoftwareComponentActionRejectsInvalidActionAndMissingQueue(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doSoftware(t, http.MethodPost, "/api/servers/srv-1/software/docker/not-real", "{}", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid action to return 400, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["error"] != "invalid_action" {
		t.Fatalf("expected invalid_action error, got %#v", body["error"])
	}

	oldClient := asynqClient
	asynqClient = nil
	defer func() { asynqClient = oldClient }()

	rec = te.doSoftware(t, http.MethodPost, "/api/servers/srv-1/software/docker/install", "{}", true)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected missing queue to return 503, got %d: %s", rec.Code, rec.Body.String())
	}
	body = parseJSON(t, rec)
	if body["error"] != "queue_unavailable" {
		t.Fatalf("expected queue_unavailable error, got %#v", body["error"])
	}
}

func TestSoftwareComponentActionReturnsConflictWhenOperationInFlight(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	oldClient := asynqClient
	asynqClient = &asynq.Client{}
	defer func() { asynqClient = oldClient }()

	col, err := te.app.FindCollectionByNameOrId(collections.SoftwareOperations)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(col)
	record.Set("server_id", "srv-1")
	record.Set("component_key", "docker")
	record.Set("action", "install")
	record.Set("phase", "executing")
	record.Set("terminal_status", "none")
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}

	rec := te.doSoftware(t, http.MethodPost, "/api/servers/srv-1/software/docker/install", "{}", true)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected in-flight operation to return 409, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["error"] != "operation_in_flight" {
		t.Fatalf("expected operation_in_flight error, got %#v", body["error"])
	}
}

func TestSoftwareComponentActionRejectsInvalidAppOSBaseURL(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	oldClient := asynqClient
	asynqClient = &asynq.Client{}
	defer func() { asynqClient = oldClient }()

	rec := te.doSoftware(t, http.MethodPost, "/api/servers/srv-1/software/docker/install", `{"apposBaseUrl":"console.example.com"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid apposBaseUrl to return 400, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["error"] != "invalid_appos_base_url" {
		t.Fatalf("expected invalid_appos_base_url error, got %#v", body["error"])
	}
}
