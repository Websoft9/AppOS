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
	"github.com/websoft9/appos/backend/internal/secrets"
	"github.com/websoft9/appos/backend/internal/settings"
)

func doSettingsRoute(t *testing.T, te *testEnv, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	g := r.Group("/api/settings/workspace")
	g.Bind(apis.RequireSuperuserAuth())
	g.GET("", handleExtSettingsDiscover)
	g.GET("/{module}", handleExtSettingsGet)
	g.PATCH("/{module}", handleExtSettingsPatch)

	tunnelGroup := r.Group("/api/settings/tunnel")
	tunnelGroup.Bind(apis.RequireSuperuserAuth())
	tunnelGroup.GET("", handleTunnelSettingsGet)
	tunnelGroup.PATCH("", handleTunnelSettingsPatch)

	secretsGroup := r.Group("/api/settings/secrets")
	secretsGroup.Bind(apis.RequireSuperuserAuth())
	secretsGroup.GET("", handleSecretsSettingsGet)
	secretsGroup.PATCH("", handleSecretsSettingsPatch)

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

func TestSettingsSecretsPolicyGetReturnsFallback(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := doSettingsRoute(t, te, http.MethodGet, "/api/settings/secrets", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string]map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	policy := body["policy"]
	if policy == nil {
		t.Fatal("expected policy group in response")
	}
	normalized := secrets.NormalizePolicy(policy)
	if normalized.DefaultAccessMode != secrets.AccessModeUseOnly {
		t.Fatalf("expected defaultAccessMode use_only, got %#v", normalized.DefaultAccessMode)
	}
	if normalized.RevealDisabled != false {
		t.Fatalf("expected revealDisabled false, got %#v", normalized.RevealDisabled)
	}
	if normalized.ClipboardClearSeconds != 0 {
		t.Fatalf("expected clipboardClearSeconds 0, got %d", normalized.ClipboardClearSeconds)
	}
}

func TestSettingsSecretsPolicyPatchValidation(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	badMode := `{"policy":{"defaultAccessMode":"invalid"}}`
	rec := doSettingsRoute(t, te, http.MethodPatch, "/api/settings/secrets", badMode, true)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for invalid mode, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "defaultAccessMode") {
		t.Fatalf("expected defaultAccessMode error, got %s", rec.Body.String())
	}

	badClipboard := `{"policy":{"clipboardClearSeconds":-1}}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/secrets", badClipboard, true)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for negative clipboardClearSeconds, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "clipboardClearSeconds") {
		t.Fatalf("expected clipboardClearSeconds error, got %s", rec.Body.String())
	}
}

func TestSettingsSecretsPolicyPatchPersistsValidValue(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	body := `{"policy":{"revealDisabled":true,"defaultAccessMode":"reveal_allowed","clipboardClearSeconds":45}}`
	rec := doSettingsRoute(t, te, http.MethodPatch, "/api/settings/secrets", body, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	stored, err := settings.GetGroup(te.app, "secrets", "policy", nil)
	if err != nil {
		t.Fatalf("expected stored policy, got error: %v", err)
	}
	normalized := secrets.NormalizePolicy(stored)
	if normalized.DefaultAccessMode != secrets.AccessModeRevealAllowed {
		t.Fatalf("expected defaultAccessMode reveal_allowed, got %#v", normalized.DefaultAccessMode)
	}
	if normalized.RevealDisabled != true {
		t.Fatalf("expected revealDisabled true, got %#v", normalized.RevealDisabled)
	}
	if normalized.ClipboardClearSeconds != 45 {
		t.Fatalf("expected clipboardClearSeconds 45, got %v", normalized.ClipboardClearSeconds)
	}
}

func TestSettingsDiscoverIncludesSecretsModule(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := doSettingsRoute(t, te, http.MethodGet, "/api/settings/workspace", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body []map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	found := false
	for _, entry := range body {
		if entry["module"] != "secrets" {
			continue
		}
		found = true
		keys, _ := entry["keys"].([]any)
		if len(keys) != 1 || keys[0] != "policy" {
			t.Fatalf("unexpected secrets keys: %#v", entry["keys"])
		}
		if entry["url"] != "/api/settings/secrets" {
			t.Fatalf("expected direct secrets settings URL, got %#v", entry["url"])
		}
	}
	if !found {
		t.Fatal("expected secrets module in discover response")
	}
}

func TestSettingsDiscoverIncludesTunnelModule(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := doSettingsRoute(t, te, http.MethodGet, "/api/settings/workspace", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body []map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	found := false
	for _, entry := range body {
		if entry["module"] != "tunnel" {
			continue
		}
		found = true
		keys, _ := entry["keys"].([]any)
		if len(keys) != 1 || keys[0] != "port_range" {
			t.Fatalf("unexpected tunnel keys: %#v", entry["keys"])
		}
		if entry["url"] != "/api/settings/tunnel" {
			t.Fatalf("expected direct tunnel settings URL, got %#v", entry["url"])
		}
	}
	if !found {
		t.Fatal("expected tunnel module in discover response")
	}
}

func TestSettingsTunnelGetReturnsFallback(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := doSettingsRoute(t, te, http.MethodGet, "/api/settings/tunnel", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string]map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	portRange := body["port_range"]
	if portRange == nil {
		t.Fatal("expected port_range group in response")
	}
	if got := int(portRange["start"].(float64)); got != 40000 {
		t.Fatalf("expected start 40000, got %d", got)
	}
	if got := int(portRange["end"].(float64)); got != 49999 {
		t.Fatalf("expected end 49999, got %d", got)
	}
}

func TestSettingsTunnelPatchValidation(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	badRange := `{"port_range":{"start":50000,"end":40000}}`
	rec := doSettingsRoute(t, te, http.MethodPatch, "/api/settings/tunnel", badRange, true)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for descending range, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "must be greater than start") {
		t.Fatalf("expected range ordering error, got %s", rec.Body.String())
	}

	sshConflict := `{"port_range":{"start":2200,"end":2300}}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/tunnel", sshConflict, true)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for ssh port overlap, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "2222") {
		t.Fatalf("expected ssh port conflict error, got %s", rec.Body.String())
	}
}

func TestSettingsTunnelPatchPersistsValidValue(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	body := `{"port_range":{"start":41000,"end":41999}}`
	rec := doSettingsRoute(t, te, http.MethodPatch, "/api/settings/tunnel", body, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	stored, err := settings.GetGroup(te.app, "tunnel", "port_range", nil)
	if err != nil {
		t.Fatalf("expected stored tunnel port range, got error: %v", err)
	}
	if got := settings.Int(stored, "start", 0); got != 41000 {
		t.Fatalf("expected start 41000, got %d", got)
	}
	if got := settings.Int(stored, "end", 0); got != 41999 {
		t.Fatalf("expected end 41999, got %d", got)
	}
}

func TestSecretsRevealDisabledByPolicy(t *testing.T) {
	te := newSecretsTestEnv(t)
	defer te.cleanup()

	if err := settings.SetGroup(te.app, "secrets", "policy", map[string]any{
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
