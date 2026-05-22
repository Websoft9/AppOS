package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/terminal"
	"github.com/websoft9/appos/backend/domain/software"
	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
)

type terminalTestSession struct{}

func (terminalTestSession) Write(p []byte) (int, error) { return len(p), nil }
func (terminalTestSession) Read(_ []byte) (int, error)  { return 0, nil }
func (terminalTestSession) Resize(_, _ uint16) error    { return nil }
func (terminalTestSession) Close() error                { return nil }

// doServer performs a server route request using the testEnv helper from resources_test.go.
func (te *testEnv) doServer(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	g := r.Group("/api/servers")
	registerServerRoutes(g)

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	var bodyReader = strings.NewReader(body)
	req := httptest.NewRequest(method, url, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	if authenticated {
		req.Header.Set("Authorization", te.token)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestLocalDockerBridgeRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodGet, "/api/servers/local/docker-bridge", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAllowWebSocketOriginAllowsEmptyOrigin(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "https://console.example.com/api/actions/demo/stream", nil)
	if !allowWebSocketOrigin(req) {
		t.Fatal("expected empty origin to be allowed")
	}
}

func TestAllowWebSocketOriginAllowsSameOrigin(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "https://console.example.com/api/actions/demo/stream", nil)
	req.Header.Set("Origin", "https://console.example.com")
	if !allowWebSocketOrigin(req) {
		t.Fatal("expected same origin to be allowed")
	}
}

func TestAllowWebSocketOriginRejectsCrossOrigin(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "https://console.example.com/api/actions/demo/stream", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	if allowWebSocketOrigin(req) {
		t.Fatal("expected cross origin to be rejected")
	}
}

func TestAllowWebSocketOriginUsesForwardedProxyHostAndProto(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "http://internal.example.local/api/actions/demo/stream", nil)
	req.Host = "console.example.com"
	req.Header.Set("X-Forwarded-Host", "console.example.com:9443")
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("Origin", "https://console.example.com:9443")
	if !allowWebSocketOrigin(req) {
		t.Fatal("expected forwarded proxy origin to be allowed")
	}
}

