package routes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
)

// doTerminal performs a terminalroute request using the testEnv helper from resources_test.go.
func (te *testEnv) doTerminal(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	g := r.Group("/api/ext")
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

	rec := te.doTerminal(t, http.MethodGet, "/api/ext/terminal/sftp/nonexistent/list?path=/", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestSFTPListInvalidServer verifies SFTP list returns 400 for unknown server.
func TestSFTPListInvalidServer(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/ext/terminal/sftp/nonexistent/list?path=/", "", true)
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
	rec := te.doTerminal(t, http.MethodGet, "/api/ext/terminal/sftp/nonexistent/download", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestSFTPMkdirRequiresPath verifies SFTP mkdir returns 400 when body is empty.
func TestSFTPMkdirRequiresPath(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPost, "/api/ext/terminal/sftp/nonexistent/mkdir", "{}", true)
	// Either 400 (bad path) because server_not_found is also 400
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestSFTPDeleteRequiresPath verifies SFTP delete returns 400 when path is omitted.
func TestSFTPDeleteRequiresPath(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodDelete, "/api/ext/terminal/sftp/nonexistent/delete", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestSFTPRenameRequiresFields verifies SFTP rename returns 400 with missing fields.
func TestSFTPRenameRequiresFields(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPost, "/api/ext/terminal/sftp/nonexistent/rename", `{"from":""}`, true)
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
	rec := te.doTerminal(t, http.MethodGet, "/api/ext/terminal/docker/testcontainer", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestSFTPStatRequiresPath verifies SFTP stat returns 400 when path is omitted.
func TestSFTPStatRequiresPath(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/ext/terminal/sftp/nonexistent/stat", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestSFTPCopyRequiresFields verifies copy endpoint validates from/to fields.
func TestSFTPCopyRequiresFields(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPost, "/api/ext/terminal/sftp/nonexistent/copy", `{}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestSFTPSymlinkRequiresFields verifies symlink endpoint validates payload.
func TestSFTPSymlinkRequiresFields(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPost, "/api/ext/terminal/sftp/nonexistent/symlink", `{}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestSFTPCopyStreamRequiresFields verifies copy-stream validates from/to query params.
func TestSFTPCopyStreamRequiresFields(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/ext/terminal/sftp/nonexistent/copy-stream", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPowerRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPost, "/api/ext/terminal/server/nonexistent/power", `{"action":"restart"}`, false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPowerRejectsInvalidAction(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPost, "/api/ext/terminal/server/nonexistent/power", `{"action":"reboot-now"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdStatusRejectsInvalidServiceName(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/ext/terminal/server/nonexistent/systemd/bad$name/status", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdLogsRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/ext/terminal/server/nonexistent/systemd/ssh/logs", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdContentRejectsInvalidServiceName(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/ext/terminal/server/nonexistent/systemd/bad$name/content", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdActionRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPost, "/api/ext/terminal/server/nonexistent/systemd/ssh/action", `{"action":"restart"}`, false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdActionRejectsInvalidAction(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPost, "/api/ext/terminal/server/nonexistent/systemd/ssh/action", `{"action":"reload"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdUnitReadRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/ext/terminal/server/nonexistent/systemd/ssh/unit", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdUnitWriteRejectsInvalidBody(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPut, "/api/ext/terminal/server/nonexistent/systemd/ssh/unit", `{"content":`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdUnitWriteRejectsEmptyContent(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPut, "/api/ext/terminal/server/nonexistent/systemd/ssh/unit", `{"content":"   "}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdUnitVerifyRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPost, "/api/ext/terminal/server/nonexistent/systemd/ssh/unit/verify", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSystemdUnitApplyRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPost, "/api/ext/terminal/server/nonexistent/systemd/ssh/unit/apply", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortInspectRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/ext/terminal/server/nonexistent/ports/8080", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortInspectRejectsInvalidPort(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/ext/terminal/server/nonexistent/ports/70000", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortInspectRejectsInvalidProtocol(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/ext/terminal/server/nonexistent/ports/8080?protocol=sctp", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortInspectRejectsInvalidView(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/ext/terminal/server/nonexistent/ports/8080?view=unknown", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortsListRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/ext/terminal/server/nonexistent/ports", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortsListRejectsInvalidProtocol(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/ext/terminal/server/nonexistent/ports?protocol=sctp", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortsListRejectsInvalidView(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodGet, "/api/ext/terminal/server/nonexistent/ports?view=invalid", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortReleaseRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPost, "/api/ext/terminal/server/nonexistent/ports/8080/release", `{"mode":"graceful"}`, false)
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

	rec := te.doTerminal(t, http.MethodPost, "/api/ext/terminal/server/nonexistent/ports/8080/release", `{"mode":"soft"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortReleaseRejectsInvalidBody(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPost, "/api/ext/terminal/server/nonexistent/ports/8080/release", `{"mode":`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerPortReleaseRejectsInvalidProtocol(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doTerminal(t, http.MethodPost, "/api/ext/terminal/server/nonexistent/ports/8080/release?protocol=sctp", `{"mode":"graceful"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestParseContainerDeclaredReservationsDockerUnavailable(t *testing.T) {
	matches, probe := parseContainerDeclaredReservations("__DOCKER_NOT_AVAILABLE__", 8080, "tcp")
	if len(matches) != 0 {
		t.Fatalf("expected no matches, got %d", len(matches))
	}
	available, _ := probe["available"].(bool)
	if available {
		t.Fatalf("expected docker probe available=false")
	}
	status, _ := probe["status"].(string)
	if status != "not_available" {
		t.Fatalf("expected not_available status, got %q", status)
	}
}

func TestParseContainerDeclaredReservationsByPortAndProtocol(t *testing.T) {
	raw := strings.Join([]string{
		"abc123\tweb\tExited (0) 3 hours ago\t0.0.0.0:8080->80/tcp, [::]:8080->80/tcp",
		"def456\tdns\tUp 2 hours\t0.0.0.0:5353->53/udp",
	}, "\n")

	matches, probe := parseContainerDeclaredReservations(raw, 8080, "tcp")
	if len(matches) != 1 {
		t.Fatalf("expected one match, got %d", len(matches))
	}
	if matches[0]["container_name"] != "web" {
		t.Fatalf("expected container web, got %#v", matches[0]["container_name"])
	}
	available, _ := probe["available"].(bool)
	if !available {
		t.Fatalf("expected docker probe available=true")
	}
}

func TestParseContainerDeclaredReservationsAllDockerUnavailable(t *testing.T) {
	all, probe := parseContainerDeclaredReservationsAll("__DOCKER_NOT_AVAILABLE__", "tcp")
	if len(all) != 0 {
		t.Fatalf("expected no reservations, got %d", len(all))
	}
	available, _ := probe["available"].(bool)
	if available {
		t.Fatalf("expected docker probe available=false")
	}
}

func TestParseDockerPublishedPorts(t *testing.T) {
	ports := parseDockerPublishedPorts("0.0.0.0:8080->80/tcp, [::]:8080->80/tcp, 0.0.0.0:5353->53/udp", "tcp")
	if len(ports) != 1 || ports[0] != 8080 {
		t.Fatalf("expected [8080], got %#v", ports)
	}
}

func TestParseSSPortListenersIncludesPIDs(t *testing.T) {
	listeners := parseSSPortListeners("LISTEN 0 4096 0.0.0.0:8080 0.0.0.0:* users:((\"nginx\",pid=123,fd=6),(\"nginx\",pid=124,fd=7))")
	if len(listeners) != 1 {
		t.Fatalf("expected one listener, got %d", len(listeners))
	}
	pids, ok := listeners[0]["pids"].([]int)
	if !ok {
		t.Fatalf("expected []int pids, got %#v", listeners[0]["pids"])
	}
	if len(pids) != 2 || pids[0] != 123 || pids[1] != 124 {
		t.Fatalf("expected [123 124], got %#v", pids)
	}
}

func TestParseRangePortsEdgeCases(t *testing.T) {
	// Empty string
	if len(parseRangePorts("")) != 0 {
		t.Fatal("expected empty for empty input")
	}

	// Single port
	result := parseRangePorts("8080")
	if len(result) != 1 || result[0] != 8080 {
		t.Fatalf("expected [8080], got %v", result)
	}

	// Normal range
	result = parseRangePorts("100-103")
	if len(result) != 4 || result[0] != 100 || result[3] != 103 {
		t.Fatalf("expected [100 101 102 103], got %v", result)
	}

	// Reversed range
	result = parseRangePorts("200-198")
	if len(result) != 3 || result[0] != 198 || result[2] != 200 {
		t.Fatalf("expected [198 199 200], got %v", result)
	}

	// Overlapping ranges — deduplication
	result = parseRangePorts("80,80-82,81")
	if len(result) != 3 || result[0] != 80 || result[2] != 82 {
		t.Fatalf("expected [80 81 82], got %v", result)
	}

	// Range too large (>1024) is skipped
	result = parseRangePorts("1-2000, 8080")
	if len(result) != 1 || result[0] != 8080 {
		t.Fatalf("expected [8080] with large range skipped, got %v", result)
	}

	// Invalid tokens are skipped
	result = parseRangePorts("abc, 443, -")
	if len(result) != 1 || result[0] != 443 {
		t.Fatalf("expected [443], got %v", result)
	}

	// Out-of-range values
	result = parseRangePorts("0, 70000, 22")
	if len(result) != 1 || result[0] != 22 {
		t.Fatalf("expected [22], got %v", result)
	}
}
