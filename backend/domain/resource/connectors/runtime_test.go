package connectors_test

import (
	"encoding/base64"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/infra/collections"
	persistence "github.com/websoft9/appos/backend/infra/persistence"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func setupRuntimeSecretKey(t *testing.T) {
	t.Helper()
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	t.Setenv(secrets.EnvSecretKey, key)
	if err := secrets.LoadKeyFromEnv(); err != nil {
		t.Fatal(err)
	}
}

func newRuntimeTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	setupRuntimeSecretKey(t)
	baselineDir, err := connectorsTestBaselineDataDir()
	if err != nil {
		t.Fatal(err)
	}
	app, err := tests.NewTestApp(baselineDir)
	if err != nil {
		t.Fatal(err)
	}
	return app
}

func createSecretRecord(t *testing.T, app core.App, templateID string, payload map[string]any) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", templateID+"-secret")
	rec.Set("template_id", templateID)
	rec.Set("scope", "global")
	rec.Set("access_mode", "use_only")
	rec.Set("status", "active")
	rec.Set("created_by", "system")
	enc, err := secrets.EncryptPayload(payload)
	if err != nil {
		t.Fatal(err)
	}
	rec.Set("payload_encrypted", enc)
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func createConnectorRecord(t *testing.T, app core.App, spec connectors.SaveInput) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(collections.Connectors)
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
	rec.Set("template_id", spec.TemplateID)
	rec.Set("endpoint", spec.Endpoint)
	rec.Set("auth_scheme", spec.AuthScheme)
	rec.Set("credential", spec.CredentialID)
	rec.Set("config", spec.Config)
	rec.Set("description", spec.Description)
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	if spec.Kind == connectors.KindProxy {
		if _, err := app.DB().NewQuery("UPDATE " + collections.Connectors + " SET kind = {:kind} WHERE id = {:id}").Bind(map[string]any{
			"kind": connectors.KindProxy,
			"id":   rec.Id,
		}).Execute(); err != nil {
			t.Fatal(err)
		}
		rec.Set("kind", connectors.KindProxy)
	}
	return rec
}

func TestLoadSMTPUsesEarliestConnector(t *testing.T) {
	app := newRuntimeTestApp(t)
	defer app.Cleanup()

	secret := createSecretRecord(t, app, "single_value", map[string]any{"value": "s3cr3t"})

	createConnectorRecord(t, app, connectors.SaveInput{
		Name:         "Marketing SMTP",
		Kind:         connectors.KindSMTP,
		TemplateID:   "generic-smtp",
		Endpoint:     "smtp://smtp.alt.example.com:587",
		AuthScheme:   connectors.AuthSchemeBasic,
		CredentialID: secret.Id,
		Config:       map[string]any{"username": "mailer", "fromAddress": "alt@example.com", "tls": false},
	})
	createConnectorRecord(t, app, connectors.SaveInput{
		Name:         "Secondary SMTP",
		Kind:         connectors.KindSMTP,
		TemplateID:   "generic-smtp",
		Endpoint:     "smtps://smtp.example.com:465",
		AuthScheme:   connectors.AuthSchemeBasic,
		CredentialID: secret.Id,
		Config: map[string]any{
			"username":    "mailer",
			"fromAddress": "noreply@example.com",
			"localName":   "appos.local",
		},
	})

	cfg, err := connectors.LoadSMTPWith(persistence.NewConnectorRepository(app), connectors.NewSecretResolver(app))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Name != "Marketing SMTP" {
		t.Fatalf("expected earliest connector, got %q", cfg.Name)
	}
	if cfg.Host != "smtp.alt.example.com" || cfg.Port != 587 {
		t.Fatalf("unexpected smtp endpoint: %+v", cfg)
	}
	if cfg.ImplicitTLS {
		t.Fatal("expected plain SMTP connector to avoid implicit TLS")
	}
	if cfg.Username != "mailer" || cfg.Password != "s3cr3t" {
		t.Fatalf("unexpected smtp credential payload: %+v", cfg)
	}
	if cfg.FromAddress != "alt@example.com" {
		t.Fatalf("unexpected smtp config mapping: %+v", cfg)
	}
	if cfg.LocalName != "" {
		t.Fatalf("expected empty local name for earliest connector, got %q", cfg.LocalName)
	}
	if cfg.TLS {
		t.Fatal("expected STARTTLS flag to stay false for earliest connector")
	}
}

