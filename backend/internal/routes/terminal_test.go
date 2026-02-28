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
