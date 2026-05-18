package routes

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/domain/software"
	"github.com/websoft9/appos/backend/domain/worker"
	"github.com/websoft9/appos/backend/infra/collections"
	"github.com/websoft9/appos/backend/infra/docker"
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

func TestDockerLocalContainerListUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: `{"ID":"ctr-1"}`,
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodGet, "/api/servers/local/docker/containers", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local container list, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["host"] != "stub-local" {
		t.Fatalf("expected host stub-local, got %v", body["host"])
	}
	if body["output"] != `{"ID":"ctr-1"}` {
		t.Fatalf("expected container list output to come from local stub, got %v", body["output"])
	}

	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker ps -a --format json" {
		t.Fatalf("expected local docker container command, got %q", gotCmd)
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

func TestDockerTargetsIncludeLocalAndOfflineTunnelServer(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	server := createTunnelServerRecord(t, te, "edge-offline")
	server.Set("tunnel_status", "offline")
	if err := te.app.Save(server); err != nil {
		t.Fatal(err)
	}

	rec := doDocker(t, te, http.MethodGet, "/api/servers/docker-targets", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for docker targets, got %d: %s", rec.Code, rec.Body.String())
	}

	items := parseJSONArray(t, rec)
	if len(items) != 2 {
		t.Fatalf("expected local and one managed server, got %d entries", len(items))
	}

	byID := make(map[string]map[string]any, len(items))
	for _, item := range items {
		id, _ := item["id"].(string)
		byID[id] = item
	}

	if byID["local"]["status"] != "online" {
		t.Fatalf("expected local target online, got %v", byID["local"]["status"])
	}
	if byID[server.Id]["status"] != "offline" {
		t.Fatalf("expected tunnel server offline, got %v", byID[server.Id]["status"])
	}
	reason, _ := byID[server.Id]["reason"].(string)
	if !strings.Contains(reason, "offline") {
		t.Fatalf("expected offline reason in docker target listing, got %q", reason)
	}
	if byID[server.Id]["host"] != "127.0.0.1" {
		t.Fatalf("expected tunnel server host to remain record host on resolution failure, got %v", byID[server.Id]["host"])
	}
	if byID[server.Id]["label"] != "edge-offline" {
		t.Fatalf("expected managed server label, got %v", byID[server.Id]["label"])
	}
}