func TestLoadSMTPFallsBackToEarliestCreatedConnector(t *testing.T) {
	app := newRuntimeTestApp(t)
	defer app.Cleanup()

	createConnectorRecord(t, app, connectors.SaveInput{Name: "One", Kind: connectors.KindSMTP, TemplateID: "generic-smtp", Endpoint: "smtp://one.example.com:587"})
	createConnectorRecord(t, app, connectors.SaveInput{Name: "Two", Kind: connectors.KindSMTP, TemplateID: "generic-smtp", Endpoint: "smtp://two.example.com:587"})

	cfg, err := connectors.LoadSMTPWith(persistence.NewConnectorRepository(app), connectors.NewSecretResolver(app))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Name != "One" {
		t.Fatalf("expected earliest-created connector to be selected, got %q", cfg.Name)
	}
	if cfg.Host != "one.example.com" || cfg.Port != 587 {
		t.Fatalf("unexpected smtp endpoint after fallback: %+v", cfg)
	}
}

func TestListRegistryResolvesBasicAuthAndFlags(t *testing.T) {
	app := newRuntimeTestApp(t)
	defer app.Cleanup()

	secret := createSecretRecord(t, app, "single_value", map[string]any{"value": "oci-pass"})

	createConnectorRecord(t, app, connectors.SaveInput{
		Name:         "GHCR",
		Kind:         connectors.KindRegistry,
		TemplateID:   "ghcr",
		Endpoint:     "https://ghcr.io",
		AuthScheme:   connectors.AuthSchemeBasic,
		CredentialID: secret.Id,
		Config: map[string]any{
			"username":  "oci-user",
			"namespace": "websoft9/appos",
			"insecure":  true,
		},
	})

	items, err := connectors.ListRegistryWith(persistence.NewConnectorRepository(app), connectors.NewSecretResolver(app))
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 registry connector, got %d", len(items))
	}
	if items[0].Host != "ghcr.io" {
		t.Fatalf("expected host ghcr.io, got %q", items[0].Host)
	}
	if items[0].Username != "oci-user" || items[0].Password != "oci-pass" {
		t.Fatalf("unexpected registry credential mapping: %+v", items[0])
	}
	if items[0].Namespace != "websoft9/appos" || !items[0].Insecure {
		t.Fatalf("unexpected registry config mapping: %+v", items[0])
	}
}

func TestLoadSMTPRejectsUnsupportedScheme(t *testing.T) {
	app := newRuntimeTestApp(t)
	defer app.Cleanup()

	createConnectorRecord(t, app, connectors.SaveInput{
		Name:       "Broken SMTP",
		Kind:       connectors.KindSMTP,
		TemplateID: "generic-smtp",
		Endpoint:   "http://smtp.example.com",
	})

	_, err := connectors.LoadSMTPWith(persistence.NewConnectorRepository(app), connectors.NewSecretResolver(app))
	if err == nil {
		t.Fatal("expected unsupported smtp scheme to fail")
	}
}

func TestSelectDefaultConnectorReturnsTypedNoConnectorError(t *testing.T) {
	app := newRuntimeTestApp(t)
	defer app.Cleanup()

	_, err := connectors.LoadSMTPWith(persistence.NewConnectorRepository(app), connectors.NewSecretResolver(app))
	if err == nil {
		t.Fatal("expected missing connector error")
	}
	if !connectors.IsRuntimeReason(err, connectors.RuntimeReasonNoConnectorConfigured) {
		t.Fatalf("expected typed no-connector error, got %v", err)
	}
}

func TestLoadSMTPFailsForRevokedSecret(t *testing.T) {
	app := newRuntimeTestApp(t)
	defer app.Cleanup()

	secret := createSecretRecord(t, app, "single_value", map[string]any{"value": "s3cr3t"})
	createConnectorRecord(t, app, connectors.SaveInput{
		Name:         "SMTP",
		Kind:         connectors.KindSMTP,
		TemplateID:   "generic-smtp",
		Endpoint:     "smtp://smtp.example.com:587",
		AuthScheme:   connectors.AuthSchemeBasic,
		CredentialID: secret.Id,
		Config:       map[string]any{"username": "mailer"},
	})

	secret.Set("status", "revoked")
	if err := app.Save(secret); err != nil {
		t.Fatal(err)
	}

	_, err := connectors.LoadSMTPWith(persistence.NewConnectorRepository(app), connectors.NewSecretResolver(app))
	if err == nil {
		t.Fatal("expected revoked secret to fail smtp resolution")
	}
}

