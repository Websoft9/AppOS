package routes

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/domain/software"
	"github.com/websoft9/appos/backend/domain/worker"
	"github.com/websoft9/appos/backend/infra/collections"
	"github.com/websoft9/appos/backend/infra/egress"
)

type stubDockerExecutor struct {
	host    string
	output  string
	outputs map[string]string
	errors  map[string]error
	lastCmd []string
	allCmds [][]string
}


func (s *stubDockerExecutor) Run(_ context.Context, command string, args ...string) (string, error) {
	cmd := append([]string{command}, args...)
	s.lastCmd = cmd
	s.allCmds = append(s.allCmds, append([]string(nil), cmd...))
	if s.errors != nil {
		if err, ok := s.errors[strings.Join(cmd, " ")]; ok {
			return "", err
		}
	}
	if s.outputs != nil {
		if output, ok := s.outputs[strings.Join(cmd, " ")]; ok {
			return output, nil
		}
	}
	return s.output, nil
}

func (s *stubDockerExecutor) RunStream(_ context.Context, command string, args ...string) (io.ReadCloser, error) {
	cmd := append([]string{command}, args...)
	s.lastCmd = cmd
	s.allCmds = append(s.allCmds, append([]string(nil), cmd...))
	return io.NopCloser(strings.NewReader(s.output)), nil
}

func (s *stubDockerExecutor) Ping(context.Context) error {
	return nil
}

func (s *stubDockerExecutor) Host() string {
	return s.host
}

func ensureDockerSecretRuntime(t *testing.T) {
	t.Helper()
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	t.Setenv(secrets.EnvSecretKey, key)
	if err := secrets.LoadKeyFromEnv(); err != nil {
		t.Fatal(err)
	}
	if err := secrets.LoadTemplatesFromDefaultPath(); err != nil {
		t.Fatal(err)
	}
}

func createDockerRouteSecret(t *testing.T, te *testEnv, value string) *core.Record {
	t.Helper()
	col, err := te.app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", "docker-route-secret")
	rec.Set("template_id", "single_value")
	rec.Set("scope", "global")
	rec.Set("access_mode", "use_only")
	rec.Set("status", "active")
	rec.Set("created_by", "system")
	enc, err := secrets.EncryptPayload(map[string]any{"value": value})
	if err != nil {
		t.Fatal(err)
	}
	rec.Set("payload_encrypted", enc)
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func createDockerRouteConnector(t *testing.T, te *testEnv, spec connectors.SaveInput) *core.Record {
	t.Helper()
	col, err := te.app.FindCollectionByNameOrId(collections.Connectors)
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	persistedKind := spec.Kind
	if spec.Kind == connectors.KindProxy {
		persistedKind = connectors.KindRegistry
	}
	rec.Set("name", spec.Name)
	rec.Set("kind", persistedKind)
	rec.Set("is_default", spec.IsDefault)
	rec.Set("template_id", spec.TemplateID)
	rec.Set("endpoint", spec.Endpoint)
	rec.Set("auth_scheme", spec.AuthScheme)
	rec.Set("credential", spec.CredentialID)
	rec.Set("config", spec.Config)
	rec.Set("description", spec.Description)
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}
	if spec.Kind == connectors.KindProxy {
		if _, err := te.app.DB().NewQuery("UPDATE " + collections.Connectors + " SET kind = {:kind} WHERE id = {:id}").Bind(map[string]any{
			"kind": connectors.KindProxy,
			"id":   rec.Id,
		}).Execute(); err != nil {
			t.Fatal(err)
		}
		rec.Set("kind", connectors.KindProxy)
	}
	return rec
}

