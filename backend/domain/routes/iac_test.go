package routes

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/websoft9/appos/backend/domain/iac"
	"github.com/websoft9/appos/backend/infra/filesvc"
)

func TestIACRoutesCreateMoveAndDownload(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()
	setupIACTestServices(t)

	rec := te.doIAC(t, http.MethodPost, "/api/ext/iac", `{"path":"apps/demo/docker-compose.yml","content":"services:\n"}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create file: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.doIAC(t, http.MethodPost, "/api/ext/iac", `{"path":"apps/target","type":"dir"}`, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create target dir: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.doIAC(t, http.MethodPost, "/api/ext/iac/move", `{"from":"apps/demo/docker-compose.yml","to":"apps/target/docker-compose.yml"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("move file: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = te.doIAC(t, http.MethodGet, "/api/ext/iac/download?path=apps/target/docker-compose.yml", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("download file: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); body != "services:\n" {
		t.Fatalf("unexpected downloaded body: %q", body)
	}
	if disposition := rec.Header().Get("Content-Disposition"); !strings.Contains(disposition, `filename="docker-compose.yml"`) {
		t.Fatalf("unexpected content disposition: %q", disposition)
	}

	rec = te.doIAC(t, http.MethodPost, "/api/ext/iac/move", `{"from":"apps/target/docker-compose.yml","to":"templates/docker-compose.yml"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("cross-root move: expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestIACRoutesUploadAndBlockedExtension(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()
	workspaceBase, _ := setupIACTestServices(t)

	rec := te.doIACMultipart(t, "/api/ext/iac/upload", true, map[string]string{"path": "apps/uploads"}, "file", "notes.txt", []byte("hello upload"))
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload file: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["path"] != "apps/uploads/notes.txt" {
		t.Fatalf("unexpected upload path: %v", body["path"])
	}
	raw, err := os.ReadFile(filepath.Join(workspaceBase, "apps", "uploads", "notes.txt"))
	if err != nil {
		t.Fatalf("read uploaded file: %v", err)
	}
	if string(raw) != "hello upload" {
		t.Fatalf("unexpected uploaded content: %q", string(raw))
	}

	rec = te.doIACMultipart(t, "/api/ext/iac/upload", true, map[string]string{"path": "apps/uploads"}, "file", "blocked.exe", []byte("bad"))
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("blocked extension: expected 415, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(workspaceBase, "apps", "uploads", "blocked.exe")); !os.IsNotExist(err) {
		t.Fatalf("expected blocked upload not to be written, got %v", err)
	}
}

func TestIACRoutesReadWorkspaceAndLibraryContent(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()
	workspaceBase, _ := setupIACTestServices(t)

	mustWriteFile(t, filepath.Join(workspaceBase, "apps", "demo", "docker-compose.yml"), []byte("services:\n  web:\n"))

	rec := te.doIAC(t, http.MethodGet, "/api/ext/iac/content?path=apps/demo/docker-compose.yml", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("read workspace content: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["path"] != "apps/demo/docker-compose.yml" {
		t.Fatalf("unexpected workspace content path: %v", body["path"])
	}
	if body["content"] != "services:\n  web:\n" {
		t.Fatalf("unexpected workspace content: %v", body["content"])
	}

	rec = te.doIAC(t, http.MethodGet, "/api/ext/iac/library/content?path=apps/wordpress/docker-compose.yml", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("read library content: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body = parseJSON(t, rec)
	if body["path"] != "apps/wordpress/docker-compose.yml" {
		t.Fatalf("unexpected library content path: %v", body["path"])
	}
	if body["content"] != "services:\n" {
		t.Fatalf("unexpected library content: %v", body["content"])
	}
}

func TestIACRoutesLibraryCopyAndConflict(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()
	workspaceBase, _ := setupIACTestServices(t)

	rec := te.doIAC(t, http.MethodPost, "/api/ext/iac/library/copy", `{"sourceKey":"wordpress","destKey":"my-wordpress"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("library copy: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["source"] != "apps/wordpress" {
		t.Fatalf("unexpected copy source: %v", body["source"])
	}
	if body["destination"] != "templates/apps/my-wordpress" {
		t.Fatalf("unexpected copy destination: %v", body["destination"])
	}

	raw, err := os.ReadFile(filepath.Join(workspaceBase, "templates", "apps", "my-wordpress", "docker-compose.yml"))
	if err != nil {
		t.Fatalf("read copied library file: %v", err)
	}
	if string(raw) != "services:\n" {
		t.Fatalf("unexpected copied library content: %q", string(raw))
	}

	rec = te.doIAC(t, http.MethodPost, "/api/ext/iac/library/copy", `{"sourceKey":"wordpress","destKey":"my-wordpress"}`, true)
	if rec.Code != http.StatusConflict {
		t.Fatalf("library copy conflict: expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
}

func setupIACTestServices(t *testing.T) (string, string) {
	t.Helper()

	oldWorkspace := iacLocalFiles
	oldLibrary := libraryLocalFiles
	oldService := iacService

	workspaceBase := t.TempDir()
	libraryBase := t.TempDir()
	mustMkdirAll(t, filepath.Join(workspaceBase, "apps"))
	mustMkdirAll(t, filepath.Join(workspaceBase, "templates"))
	mustMkdirAll(t, filepath.Join(workspaceBase, "workflows"))
	mustMkdirAll(t, filepath.Join(libraryBase, "apps", "wordpress"))
	mustWriteFile(t, filepath.Join(libraryBase, "apps", "wordpress", "docker-compose.yml"), []byte("services:\n"))

	workspace, err := filesvc.NewLocal(filesvc.Config{
		Name:         "iac-workspace-test",
		BasePath:     workspaceBase,
		AllowedRoots: iac.WorkspaceRoots(),
	})
	if err != nil {
		t.Fatalf("new workspace service: %v", err)
	}
	library, err := filesvc.NewLocal(filesvc.Config{
		Name:         "iac-library-test",
		BasePath:     libraryBase,
		AllowedRoots: iac.LibraryRoots(),
		ReadOnly:     true,
	})
	if err != nil {
		t.Fatalf("new library service: %v", err)
	}

	iacLocalFiles = workspace
	libraryLocalFiles = library
	iacService = iac.NewService(workspace, library, libraryToWorkspaceCopier{src: library, dst: workspace})

	t.Cleanup(func() {
		iacLocalFiles = oldWorkspace
		libraryLocalFiles = oldLibrary
		iacService = oldService
	})

	return workspaceBase, libraryBase
}

func (te *testEnv) doIAC(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	g := r.Group("/api/ext")
	registerIaCRoutes(g)

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(method, url, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if authenticated {
		req.Header.Set("Authorization", te.token)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func (te *testEnv) doIACMultipart(t *testing.T, url string, authenticated bool, fields map[string]string, fileField string, filename string, data []byte) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	g := r.Group("/api/ext")
	registerIaCRoutes(g)

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range fields {
		if writeErr := writer.WriteField(key, value); writeErr != nil {
			t.Fatal(writeErr)
		}
	}
	part, err := writer.CreateFormFile(fileField, filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, url, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if authenticated {
		req.Header.Set("Authorization", te.token)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func mustMkdirAll(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
}

func mustWriteFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
