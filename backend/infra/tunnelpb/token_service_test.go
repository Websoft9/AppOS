package tunnelpb

import (
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/resource/servers"
	sec "github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/infra/crypto"
)

func ensureTunnelSecretsCollection(t *testing.T, app core.App) {
	t.Helper()

	if _, err := app.FindCollectionByNameOrId("secrets"); err == nil {
		return
	}

	col := core.NewBaseCollection("secrets")
	col.Fields.Add(&core.TextField{Name: "name", Required: true})
	col.Fields.Add(&core.TextField{Name: "access_mode"})
	col.Fields.Add(&core.TextField{Name: "expires_at"})
	col.Fields.Add(&core.TextField{Name: "scope"})
	col.Fields.Add(&core.TextField{Name: "created_by"})
	col.Fields.Add(&core.TextField{Name: "type", Required: true})
	col.Fields.Add(&core.TextField{Name: "template_id"})
	col.Fields.Add(&core.TextField{Name: "created_source"})
	col.Fields.Add(&core.TextField{Name: "status"})
	col.Fields.Add(&core.TextField{Name: "value"})
	col.Fields.Add(&core.TextField{Name: "payload_encrypted"})
	col.Fields.Add(&core.JSONField{Name: "payload_meta"})
	col.Fields.Add(&core.NumberField{Name: "version"})

	if err := app.Save(col); err != nil {
		t.Fatalf("create secrets collection: %v", err)
	}
}

func createStoredTunnelTokenSecret(t *testing.T, app core.App, managedServerID, rawToken string) *core.Record {
	t.Helper()

	ensureTunnelSecretsCollection(t, app)

	secretCol, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	encToken, err := crypto.Encrypt(rawToken)
	if err != nil {
		t.Fatal(err)
	}
	secret := core.NewRecord(secretCol)
	secret.Set("name", servers.TunnelTokenSecretName(managedServerID))
	secret.Set("type", "tunnel_token")
	secret.Set("template_id", "single_value")
	secret.Set("created_source", "system")
	secret.Set("value", encToken)
	if err := app.Save(secret); err != nil {
		t.Fatal(err)
	}
	return secret
}

func TestTokenServiceGetMissingReturnsFalse(t *testing.T) {
	app := newTunnelApp(t)
	defer app.Cleanup()
	ensureTunnelSecretsCollection(t, app)

	service := &TokenService{App: app}
	token, found, err := service.Get("missing-server")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if found {
		t.Fatal("expected token to be missing")
	}
	if token != "" {
		t.Fatalf("expected empty token, got %q", token)
	}
}

func TestTokenServiceGetReturnsStoredToken(t *testing.T) {
	app := newTunnelApp(t)
	defer app.Cleanup()
	createStoredTunnelTokenSecret(t, app, "server-1", "stored-token")

	service := &TokenService{App: app}
	token, found, err := service.Get("server-1")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if !found {
		t.Fatal("expected token to be found")
	}
	if token != "stored-token" {
		t.Fatalf("expected stored-token, got %q", token)
	}
}

func TestTokenServiceGetOrIssueCreatesTokenAndCachesIt(t *testing.T) {
	app := newTunnelApp(t)
	defer app.Cleanup()
	ensureTunnelSecretsCollection(t, app)

	cache := &sync.Map{}
	service := &TokenService{App: app, TokenCache: cache}
	result, err := service.GetOrIssue("server-create", false)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result == nil || result.Token == "" {
		t.Fatal("expected issued token")
	}
	if !result.Changed {
		t.Fatal("expected created token to mark Changed=true")
	}
	if result.Rotated {
		t.Fatal("expected first issue to not be a rotation")
	}

	stored, err := (&tunnelRepository{app: app}).findTunnelTokenSecret("server-create")
	if err != nil {
		t.Fatalf("expected stored secret, got %v", err)
	}
	if stored == nil {
		t.Fatal("expected tunnel secret to be created")
	}
	if cached, ok := cache.Load(result.Token); !ok || cached.(string) != "server-create" {
		t.Fatalf("expected cache to contain issued token for server-create, got %#v found=%v", cached, ok)
	}
}

func TestTokenServiceGetOrIssueIsIdempotentWithoutRotate(t *testing.T) {
	app := newTunnelApp(t)
	defer app.Cleanup()
	createStoredTunnelTokenSecret(t, app, "server-stable", "stable-token")

	service := &TokenService{App: app, TokenCache: &sync.Map{}}
	result, err := service.GetOrIssue("server-stable", false)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.Token != "stable-token" {
		t.Fatalf("expected stable-token, got %q", result.Token)
	}
	if result.Changed {
		t.Fatal("expected idempotent fetch to keep Changed=false")
	}
	if result.Rotated {
		t.Fatal("expected idempotent fetch to keep Rotated=false")
	}
}

func TestTokenServiceGetOrIssueRotateReplacesSecretAndInvalidatesCache(t *testing.T) {
	app := newTunnelApp(t)
	defer app.Cleanup()
	secret := createStoredTunnelTokenSecret(t, app, "server-rotate", "old-token")

	cache := &sync.Map{}
	cache.Store("old-token", "server-rotate")
	service := &TokenService{App: app, TokenCache: cache}
	result, err := service.GetOrIssue("server-rotate", true)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.Token == "" || result.Token == "old-token" {
		t.Fatalf("expected a new token, got %q", result.Token)
	}
	if !result.Changed || !result.Rotated {
		t.Fatalf("expected rotation flags true, got changed=%v rotated=%v", result.Changed, result.Rotated)
	}
	if _, found := cache.Load("old-token"); found {
		t.Fatal("expected old token cache entry to be removed")
	}
	if cached, found := cache.Load(result.Token); !found || cached.(string) != "server-rotate" {
		t.Fatalf("expected new token to be cached for server-rotate, got %#v found=%v", cached, found)
	}

	stored, err := app.FindRecordById("secrets", secret.Id)
	if err != nil {
		t.Fatalf("expected rotated secret record to exist, got %v", err)
	}
	decrypted, err := sec.ReadSystemSingleValue(sec.From(stored))
	if err != nil {
		t.Fatalf("expected rotated secret to decrypt, got %v", err)
	}
	if decrypted != result.Token {
		t.Fatalf("expected stored token %q, got %q", result.Token, decrypted)
	}
}
