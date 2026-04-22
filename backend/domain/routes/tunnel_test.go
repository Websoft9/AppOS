package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/websoft9/appos/backend/domain/audit"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	appcrypto "github.com/websoft9/appos/backend/infra/crypto"
	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
	tunnelpb "github.com/websoft9/appos/backend/infra/tunnelpb"
)

func (te *testEnv) doTunnel(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	g := r.Group("/api/tunnel")
	g.Bind(apis.RequireSuperuserAuth())
	g.POST("/servers/{id}/token", func(e *core.RequestEvent) error { return handleTunnelToken(e) })
	g.GET("/servers/{id}/setup", func(e *core.RequestEvent) error { return handleTunnelSetup(e) })
	g.GET("/servers/{id}/forwards", func(e *core.RequestEvent) error { return handleTunnelForwards(e) })
	g.PUT("/servers/{id}/forwards", func(e *core.RequestEvent) error { return handleTunnelForwardsPut(e) })
	g.GET("/servers/{id}/logs", func(e *core.RequestEvent) error { return handleTunnelLogs(e) })
	g.GET("/overview", func(e *core.RequestEvent) error { return handleTunnelOverview(e) })
	g.GET("/servers/{id}/session", func(e *core.RequestEvent) error { return handleTunnelSession(e) })
	g.POST("/servers/{id}/disconnect", func(e *core.RequestEvent) error { return handleTunnelDisconnect(e) })
	g.POST("/servers/{id}/pause", func(e *core.RequestEvent) error { return handleTunnelPause(e) })
	g.POST("/servers/{id}/resume", func(e *core.RequestEvent) error { return handleTunnelResume(e) })

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

func createTunnelTokenSecret(t *testing.T, te *testEnv, serverID, token string) {
	t.Helper()
	secretCol, err := te.app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	enc, err := appcrypto.Encrypt(token)
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(secretCol)
	rec.Set("name", servers.TunnelTokenSecretName(serverID))
	rec.Set("type", "tunnel_token")
	rec.Set("template_id", "single_value")
	rec.Set("created_source", "system")
	rec.Set("value", enc)
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}
}

func createTunnelServerRecord(t *testing.T, te *testEnv, name string) *core.Record {
	t.Helper()

	serversCol, err := te.app.FindCollectionByNameOrId("servers")
	if err != nil {
		t.Fatal(err)
	}

	record := core.NewRecord(serversCol)
	record.Set("name", name)
	record.Set("host", "127.0.0.1")
	record.Set("port", 22)
	record.Set("user", "root")
	record.Set("auth_type", "password")
	record.Set("connect_type", "tunnel")

	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}

	return record
}

func TestTunnelOverviewReturnsEmptyCollections(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tunnelSessions = tunnelcore.NewRegistry()
	createTunnelServerRecord(t, te, "edge-1")

	rec := te.doTunnel(t, http.MethodGet, "/api/tunnel/overview", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("failed to decode payload: %v", err)
	}
	if len(payload.Items) != 1 {
		t.Fatalf("expected 1 tunnel item, got %d", len(payload.Items))
	}

	services, ok := payload.Items[0]["services"].([]any)
	if !ok {
		t.Fatalf("expected services array, got %#v", payload.Items[0]["services"])
	}
	if len(services) != 0 {
		t.Fatalf("expected empty services array, got %d entries", len(services))
	}

	groups, ok := payload.Items[0]["group_names"].([]any)
	if !ok {
		t.Fatalf("expected group_names array, got %#v", payload.Items[0]["group_names"])
	}
	if len(groups) != 0 {
		t.Fatalf("expected empty group_names array, got %d entries", len(groups))
	}

	waiting, _ := payload.Items[0]["waiting_for_first_connect"].(bool)
	if !waiting {
		t.Fatal("expected newly created tunnel server to be waiting for first connect")
	}
}

