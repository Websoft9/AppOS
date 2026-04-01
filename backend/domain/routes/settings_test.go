package routes

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
)

func doSettingsRoute(t *testing.T, te *testEnv, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	RegisterSettings(&core.ServeEvent{App: te.app, Router: r})

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

func TestSettingsSchemaIncludesUnifiedEntries(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := doSettingsRoute(t, te, http.MethodGet, "/api/settings/schema", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string][]map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	entries := body["entries"]
	if len(entries) == 0 {
		t.Fatal("expected schema entries")
	}

	var foundSystem bool
	var foundWorkspace bool
	for _, entry := range entries {
		id, _ := entry["id"].(string)
		section, _ := entry["section"].(string)
		source, _ := entry["source"].(string)
		switch id {
		case "smtp":
			foundSystem = section == "system" && source == "native"
		case "space-quota":
			foundWorkspace = section == "workspace" && source == "custom"
		case "iac-files":
			if section != "workspace" || source != "custom" {
				t.Fatalf("expected iac-files schema entry with workspace/custom metadata, got section=%s source=%s", section, source)
			}
		}
	}

	if !foundSystem {
		t.Fatal("expected smtp schema entry with system/native metadata")
	}
	if !foundWorkspace {
		t.Fatal("expected space-quota schema entry with workspace/custom metadata")
	}
}

func TestSettingsSchemaPreservesCatalogOrder(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := doSettingsRoute(t, te, http.MethodGet, "/api/settings/schema", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string][]map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	entries := body["entries"]
	if len(entries) < 8 {
		t.Fatalf("expected representative schema entries, got %d", len(entries))
	}

	ids := make([]string, 0, len(entries))
	for _, entry := range entries {
		id, _ := entry["id"].(string)
		ids = append(ids, id)
	}

	expectedPrefix := []string{
		"basic",
		"smtp",
		"s3",
		"logs",
		"secrets-policy",
		"space-quota",
		"connect-terminal",
		"connect-sftp",
	}
	for idx, want := range expectedPrefix {
		if ids[idx] != want {
			t.Fatalf("expected schema order %v, got %v", expectedPrefix, ids[:len(expectedPrefix)])
		}
	}
}

func TestSettingsEntriesListIncludesRepresentativeValues(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := doSettingsRoute(t, te, http.MethodGet, "/api/settings/entries", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string][]map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	items := body["items"]
	if len(items) == 0 {
		t.Fatal("expected entry payloads")
	}

	var foundIacFiles bool
	var foundTunnel bool
	var foundSecrets bool
	for _, item := range items {
		id, _ := item["id"].(string)
		value, _ := item["value"].(map[string]any)
		switch id {
		case "iac-files":
			foundIacFiles = value != nil && int(value["maxSizeMB"].(float64)) == 10 && int(value["maxZipSizeMB"].(float64)) == 50
		case "tunnel-port-range":
			foundTunnel = value != nil && int(value["start"].(float64)) == 40000 && int(value["end"].(float64)) == 49999
		case "secrets-policy":
			foundSecrets = value != nil && value["defaultAccessMode"] == string(secrets.AccessModeUseOnly)
		}
	}

	if !foundIacFiles {
		t.Fatal("expected iac-files fallback value")
	}
	if !foundTunnel {
		t.Fatal("expected tunnel-port-range fallback value")
	}
	if !foundSecrets {
		t.Fatal("expected secrets-policy fallback value")
	}
}

func TestSettingsEntryPatchValidation(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	badMode := `{"defaultAccessMode":"invalid"}`
	rec := doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/secrets-policy", badMode, true)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for invalid secrets policy, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "defaultAccessMode") {
		t.Fatalf("expected defaultAccessMode error, got %s", rec.Body.String())
	}

	badRange := `{"start":50000,"end":40000}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/tunnel-port-range", badRange, true)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for descending range, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "must be greater than start") {
		t.Fatalf("expected tunnel validation error, got %s", rec.Body.String())
	}

	badIacFiles := `{"maxSizeMB":0,"maxZipSizeMB":-1}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/iac-files", badIacFiles, true)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for invalid iac-files limits, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "maxSizeMB") {
		t.Fatalf("expected iac-files validation error, got %s", rec.Body.String())
	}
}