func TestDockerLocalContainerMetadataUsesSingleInspectCall(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host: "stub-local",
		output: `[
			{"Id":"ctr-1","Created":"2026-05-17T10:00:00Z","Config":{"Labels":{"com.docker.compose.project":"demo"}},"Mounts":[{"Name":"data","Type":"volume"},{"Name":"cache","Type":"volume"},{"Name":"cache","Type":"volume"},{"Name":"","Type":"bind"}]},
			{"Id":"ctr-2","Created":"2026-05-17T10:05:00Z","Config":{"Labels":{}},"Mounts":[]}
		]`,
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/containers/metadata", `{"ids":["ctr-1","ctr-2"]}`, te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local container metadata, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	items, ok := body["items"].(map[string]any)
	if !ok {
		t.Fatalf("expected items object, got %#v", body["items"])
	}
	first, ok := items["ctr-1"].(map[string]any)
	if !ok {
		t.Fatalf("expected ctr-1 metadata, got %#v", items["ctr-1"])
	}
	if first["compose_project"] != "demo" {
		t.Fatalf("expected compose project demo, got %v", first["compose_project"])
	}
	volumes, ok := first["volume_names"].([]any)
	if !ok || len(volumes) != 2 || volumes[0] != "data" || volumes[1] != "cache" {
		t.Fatalf("unexpected volume names: %#v", first["volume_names"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker inspect ctr-1 ctr-2" {
		t.Fatalf("expected single inspect-many command, got %q", gotCmd)
	}
}

func TestDockerLocalContainerMetadataMapsRequestedShortIDs(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host: "stub-local",
		output: `[
			{"Id":"ctr-1-full-id","Created":"2026-05-17T10:00:00Z","Config":{"Labels":{"com.docker.compose.project":"demo"}},"Mounts":[{"Name":"data","Type":"volume"}]},
			{"Id":"ctr-2-full-id","Created":"2026-05-17T10:05:00Z","Config":{"Labels":{}},"Mounts":[]}
		]`,
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/containers/metadata", `{"ids":["ctr-1","ctr-2"]}`, te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local container metadata, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	items, ok := body["items"].(map[string]any)
	if !ok {
		t.Fatalf("expected items object, got %#v", body["items"])
	}
	shortFirst, ok := items["ctr-1"].(map[string]any)
	if !ok {
		t.Fatalf("expected short-id ctr-1 metadata, got %#v", items["ctr-1"])
	}
	if shortFirst["compose_project"] != "demo" {
		t.Fatalf("expected compose project demo on short id, got %v", shortFirst["compose_project"])
	}
	if _, ok := items["ctr-1-full-id"].(map[string]any); !ok {
		t.Fatalf("expected full-id alias metadata to remain present, got %#v", items["ctr-1-full-id"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker inspect ctr-1 ctr-2" {
		t.Fatalf("expected single inspect-many command, got %q", gotCmd)
	}
}

func TestDockerLocalComposeMetadataGroupsContainersWithSingleInspectCall(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host: "stub-local",
		outputs: map[string]string{
			"docker ps -a --format json": strings.Join([]string{
				`{"ID":"ctr-1","Names":"demo-web-1","Image":"nginx:alpine","State":"running","Status":"Up 2 hours"}`,
				`{"ID":"ctr-2","Names":"demo-worker-1","Image":"busybox:latest","State":"exited","Status":"Exited (0) 1 minute ago"}`,
				`{"ID":"ctr-3","Names":"other-db-1","Image":"postgres:16","State":"running","Status":"Up 1 hour"}`,
			}, "\n"),
			"docker inspect ctr-1 ctr-2 ctr-3": `[
				{"Id":"ctr-1-full-id","Created":"2026-05-17T10:00:00Z","Config":{"Labels":{"com.docker.compose.project":"demo"}},"Mounts":[]},
				{"Id":"ctr-2-full-id","Created":"2026-05-17T10:05:00Z","Config":{"Labels":{"com.docker.compose.project":"demo"}},"Mounts":[]},
				{"Id":"ctr-3-full-id","Created":"2026-05-17T10:10:00Z","Config":{"Labels":{"com.docker.compose.project":"other"}},"Mounts":[]}
			]`,
		},
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/compose/metadata", `{"projects":["demo","missing"]}`, te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local compose metadata, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	items, ok := body["items"].(map[string]any)
	if !ok {
		t.Fatalf("expected items object, got %#v", body["items"])
	}
	demo, ok := items["demo"].(map[string]any)
	if !ok {
		t.Fatalf("expected demo metadata, got %#v", items["demo"])
	}
	containers, ok := demo["containers"].([]any)
	if !ok || len(containers) != 2 {
		t.Fatalf("expected two demo containers, got %#v", demo["containers"])
	}
	first, ok := containers[0].(map[string]any)
	if !ok || first["name"] != "demo-web-1" || first["state"] != "running" {
		t.Fatalf("unexpected first demo container: %#v", containers[0])
	}
	missing, ok := items["missing"].(map[string]any)
	if !ok {
		t.Fatalf("expected missing project metadata, got %#v", items["missing"])
	}
	missingContainers, ok := missing["containers"].([]any)
	if !ok || len(missingContainers) != 0 {
		t.Fatalf("expected empty missing containers, got %#v", missing["containers"])
	}

	gotCommands := make([]string, 0, len(stub.allCmds))
	for _, cmd := range stub.allCmds {
		gotCommands = append(gotCommands, strings.Join(cmd, " "))
	}
	wantCommands := []string{"docker ps -a --format json", "docker inspect ctr-1 ctr-2 ctr-3"}
	if strings.Join(gotCommands, "|") != strings.Join(wantCommands, "|") {
		t.Fatalf("unexpected docker commands: got %#v want %#v", gotCommands, wantCommands)
	}
}

func TestLoadDockerProxyEnvIncludesCredentials(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	if err := sysconfig.SetGroup(te.app, "proxy", "network", map[string]any{
		"httpProxy":  "http://proxy.example.com:3128",
		"httpsProxy": "https://secure-proxy.example.com:4443",
		"noProxy":    "localhost,127.0.0.1,.svc",
		"username":   "alice",
		"password":   "secret",
	}); err != nil {
		t.Fatal(err)
	}

	env := loadDockerProxyEnv(te.app)
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

func TestDockerComposeUpLocalUsesLocalClientAndWritesAudit(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "compose up ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/compose/up", `{"projectDir":"/srv/apps/demo"}`, te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local compose up, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "compose up ok" {
		t.Fatalf("expected compose up output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker compose -f /srv/apps/demo/docker-compose.yml up -d" {
		t.Fatalf("expected compose up command, got %q", gotCmd)
	}

	entries := dockerAuditEntriesByAction(t, te, "app.deploy")
	if len(entries) != 1 {
		t.Fatalf("expected one app.deploy audit entry, got %d", len(entries))
	}
	if entries[0].GetString("resource_id") != "/srv/apps/demo" {
		t.Fatalf("expected audit resource_id /srv/apps/demo, got %q", entries[0].GetString("resource_id"))
	}
	if entries[0].GetString("status") != "success" {
		t.Fatalf("expected successful compose up audit entry, got %q", entries[0].GetString("status"))
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

func TestDockerComposeDownLocalWithRemoveVolumesUsesLocalClientAndWritesAudit(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "compose down ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/compose/down", `{"projectDir":"/srv/apps/demo","removeVolumes":true}`, te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local compose down, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "compose down ok" {
		t.Fatalf("expected compose down output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker compose -f /srv/apps/demo/docker-compose.yml down -v" {
		t.Fatalf("expected compose down command with volumes removal, got %q", gotCmd)
	}

	entries := dockerAuditEntriesByAction(t, te, "app.delete")
	if len(entries) != 1 {
		t.Fatalf("expected one app.delete audit entry, got %d", len(entries))
	}
	if entries[0].GetString("resource_id") != "/srv/apps/demo" {
		t.Fatalf("expected audit resource_id /srv/apps/demo, got %q", entries[0].GetString("resource_id"))
	}
	if entries[0].GetString("status") != "success" {
		t.Fatalf("expected successful compose down audit entry, got %q", entries[0].GetString("status"))
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

func TestDockerExecLocalParsesCommandAndUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "exec ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/exec", `{"command":"ps --format \"{{.ID}} {{.Names}}\""}`, te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local docker exec, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "exec ok" {
		t.Fatalf("expected docker exec output from local stub, got %v", body["output"])
	}
	if body["host"] != "stub-local" {
		t.Fatalf("expected host stub-local, got %v", body["host"])
	}
	gotCmd := strings.Join(stub.lastCmd, "|")
	if gotCmd != "docker|ps|--format|{{.ID}} {{.Names}}" {
		t.Fatalf("expected parsed docker exec args, got %q", gotCmd)
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

func TestDockerComposeStartLocalUsesLocalClientAndWritesAudit(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "compose start ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/compose/start", `{"projectDir":"/srv/apps/demo"}`, te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local compose start, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "compose start ok" {
		t.Fatalf("expected compose start output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker compose -f /srv/apps/demo/docker-compose.yml start" {
		t.Fatalf("expected compose start command, got %q", gotCmd)
	}

	entries := dockerAuditEntriesByAction(t, te, "app.start")
	if len(entries) != 1 {
		t.Fatalf("expected one app.start audit entry, got %d", len(entries))
	}
	if entries[0].GetString("resource_id") != "/srv/apps/demo" {
		t.Fatalf("expected audit resource_id /srv/apps/demo, got %q", entries[0].GetString("resource_id"))
	}
	if entries[0].GetString("status") != "success" {
		t.Fatalf("expected successful compose start audit entry, got %q", entries[0].GetString("status"))
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

func TestDockerComposeStopLocalUsesLocalClientAndWritesAudit(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "compose stop ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/compose/stop", `{"projectDir":"/srv/apps/demo"}`, te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local compose stop, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "compose stop ok" {
		t.Fatalf("expected compose stop output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker compose -f /srv/apps/demo/docker-compose.yml stop" {
		t.Fatalf("expected compose stop command, got %q", gotCmd)
	}

	entries := dockerAuditEntriesByAction(t, te, "app.stop")
	if len(entries) != 1 {
		t.Fatalf("expected one app.stop audit entry, got %d", len(entries))
	}
	if entries[0].GetString("resource_id") != "/srv/apps/demo" {
		t.Fatalf("expected audit resource_id /srv/apps/demo, got %q", entries[0].GetString("resource_id"))
	}
	if entries[0].GetString("status") != "success" {
		t.Fatalf("expected successful compose stop audit entry, got %q", entries[0].GetString("status"))
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

func TestDockerComposeRestartLocalUsesLocalClientAndWritesAudit(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "compose restart ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/compose/restart", `{"projectDir":"/srv/apps/demo"}`, te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local compose restart, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "compose restart ok" {
		t.Fatalf("expected compose restart output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker compose -f /srv/apps/demo/docker-compose.yml restart" {
		t.Fatalf("expected compose restart command, got %q", gotCmd)
	}

	entries := dockerAuditEntriesByAction(t, te, "app.restart")
	if len(entries) != 1 {
		t.Fatalf("expected one app.restart audit entry, got %d", len(entries))
	}
	if entries[0].GetString("resource_id") != "/srv/apps/demo" {
		t.Fatalf("expected audit resource_id /srv/apps/demo, got %q", entries[0].GetString("resource_id"))
	}
	if entries[0].GetString("status") != "success" {
		t.Fatalf("expected successful compose restart audit entry, got %q", entries[0].GetString("status"))
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

func TestDockerComposePullLocalUsesLocalClientAndWritesAudit(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "compose pull ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/compose/pull", `{"projectDir":"/srv/apps/demo"}`, te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local compose pull, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "compose pull ok" {
		t.Fatalf("expected compose pull output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker compose -f /srv/apps/demo/docker-compose.yml pull" {
		t.Fatalf("expected compose pull command, got %q", gotCmd)
	}

	entries := dockerAuditEntriesByAction(t, te, "app.pull")
	if len(entries) != 1 {
		t.Fatalf("expected one app.pull audit entry, got %d", len(entries))
	}
	if entries[0].GetString("resource_id") != "/srv/apps/demo" {
		t.Fatalf("expected audit resource_id /srv/apps/demo, got %q", entries[0].GetString("resource_id"))
	}
	if entries[0].GetString("status") != "success" {
		t.Fatalf("expected successful compose pull audit entry, got %q", entries[0].GetString("status"))
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

func TestDockerComposeLogsLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "compose logs ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodGet, "/api/servers/local/docker/compose/logs?projectDir=/srv/apps/demo&tail=25", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local compose logs, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "compose logs ok" {
		t.Fatalf("expected compose logs output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker compose -f /srv/apps/demo/docker-compose.yml logs --tail 25" {
		t.Fatalf("expected compose logs command, got %q", gotCmd)
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

func TestDockerComposePsLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: `[{"Name":"demo-web-1","Service":"web","State":"running"}]`,
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodGet, "/api/servers/local/docker/compose/ps?projectDir=/srv/apps/demo&projectName=demo", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local compose ps, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != `[{"Name":"demo-web-1","Service":"web","State":"running"}]` {
		t.Fatalf("expected compose ps output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker compose -p demo -f /srv/apps/demo/docker-compose.yml ps --format json" {
		t.Fatalf("expected compose ps command, got %q", gotCmd)
	}
}

func TestDockerContainerLogsLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "container logs ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodGet, "/api/servers/local/docker/containers/ctr-1/logs?tail=25", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local container logs, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "container logs ok" {
		t.Fatalf("expected container logs output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker logs --tail 25 ctr-1" {
		t.Fatalf("expected container logs command, got %q", gotCmd)
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

func TestDockerContainerStatsLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "container stats ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodGet, "/api/servers/local/docker/containers/stats", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local container stats, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "container stats ok" {
		t.Fatalf("expected container stats output from local stub, got %v", body["output"])
	}
	if body["host"] != "stub-local" {
		t.Fatalf("expected host stub-local, got %v", body["host"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker stats --no-stream --format json" {
		t.Fatalf("expected container stats command, got %q", gotCmd)
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

func TestDockerContainerInspectLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "container inspect ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodGet, "/api/servers/local/docker/containers/ctr-1", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local container inspect, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "container inspect ok" {
		t.Fatalf("expected container inspect output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker inspect ctr-1" {
		t.Fatalf("expected container inspect command, got %q", gotCmd)
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

func TestDockerImageInspectLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "image inspect ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodGet, "/api/servers/local/docker/images/img-1/inspect", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local image inspect, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "image inspect ok" {
		t.Fatalf("expected image inspect output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker image inspect img-1" {
		t.Fatalf("expected image inspect command, got %q", gotCmd)
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

func TestDockerNetworkInspectLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "network inspect ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodGet, "/api/servers/local/docker/networks/net-1/inspect", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local network inspect, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "network inspect ok" {
		t.Fatalf("expected network inspect output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker network inspect net-1" {
		t.Fatalf("expected network inspect command, got %q", gotCmd)
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

func TestDockerVolumeInspectLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "volume inspect ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodGet, "/api/servers/local/docker/volumes/vol-1/inspect", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local volume inspect, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "volume inspect ok" {
		t.Fatalf("expected volume inspect output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker volume inspect vol-1" {
		t.Fatalf("expected volume inspect command, got %q", gotCmd)
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

func TestDockerContainerStartLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "container start ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/containers/ctr-1/start", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local container start, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "container start ok" {
		t.Fatalf("expected container start output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker start ctr-1" {
		t.Fatalf("expected container start command, got %q", gotCmd)
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

func TestDockerContainerStopLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "container stop ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/containers/ctr-1/stop", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local container stop, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "container stop ok" {
		t.Fatalf("expected container stop output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker stop ctr-1" {
		t.Fatalf("expected container stop command, got %q", gotCmd)
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

func TestDockerContainerRestartLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "container restart ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/containers/ctr-1/restart", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local container restart, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "container restart ok" {
		t.Fatalf("expected container restart output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker restart ctr-1" {
		t.Fatalf("expected container restart command, got %q", gotCmd)
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

func TestDockerContainerRemoveLocalWithForceUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "container remove ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodDelete, "/api/servers/local/docker/containers/ctr-1?force=true", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local container remove, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "container remove ok" {
		t.Fatalf("expected container remove output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker rm -f ctr-1" {
		t.Fatalf("expected forced container remove command, got %q", gotCmd)
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

func TestDockerImageRemoveLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "image remove ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodDelete, "/api/servers/local/docker/images/sha256:img-1", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local image remove, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "image remove ok" {
		t.Fatalf("expected image remove output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker image rm sha256:img-1" {
		t.Fatalf("expected image remove command, got %q", gotCmd)
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

func XTestDockerImagePullLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "image pull ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/images/pull", `{"name":"nginx:latest"}`, te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local image pull, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "image pull ok" {
		t.Fatalf("expected image pull output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker pull nginx:latest" {
		t.Fatalf("expected image pull command, got %q", gotCmd)
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

func TestDockerImagePullLocalEnqueuesAsyncOperation(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	oldClient := asynqClient
	asynqClient = &asynq.Client{}
	defer func() { asynqClient = oldClient }()

	oldEnqueue := enqueueDockerImagePullTask
	called := false
	enqueueDockerImagePullTask = func(client *asynq.Client, operationID, serverID, imageName, userID, userEmail string) error {
		called = true
		if operationID == "" {
			return errors.New("missing operation id")
		}
		if serverID != "local" {
			return errors.New("unexpected server id")
		}
		if imageName != "nginx:latest" {
			return errors.New("unexpected image name")
		}
		return nil
	}
	defer func() { enqueueDockerImagePullTask = oldEnqueue }()

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/images/pull", `{"name":"nginx:latest"}`, te.token)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202 for async image pull, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["accepted"] != true {
		t.Fatalf("expected accepted=true, got %v", body["accepted"])
	}
	operationID, _ := body["operation_id"].(string)
	if operationID == "" {
		t.Fatal("expected operation_id to be populated")
	}
	if !called {
		t.Fatal("expected image pull task to be enqueued")
	}
	record, err := te.app.FindRecordById(collections.DockerImagePullOperations, operationID)
	if err != nil {
		t.Fatalf("load operation record: %v", err)
	}
	if record.GetString("phase") != string(software.OperationPhaseAccepted) {
		t.Fatalf("expected accepted phase, got %q", record.GetString("phase"))
	}
	if record.GetString("terminal_status") != string(software.TerminalStatusNone) {
		t.Fatalf("expected non-terminal accepted record, got %q", record.GetString("terminal_status"))
	}
}

func TestDockerImagePullDeduplicatesInFlightOperation(t *testing.T) {
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

func TestDockerImagePruneLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "image prune ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/images/prune", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local image prune, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "image prune ok" {
		t.Fatalf("expected image prune output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker image prune -f" {
		t.Fatalf("expected image prune command, got %q", gotCmd)
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

func TestDockerNetworkRemoveLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "network remove ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodDelete, "/api/servers/local/docker/networks/net-1", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local network remove, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "network remove ok" {
		t.Fatalf("expected network remove output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker network rm net-1" {
		t.Fatalf("expected network remove command, got %q", gotCmd)
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

func TestDockerVolumeRemoveLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "volume remove ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodDelete, "/api/servers/local/docker/volumes/vol-1", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local volume remove, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "volume remove ok" {
		t.Fatalf("expected volume remove output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker volume rm vol-1" {
		t.Fatalf("expected volume remove command, got %q", gotCmd)
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

func TestDockerNetworkCreateLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "network create ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/networks", `{"name":"app-net"}`, te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local network create, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "network create ok" {
		t.Fatalf("expected network create output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker network create app-net" {
		t.Fatalf("expected network create command, got %q", gotCmd)
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

func TestDockerImageRegistrySearchLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "registry search ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodGet, "/api/servers/local/docker/images/registry/search?q=nginx&limit=25", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local registry search, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "registry search ok" {
		t.Fatalf("expected registry search output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker search nginx --limit 25 --format json" {
		t.Fatalf("expected registry search command, got %q", gotCmd)
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

func TestDockerImageRegistryStatusLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "pull ok",
		errors: map[string]error{
			"docker image inspect hello-world:latest": errors.New("not found"),
		},
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodGet, "/api/servers/local/docker/images/registry/status", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local registry status, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["available"] != true {
		t.Fatalf("expected registry status available=true, got %v", body["available"])
	}
	if body["registry"] != "Docker Hub" {
		t.Fatalf("expected Docker Hub registry label, got %v", body["registry"])
	}
	if len(stub.allCmds) != 3 {
		t.Fatalf("expected three registry status commands, got %d", len(stub.allCmds))
	}
	gotHistory := []string{
		strings.Join(stub.allCmds[0], " "),
		strings.Join(stub.allCmds[1], " "),
		strings.Join(stub.allCmds[2], " "),
	}
	wantHistory := []string{
		"docker image inspect hello-world:latest",
		"docker pull --quiet hello-world:latest",
		"docker image rm hello-world:latest",
	}
	for index, want := range wantHistory {
		if gotHistory[index] != want {
			t.Fatalf("expected registry status command %d to be %q, got %q", index, want, gotHistory[index])
		}
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

func TestDockerVolumePruneLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "volume prune ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodPost, "/api/servers/local/docker/volumes/prune", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local volume prune, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "volume prune ok" {
		t.Fatalf("expected volume prune output from local stub, got %v", body["output"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker volume prune -f" {
		t.Fatalf("expected volume prune command, got %q", gotCmd)
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

func TestDockerNetworkListLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "network list ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodGet, "/api/servers/local/docker/networks", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local network list, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "network list ok" {
		t.Fatalf("expected network list output from local stub, got %v", body["output"])
	}
	if body["host"] != "stub-local" {
		t.Fatalf("expected host stub-local, got %v", body["host"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker network ls --format json" {
		t.Fatalf("expected network list command, got %q", gotCmd)
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

func TestDockerVolumeListLocalUsesLocalClient(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	stub := &stubDockerExecutor{
		host:   "stub-local",
		output: "volume list ok",
	}
	originalLocalClient := localDockerClient
	localDockerClient = docker.New(stub)
	t.Cleanup(func() {
		localDockerClient = originalLocalClient
	})

	rec := doDocker(t, te, http.MethodGet, "/api/servers/local/docker/volumes", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for local volume list, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseJSON(t, rec)
	if body["output"] != "volume list ok" {
		t.Fatalf("expected volume list output from local stub, got %v", body["output"])
	}
	if body["host"] != "stub-local" {
		t.Fatalf("expected host stub-local, got %v", body["host"])
	}
	gotCmd := strings.Join(stub.lastCmd, " ")
	if gotCmd != "docker volume ls --format json" {
		t.Fatalf("expected volume list command, got %q", gotCmd)
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