func TestTunnelSessionReturnsDisconnectReasonLabel(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tunnelSessions = tunnelcore.NewRegistry()
	server := createTunnelServerRecord(t, te, "edge-2")
	server.Set("tunnel_disconnect_reason", string(tunnelcore.DisconnectReasonKeepaliveTimeout))
	server.Set("tunnel_status", "offline")
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := te.doTunnel(t, http.MethodGet, "/api/tunnel/servers/"+server.Id+"/session", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("failed to decode payload: %v", err)
	}
	if payload["disconnect_reason"] != string(tunnelcore.DisconnectReasonKeepaliveTimeout) {
		t.Fatalf("unexpected disconnect_reason: %#v", payload["disconnect_reason"])
	}
	if payload["disconnect_reason_label"] != "Keepalive timeout" {
		t.Fatalf("unexpected disconnect_reason_label: %#v", payload["disconnect_reason_label"])
	}
	if _, ok := payload["services"].([]any); !ok {
		t.Fatalf("expected services array, got %#v", payload["services"])
	}
}

func TestTunnelSessionReturnsReconnectSummary(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tunnelSessions = tunnelcore.NewRegistry()
	server := createTunnelServerRecord(t, te, "edge-3")
	connectedAt := time.Now().UTC().Add(-95 * time.Minute)
	disconnectAt := connectedAt.Add(90 * time.Minute)
	server.Set("tunnel_connected_at", connectedAt)
	server.Set("tunnel_disconnect_at", disconnectAt)
	server.Set("tunnel_status", "offline")
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	audit.Write(te.app, audit.Entry{
		UserID:       "system",
		UserEmail:    "system@appos.local",
		Action:       "tunnel.connect",
		ResourceType: "server",
		ResourceID:   server.Id,
		Status:       audit.StatusSuccess,
		Detail: map[string]any{
			"remote_addr":    "10.0.0.3:2200",
			"services_count": 2,
		},
	})

	rec := te.doTunnel(t, http.MethodGet, "/api/tunnel/servers/"+server.Id+"/session", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("failed to decode payload: %v", err)
	}
	if payload["disconnect_at"] == "" {
		t.Fatalf("expected disconnect_at in payload, got %#v", payload["disconnect_at"])
	}
	if seconds, ok := payload["connection_duration_seconds"].(float64); !ok || seconds < 5400 {
		t.Fatalf("expected connection duration seconds >= 5400, got %#v", payload["connection_duration_seconds"])
	}
	if payload["recent_reconnect_count_24h"] != float64(1) {
		t.Fatalf("expected recent_reconnect_count_24h=1, got %#v", payload["recent_reconnect_count_24h"])
	}
	reconnects, ok := payload["recent_reconnects"].([]any)
	if !ok || len(reconnects) != 1 {
		t.Fatalf("expected one recent reconnect, got %#v", payload["recent_reconnects"])
	}
	first, ok := reconnects[0].(map[string]any)
	if !ok {
		t.Fatalf("expected reconnect item object, got %#v", reconnects[0])
	}
	if first["at"] == "" {
		t.Fatalf("expected reconnect timestamp, got %#v", first["at"])
	}
}

func TestTunnelForwardsGetReturnsDefaultsWhenUnset(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	server := createTunnelServerRecord(t, te, "edge-4")
	rec := te.doTunnel(t, http.MethodGet, "/api/tunnel/servers/"+server.Id+"/forwards", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	forwards, ok := payload["forwards"].([]any)
	if !ok || len(forwards) != 2 {
		t.Fatalf("expected 2 default forwards, got %#v", payload["forwards"])
	}
}

func TestTunnelForwardsPutValidatesAndPersists(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	server := createTunnelServerRecord(t, te, "edge-5")
	bad := `{"forwards":[{"service_name":"app","local_port":3000}]}`
	badRec := te.doTunnel(t, http.MethodPut, "/api/tunnel/servers/"+server.Id+"/forwards", bad, true)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing ssh forward, got %d: %s", badRec.Code, badRec.Body.String())
	}

	body := `{"forwards":[{"service_name":"ssh","local_port":22},{"service_name":"app","local_port":3000}]}`
	rec := te.doTunnel(t, http.MethodPut, "/api/tunnel/servers/"+server.Id+"/forwards", body, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	stored, err := te.app.FindRecordById("servers", server.Id)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stored.GetString("tunnel_forwards"), `"service_name":"app"`) {
		t.Fatalf("expected tunnel_forwards to persist app forward, got %s", stored.GetString("tunnel_forwards"))
	}
}