func createDockerBrokenSecret(t *testing.T, te *testEnv) *core.Record {
	t.Helper()
	col, err := te.app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", "docker-route-broken-secret")
	rec.Set("template_id", "single_value")
	rec.Set("scope", "global")
	rec.Set("access_mode", "use_only")
	rec.Set("status", "active")
	rec.Set("created_by", "system")
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func dockerAuditEntriesByAction(t *testing.T, te *testEnv, action string) []*core.Record {
	t.Helper()
	entries, err := te.app.FindRecordsByFilter("audit_logs", "action = {:action}", "", 0, 0, map[string]any{"action": action})
	if err != nil {
		t.Fatal(err)
	}
	return entries
}

func TestTunnelSSHPortFromServices(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    int
		wantErr bool
	}{
		{
			name:    "valid ssh service",
			raw:     `[{"service_name":"ssh","tunnel_port":42001},{"service_name":"http","tunnel_port":42002}]`,
			want:    42001,
			wantErr: false,
		},
		{
			name:    "missing ssh service",
			raw:     `[{"service_name":"http","tunnel_port":42002}]`,
			want:    0,
			wantErr: true,
		},
		{
			name:    "empty services",
			raw:     ``,
			want:    0,
			wantErr: true,
		},
		{
			name:    "invalid json",
			raw:     `{bad json}`,
			want:    0,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := servers.TunnelSSHPortFromServices(tt.raw)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("got %d, want %d", got, tt.want)
			}
		})
	}
}

func doDocker(t *testing.T, te *testEnv, method, url, body, token string) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	g := r.Group("/api/servers")
	g.Bind(apis.RequireAuth())
	registerDockerRoutes(g)

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

func createRegularUserToken(t *testing.T, te *testEnv) string {
	t.Helper()

	usersCol, err := te.app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(usersCol)
	user.Set("email", "user@test.com")
	user.SetPassword("1234567890")
	if err := te.app.Save(user); err != nil {
		t.Fatal(err)
	}

	token, err := user.NewStaticAuthToken(0)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestDockerRoutesRequireSuperuser(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	userToken := createRegularUserToken(t, te)

	rec := doDocker(t, te, http.MethodGet, "/api/servers/docker-targets", "", userToken)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-superuser, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = doDocker(t, te, http.MethodGet, "/api/servers/docker-targets", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for superuser, got %d: %s", rec.Code, rec.Body.String())
	}
}

func createDockerImagePullOperationRecord(
	t *testing.T,
	te *testEnv,
	serverID string,
	imageName string,
	phase software.OperationPhase,
	terminalStatus software.TerminalStatus,
	failureReason string,
) *core.Record {
	t.Helper()
	col, err := te.app.FindCollectionByNameOrId(collections.DockerImagePullOperations)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(col)
	record.Set("server_id", serverID)
	record.Set("image_name", imageName)
	record.Set("normalized_name", worker.NormalizeDockerImageReference(imageName))
	record.Set("phase", string(phase))
	record.Set("terminal_status", string(terminalStatus))
	record.Set("failure_reason", failureReason)
	record.Set("output", "")
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}
	return record
}

func TestDockerImagePullOperationsListFiltersByStatusAndServer(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	inProgress := createDockerImagePullOperationRecord(
		t,
		te,
		"srv-1",
		"nginx:latest",
		software.OperationPhaseExecuting,
		software.TerminalStatusNone,
		"",
	)
	completed := createDockerImagePullOperationRecord(
		t,
		te,
		"srv-1",
		"redis:7",
		software.OperationPhaseSucceeded,
		software.TerminalStatusSuccess,
		"",
	)
	failed := createDockerImagePullOperationRecord(
		t,
		te,
		"srv-1",
		"busybox:latest",
		software.OperationPhaseFailed,
		software.TerminalStatusFailed,
		"registry timeout",
	)
	_ = createDockerImagePullOperationRecord(
		t,
		te,
		"srv-2",
		"postgres:16",
		software.OperationPhaseExecuting,
		software.TerminalStatusNone,
		"",
	)

	rec := doDocker(t, te, http.MethodGet, "/api/servers/srv-1/docker/image-pull-operations", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, inProgress.Id) {
		t.Fatalf("expected in-progress operation in response: %s", body)
	}
	if strings.Contains(body, completed.Id) || strings.Contains(body, failed.Id) {
		t.Fatalf("expected default in_progress filter to exclude terminal operations: %s", body)
	}

	rec = doDocker(t, te, http.MethodGet, "/api/servers/srv-1/docker/image-pull-operations?status=all", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for status=all, got %d: %s", rec.Code, rec.Body.String())
	}
	body = rec.Body.String()
	for _, id := range []string{inProgress.Id, completed.Id, failed.Id} {
		if !strings.Contains(body, id) {
			t.Fatalf("expected %s in status=all response: %s", id, body)
		}
	}

	rec = doDocker(t, te, http.MethodGet, "/api/servers/srv-1/docker/image-pull-operations?status=failed", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for status=failed, got %d: %s", rec.Code, rec.Body.String())
	}
	body = rec.Body.String()
	if !strings.Contains(body, failed.Id) || strings.Contains(body, inProgress.Id) || strings.Contains(body, completed.Id) {
		t.Fatalf("expected failed-only response, got: %s", body)
	}
}

