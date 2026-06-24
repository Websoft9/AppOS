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
)

func (te *testEnv) doSystem(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	g := r.Group("/api/system")
	g.Bind(apis.RequireAuth())
	registerSystemRoutes(g)

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

func (te *testEnv) doPublicTraefik(t *testing.T, method, url string) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	registerPublicTraefikRoutes(&core.ServeEvent{Router: r})

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(method, url, nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func (te *testEnv) doFullRegister(t *testing.T, method, url string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	Register(&core.ServeEvent{Router: r})

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(method, url, nil)
	if authenticated {
		req.Header.Set("Authorization", te.token)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestSystemRuntimeRouteAggregatesPlatformRuntimeData(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	originalComponents := loadSystemRuntimeComponents
	originalServices := loadSystemRuntimeServices
	originalFacts := loadSystemRuntimeFacts
	t.Cleanup(func() {
		loadSystemRuntimeComponents = originalComponents
		loadSystemRuntimeServices = originalServices
		loadSystemRuntimeFacts = originalFacts
	})

	loadSystemRuntimeComponents = func(app core.App) ([]softwareComponentListItem, error) {
		return []softwareComponentListItem{{
			ID:           "appos",
			Name:         "AppOS",
			RuntimeKind:  "service",
			Version:      "1.0.0",
			Available:    true,
			ProbePending: false,
		}}, nil
	}
	loadSystemRuntimeServices = func() ([]componentServiceItem, error) {
		return []componentServiceItem{{
			Name:         "appos-core",
			State:        "running",
			PID:          101,
			Uptime:       3600,
			LogAvailable: true,
		}}, nil
	}
	loadSystemRuntimeFacts = func() (systemHostKernelFacts, systemRuntimeLimits, error) {
		limit := int64(536870912)
		return systemHostKernelFacts{
				KernelRelease: "6.8.0-test",
				Architecture:  "x86_64",
				CPUTopologyVisible: systemVisibleCPUTopology{
					ModelName:      "Test CPU",
					OnlineCPUCount: 4,
				},
			}, systemRuntimeLimits{
				CPUSetEffective: "0-3",
				CPUQuota: systemCPUQuota{
					Status: systemCPUQuotaUnrestricted,
				},
				MemoryLimitBytes: &limit,
			}, nil
	}

	rec := te.doSystem(t, http.MethodGet, "/api/system/runtime", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp systemRuntimeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Summary.RunningComponents != 1 || resp.Summary.DegradedComponents != 0 || resp.Summary.CheckingComponents != 0 {
		t.Fatalf("unexpected runtime summary: %+v", resp.Summary)
	}
	if len(resp.Components) != 1 || resp.Components[0].ID != "appos" {
		t.Fatalf("unexpected runtime components: %+v", resp.Components)
	}
	if len(resp.Processes) != 1 || resp.Processes[0].Name != "appos-core" {
		t.Fatalf("unexpected runtime processes: %+v", resp.Processes)
	}
	if resp.HostKernelFacts.KernelRelease != "6.8.0-test" || resp.HostKernelFacts.CPUTopologyVisible.OnlineCPUCount != 4 {
		t.Fatalf("unexpected host/kernel facts: %+v", resp.HostKernelFacts)
	}
	if resp.RuntimeLimits.CPUSetEffective != "0-3" || resp.RuntimeLimits.CPUQuota.Status != systemCPUQuotaUnrestricted {
		t.Fatalf("unexpected runtime limits: %+v", resp.RuntimeLimits)
	}
	if resp.RuntimeLimits.MemoryLimitBytes == nil || *resp.RuntimeLimits.MemoryLimitBytes != 536870912 {
		t.Fatalf("unexpected memory limit: %+v", resp.RuntimeLimits.MemoryLimitBytes)
	}
}

func TestSummarizeSystemRuntimeTreatsPendingAsChecking(t *testing.T) {
	summary := summarizeSystemRuntime([]softwareComponentListItem{
		{ID: "appos", Available: true},
		{ID: "docker", ProbePending: true},
		{ID: "vm", Available: false},
	})

	if summary.RunningComponents != 1 || summary.DegradedComponents != 1 || summary.CheckingComponents != 1 {
		t.Fatalf("unexpected runtime summary: %+v", summary)
	}
}

func TestNewStructuredCPUQuotaUsesTriStateStatus(t *testing.T) {
	constrained := newStructuredCPUQuota(50000, true, 100000, true)
	if constrained.Status != systemCPUQuotaConstrained || constrained.CoresEquivalent == nil || *constrained.CoresEquivalent != 0.5 {
		t.Fatalf("unexpected constrained quota: %+v", constrained)
	}

	unknown := newStructuredCPUQuota(0, false, 100000, true)
	if unknown.Status != systemCPUQuotaUnknown {
		t.Fatalf("unexpected unknown quota: %+v", unknown)
	}
}

func TestPublicTraefikDashboardProxyForwardsWithoutAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	originalURL := systemTraefikDashboardURL
	originalEnsure := ensureSystemTraefikReady
	t.Cleanup(func() {
		systemTraefikDashboardURL = originalURL
		ensureSystemTraefikReady = originalEnsure
	})

	ensureSystemTraefikReady = func(_ context.Context) error { return nil }
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/settings/public/traefik/dashboard/" {
			t.Fatalf("unexpected upstream path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html>traefik dashboard</html>"))
	}))
	defer upstream.Close()
	systemTraefikDashboardURL = upstream.URL

	rec := te.doPublicTraefik(t, http.MethodGet, "/api/settings/public/traefik/dashboard/")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); body != "<html>traefik dashboard</html>" {
		t.Fatalf("unexpected proxied body %q", body)
	}
}

func TestPublicTraefikDashboardProxyWithFullRegisterForwardsWithoutAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	originalURL := systemTraefikDashboardURL
	originalEnsure := ensureSystemTraefikReady
	originalTunnelHook := startTunnelRuntimeHook
	t.Cleanup(func() {
		systemTraefikDashboardURL = originalURL
		ensureSystemTraefikReady = originalEnsure
		startTunnelRuntimeHook = originalTunnelHook
	})

	ensureSystemTraefikReady = func(_ context.Context) error { return nil }
	startTunnelRuntimeHook = func(*core.ServeEvent) {}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/settings/public/traefik/dashboard/" {
			t.Fatalf("unexpected upstream path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html>traefik dashboard</html>"))
	}))
	defer upstream.Close()
	systemTraefikDashboardURL = upstream.URL

	rec := te.doFullRegister(t, http.MethodGet, "/api/settings/public/traefik/dashboard/", false)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); body != "<html>traefik dashboard</html>" {
		t.Fatalf("unexpected proxied body %q", body)
	}
}