func TestTunnelSetupUsesDesiredForwards(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	server := createTunnelServerRecord(t, te, "edge-6")
	server.Set("tunnel_forwards", `[{"service_name":"ssh","local_port":22},{"service_name":"app","local_port":3000}]`)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}
	createTunnelTokenSecret(t, te, server.Id, "test-token")

	rec := te.doTunnel(t, http.MethodGet, "/api/tunnel/servers/"+server.Id+"/setup", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	autosshCmd, _ := payload["autossh_cmd"].(string)
	if !strings.Contains(autosshCmd, "-R 0:localhost:3000") {
		t.Fatalf("expected autossh command to include app forward, got %s", autosshCmd)
	}
	if strings.Contains(autosshCmd, "-R 0:localhost:80") {
		t.Fatalf("expected autossh command to omit default http forward, got %s", autosshCmd)
	}
}

func TestTunnelPauseAndResumePersistPauseUntil(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tunnelSessions = tunnelcore.NewRegistry()
	server := createTunnelServerRecord(t, te, "edge-7")

	pauseRec := te.doTunnel(t, http.MethodPost, "/api/tunnel/servers/"+server.Id+"/pause", `{"minutes":0.1}`, true)
	if pauseRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", pauseRec.Code, pauseRec.Body.String())
	}

	stored, err := te.app.FindRecordById("servers", server.Id)
	if err != nil {
		t.Fatal(err)
	}
	pauseUntil := stored.GetDateTime("tunnel_pause_until")
	if pauseUntil.IsZero() {
		t.Fatal("expected tunnel_pause_until to be set")
	}
	remaining := pauseUntil.Time().Sub(time.Now().UTC())
	if remaining < 5*time.Second || remaining > 7*time.Second {
		t.Fatalf("expected pause_until about 6s ahead, got %s", remaining)
	}

	resumeRec := te.doTunnel(t, http.MethodPost, "/api/tunnel/servers/"+server.Id+"/resume", "", true)
	if resumeRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resumeRec.Code, resumeRec.Body.String())
	}

	stored, err = te.app.FindRecordById("servers", server.Id)
	if err != nil {
		t.Fatal(err)
	}
	if !stored.GetDateTime("tunnel_pause_until").IsZero() {
		t.Fatal("expected tunnel_pause_until to be cleared after resume")
	}
}

func TestTunnelTokenValidatorRejectsPausedServer(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	server := createTunnelServerRecord(t, te, "edge-8")
	server.Set("tunnel_pause_until", time.Now().UTC().Add(5*time.Minute))
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}
	createTunnelTokenSecret(t, te, server.Id, "paused-token")

	validator := &tunnelpb.TokenValidator{App: te.app, TokenCache: &tunnelTokenCache, PauseUntil: tunnelPauseUntil}
	if managedServerID, ok := validator.Validate("paused-token"); ok || managedServerID != "" {
		t.Fatalf("expected paused token validation to fail, got ok=%v managedServerID=%q", ok, managedServerID)
	}
}

func TestTunnelLogsReturnConnectionLifecycle(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	server := createTunnelServerRecord(t, te, "edge-9")
	audit.Write(te.app, audit.Entry{
		UserID:       "system",
		Action:       "tunnel.connect",
		ResourceType: "server",
		ResourceID:   server.Id,
		Status:       audit.StatusSuccess,
		Detail: map[string]any{
			"remote_addr": "10.0.0.9:2200",
		},
	})
	audit.Write(te.app, audit.Entry{
		UserID:       "system",
		Action:       "tunnel.disconnect",
		ResourceType: "server",
		ResourceID:   server.Id,
		Status:       audit.StatusSuccess,
		Detail: map[string]any{
			"reason":       string(tunnelcore.DisconnectReasonPausedByOperator),
			"reason_label": "Paused by operator",
		},
	})
	audit.Write(te.app, audit.Entry{
		UserID:       "system",
		Action:       "tunnel.pause",
		ResourceType: "server",
		ResourceID:   server.Id,
		Status:       audit.StatusSuccess,
		Detail: map[string]any{
			"minutes":     0.1,
			"pause_until": time.Now().UTC().Add(6 * time.Second).Format(time.RFC3339),
		},
	})

	rec := te.doTunnel(t, http.MethodGet, "/api/tunnel/servers/"+server.Id+"/logs", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("failed to decode payload: %v", err)
	}
	if len(payload.Items) != 3 {
		t.Fatalf("expected 3 log items, got %#v", payload.Items)
	}
	byLabel := map[string]map[string]any{}
	for _, item := range payload.Items {
		label, _ := item["label"].(string)
		byLabel[label] = item
	}
	if _, ok := byLabel["Pause started"]; !ok {
		t.Fatalf("expected paused log item, got %#v", payload.Items)
	}
	if byLabel["Disconnected"]["reason_label"] != "Paused by operator" {
		t.Fatalf("expected disconnect reason label, got %#v", byLabel["Disconnected"]["reason_label"])
	}
	if byLabel["Connected"]["remote_addr"] != "10.0.0.9:2200" {
		t.Fatalf("expected connect remote addr, got %#v", byLabel["Connected"]["remote_addr"])
	}
}

