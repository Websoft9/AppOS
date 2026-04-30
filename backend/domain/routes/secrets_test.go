package routes

import (
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/secrets"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func newSecretsTestEnv(t *testing.T) *testEnv {
	t.Helper()
	t.Setenv("APPOS_INTERNAL_TOKEN", "test-internal-token")
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	t.Setenv(secrets.EnvSecretKey, key)
	if err := secrets.LoadKeyFromEnv(); err != nil {
		t.Fatal(err)
	}
	if err := secrets.LoadTemplatesFromDefaultPath(); err != nil {
		t.Fatal(err)
	}
	return newTestEnv(t)
}

func doSecretsRoute(t *testing.T, te *testEnv, method, url, body string, auth bool, internal bool) *httptest.ResponseRecorder {
	t.Helper()
	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}
	g := r.Group("/api/secrets")
	registerSecretsGroup(g)

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
	if auth {
		req.Header.Set("Authorization", te.token)
	}
	if internal {
		req.Header.Set("X-Appos-Internal", "1")
		req.Header.Set("X-Appos-Internal-Token", "test-internal-token")
		req.RemoteAddr = "127.0.0.1:12345"
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestSecretsTemplatesRequireAuth(t *testing.T) {
	te := newSecretsTestEnv(t)
	defer te.cleanup()

	rec := doSecretsRoute(t, te, http.MethodGet, "/api/secrets/templates", "", false, false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}

	rec = doSecretsRoute(t, te, http.MethodGet, "/api/secrets/templates", "", true, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSecretsResolveRequiresInternalHeader(t *testing.T) {
	te := newSecretsTestEnv(t)
	defer te.cleanup()

	col, err := te.app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", "route-secret")
	rec.Set("type", "password")
	rec.Set("template_id", "single_value")
	rec.Set("scope", "global")
	rec.Set("access_mode", "use_only")
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

	body := `{"secret_id":"` + rec.Id + `","used_by":"test:1"}`
	res := doSecretsRoute(t, te, http.MethodPost, "/api/secrets/resolve", body, false, false)
	if res.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", res.Code, res.Body.String())
	}

	res = doSecretsRoute(t, te, http.MethodPost, "/api/secrets/resolve", body, false, true)
	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}
}

func TestSecretsResolveRejectsMissingOrInvalidInternalToken(t *testing.T) {
	te := newSecretsTestEnv(t)
	defer te.cleanup()

	col, err := te.app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", "route-secret-token-check")
	rec.Set("template_id", "single_value")
	rec.Set("scope", "global")
	rec.Set("access_mode", "use_only")
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

	body := `{"secret_id":"` + rec.Id + `","used_by":"test:token"}`

	res := doSecretsRoute(t, te, http.MethodPost, "/api/secrets/resolve", body, false, true)
	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}
	g := r.Group("/api/secrets")
	registerSecretsGroup(g)
	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	reqNoToken := httptest.NewRequest(http.MethodPost, "/api/secrets/resolve", strings.NewReader(body))
	reqNoToken.Header.Set("Content-Type", "application/json")
	reqNoToken.Header.Set("X-Appos-Internal", "1")
	reqNoToken.RemoteAddr = "127.0.0.1:12345"
	recNoToken := httptest.NewRecorder()
	mux.ServeHTTP(recNoToken, reqNoToken)
	if recNoToken.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for missing token, got %d: %s", recNoToken.Code, recNoToken.Body.String())
	}

	reqBadToken := httptest.NewRequest(http.MethodPost, "/api/secrets/resolve", strings.NewReader(body))
	reqBadToken.Header.Set("Content-Type", "application/json")
	reqBadToken.Header.Set("X-Appos-Internal", "1")
	reqBadToken.Header.Set("X-Appos-Internal-Token", "wrong-token")
	reqBadToken.RemoteAddr = "127.0.0.1:12345"
	recBadToken := httptest.NewRecorder()
	mux.ServeHTTP(recBadToken, reqBadToken)
	if recBadToken.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for invalid token, got %d: %s", recBadToken.Code, recBadToken.Body.String())
	}
}

func TestSecretsResolveRejectsWhenInternalTokenNotConfigured(t *testing.T) {
	te := newSecretsTestEnv(t)
	defer te.cleanup()

	t.Setenv("APPOS_INTERNAL_TOKEN", "")

	body := `{"secret_id":"any","used_by":"test:no-token-env"}`
	res := doSecretsRoute(t, te, http.MethodPost, "/api/secrets/resolve", body, false, true)
	if res.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when APPOS_INTERNAL_TOKEN is empty, got %d: %s", res.Code, res.Body.String())
	}
}

func TestSecretsPayloadUpdateRevokedForbidden(t *testing.T) {
	te := newSecretsTestEnv(t)
	defer te.cleanup()

	col, err := te.app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", "route-secret-revoked")
	rec.Set("template_id", "single_value")
	rec.Set("scope", "global")
	rec.Set("access_mode", "use_only")
	rec.Set("status", "revoked")
	rec.Set("created_by", "u1")
	enc, err := secrets.EncryptPayload(map[string]any{"value": "old"})
	if err != nil {
		t.Fatal(err)
	}
	rec.Set("payload_encrypted", enc)
	rec.Set("version", 1)
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}

	body := `{"payload":{"value":"new"}}`
	res := doSecretsRoute(t, te, http.MethodPut, "/api/secrets/"+rec.Id+"/payload", body, true, false)
	if res.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", res.Code, res.Body.String())
	}
}

func TestSecretsPayloadUpdateSystemManagedForbidden(t *testing.T) {
	te := newSecretsTestEnv(t)
	defer te.cleanup()

	col, err := te.app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", "route-secret-system")
	rec.Set("template_id", "single_value")
	rec.Set("scope", "global")
	rec.Set("access_mode", "use_only")
	rec.Set("status", "active")
	rec.Set("created_source", "system")
	rec.Set("created_by", "u1")
	enc, err := secrets.EncryptPayload(map[string]any{"value": "old"})
	if err != nil {
		t.Fatal(err)
	}
	rec.Set("payload_encrypted", enc)
	rec.Set("version", 1)
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}

	body := `{"payload":{"value":"new"}}`
	res := doSecretsRoute(t, te, http.MethodPut, "/api/secrets/"+rec.Id+"/payload", body, true, false)
	if res.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", res.Code, res.Body.String())
	}
	if !strings.Contains(strings.ToLower(res.Body.String()), "system_secret_payload_read_only") {
		t.Fatalf("expected reason code in response, got %s", res.Body.String())
	}
}

func TestSecretsPayloadUpdateLegacyTunnelTokenForbidden(t *testing.T) {
	te := newSecretsTestEnv(t)
	defer te.cleanup()

	col, err := te.app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", "route-secret-tunnel")
	rec.Set("type", "tunnel_token")
	rec.Set("template_id", "single_value")
	rec.Set("scope", "global")
	rec.Set("access_mode", "use_only")
	rec.Set("status", "active")
	rec.Set("created_by", "u1")
	enc, err := secrets.EncryptPayload(map[string]any{"value": "old"})
	if err != nil {
		t.Fatal(err)
	}
	rec.Set("payload_encrypted", enc)
	rec.Set("version", 1)
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}

	body := `{"payload":{"value":"new"}}`
	res := doSecretsRoute(t, te, http.MethodPut, "/api/secrets/"+rec.Id+"/payload", body, true, false)
	if res.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", res.Code, res.Body.String())
	}
	if !strings.Contains(strings.ToLower(res.Body.String()), "system_secret_payload_read_only") {
		t.Fatalf("expected reason code in response, got %s", res.Body.String())
	}
}