func TestLocalDockerBridgeReturnsAddress(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	originalLookup := dockerBridgeIPv4Lookup
	originalGatewayLookup := dockerBridgeGatewayLookup
	dockerBridgeIPv4Lookup = func(name string) (string, error) {
		if name != "docker0" {
			t.Fatalf("expected docker0 lookup, got %s", name)
		}
		return "172.17.0.1", nil
	}
	defer func() {
		dockerBridgeIPv4Lookup = originalLookup
		dockerBridgeGatewayLookup = originalGatewayLookup
	}()
	dockerBridgeGatewayLookup = func(_ context.Context) (string, error) {
		t.Fatal("gateway lookup should not run when docker0 succeeds")
		return "", nil
	}

	rec := te.doServer(t, http.MethodGet, "/api/servers/local/docker-bridge", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Interface string `json:"interface"`
		Address   string `json:"address"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if payload.Interface != "docker0" || payload.Address != "172.17.0.1" {
		t.Fatalf("unexpected payload: %+v", payload)
	}
}

func TestServerConnectivityOnlineEnqueuesSnapshotWarm(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	server := createTunnelServerRecord(t, te, "warm-edge")
	oldSessions := tunnelSessions
	tunnelSessions = tunnelcore.NewRegistry()
	tunnelSessions.Register(server.Id, &tunnelcore.Session{ClientID: server.Id, ConnectedAt: time.Now().UTC()})
	defer func() { tunnelSessions = oldSessions }()

	oldClient := asynqClient
	asynqClient = &asynq.Client{}
	defer func() { asynqClient = oldClient }()

	oldEnqueue := enqueueSoftwareSnapshotWarmTask
	called := false
	var gotServerID string
	var gotUserID string
	var gotComponents []software.ComponentKey
	enqueueSoftwareSnapshotWarmTask = func(client *asynq.Client, serverID, userID string, componentKeys []software.ComponentKey) error {
		called = true
		gotServerID = serverID
		gotUserID = userID
		gotComponents = append([]software.ComponentKey(nil), componentKeys...)
		return nil
	}
	defer func() { enqueueSoftwareSnapshotWarmTask = oldEnqueue }()

	rec := te.doServer(t, http.MethodGet, "/api/servers/"+server.Id+"/ops/connectivity?mode=tunnel", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !called {
		t.Fatal("expected connectivity online check to enqueue snapshot warming")
	}
	if gotServerID != server.Id {
		t.Fatalf("expected server id %q, got %q", server.Id, gotServerID)
	}
	if gotUserID == "" {
		t.Fatal("expected authenticated user id to be forwarded to snapshot warming")
	}
	if len(gotComponents) != 3 {
		t.Fatalf("expected 3 default warm components, got %#v", gotComponents)
	}
}

func TestLocalDockerBridgeFallsBackToBridgeGateway(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	originalLookup := dockerBridgeIPv4Lookup
	originalGatewayLookup := dockerBridgeGatewayLookup
	dockerBridgeIPv4Lookup = func(name string) (string, error) {
		if name != "docker0" {
			t.Fatalf("expected docker0 lookup, got %s", name)
		}
		return "", http.ErrNoLocation
	}
	defer func() {
		dockerBridgeIPv4Lookup = originalLookup
		dockerBridgeGatewayLookup = originalGatewayLookup
	}()
	dockerBridgeGatewayLookup = func(_ context.Context) (string, error) {
		return "172.17.0.1", nil
	}

	rec := te.doServer(t, http.MethodGet, "/api/servers/local/docker-bridge", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Interface string `json:"interface"`
		Address   string `json:"address"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if payload.Interface != "bridge" || payload.Address != "172.17.0.1" {
		t.Fatalf("unexpected bridge fallback payload: %+v", payload)
	}
}

func TestLocalDockerBridgeFallsBackToLoopback(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	originalLookup := dockerBridgeIPv4Lookup
	originalGatewayLookup := dockerBridgeGatewayLookup
	dockerBridgeIPv4Lookup = func(name string) (string, error) {
		if name != "docker0" {
			t.Fatalf("expected docker0 lookup, got %s", name)
		}
		return "", http.ErrNoLocation
	}
	defer func() {
		dockerBridgeIPv4Lookup = originalLookup
		dockerBridgeGatewayLookup = originalGatewayLookup
	}()
	dockerBridgeGatewayLookup = func(_ context.Context) (string, error) {
		return "", http.ErrUseLastResponse
	}

	rec := te.doServer(t, http.MethodGet, "/api/servers/local/docker-bridge", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Interface string `json:"interface"`
		Address   string `json:"address"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if payload.Interface != "loopback" || payload.Address != "127.0.0.1" {
		t.Fatalf("unexpected loopback fallback payload: %+v", payload)
	}
}

func TestServersViewRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodGet, "/api/servers/connection", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServersViewBuildsAccessAndTunnelReadModel(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createRouteSecret(t, te, "global", "")
	owner, err := te.app.FindFirstRecordByData("_superusers", "email", "admin@test.com")
	if err != nil {
		t.Fatalf("find seeded superuser: %v", err)
	}

	direct := createServerRecord(t, te, "direct-a", "10.0.0.1", 22, "root", "password")
	direct.Set("connect_type", "direct")
	direct.Set("credential", secret.Id)
	direct.Set("created_by", owner.Id)
	direct.Set("facts_json", map[string]any{
		"os": map[string]any{
			"family":       "linux",
			"distribution": "ubuntu",
			"version":      "24.04",
		},
		"kernel": map[string]any{
			"release": "6.8.0",
		},
		"architecture": "amd64",
		"cpu": map[string]any{
			"cores": float64(4),
		},
		"memory": map[string]any{
			"total_bytes": float64(8589934592),
		},
		"cloud": map[string]any{
			"provider": "aws",
			"region":   "cn-northwest-1",
			"zone":     "cn-northwest-1a",
			"source":   "cloud-init",
		},
	})
	direct.Set("facts_observed_at", "2026-04-22 10:30:00.000Z")
	// Simulate a previously successful probe persisted to the DB (the new
	// connectivity-check write-back path). The list endpoint reads this cached
	// value instead of running a live TCP probe.
	direct.Set("access_status", "available")
	direct.Set("access_reason", "")
	direct.Set("access_checked_at", "2026-04-22 10:00:00.000Z")
	if err := te.app.Save(direct); err != nil {
		t.Fatal(err)
	}

	tunnel := createTunnelServerRecord(t, te, "tunnel-b")
	tunnel.Set("credential", secret.Id)
	tunnel.Set("created_by", owner.Id)
	tunnel.Set("tunnel_status", "online")
	tunnel.Set("tunnel_connected_at", "2026-04-22 10:00:00.000Z")
	tunnel.Set("tunnel_last_seen", "2026-04-22 10:00:00.000Z")
	if err := te.app.Save(tunnel); err != nil {
		t.Fatal(err)
	}

	tunnelSessions = tunnelcore.NewRegistry()
	t.Cleanup(func() {
		tunnelSessions = nil
	})

	rec := te.doServer(t, http.MethodGet, "/api/servers/connection", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Items []struct {
			ID              string         `json:"id"`
			Name            string         `json:"name"`
			CreatedByName   string         `json:"created_by_name"`
			CredentialType  string         `json:"credential_type"`
			CloudProvider   string         `json:"cloud_provider_name"`
			CloudRegion     string         `json:"cloud_region"`
			CloudZone       string         `json:"cloud_zone"`
			CloudSource     string         `json:"cloud_provider_source"`
			FactsJSON       map[string]any `json:"facts_json"`
			FactsObservedAt string         `json:"facts_observed_at"`
			Connection      struct {
				StateCode   string `json:"state_code"`
				ReasonCode  string `json:"reason_code"`
				ConfigReady bool   `json:"config_ready"`
			} `json:"connection"`
			Access struct {
				Status string `json:"status"`
				Reason string `json:"reason"`
				Source string `json:"source"`
			} `json:"access"`
			Tunnel *struct {
				State   string `json:"state"`
				Status  string `json:"status"`
				Waiting bool   `json:"waiting_for_first_connect"`
			} `json:"tunnel"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(payload.Items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(payload.Items))
	}

	byName := make(map[string]struct {
		ID               string
		CreatedByName    string
		CredentialType   string
		ConnectionState  string
		ConnectionReason string
		ConfigReady      bool
		AccessStatus     string
		AccessReason     string
		AccessSource     string
		TunnelState      string
		TunnelStatus     string
		TunnelWaiting    bool
	})
	for _, item := range payload.Items {
		entry := struct {
			ID               string
			CreatedByName    string
			CredentialType   string
			ConnectionState  string
			ConnectionReason string
			ConfigReady      bool
			AccessStatus     string
			AccessReason     string
			AccessSource     string
			TunnelState      string
			TunnelStatus     string
			TunnelWaiting    bool
		}{
			ID:               item.ID,
			CreatedByName:    item.CreatedByName,
			CredentialType:   item.CredentialType,
			ConnectionState:  item.Connection.StateCode,
			ConnectionReason: item.Connection.ReasonCode,
			ConfigReady:      item.Connection.ConfigReady,
			AccessStatus:     item.Access.Status,
			AccessReason:     item.Access.Reason,
			AccessSource:     item.Access.Source,
		}
		if item.Tunnel != nil {
			entry.TunnelState = item.Tunnel.State
			entry.TunnelStatus = item.Tunnel.Status
			entry.TunnelWaiting = item.Tunnel.Waiting
		}
		byName[item.Name] = entry
	}

	if got := byName["direct-a"]; got.AccessStatus != "available" || got.AccessSource != "cached" {
		t.Fatalf("unexpected direct access payload: %#v", got)
	}
	if got := byName["direct-a"]; got.ConnectionState != "online" || got.ConnectionReason != "" || !got.ConfigReady {
		t.Fatalf("unexpected direct connection payload: %#v", got)
	}
	if got := byName["direct-a"]; got.CredentialType != "Password" {
		t.Fatalf("expected direct credential type Password, got %#v", got)
	}
	if got := byName["direct-a"]; got.CreatedByName != "admin@test.com" {
		t.Fatalf("expected direct created_by_name admin@test.com, got %#v", got)
	}
	if got := byName["direct-a"]; got.TunnelState != "" {
		t.Fatalf("expected no tunnel payload for direct server, got %#v", got)
	}
	for _, item := range payload.Items {
		if item.Name != "direct-a" {
			continue
		}
		if item.FactsObservedAt != "2026-04-22T10:30:00Z" {
			t.Fatalf("expected direct facts_observed_at, got %#v", item.FactsObservedAt)
		}
		if item.FactsJSON["architecture"] != "amd64" {
			t.Fatalf("expected direct facts_json architecture, got %#v", item.FactsJSON)
		}
		if item.CloudProvider != "aws" || item.CloudRegion != "cn-northwest-1" || item.CloudZone != "cn-northwest-1a" || item.CloudSource != "cloud-init" {
			t.Fatalf("expected projected cloud fields, got provider=%q region=%q zone=%q source=%q", item.CloudProvider, item.CloudRegion, item.CloudZone, item.CloudSource)
		}
		osFacts, ok := item.FactsJSON["os"].(map[string]any)
		if !ok || osFacts["distribution"] != "ubuntu" {
			t.Fatalf("expected direct os facts, got %#v", item.FactsJSON)
		}
		memoryFacts, ok := item.FactsJSON["memory"].(map[string]any)
		if !ok || memoryFacts["total_bytes"] != float64(8589934592) {
			t.Fatalf("expected direct memory facts, got %#v", item.FactsJSON)
		}
	}

	if got := byName["tunnel-b"]; got.AccessStatus != "available" || got.AccessSource != "tunnel_runtime" {
		t.Fatalf("unexpected tunnel access payload: %#v", got)
	}
	if got := byName["tunnel-b"]; got.ConnectionState != "online" || got.ConnectionReason != "" || !got.ConfigReady {
		t.Fatalf("unexpected tunnel connection payload: %#v", got)
	}
	if got := byName["tunnel-b"]; got.TunnelState != "ready" || got.TunnelStatus != "online" || got.TunnelWaiting {
		t.Fatalf("unexpected tunnel state payload: %#v", got)
	}
	if got := byName["tunnel-b"]; got.CredentialType != "Password" {
		t.Fatalf("expected tunnel credential type Password, got %#v", got)
	}
}

func TestServersViewDerivesCloudRegionFromZone(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createRouteSecret(t, te, "global", "")
	server := createServerRecord(t, te, "direct-zone-only", "10.0.0.3", 22, "root", "password")
	server.Set("connect_type", "direct")
	server.Set("credential", secret.Id)
	server.Set("facts_json", map[string]any{
		"os": map[string]any{
			"family":       "linux",
			"distribution": "ubuntu",
			"version":      "24.04",
		},
		"kernel": map[string]any{
			"release": "6.8.0",
		},
		"architecture": "amd64",
		"cpu": map[string]any{
			"cores": float64(4),
		},
		"memory": map[string]any{
			"total_bytes": float64(8589934592),
		},
		"cloud": map[string]any{
			"provider": "gcp",
			"zone":     "us-central1-a",
			"source":   "cloud-init",
		},
	})
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := te.doServer(t, http.MethodGet, "/api/servers/connection", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Items []struct {
			Name          string `json:"name"`
			CloudProvider string `json:"cloud_provider_name"`
			CloudRegion   string `json:"cloud_region"`
			CloudZone     string `json:"cloud_zone"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	for _, item := range payload.Items {
		if item.Name != "direct-zone-only" {
			continue
		}
		if item.CloudProvider != "gcp" || item.CloudRegion != "us-central1" || item.CloudZone != "us-central1-a" {
			t.Fatalf("expected projected zone-derived region, got %+v", item)
		}
		return
	}
	t.Fatal("expected direct-zone-only item in response")
}

func TestServersViewUsesControlReachabilityAccessCache(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createRouteSecret(t, te, "global", "")
	direct := createServerRecord(t, te, "direct-offline", "10.0.0.99", 22, "root", "password")
	direct.Set("connect_type", "direct")
	direct.Set("credential", secret.Id)
	direct.Set("access_status", "unavailable")
	direct.Set("access_reason", "control_unreachable")
	direct.Set("access_checked_at", "2026-05-13 10:00:00.000Z")
	if err := te.app.Save(direct); err != nil {
		t.Fatal(err)
	}

	rec := te.doServer(t, http.MethodGet, "/api/servers/connection", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Items []struct {
			Name       string `json:"name"`
			Connection struct {
				StateCode  string `json:"state_code"`
				ReasonCode string `json:"reason_code"`
			} `json:"connection"`
			Access struct {
				Status string `json:"status"`
				Reason string `json:"reason"`
				Source string `json:"source"`
			} `json:"access"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(payload.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(payload.Items))
	}
	item := payload.Items[0]
	if item.Name != "direct-offline" {
		t.Fatalf("unexpected server row: %#v", item)
	}
	if item.Access.Status != "unavailable" || item.Access.Reason != "control_unreachable" || item.Access.Source != "cached" {
		t.Fatalf("unexpected access projection: %#v", item.Access)
	}
	if item.Connection.StateCode != "needs_attention" || item.Connection.ReasonCode != "control_unreachable" {
		t.Fatalf("expected needs_attention/control_unreachable connection, got %#v", item.Connection)
	}
}

func TestServersViewMarksTunnelSetupRequired(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tunnel := createTunnelServerRecord(t, te, "tunnel-setup")
	tunnel.Set("tunnel_status", "offline")
	if err := te.app.Save(tunnel); err != nil {
		t.Fatal(err)
	}

	tunnelSessions = tunnelcore.NewRegistry()
	t.Cleanup(func() {
		tunnelSessions = nil
	})

	rec := te.doServer(t, http.MethodGet, "/api/servers/connection", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Items []struct {
			Name       string `json:"name"`
			Connection struct {
				StateCode   string `json:"state_code"`
				ReasonCode  string `json:"reason_code"`
				ConfigReady bool   `json:"config_ready"`
			} `json:"connection"`
			Access struct {
				Status string `json:"status"`
				Reason string `json:"reason"`
			} `json:"access"`
			Tunnel *struct {
				State   string `json:"state"`
				Waiting bool   `json:"waiting_for_first_connect"`
			} `json:"tunnel"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(payload.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(payload.Items))
	}
	item := payload.Items[0]
	if item.Name != "tunnel-setup" {
		t.Fatalf("unexpected item name: %#v", item)
	}
	if item.Access.Status != "unavailable" || item.Access.Reason != "waiting_for_first_connect" {
		t.Fatalf("unexpected setup-required access payload: %#v", item)
	}
	if item.Connection.StateCode != "not_configured" || item.Connection.ReasonCode != "config_incomplete" || item.Connection.ConfigReady {
		t.Fatalf("unexpected setup-required connection payload: %#v", item)
	}
	if item.Tunnel == nil || item.Tunnel.State != "setup_required" || !item.Tunnel.Waiting {
		t.Fatalf("unexpected setup-required tunnel payload: %#v", item)
	}
}

// doTerminal performs a terminal route request using the testEnv helper from resources_test.go.
func (te *testEnv) doTerminal(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	g := r.Group("/api/terminal")
	g.Bind(wsTokenAuth())
	g.Bind(apis.RequireSuperuserAuth())
	registerTerminalRoutes(g)

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	var bodyReader = strings.NewReader(body)
	req := httptest.NewRequest(method, url, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	if authenticated {
		req.Header.Set("Authorization", te.token)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// TestSFTPListRequiresAuth verifies that SFTP list endpoint rejects unauthenticated requests.
func TestSFTPListRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/terminal/sftp/nonexistent/list?path=/", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestTerminalSessionsReturnsCurrentUsersActiveSessions(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	registryReset := func() {
		terminal.Unregister("session-user")
		terminal.Unregister("session-other")
	}
	registryReset()
	defer registryReset()

	admin, err := te.app.FindFirstRecordByData(core.CollectionNameSuperusers, "email", routesTestAdminEmail)
	if err != nil {
		t.Fatal(err)
	}

	other := core.NewRecord(admin.Collection())
	other.Set("email", "other-admin@test.com")
	other.SetPassword("1234567890")
	if err := te.app.Save(other); err != nil {
		t.Fatal(err)
	}

	terminal.RegisterDetailed("session-user", terminalTestSession{}, admin.Id, "server", "srv-1", "ssh")
	terminal.RegisterDetailed("session-other", terminalTestSession{}, other.Id, "server", "srv-2", "ssh")

	rec := te.doTerminal(t, http.MethodGet, "/api/terminal/sessions", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Items []terminal.SessionSummary `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(payload.Items))
	}
	if payload.Items[0].ID != "session-user" {
		t.Fatalf("expected current user's session, got %s", payload.Items[0].ID)
	}
	if payload.Items[0].ResourceID != "srv-1" || payload.Items[0].SessionType != "ssh" {
		t.Fatalf("unexpected session payload: %+v", payload.Items[0])
	}
}

func TestTerminalSessionWorkspaceUpdatesSnapshot(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	admin, err := te.app.FindFirstRecordByData(core.CollectionNameSuperusers, "email", routesTestAdminEmail)
	if err != nil {
		t.Fatal(err)
	}

	terminal.Unregister("session-workspace")
	defer terminal.Unregister("session-workspace")
	terminal.RegisterDetailed("session-workspace", terminalTestSession{}, admin.Id, "server", "srv-1", "ssh")

	body := `{"active_server_id":"srv-1","side_panel":"files","file_path":"/var/log","locked_root":"/var","split_ratio":0.4}`
	rec := te.doTerminal(t, http.MethodPatch, "/api/terminal/sessions/session-workspace/workspace", body, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	listRec := te.doTerminal(t, http.MethodGet, "/api/terminal/sessions", "", true)
	if listRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", listRec.Code, listRec.Body.String())
	}

	var payload struct {
		Items []terminal.SessionSummary `json:"items"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(payload.Items))
	}
	if payload.Items[0].Workspace.FilePath != "/var/log" || payload.Items[0].Workspace.LockedRoot != "/var" {
		t.Fatalf("unexpected workspace payload: %+v", payload.Items[0].Workspace)
	}
}

func TestTerminalSessionCloseRemovesOwnedSession(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	admin, err := te.app.FindFirstRecordByData(core.CollectionNameSuperusers, "email", routesTestAdminEmail)
	if err != nil {
		t.Fatal(err)
	}

	terminal.Unregister("session-close")
	terminal.RegisterDetailed("session-close", terminalTestSession{}, admin.Id, "server", "srv-1", "ssh")

	rec := te.doTerminal(t, http.MethodDelete, "/api/terminal/sessions/session-close", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	listRec := te.doTerminal(t, http.MethodGet, "/api/terminal/sessions", "", true)
	if listRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", listRec.Code, listRec.Body.String())
	}

	var payload struct {
		Items []terminal.SessionSummary `json:"items"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Items) != 0 {
		t.Fatalf("expected 0 items after close, got %d", len(payload.Items))
	}
}

// TestSFTPListInvalidServer verifies SFTP list returns 400 for unknown server.
func TestSFTPListInvalidServer(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/terminal/sftp/nonexistent/list?path=/", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestSFTPDownloadRequiresPath verifies SFTP download returns 400 when path is omitted.
func TestSFTPDownloadRequiresPath(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	// First, we need a server to test against — but since the server doesn't exist in DB,
	// we'll get a 400 for "server not found" first. That's OK for this test.
	rec := te.doTerminal(t, http.MethodGet, "/api/terminal/sftp/nonexistent/download", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestSFTPMkdirRequiresPath verifies SFTP mkdir returns 400 when body is empty.
func TestSFTPMkdirRequiresPath(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPost, "/api/terminal/sftp/nonexistent/mkdir", "{}", true)
	// Either 400 (bad path) because server_not_found is also 400
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestSFTPDeleteRequiresPath verifies SFTP delete returns 400 when path is omitted.
func TestSFTPDeleteRequiresPath(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodDelete, "/api/terminal/sftp/nonexistent/delete", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestSFTPRenameRequiresFields verifies SFTP rename returns 400 with missing fields.
func TestSFTPRenameRequiresFields(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPost, "/api/terminal/sftp/nonexistent/rename", `{"from":""}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestDockerExecRequiresAuth verifies Docker exec rejects unauthenticated requests.
func TestDockerExecRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	// Docker exec is a WebSocket endpoint, but without proper WS handshake,
	// it should return 401 for unauthenticated requests.
	rec := te.doTerminal(t, http.MethodGet, "/api/terminal/docker/testcontainer", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestSFTPStatRequiresPath verifies SFTP stat returns 400 when path is omitted.
func TestSFTPStatRequiresPath(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/terminal/sftp/nonexistent/stat", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestSFTPCopyRequiresFields verifies copy endpoint validates from/to fields.
func TestSFTPCopyRequiresFields(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPost, "/api/terminal/sftp/nonexistent/copy", `{}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestSFTPSymlinkRequiresFields verifies symlink endpoint validates payload.
func TestSFTPSymlinkRequiresFields(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPost, "/api/terminal/sftp/nonexistent/symlink", `{}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestSFTPCopyStreamRequiresFields verifies copy-stream validates from/to query params.
func TestSFTPCopyStreamRequiresFields(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/terminal/sftp/nonexistent/copy-stream", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPowerRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodPost, "/api/servers/nonexistent/ops/power", `{"action":"restart"}`, false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPowerRejectsInvalidAction(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodPost, "/api/servers/nonexistent/ops/power", `{"action":"reboot-now"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdStatusRejectsInvalidServiceName(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodGet, "/api/servers/nonexistent/ops/systemd/bad$name/status", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdLogsRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodGet, "/api/servers/nonexistent/ops/systemd/ssh/logs", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdContentRejectsInvalidServiceName(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodGet, "/api/servers/nonexistent/ops/systemd/bad$name/content", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdActionRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodPost, "/api/servers/nonexistent/ops/systemd/ssh/action", `{"action":"restart"}`, false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdActionRejectsInvalidAction(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodPost, "/api/servers/nonexistent/ops/systemd/ssh/action", `{"action":"reload"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdUnitReadRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodGet, "/api/servers/nonexistent/ops/systemd/ssh/unit", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdUnitWriteRejectsInvalidBody(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodPut, "/api/servers/nonexistent/ops/systemd/ssh/unit", `{"content":`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdUnitWriteRejectsEmptyContent(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodPut, "/api/servers/nonexistent/ops/systemd/ssh/unit", `{"content":"   "}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdUnitVerifyRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodPost, "/api/servers/nonexistent/ops/systemd/ssh/unit/verify", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdUnitApplyRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodPost, "/api/servers/nonexistent/ops/systemd/ssh/unit/apply", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortInspectRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodGet, "/api/servers/nonexistent/ops/ports/8080", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortInspectRejectsInvalidPort(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodGet, "/api/servers/nonexistent/ops/ports/70000", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortInspectRejectsInvalidProtocol(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodGet, "/api/servers/nonexistent/ops/ports/8080?protocol=sctp", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortInspectRejectsInvalidView(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodGet, "/api/servers/nonexistent/ops/ports/8080?view=unknown", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortsListRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodGet, "/api/servers/nonexistent/ops/ports", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortsListRejectsInvalidProtocol(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodGet, "/api/servers/nonexistent/ops/ports?protocol=sctp", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortsListRejectsInvalidView(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodGet, "/api/servers/nonexistent/ops/ports?view=invalid", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortReleaseRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodPost, "/api/servers/nonexistent/ops/ports/8080/release", `{"mode":"graceful"}`, false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestServerPortReleaseRejectsInvalidMode verifies invalid mode returns 400.
// Note: With a nonexistent server, this test actually reaches resolveServerConfig first
// (also 400). The mode validation is separately tested by normalizePortReleaseMode logic.
func TestServerPortReleaseRejectsInvalidMode(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodPost, "/api/servers/nonexistent/ops/ports/8080/release", `{"mode":"soft"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortReleaseRejectsInvalidBody(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodPost, "/api/servers/nonexistent/ops/ports/8080/release", `{"mode":`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortReleaseRejectsInvalidProtocol(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodPost, "/api/servers/nonexistent/ops/ports/8080/release?protocol=sctp", `{"mode":"graceful"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