func TestSettingsEntryPatchPersistsUnifiedValues(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	basicBody := `{"appName":"Unified AppOS","appURL":"https://unified.test"}`
	rec := doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/basic", basicBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for basic entry patch, got %d: %s", rec.Code, rec.Body.String())
	}

	basicGet := doSettingsRoute(t, te, http.MethodGet, "/api/settings/entries/basic", "", true)
	if basicGet.Code != http.StatusOK {
		t.Fatalf("expected 200 for basic entry get, got %d: %s", basicGet.Code, basicGet.Body.String())
	}
	if !strings.Contains(basicGet.Body.String(), "Unified AppOS") {
		t.Fatalf("expected updated basic entry payload, got %s", basicGet.Body.String())
	}

	policyBody := `{"revealDisabled":true,"defaultAccessMode":"reveal_allowed","clipboardClearSeconds":45}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/secrets-policy", policyBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for secrets-policy patch, got %d: %s", rec.Code, rec.Body.String())
	}

	storedPolicy, err := sysconfig.GetGroup(te.app, "secrets", "policy", nil)
	if err != nil {
		t.Fatalf("expected stored policy, got error: %v", err)
	}
	normalized := secrets.NormalizePolicy(storedPolicy)
	if normalized.DefaultAccessMode != secrets.AccessModeRevealAllowed || !normalized.RevealDisabled || normalized.ClipboardClearSeconds != 45 {
		t.Fatalf("unexpected persisted unified secrets policy: %#v", normalized)
	}

	tunnelBody := `{"start":41000,"end":41999}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/tunnel-port-range", tunnelBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for tunnel entry patch, got %d: %s", rec.Code, rec.Body.String())
	}

	storedTunnel, err := sysconfig.GetGroup(te.app, "tunnel", "port_range", nil)
	if err != nil {
		t.Fatalf("expected stored tunnel port range, got error: %v", err)
	}
	if got := sysconfig.Int(storedTunnel, "start", 0); got != 41000 {
		t.Fatalf("expected start 41000, got %d", got)
	}
	if got := sysconfig.Int(storedTunnel, "end", 0); got != 41999 {
		t.Fatalf("expected end 41999, got %d", got)
	}

	iacBody := `{"maxSizeMB":25,"maxZipSizeMB":100,"extensionBlacklist":".exe,.bin"}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/iac-files", iacBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for iac-files patch, got %d: %s", rec.Code, rec.Body.String())
	}

	storedIacFiles, err := sysconfig.GetGroup(te.app, "files", "limits", nil)
	if err != nil {
		t.Fatalf("expected stored iac-files limits, got error: %v", err)
	}
	if got := sysconfig.Int(storedIacFiles, "maxSizeMB", 0); got != 25 {
		t.Fatalf("expected maxSizeMB 25, got %d", got)
	}
	if got := sysconfig.Int(storedIacFiles, "maxZipSizeMB", 0); got != 100 {
		t.Fatalf("expected maxZipSizeMB 100, got %d", got)
	}
	if got := sysconfig.String(storedIacFiles, "extensionBlacklist", ""); got != ".exe,.bin" {
		t.Fatalf("expected extensionBlacklist .exe,.bin, got %q", got)
	}
}

func TestSecretsRevealDisabledByPolicy(t *testing.T) {
	te := newSecretsTestEnv(t)
	defer te.cleanup()

	if err := sysconfig.SetGroup(te.app, "secrets", "policy", map[string]any{
		"revealDisabled":        true,
		"defaultAccessMode":     "use_only",
		"clipboardClearSeconds": 0,
	}); err != nil {
		t.Fatal(err)
	}

	col, err := te.app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", "policy-blocked-secret")
	rec.Set("template_id", "single_value")
	rec.Set("scope", "global")
	rec.Set("access_mode", "reveal_allowed")
	rec.Set("status", "active")
	rec.Set("created_by", "u1")
	enc, err := secrets.EncryptPayload(map[string]any{"value": "hello"})
	if err != nil {
		t.Fatal(err)
	}
	rec.Set("payload_encrypted", enc)
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}

	res := doSecretsRoute(t, te, http.MethodGet, "/api/secrets/"+rec.Id+"/reveal", "", true, false)
	if res.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "Secret reveal is disabled by administrator") {
		t.Fatalf("expected admin-disabled message, got %s", res.Body.String())
	}
}
