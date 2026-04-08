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
	app, err := tests.NewTestApp()
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
	rec.Set("name", spec.Name)
	rec.Set("kind", spec.Kind)
	rec.Set("is_default", spec.IsDefault)
	rec.Set("template_id", spec.TemplateID)
	rec.Set("endpoint", spec.Endpoint)
	rec.Set("auth_scheme", spec.AuthScheme)
	rec.Set("credential", spec.CredentialID)
	rec.Set("config", spec.Config)
	rec.Set("description", spec.Description)
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func TestLoadSMTPUsesDefaultNamedConnector(t *testing.T) {
	app := newRuntimeTestApp(t)
	defer app.Cleanup()

	secret := createSecretRecord(t, app, "basic_auth", map[string]any{
		"username": "mailer",
		"password": "s3cr3t",
	})

	createConnectorRecord(t, app, connectors.SaveInput{
		Name:         "Marketing SMTP",
		Kind:         connectors.KindSMTP,
		IsDefault:    false,
		TemplateID:   "generic-smtp",
		Endpoint:     "smtp://smtp.alt.example.com:587",
		AuthScheme:   connectors.AuthSchemeBasic,
		CredentialID: secret.Id,
		Config:       map[string]any{"fromAddress": "alt@example.com", "tls": false},
	})
	createConnectorRecord(t, app, connectors.SaveInput{
		Name:         "default",
		Kind:         connectors.KindSMTP,
		IsDefault:    true,
		TemplateID:   "generic-smtp",
		Endpoint:     "smtps://smtp.example.com:465",
		AuthScheme:   connectors.AuthSchemeBasic,
		CredentialID: secret.Id,
		Config: map[string]any{
			"fromAddress": "noreply@example.com",
			"localName":   "appos.local",
		},
	})

	cfg, err := connectors.LoadSMTPWith(persistence.NewConnectorRepository(app), connectors.NewSecretResolver(app))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Name != "default" {
		t.Fatalf("expected default connector, got %q", cfg.Name)
	}
	if cfg.Host != "smtp.example.com" || cfg.Port != 465 {
		t.Fatalf("unexpected smtp endpoint: %+v", cfg)
	}
	if !cfg.ImplicitTLS {
		t.Fatal("expected implicit TLS for smtps endpoint")
	}
	if cfg.Username != "mailer" || cfg.Password != "s3cr3t" {
		t.Fatalf("unexpected smtp credential payload: %+v", cfg)
	}
	if cfg.FromAddress != "noreply@example.com" || cfg.LocalName != "appos.local" {
		t.Fatalf("unexpected smtp config mapping: %+v", cfg)
	}
	if cfg.TLS {
		t.Fatal("expected STARTTLS flag to stay false for implicit TLS connector")
	}
}

func TestLoadSMTPFailsForAmbiguousConnectors(t *testing.T) {
	app := newRuntimeTestApp(t)
	defer app.Cleanup()

	createConnectorRecord(t, app, connectors.SaveInput{Name: "One", Kind: connectors.KindSMTP, IsDefault: false, TemplateID: "generic-smtp", Endpoint: "smtp://one.example.com:587"})
	createConnectorRecord(t, app, connectors.SaveInput{Name: "Two", Kind: connectors.KindSMTP, IsDefault: false, TemplateID: "generic-smtp", Endpoint: "smtp://two.example.com:587"})

	_, err := connectors.LoadSMTPWith(persistence.NewConnectorRepository(app), connectors.NewSecretResolver(app))
	if err == nil {
		t.Fatal("expected ambiguous smtp connectors to fail")
	}
}

func TestListRegistryResolvesBasicAuthAndFlags(t *testing.T) {
	app := newRuntimeTestApp(t)
	defer app.Cleanup()

	secret := createSecretRecord(t, app, "basic_auth", map[string]any{
		"username": "oci-user",
		"password": "oci-pass",
	})

	createConnectorRecord(t, app, connectors.SaveInput{
		Name:         "GHCR",
		Kind:         connectors.KindRegistry,
		IsDefault:    true,
		TemplateID:   "ghcr",
		Endpoint:     "https://ghcr.io",
		AuthScheme:   connectors.AuthSchemeBasic,
		CredentialID: secret.Id,
		Config: map[string]any{
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
		IsDefault:  true,
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

	secret := createSecretRecord(t, app, "basic_auth", map[string]any{
		"username": "mailer",
		"password": "s3cr3t",
	})
	createConnectorRecord(t, app, connectors.SaveInput{
		Name:         "SMTP",
		Kind:         connectors.KindSMTP,
		IsDefault:    true,
		TemplateID:   "generic-smtp",
		Endpoint:     "smtp://smtp.example.com:587",
		AuthScheme:   connectors.AuthSchemeBasic,
		CredentialID: secret.Id,
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

	secret := createSecretRecord(t, app, "basic_auth", map[string]any{
		"username": "mailer",
		"password": "s3cr3t",
	})
	createConnectorRecord(t, app, connectors.SaveInput{
		Name:         "SMTP",
		Kind:         connectors.KindSMTP,
		IsDefault:    true,
		TemplateID:   "generic-smtp",
		Endpoint:     "smtp://smtp.example.com:587",
		AuthScheme:   connectors.AuthSchemeBasic,
		CredentialID: secret.Id,
	})

	if _, err := app.DB().NewQuery("DELETE FROM secrets WHERE id = {:id}").Bind(map[string]any{"id": secret.Id}).Execute(); err != nil {
		t.Fatal(err)
	}

	_, err := connectors.LoadSMTPWith(persistence.NewConnectorRepository(app), connectors.NewSecretResolver(app))
	if err == nil {
		t.Fatal("expected deleted secret to fail smtp resolution")
	}
}
