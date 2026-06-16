package routes

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func (te *testEnv) doAssets(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	registerAssetsRoutes(&core.ServeEvent{Router: r})

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, url, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	if authenticated {
		req.Header.Set("Authorization", te.token)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestAssetsListRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doAssets(t, http.MethodGet, "/api/assets", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAssetsCreateListGetDeleteLocalFile(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	payload := `{"name":"Backup Script","description":"Script for backups","kind":"script","storage_kind":"file","language":"shell","content":"echo hello"}`
	rec := te.doAssets(t, http.MethodPost, "/api/assets", payload, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("create asset: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	assetID, _ := created["id"].(string)
	if assetID == "" {
		t.Fatal("expected created asset id")
	}
	wantPath := "backup-script-" + assetID + ".sh"
	if created["path"] != wantPath {
		t.Fatalf("expected path %s, got %v", wantPath, created["path"])
	}
	if created["entrypoint"] != "" {
		t.Fatalf("expected empty entrypoint, got %v", created["entrypoint"])
	}

	rec = te.doAssets(t, http.MethodGet, "/api/assets", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("list assets: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	items := parseJSONArray(t, rec)
	foundCreated := false
	for _, item := range items {
		if item["id"] == assetID {
			foundCreated = true
			break
		}
	}
	if !foundCreated {
		t.Fatalf("expected created asset %s to appear in list", assetID)
	}

	rec = te.doAssets(t, http.MethodGet, "/api/assets/"+assetID, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get asset: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	got := parseJSON(t, rec)
	if got["kind"] != "script" {
		t.Fatalf("expected kind script, got %v", got["kind"])
	}
	if got["language"] != "shell" {
		t.Fatalf("expected language shell, got %v", got["language"])
	}
	if got["description"] != "Script for backups" {
		t.Fatalf("expected description to roundtrip, got %v", got["description"])
	}

	rec = te.doAssets(t, http.MethodGet, "/api/assets/"+assetID+"/content", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("get asset content: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	content := parseJSON(t, rec)
	if content["content"] != "echo hello" {
		t.Fatalf("expected content echo hello, got %v", content["content"])
	}

	rec = te.doAssets(t, http.MethodDelete, "/api/assets/"+assetID, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete asset: expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := te.app.FindRecordById("assets", assetID); err == nil {
		t.Fatal("expected asset record to be deleted")
	}
}

func TestAssetsCreateAndPreviewFolder(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	payload := `{"name":"Ops Skill","kind":"skill","storage_kind":"folder","entrypoint":"SKILL.md","files":{"SKILL.md":"# Skill","scripts/check.sh":"echo ok"}}`
	rec := te.doAssets(t, http.MethodPost, "/api/assets", payload, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("create folder asset: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	assetID := created["id"].(string)

	rec = te.doAssets(t, http.MethodGet, "/api/assets/"+assetID+"/content", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("folder content: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Files []map[string]any `json:"files"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal folder content: %v", err)
	}
	if len(body.Files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(body.Files))
	}
	if body.Files[0]["path"] != "SKILL.md" {
		t.Fatalf("expected first file SKILL.md, got %v", body.Files[0]["path"])
	}
}

func TestAssetsSkillAllowsReferenceMetadataWithFiles(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	payload := `{"name":"Imported Skill","kind":"skill","storage_kind":"folder","entrypoint":"SKILL.md","reference":"https://github.com/example/skill-repo","files":{"SKILL.md":"# Skill","README.md":"hello"}}`
	rec := te.doAssets(t, http.MethodPost, "/api/assets", payload, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("create skill with reference metadata: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["source_kind"] != "local" {
		t.Fatalf("expected source_kind local when files exist, got %v", body["source_kind"])
	}
	if body["reference"] != "https://github.com/example/skill-repo" {
		t.Fatalf("expected reference to roundtrip, got %v", body["reference"])
	}
}

func TestAssetsSkillAllowsReferenceWithoutFiles(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	payload := `{"name":"Remote Skill","kind":"skill","storage_kind":"folder","entrypoint":"SKILL.md","reference":"https://github.com/example/skill-repo"}`
	rec := te.doAssets(t, http.MethodPost, "/api/assets", payload, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("create reference skill: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["source_kind"] != "reference" {
		t.Fatalf("expected source_kind reference without files, got %v", body["source_kind"])
	}
}

func TestAssetsReferenceScriptCreateAllowedButContentUnavailable(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	payload := `{"name":"Remote Script","kind":"script","storage_kind":"file","language":"python","reference":"https://example.com/main.py"}`
	rec := te.doAssets(t, http.MethodPost, "/api/assets", payload, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("create reference asset: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	assetID := created["id"].(string)

	rec = te.doAssets(t, http.MethodGet, "/api/assets/"+assetID+"/content", "", true)
	if rec.Code != http.StatusConflict {
		t.Fatalf("reference content: expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAssetsRejectsScriptWithoutContentOrReference(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	payload := `{"name":"Empty Script","kind":"script","storage_kind":"file","language":"shell"}`
	rec := te.doAssets(t, http.MethodPost, "/api/assets", payload, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(strings.ToLower(rec.Body.String()), "content or reference") {
		t.Fatalf("expected content or reference error, got %s", rec.Body.String())
	}
}

func TestAssetsRejectsScriptWithoutLanguage(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	payload := `{"name":"Backup Script","kind":"script","storage_kind":"file","content":"echo hello"}`
	rec := te.doAssets(t, http.MethodPost, "/api/assets", payload, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(strings.ToLower(rec.Body.String()), "language") {
		t.Fatalf("expected language error, got %s", rec.Body.String())
	}
}

func TestAssetsCreatePromptLocalFile(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	payload := `{"name":"Support Prompt","kind":"prompt","storage_kind":"file","content":"You are a support assistant."}`
	rec := te.doAssets(t, http.MethodPost, "/api/assets", payload, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	assetID := body["id"].(string)
	if body["source_kind"] != "local" {
		t.Fatalf("expected source_kind local, got %v", body["source_kind"])
	}
	if body["reference"] != "" {
		t.Fatalf("expected empty reference, got %v", body["reference"])
	}
	if body["path"] != "support-prompt-"+assetID+".md" {
		t.Fatalf("unexpected prompt path %v", body["path"])
	}

	rec = te.doAssets(t, http.MethodGet, "/api/assets/"+assetID+"/content", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("prompt content: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	content := parseJSON(t, rec)
	if content["content"] != "You are a support assistant." {
		t.Fatalf("expected prompt content roundtrip, got %v", content["content"])
	}
}

func TestAssetsRejectsPromptReference(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	payload := `{"name":"Remote Prompt","kind":"prompt","storage_kind":"file","reference":"https://example.com/prompt.txt","content":"hello"}`
	rec := te.doAssets(t, http.MethodPost, "/api/assets", payload, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(strings.ToLower(rec.Body.String()), "reference") {
		t.Fatalf("expected reference validation error, got %s", rec.Body.String())
	}
}

func TestAssetsSeededSystemPromptCannotBeDeleted(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record, err := te.app.FindFirstRecordByFilter("assets", "template_key = {:template_key}", map[string]any{"template_key": "prompt-meta-optimizer"})
	if err != nil {
		t.Fatalf("find seeded meta prompt: %v", err)
	}

	rec := te.doAssets(t, http.MethodDelete, "/api/assets/"+record.Id, "", true)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAssetsCreateScriptSupportsExpandedLanguageCatalog(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	payload := `{"name":"Bash Script","kind":"script","storage_kind":"file","language":"bash","content":"echo hello"}`
	rec := te.doAssets(t, http.MethodPost, "/api/assets", payload, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if !strings.HasSuffix(body["path"].(string), ".bash") {
		t.Fatalf("expected .bash path, got %v", body["path"])
	}
	if body["language"] != "bash" {
		t.Fatalf("expected language bash, got %v", body["language"])
	}
}

func TestAssetsCreateOtherScriptRequiresCustomExtension(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	payload := `{"name":"Custom Script","kind":"script","storage_kind":"file","language":"other","content":"echo hello"}`
	rec := te.doAssets(t, http.MethodPost, "/api/assets", payload, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(strings.ToLower(rec.Body.String()), "script_extension") {
		t.Fatalf("expected script_extension error, got %s", rec.Body.String())
	}
}

func TestAssetsCreateOtherScriptUsesCustomExtension(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	payload := `{"name":"Custom Script","kind":"script","storage_kind":"file","language":"other","script_extension":"nu","content":"echo hello"}`
	rec := te.doAssets(t, http.MethodPost, "/api/assets", payload, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["script_extension"] != "nu" {
		t.Fatalf("expected script_extension nu, got %v", body["script_extension"])
	}
	if !strings.HasSuffix(body["path"].(string), ".nu") {
		t.Fatalf("expected .nu path, got %v", body["path"])
	}
}

func TestAssetsScriptPullRejectsLocalhost(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	payload := `{"reference":"http://127.0.0.1/script.sh"}`
	rec := te.doAssets(t, http.MethodPost, "/api/assets/script/pull", payload, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(strings.ToLower(rec.Body.String()), "private/loopback") {
		t.Fatalf("expected ssrf validation error, got %s", rec.Body.String())
	}
}

func TestAssetsSkillPullUsesGitHubSnapshot(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	original := fetchGitHubSkillContent
	fetchGitHubSkillContent = func(_ context.Context, reference string) (skillPullResult, error) {
		if reference != "https://github.com/example/skill-repo" {
			t.Fatalf("unexpected reference %s", reference)
		}
		return skillPullResult{
			Entrypoint: "SKILL.md",
			Files: map[string]string{
				"README.md": "hello",
				"SKILL.md":  "# Skill",
			},
		}, nil
	}
	defer func() { fetchGitHubSkillContent = original }()

	payload := `{"reference":"https://github.com/example/skill-repo"}`
	rec := te.doAssets(t, http.MethodPost, "/api/assets/skill/pull", payload, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["entrypoint"] != "SKILL.md" {
		t.Fatalf("expected entrypoint SKILL.md, got %v", body["entrypoint"])
	}
	files, ok := body["files"].([]any)
	if !ok || len(files) != 2 {
		t.Fatalf("expected 2 files, got %v", body["files"])
	}
}

func TestAssetsRejectsNonGitHubSkillReference(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	payload := `{"name":"Remote Skill","kind":"skill","storage_kind":"folder","entrypoint":"SKILL.md","reference":"https://example.com/skill-repo"}`
	rec := te.doAssets(t, http.MethodPost, "/api/assets", payload, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(strings.ToLower(rec.Body.String()), "github") {
		t.Fatalf("expected github validation error, got %s", rec.Body.String())
	}
}

func TestParseGitHubArchiveURL(t *testing.T) {
	archiveURL, subdir, err := parseGitHubArchiveURL("https://github.com/websoft9/appos/tree/main/templates/addons")
	if err != nil {
		t.Fatalf("parse github archive url: %v", err)
	}
	if archiveURL != "https://github.com/websoft9/appos/archive/main.zip" {
		t.Fatalf("unexpected archive URL %s", archiveURL)
	}
	if subdir != "templates/addons" {
		t.Fatalf("unexpected subdir %s", subdir)
	}
}

func TestExtractGitHubSkillFiles(t *testing.T) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	files := map[string]string{
		"repo-main/SKILL.md":         "# Skill",
		"repo-main/docs/guide.md":    "hello",
		"repo-main/assets/logo.png":  string([]byte{0xff, 0xfe, 0xfd}),
		"repo-main/scripts/check.sh": "echo ok",
	}
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create zip entry: %v", err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatalf("write zip entry: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close zip writer: %v", err)
	}

	result, err := extractGitHubSkillFiles(buffer.Bytes(), "")
	if err != nil {
		t.Fatalf("extract github skill files: %v", err)
	}
	if len(result) != 3 {
		t.Fatalf("expected 3 text files, got %d", len(result))
	}
	if result["SKILL.md"] != "# Skill" {
		t.Fatalf("expected SKILL.md to be extracted, got %v", result["SKILL.md"])
	}
}

func TestAssetsSeedsPromptTemplates(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doAssets(t, http.MethodGet, "/api/assets", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	items := parseJSONArray(t, rec)
	templateCount := 0
	metaFound := false
	for _, item := range items {
		if item["kind"] == "prompt" && item["is_template"] == true {
			templateCount++
		}
		if item["template_key"] == "prompt-meta-optimizer" && item["is_system"] == true {
			metaFound = true
		}
	}
	if templateCount < 5 {
		t.Fatalf("expected at least 5 seeded prompt templates, got %d", templateCount)
	}
	if !metaFound {
		t.Fatal("expected seeded meta prompt to exist")
	}
}