// ═══════════════════════════════════════════════════════════
// TEST-1: Unauthenticated access & handler edge cases
// ═══════════════════════════════════════════════════════════

func TestTunnelEndpointsRejectUnauthenticated(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tunnelSessions = tunnelcore.NewRegistry()
	server := createTunnelServerRecord(t, te, "authtest-1")

	endpoints := []struct {
		method string
		url    string
	}{
		{http.MethodGet, "/api/tunnel/overview"},
		{http.MethodGet, "/api/tunnel/servers/" + server.Id + "/session"},
		{http.MethodGet, "/api/tunnel/servers/" + server.Id + "/forwards"},
		{http.MethodPut, "/api/tunnel/servers/" + server.Id + "/forwards"},
		{http.MethodPost, "/api/tunnel/servers/" + server.Id + "/token"},
		{http.MethodPost, "/api/tunnel/servers/" + server.Id + "/disconnect"},
		{http.MethodPost, "/api/tunnel/servers/" + server.Id + "/pause"},
		{http.MethodPost, "/api/tunnel/servers/" + server.Id + "/resume"},
		{http.MethodGet, "/api/tunnel/servers/" + server.Id + "/logs"},
	}
	for _, ep := range endpoints {
		rec := te.doTunnel(t, ep.method, ep.url, "", false)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: expected 401, got %d", ep.method, ep.url, rec.Code)
		}
	}
}

