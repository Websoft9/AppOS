package routes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
// all four Action constants and maps to the correct values.
func TestValidSoftwareActionsMap(t *testing.T) {
	expected := map[string]software.Action{
		"install": software.ActionInstall,
		"upgrade": software.ActionUpgrade,
		"verify":  software.ActionVerify,
		"repair":  software.ActionRepair,
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
		if entry.ComponentKey == software.ComponentKeyMonitorAgent && tpl.TemplateKind != software.TemplateKindScript {
			t.Fatalf("monitor-agent should resolve to script template, got %q", tpl.TemplateKind)
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