func TestLoadSMTPFailsForDeletedSecret(t *testing.T) {
	app := newRuntimeTestApp(t)
	defer app.Cleanup()

	secret := createSecretRecord(t, app, "single_value", map[string]any{"value": "s3cr3t"})
	createConnectorRecord(t, app, connectors.SaveInput{
		Name:         "SMTP",
		Kind:         connectors.KindSMTP,
		TemplateID:   "generic-smtp",
		Endpoint:     "smtp://smtp.example.com:587",
		AuthScheme:   connectors.AuthSchemeBasic,
		CredentialID: secret.Id,
		Config:       map[string]any{"username": "mailer"},
	})

	if _, err := app.DB().NewQuery("DELETE FROM secrets WHERE id = {:id}").Bind(map[string]any{"id": secret.Id}).Execute(); err != nil {
		t.Fatal(err)
	}

	_, err := connectors.LoadSMTPWith(persistence.NewConnectorRepository(app), connectors.NewSecretResolver(app))
	if err == nil {
		t.Fatal("expected deleted secret to fail smtp resolution")
	}
}

func TestBuildProxyEnvWithUsesSelectedProxyConnectors(t *testing.T) {
	app := newRuntimeTestApp(t)
	defer app.Cleanup()

	secret := createSecretRecord(t, app, "single_value", map[string]any{"value": "proxy-secret"})
	httpConnector := createConnectorRecord(t, app, connectors.SaveInput{
		Name:         "HTTP Proxy",
		Kind:         connectors.KindProxy,
		TemplateID:   "generic-proxy",
		Endpoint:     "http://proxy.example.com:3128",
		AuthScheme:   connectors.AuthSchemeBasic,
		CredentialID: secret.Id,
		Config: map[string]any{
			"protocol":  "http",
			"username":  "alice",
			"no_proxy":  "localhost,.svc",
			"auth_mode": "username_password",
		},
	})
	httpsConnector := createConnectorRecord(t, app, connectors.SaveInput{
		Name:       "HTTPS Proxy",
		Kind:       connectors.KindProxy,
		TemplateID: "generic-proxy",
		Endpoint:   "https://secure.example.com:4443",
		AuthScheme: connectors.AuthSchemeNone,
		Config: map[string]any{
			"protocol": "https",
			"no_proxy": "127.0.0.1,.svc",
		},
	})

	env, err := connectors.BuildProxyEnvWith(
		persistence.NewConnectorRepository(app),
		connectors.NewSecretResolver(app),
		true,
		"",
		httpConnector.Id,
		httpsConnector.Id,
	)
	if err != nil {
		t.Fatal(err)
	}
	if env["HTTP_PROXY"] != "http://alice:proxy-secret@proxy.example.com:3128" {
		t.Fatalf("unexpected HTTP_PROXY: %q", env["HTTP_PROXY"])
	}
	if env["HTTPS_PROXY"] != "https://secure.example.com:4443" {
		t.Fatalf("unexpected HTTPS_PROXY: %q", env["HTTPS_PROXY"])
	}
	if env["NO_PROXY"] != "localhost,.svc,127.0.0.1" {
		t.Fatalf("unexpected NO_PROXY: %q", env["NO_PROXY"])
	}
}

func TestBuildProxyEnvWithDisabledProxyReturnsNil(t *testing.T) {
	app := newRuntimeTestApp(t)
	defer app.Cleanup()

	env, err := connectors.BuildProxyEnvWith(
		persistence.NewConnectorRepository(app),
		connectors.NewSecretResolver(app),
		false,
		"",
		"",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	if env != nil {
		t.Fatalf("expected nil env when proxy is disabled, got %#v", env)
	}
}

func TestBuildProxyEnvWithPrefersSocks5Connector(t *testing.T) {
	app := newRuntimeTestApp(t)
	defer app.Cleanup()

	secret := createSecretRecord(t, app, "single_value", map[string]any{"value": "proxy-secret"})
	socks5Connector := createConnectorRecord(t, app, connectors.SaveInput{
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
	httpConnector := createConnectorRecord(t, app, connectors.SaveInput{
		Name:       "HTTP Proxy",
		Kind:       connectors.KindProxy,
		TemplateID: "http-proxy",
		Endpoint:   "http://proxy.example.com:3128",
		Config:     map[string]any{"protocol": "http"},
	})

	env, err := connectors.BuildProxyEnvWith(
		persistence.NewConnectorRepository(app),
		connectors.NewSecretResolver(app),
		true,
		socks5Connector.Id,
		httpConnector.Id,
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	want := "socks5://alice:proxy-secret@socks.example.com:1080"
	if env["ALL_PROXY"] != want {
		t.Fatalf("unexpected ALL_PROXY: %q", env["ALL_PROXY"])
	}
	if env["HTTP_PROXY"] != want || env["HTTPS_PROXY"] != want {
		t.Fatalf("expected HTTP/HTTPS env to use SOCKS5, got %#v", env)
	}
	if env["NO_PROXY"] != "localhost,.svc" {
		t.Fatalf("unexpected NO_PROXY: %q", env["NO_PROXY"])
	}
}