func TestTunnelDisconnectOfflineServer(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tunnelSessions = tunnelcore.NewRegistry()
	server := createTunnelServerRecord(t, te, "disc-1")
	server.Set("tunnel_status", "offline")
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := te.doTunnel(t, http.MethodPost, "/api/tunnel/servers/"+server.Id+"/disconnect", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var payload map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload["status"] != "offline" {
		t.Fatalf("expected status=offline for already-offline server, got %v", payload["status"])
	}
}

func TestTunnelDisconnectNonTunnelServerReturns400(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	// Create a server with connect_type != "tunnel"
	serversCol, err := te.app.FindCollectionByNameOrId("servers")
	if err != nil {
		t.Fatal(err)
	}
	server := core.NewRecord(serversCol)
	server.Set("name", "ssh-server")
	server.Set("host", "10.0.0.1")
	server.Set("port", 22)
	server.Set("user", "root")
	server.Set("auth_type", "password")
	server.Set("connect_type", "ssh")
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := te.doTunnel(t, http.MethodPost, "/api/tunnel/servers/"+server.Id+"/disconnect", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for non-tunnel server, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ═══════════════════════════════════════════════════════════
// TEST-2: Token cache & rotation
// ═══════════════════════════════════════════════════════════

func TestTunnelTokenCachePopulatedOnValidate(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	// Clear the global cache to test cold-start.
	tunnelTokenCache = sync.Map{}

	server := createTunnelServerRecord(t, te, "cache-1")
	createTunnelTokenSecret(t, te, server.Id, "cache-test-token")

	validator := &tunnelpb.TokenValidator{App: te.app, TokenCache: &tunnelTokenCache, PauseUntil: tunnelPauseUntil}
	managedServerID, ok := validator.Validate("cache-test-token")
	if !ok || managedServerID != server.Id {
		t.Fatalf("expected valid token, got ok=%v managedServerID=%q", ok, managedServerID)
	}

	// After validation the cache should contain the token.
	if cached, found := tunnelTokenCache.Load("cache-test-token"); !found {
		t.Fatal("expected token to be cached after Validate")
	} else if cached.(string) != server.Id {
		t.Fatalf("cached serverID mismatch: %q vs %q", cached, server.Id)
	}

	// Second call should hit the cache (O(1) path).
	serverID2, ok2 := validator.Validate("cache-test-token")
	if !ok2 || serverID2 != server.Id {
		t.Fatalf("cache hit path failed: ok=%v serverID=%q", ok2, serverID2)
	}
}

func TestTunnelTokenRotationInvalidatesOldCache(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tunnelSessions = tunnelcore.NewRegistry()
	tunnelTokenCache = sync.Map{}

	server := createTunnelServerRecord(t, te, "rotate-1")
	createTunnelTokenSecret(t, te, server.Id, "old-token-abc")

	// Seed the cache with the old token.
	tunnelTokenCache.Store("old-token-abc", server.Id)

	// Rotate via the handler.
	rec := te.doTunnel(t, http.MethodPost, "/api/tunnel/servers/"+server.Id+"/token?rotate=true", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	newToken, _ := payload["token"].(string)
	if newToken == "" || newToken == "old-token-abc" {
		t.Fatalf("expected new token after rotation, got %q", newToken)
	}

	// Old token should be removed from cache.
	if _, found := tunnelTokenCache.Load("old-token-abc"); found {
		t.Fatal("old token should have been removed from cache after rotation")
	}

	// New token should be in cache.
	if cached, found := tunnelTokenCache.Load(newToken); !found {
		t.Fatal("new token should be in cache after rotation")
	} else if cached.(string) != server.Id {
		t.Fatalf("cached serverID mismatch for new token: %q vs %q", cached, server.Id)
	}
}

func TestTunnelTokenIdempotentWithoutRotate(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tunnelSessions = tunnelcore.NewRegistry()
	server := createTunnelServerRecord(t, te, "idem-1")
	createTunnelTokenSecret(t, te, server.Id, "stable-token")

	rec1 := te.doTunnel(t, http.MethodPost, "/api/tunnel/servers/"+server.Id+"/token", "", true)
	if rec1.Code != http.StatusOK {
		t.Fatalf("first call: expected 200, got %d", rec1.Code)
	}
	var p1 map[string]any
	json.NewDecoder(rec1.Body).Decode(&p1)

	rec2 := te.doTunnel(t, http.MethodPost, "/api/tunnel/servers/"+server.Id+"/token", "", true)
	if rec2.Code != http.StatusOK {
		t.Fatalf("second call: expected 200, got %d", rec2.Code)
	}
	var p2 map[string]any
	json.NewDecoder(rec2.Body).Decode(&p2)

	if p1["token"] != p2["token"] {
		t.Fatalf("expected same token without rotate, got %q vs %q", p1["token"], p2["token"])
	}
}

func TestTunnelTokenValidatorRejectsInvalidToken(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tunnelTokenCache = sync.Map{}

	createTunnelServerRecord(t, te, "reject-1")
	validator := &tunnelpb.TokenValidator{App: te.app, TokenCache: &tunnelTokenCache, PauseUntil: tunnelPauseUntil}
	if managedServerID, ok := validator.Validate("totally-invalid-token"); ok || managedServerID != "" {
		t.Fatalf("expected invalid token to be rejected, got ok=%v managedServerID=%q", ok, managedServerID)
	}
}

// ═══════════════════════════════════════════════════════════
// TEST-3: Extended pause flow
// ═══════════════════════════════════════════════════════════

func TestTunnelPauseRejectsInvalidMinutes(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tunnelSessions = tunnelcore.NewRegistry()
	server := createTunnelServerRecord(t, te, "pause-bad-1")

	// Zero minutes should not be accepted (or result in near-instant unpause).
	rec := te.doTunnel(t, http.MethodPost, "/api/tunnel/servers/"+server.Id+"/pause", `{"minutes":0}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for zero minutes, got %d: %s", rec.Code, rec.Body.String())
	}

	// Negative minutes should not be accepted.
	rec2 := te.doTunnel(t, http.MethodPost, "/api/tunnel/servers/"+server.Id+"/pause", `{"minutes":-5}`, true)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for negative minutes, got %d: %s", rec2.Code, rec2.Body.String())
	}
}

func TestTunnelResumeAlreadyResumedIsIdempotent(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tunnelSessions = tunnelcore.NewRegistry()
	server := createTunnelServerRecord(t, te, "resume-idem-1")

	// Server has no pause set — resume should still return 200.
	rec := te.doTunnel(t, http.MethodPost, "/api/tunnel/servers/"+server.Id+"/resume", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for resume on non-paused server, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestTunnelPauseThenValidateRejects(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tunnelTokenCache = sync.Map{}
	tunnelSessions = tunnelcore.NewRegistry()

	server := createTunnelServerRecord(t, te, "pause-validate-1")
	createTunnelTokenSecret(t, te, server.Id, "paused-val-token")

	// Pause for 5 minutes.
	rec := te.doTunnel(t, http.MethodPost, "/api/tunnel/servers/"+server.Id+"/pause", `{"minutes":5}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Token validation should fail while paused (both cold and warm paths).
	validator := &tunnelpb.TokenValidator{App: te.app, TokenCache: &tunnelTokenCache, PauseUntil: tunnelPauseUntil}

	// Cold path (cache miss → full scan):
	if sid, ok := validator.Validate("paused-val-token"); ok || sid != "" {
		t.Fatalf("cold path: expected rejection while paused, got ok=%v sid=%q", ok, sid)
	}

	// Warm path (cache hit):
	tunnelTokenCache.Store("paused-val-token", server.Id)
	if sid, ok := validator.Validate("paused-val-token"); ok || sid != "" {
		t.Fatalf("warm path: expected rejection while paused, got ok=%v sid=%q", ok, sid)
	}

	// Resume and validating again should succeed.
	resRec := te.doTunnel(t, http.MethodPost, "/api/tunnel/servers/"+server.Id+"/resume", "", true)
	if resRec.Code != http.StatusOK {
		t.Fatalf("resume expected 200, got %d", resRec.Code)
	}

	tunnelTokenCache = sync.Map{}
	if sid, ok := validator.Validate("paused-val-token"); !ok || sid != server.Id {
		t.Fatalf("expected valid after resume, got ok=%v sid=%q", ok, sid)
	}
}

func TestTunnelSetupScriptRateLimiter(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	// Reset the rate limiter state.
	setupScriptLimiters = sync.Map{}

	server := createTunnelServerRecord(t, te, "ratelimit-1")
	createTunnelTokenSecret(t, te, server.Id, "rl-token-123")

	// Build a router that includes the unauthenticated setup-script route.
	doSetupScript := func() *httptest.ResponseRecorder {
		r, err := apis.NewRouter(te.app)
		if err != nil {
			t.Fatal(err)
		}
		r.GET("/tunnel/setup/{token}", func(e *core.RequestEvent) error {
			return handleTunnelSetupScript(e)
		})
		mux, err := r.BuildMux()
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodGet, "/tunnel/setup/rl-token-123", nil)
		req.Header.Set("X-Forwarded-For", "198.51.100.42")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	// First 3 requests (burst) should succeed.
	for i := 0; i < 3; i++ {
		rec := doSetupScript()
		if rec.Code == http.StatusTooManyRequests {
			t.Fatalf("request %d: expected success, got 429", i+1)
		}
	}

	// Subsequent rapid requests should be rate limited.
	limited := false
	for i := 0; i < 5; i++ {
		rec := doSetupScript()
		if rec.Code == http.StatusTooManyRequests {
			limited = true
			if rec.Header().Get("Retry-After") == "" {
				t.Fatal("rate-limited response missing Retry-After header")
			}
			break
		}
	}
	if !limited {
		t.Fatal("expected rate limiting after burst, but all requests succeeded")
	}
}

func TestTunnelSetupScriptReturnsShellForPayloadBackedToken(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	setupScriptLimiters = sync.Map{}
	tunnelTokenCache = sync.Map{}
	server := createTunnelServerRecord(t, te, "setup-script-1")
	createTunnelTokenSecret(t, te, server.Id, "setup-token-123")

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}
	r.GET("/tunnel/setup/{token}", func(e *core.RequestEvent) error {
		return handleTunnelSetupScript(e)
	})
	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/tunnel/setup/setup-token-123", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if contentType := rec.Header().Get("Content-Type"); !strings.Contains(contentType, "text/x-sh") {
		t.Fatalf("expected shell content type, got %q", contentType)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "#!/bin/bash") {
		t.Fatalf("expected shell script body, got %q", body)
	}
	if !strings.Contains(body, "setup-token-123") {
		t.Fatalf("expected token in shell script, got %q", body)
	}
}