func TestDockerImagePullOperationsListValidation(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := doDocker(t, te, http.MethodGet, "/api/servers/local/docker/image-pull-operations?limit=0", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid limit, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = doDocker(t, te, http.MethodGet, "/api/servers/local/docker/image-pull-operations?status=unknown", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid status, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDockerImagePullOperationDeleteRemovesTerminalRecord(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := createDockerImagePullOperationRecord(
		t,
		te,
		"srv-1",
		"redis:7",
		software.OperationPhaseSucceeded,
		software.TerminalStatusSuccess,
		"",
	)

	rec := doDocker(t, te, http.MethodDelete, "/api/servers/srv-1/docker/image-pull-operations/"+record.Id, "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := te.app.FindRecordById(collections.DockerImagePullOperations, record.Id); err == nil {
		t.Fatalf("expected deleted record %s to be gone", record.Id)
	}
}

func TestDockerImagePullOperationDeleteRejectsActiveRecord(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := createDockerImagePullOperationRecord(
		t,
		te,
		"srv-1",
		"nginx:latest",
		software.OperationPhaseExecuting,
		software.TerminalStatusNone,
		"",
	)

	rec := doDocker(t, te, http.MethodDelete, "/api/servers/srv-1/docker/image-pull-operations/"+record.Id, "", te.token)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDockerImagePullOperationsClearDeletesOnlyTerminalRecords(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	active := createDockerImagePullOperationRecord(
		t,
		te,
		"srv-1",
		"nginx:latest",
		software.OperationPhaseExecuting,
		software.TerminalStatusNone,
		"",
	)
	completed := createDockerImagePullOperationRecord(
		t,
		te,
		"srv-1",
		"redis:7",
		software.OperationPhaseSucceeded,
		software.TerminalStatusSuccess,
		"",
	)
	failed := createDockerImagePullOperationRecord(
		t,
		te,
		"srv-1",
		"busybox:latest",
		software.OperationPhaseFailed,
		software.TerminalStatusFailed,
		"timeout",
	)
	_ = createDockerImagePullOperationRecord(
		t,
		te,
		"srv-2",
		"postgres:16",
		software.OperationPhaseSucceeded,
		software.TerminalStatusSuccess,
		"",
	)

	rec := doDocker(t, te, http.MethodDelete, "/api/servers/srv-1/docker/image-pull-operations", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["deleted"] != float64(2) {
		t.Fatalf("expected 2 deleted records, got %v", body["deleted"])
	}
	if _, err := te.app.FindRecordById(collections.DockerImagePullOperations, active.Id); err != nil {
		t.Fatalf("expected active record to remain, got %v", err)
	}
	if _, err := te.app.FindRecordById(collections.DockerImagePullOperations, completed.Id); err == nil {
		t.Fatalf("expected completed record to be deleted")
	}
	if _, err := te.app.FindRecordById(collections.DockerImagePullOperations, failed.Id); err == nil {
		t.Fatalf("expected failed record to be deleted")
	}
}

func TestDockerImagePullOperationCancelMarksAcceptedRecordCancelled(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := createDockerImagePullOperationRecord(
		t,
		te,
		"srv-1",
		"redis:7",
		software.OperationPhaseAccepted,
		software.TerminalStatusNone,
		"",
	)

	rec := doDocker(t, te, http.MethodPost, "/api/servers/srv-1/docker/image-pull-operations/"+record.Id+"/cancel", "", te.token)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	updated, err := te.app.FindRecordById(collections.DockerImagePullOperations, record.Id)
	if err != nil {
		t.Fatal(err)
	}
	if updated.GetString("terminal_status") != string(software.TerminalStatusCancelled) {
		t.Fatalf("expected cancelled terminal status, got %q", updated.GetString("terminal_status"))
	}
	if updated.GetString("phase") != string(software.OperationPhaseFailed) {
		t.Fatalf("expected failed phase after cancellation, got %q", updated.GetString("phase"))
	}
}

func TestDockerImagePullOperationCancelRejectsExecutingRecord(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := createDockerImagePullOperationRecord(
		t,
		te,
		"srv-1",
		"redis:7",
		software.OperationPhaseExecuting,
		software.TerminalStatusNone,
		"",
	)

	rec := doDocker(t, te, http.MethodPost, "/api/servers/srv-1/docker/image-pull-operations/"+record.Id+"/cancel", "", te.token)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDockerRemoteTunnelOfflineReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	server := createTunnelServerRecord(t, te, "edge-offline")
	server.Set("tunnel_status", "offline")
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodGet, "/api/servers/"+server.Id+"/docker/containers", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for offline tunnel server, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected generic server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "offline") {
		t.Fatalf("expected offline tunnel error, got %q", errorText)
	}
}

func TestDockerTargetsExcludeDisabledServers(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	enabled := createServerRecord(t, te, "direct-enabled", "127.0.0.1", 22, "root", "password")
	disabled := createServerRecord(t, te, "direct-disabled", "127.0.0.2", 22, "root", "password")
	disabled.Set("is_enabled", false)
	if err := te.app.Save(disabled); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodGet, "/api/servers/docker-targets", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for docker targets, got %d: %s", rec.Code, rec.Body.String())
	}

	items := parseJSONArray(t, rec)
	if len(items) != 1 {
		t.Fatalf("expected only enabled server in docker targets, got %d entries", len(items))
	}
	if items[0]["id"] != enabled.Id {
		t.Fatalf("expected enabled server only, got %v", items[0]["id"])
	}
}

func TestLoadDockerProxyEnvIncludesCredentials(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()
	ensureDockerSecretRuntime(t)
	secret := createDockerRouteSecret(t, te, "secret")
	httpConnector := createDockerRouteConnector(t, te, connectors.SaveInput{
		Name:         "HTTP Proxy",
		Kind:         connectors.KindProxy,
		TemplateID:   "generic-proxy",
		Endpoint:     "http://proxy.example.com:3128",
		AuthScheme:   connectors.AuthSchemeBasic,
		CredentialID: secret.Id,
		Config: map[string]any{
			"protocol":  "http",
			"username":  "alice",
			"no_proxy":  "localhost,127.0.0.1,.svc",
			"auth_mode": "username_password",
		},
	})
	httpsConnector := createDockerRouteConnector(t, te, connectors.SaveInput{
		Name:         "HTTPS Proxy",
		Kind:         connectors.KindProxy,
		TemplateID:   "generic-proxy",
		Endpoint:     "https://secure-proxy.example.com:4443",
		AuthScheme:   connectors.AuthSchemeBasic,
		CredentialID: secret.Id,
		Config: map[string]any{
			"protocol":  "https",
			"username":  "alice",
			"auth_mode": "username_password",
		},
	})

	if err := sysconfig.SetGroup(te.app, "proxy", "network", map[string]any{
		"enabled":           true,
		"socks5ConnectorId": "",
		"httpConnectorId":   httpConnector.Id,
		"httpsConnectorId":  httpsConnector.Id,
	}); err != nil {
		t.Fatal(err)
	}

	env, err := egress.ProxyEnv(te.app)
	if err != nil {
		t.Fatal(err)
	}
	if env["HTTP_PROXY"] != "http://alice:secret@proxy.example.com:3128" {
		t.Fatalf("unexpected HTTP_PROXY: %q", env["HTTP_PROXY"])
	}
	if env["HTTPS_PROXY"] != "https://alice:secret@secure-proxy.example.com:4443" {
		t.Fatalf("unexpected HTTPS_PROXY: %q", env["HTTPS_PROXY"])
	}
	if env["NO_PROXY"] != "localhost,127.0.0.1,.svc" {
		t.Fatalf("unexpected NO_PROXY: %q", env["NO_PROXY"])
	}
	if env["http_proxy"] != env["HTTP_PROXY"] || env["https_proxy"] != env["HTTPS_PROXY"] {
		t.Fatalf("expected lowercase proxy env aliases to mirror uppercase values: %#v", env)
	}
}

func TestLoadDockerProxyEnvPrefersSocks5WhenConfigured(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	ensureDockerSecretRuntime(t)
	secret := createDockerRouteSecret(t, te, "secret")
	socks5Connector := createDockerRouteConnector(t, te, connectors.SaveInput{
		Name:         "SOCKS5 Proxy",
		Kind:         connectors.KindProxy,
		TemplateID:   "socks5-proxy",
		Endpoint:     "socks5://socks.example.com:1080",
		AuthScheme:   connectors.AuthSchemeBasic,
		CredentialID: secret.Id,
		Config: map[string]any{
			"protocol":  "socks5",
			"username":  "alice",
			"no_proxy":  "localhost,.svc",
			"auth_mode": "username_password",
		},
	})
	httpConnector := createDockerRouteConnector(t, te, connectors.SaveInput{
		Name:       "HTTP Proxy",
		Kind:       connectors.KindProxy,
		TemplateID: "http-proxy",
		Endpoint:   "http://proxy.example.com:3128",
		Config:     map[string]any{"protocol": "http"},
	})

	if err := sysconfig.SetGroup(te.app, "proxy", "network", map[string]any{
		"enabled":           true,
		"socks5ConnectorId": socks5Connector.Id,
		"httpConnectorId":   httpConnector.Id,
		"httpsConnectorId":  "",
	}); err != nil {
		t.Fatal(err)
	}

	env, err := egress.ProxyEnv(te.app)
	if err != nil {
		t.Fatal(err)
	}
	want := "socks5://alice:secret@socks.example.com:1080"
	if env["ALL_PROXY"] != want {
		t.Fatalf("unexpected ALL_PROXY: %q", env["ALL_PROXY"])
	}
	if env["HTTP_PROXY"] != want || env["HTTPS_PROXY"] != want {
		t.Fatalf("expected HTTP/HTTPS proxy env to use SOCKS5, got %#v", env)
	}
	if env["NO_PROXY"] != "localhost,.svc" {
		t.Fatalf("unexpected NO_PROXY: %q", env["NO_PROXY"])
	}
}

func TestProxyURLWithCredentialsPreservesExistingUserInfo(t *testing.T) {
	got := proxyURLWithCredentials("http://bob:existing@proxy.example.com:8080", "alice", "secret")
	if got != "http://bob:existing@proxy.example.com:8080" {
		t.Fatalf("expected existing user info to be preserved, got %q", got)
	}
}

func TestDockerRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodGet, "/api/servers/"+server.Id+"/docker/containers", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct server with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerTargetsIncludeOfflineDirectServerWithResolvedCredential(t *testing.T) {
	ensureDockerSecretRuntime(t)
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerRouteSecret(t, te, "test-password")
	server := createServerRecord(t, te, "direct-offline", "127.0.0.1", 1, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodGet, "/api/servers/docker-targets", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for docker targets, got %d: %s", rec.Code, rec.Body.String())
	}

	items := parseJSONArray(t, rec)
	byID := make(map[string]map[string]any, len(items))
	for _, item := range items {
		id, _ := item["id"].(string)
		byID[id] = item
	}

	entry, ok := byID[server.Id]
	if !ok {
		t.Fatalf("expected direct remote server in docker target listing")
	}
	if entry["status"] != "offline" {
		t.Fatalf("expected direct server offline, got %v", entry["status"])
	}
	if entry["host"] != "127.0.0.1" {
		t.Fatalf("expected direct server host preserved, got %v", entry["host"])
	}
	reason, _ := entry["reason"].(string)
	if strings.TrimSpace(reason) == "" {
		t.Fatalf("expected offline reason for direct server")
	}
	if strings.Contains(reason, "credential resolve failed") {
		t.Fatalf("expected resolved credential to reach network ping stage, got %q", reason)
	}
	if entry["label"] != "direct-offline" {
		t.Fatalf("expected direct server label, got %v", entry["label"])
	}
}

func TestDockerComposeUpRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-compose-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodPost, "/api/servers/"+server.Id+"/docker/compose/up", `{"projectDir":"/srv/apps/demo"}`, te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote compose up with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
	entries := dockerAuditEntriesByAction(t, te, "app.deploy")
	if len(entries) != 0 {
		t.Fatalf("expected no app.deploy audit entries when server resolution fails, got %d", len(entries))
	}
}

func TestDockerComposeDownRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-compose-down-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodPost, "/api/servers/"+server.Id+"/docker/compose/down", `{"projectDir":"/srv/apps/demo","removeVolumes":true}`, te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote compose down with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
	entries := dockerAuditEntriesByAction(t, te, "app.delete")
	if len(entries) != 0 {
		t.Fatalf("expected no app.delete audit entries when server resolution fails, got %d", len(entries))
	}
}

func TestDockerExecRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-exec-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodPost, "/api/servers/"+server.Id+"/docker/exec", `{"command":"ps -a"}`, te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote docker exec with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerComposeStartRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-compose-start-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodPost, "/api/servers/"+server.Id+"/docker/compose/start", `{"projectDir":"/srv/apps/demo"}`, te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote compose start with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
	entries := dockerAuditEntriesByAction(t, te, "app.start")
	if len(entries) != 0 {
		t.Fatalf("expected no app.start audit entries when server resolution fails, got %d", len(entries))
	}
}

func TestDockerComposeStopRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-compose-stop-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodPost, "/api/servers/"+server.Id+"/docker/compose/stop", `{"projectDir":"/srv/apps/demo"}`, te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote compose stop with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
	entries := dockerAuditEntriesByAction(t, te, "app.stop")
	if len(entries) != 0 {
		t.Fatalf("expected no app.stop audit entries when server resolution fails, got %d", len(entries))
	}
}

func TestDockerComposeRestartRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-compose-restart-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodPost, "/api/servers/"+server.Id+"/docker/compose/restart", `{"projectDir":"/srv/apps/demo"}`, te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote compose restart with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
	entries := dockerAuditEntriesByAction(t, te, "app.restart")
	if len(entries) != 0 {
		t.Fatalf("expected no app.restart audit entries when server resolution fails, got %d", len(entries))
	}
}

func TestDockerComposePullRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-compose-pull-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodPost, "/api/servers/"+server.Id+"/docker/compose/pull", `{"projectDir":"/srv/apps/demo"}`, te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote compose pull with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
	entries := dockerAuditEntriesByAction(t, te, "app.pull")
	if len(entries) != 0 {
		t.Fatalf("expected no app.pull audit entries when server resolution fails, got %d", len(entries))
	}
}

func TestDockerComposeLogsRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-compose-logs-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodGet, "/api/servers/"+server.Id+"/docker/compose/logs?projectDir=/srv/apps/demo&tail=25", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote compose logs with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerContainerLogsRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-container-logs-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodGet, "/api/servers/"+server.Id+"/docker/containers/ctr-1/logs?tail=25", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote container logs with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerContainerStatsRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-container-stats-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodGet, "/api/servers/"+server.Id+"/docker/containers/stats", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote container stats with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerContainerInspectRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-container-inspect-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodGet, "/api/servers/"+server.Id+"/docker/containers/ctr-1", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote container inspect with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerImageInspectRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-image-inspect-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodGet, "/api/servers/"+server.Id+"/docker/images/img-1/inspect", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote image inspect with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerNetworkInspectRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-network-inspect-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodGet, "/api/servers/"+server.Id+"/docker/networks/net-1/inspect", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote network inspect with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerVolumeInspectRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-volume-inspect-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodGet, "/api/servers/"+server.Id+"/docker/volumes/vol-1/inspect", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote volume inspect with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerContainerStartRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-container-start-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodPost, "/api/servers/"+server.Id+"/docker/containers/ctr-1/start", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote container start with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerContainerStopRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-container-stop-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodPost, "/api/servers/"+server.Id+"/docker/containers/ctr-1/stop", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote container stop with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerContainerRestartRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-container-restart-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodPost, "/api/servers/"+server.Id+"/docker/containers/ctr-1/restart", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote container restart with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerContainerRemoveRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-container-remove-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodDelete, "/api/servers/"+server.Id+"/docker/containers/ctr-1?force=true", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote container remove with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerImageRemoveRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-image-remove-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodDelete, "/api/servers/"+server.Id+"/docker/images/sha256:img-1", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote image remove with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerImagePullRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-image-pull-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodPost, "/api/servers/"+server.Id+"/docker/images/pull", `{"name":"nginx:latest"}`, te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote image pull with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerImagePullDeduplicatesInFlightOperation(t *testing.T) {
	t.Skip("legacy local-target fixture; rewrite with managed server fixture")
	te := newTestEnv(t)
	defer te.cleanup()

	col, err := te.app.FindCollectionByNameOrId(collections.DockerImagePullOperations)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(col)
	record.Set("server_id", "local")
	record.Set("image_name", "nginx:latest")
	record.Set("normalized_name", worker.NormalizeDockerImageReference("nginx:latest"))
	record.Set("phase", string(software.OperationPhaseExecuting))
	record.Set("terminal_status", string(software.TerminalStatusNone))
	record.Set("output", "Starting docker pull nginx:latest...")
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/images/pull", `{"name":"nginx:latest"}`, te.token)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202 when deduplicating image pull, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["operation_id"] != record.Id {
		t.Fatalf("expected existing operation id %q, got %v", record.Id, body["operation_id"])
	}
	if body["deduplicated"] != true {
		t.Fatalf("expected deduplicated=true, got %v", body["deduplicated"])
	}
}

func TestDockerImagePruneRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-image-prune-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodPost, "/api/servers/"+server.Id+"/docker/images/prune", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote image prune with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerNetworkRemoveRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-network-remove-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodDelete, "/api/servers/"+server.Id+"/docker/networks/net-1", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote network remove with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerVolumeRemoveRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-volume-remove-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodDelete, "/api/servers/"+server.Id+"/docker/volumes/vol-1", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote volume remove with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerNetworkCreateRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-network-create-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodPost, "/api/servers/"+server.Id+"/docker/networks", `{"name":"app-net"}`, te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote network create with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerImageRegistrySearchRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-registry-search-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodGet, "/api/servers/"+server.Id+"/docker/images/registry/search?q=nginx&limit=25", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote registry search with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerImageRegistryStatusRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-registry-status-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodGet, "/api/servers/"+server.Id+"/docker/images/registry/status", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote registry status with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerVolumePruneRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-volume-prune-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodPost, "/api/servers/"+server.Id+"/docker/volumes/prune", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote volume prune with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerNetworkListRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-network-list-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodGet, "/api/servers/"+server.Id+"/docker/networks", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote network list with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}

func TestDockerVolumeListRemoteDirectBrokenCredentialReturnsBadRequest(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	secret := createDockerBrokenSecret(t, te)
	server := createServerRecord(t, te, "direct-volume-list-broken-credential", "127.0.0.1", 22, "root", "password")
	server.Set("credential", secret.Id)
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodGet, "/api/servers/"+server.Id+"/docker/volumes", "", te.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for direct remote volume list with broken credential, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["message"] != "server not found" {
		t.Fatalf("expected server resolution message, got %v", body["message"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected error data object, got %#v", body["data"])
	}
	errorText, _ := data["error"].(string)
	if !strings.Contains(errorText, "credential resolve failed") {
		t.Fatalf("expected credential resolution error, got %q", errorText)
	}
	if !strings.Contains(errorText, "secret has no payload") {
		t.Fatalf("expected broken credential detail, got %q", errorText)
	}
}
