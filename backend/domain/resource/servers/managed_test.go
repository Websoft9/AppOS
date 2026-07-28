package servers

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/pem"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/secrets"

	cryptossh "golang.org/x/crypto/ssh"
)

func TestManagedServerApplyBestEffortTunnel(t *testing.T) {
	server := &ManagedServer{
		ConnectType: ConnectionModeTunnel,
	}
	rt := TunnelRuntime{ServicesRaw: `[{"service_name":"ssh","tunnel_port":22022}]`}
	cfg := AccessConfig{Host: "remote.example.com", Port: 22}

	server.ApplyBestEffortTunnel(&cfg, rt)

	if cfg.Host != "127.0.0.1" {
		t.Fatalf("expected tunnel host rewrite, got %q", cfg.Host)
	}
	if cfg.Port != 22022 {
		t.Fatalf("expected tunnel port rewrite, got %d", cfg.Port)
	}
}

func TestManagedServerResolveDockerSSHAddressRequiresOnlineTunnel(t *testing.T) {
	server := &ManagedServer{
		ID:          "server-1",
		Host:        "remote.example.com",
		Port:        22,
		ConnectType: ConnectionModeTunnel,
	}
	rt := TunnelRuntime{
		Status:      "offline",
		ServicesRaw: `[{"service_name":"ssh","tunnel_port":22022}]`,
	}

	_, _, err := server.ResolveDockerSSHAddress(rt)
	if err == nil {
		t.Fatal("expected offline tunnel docker address resolution to fail")
	}
}

func TestManagedServerTunnelForwardSpecsFallsBackToDefault(t *testing.T) {
	server := &ManagedServer{}

	forwards, err := server.TunnelForwardSpecs()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(forwards) == 0 {
		t.Fatal("expected default tunnel forwards")
	}
}

func TestManagedServerIsTunnel(t *testing.T) {
	server := &ManagedServer{ConnectType: ConnectionModeTunnel}
	if !server.IsTunnel() {
		t.Fatal("expected tunnel server")
	}
}

func TestResolveConfigForUserIDIncludesSSHKeyPassphrase(t *testing.T) {
	app := newManagedServerTestApp(t)
	defer app.Cleanup()

	secret := createManagedServerSecret(t, app, "ssh_key", map[string]any{
		"private_key": mustManagedEncryptedPrivateKeyPEM(t, "secret-pass"),
		"passphrase":  "secret-pass",
	})
	serverID := createManagedServerRecord(t, app, secret.Id)

	cfg, err := ResolveConfigForUserID(app, serverID, "operator-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.AuthType != AuthMethodPrivateKey {
		t.Fatalf("expected private_key auth type, got %q", cfg.AuthType)
	}
	if cfg.Secret == "" {
		t.Fatal("expected decrypted private key in config")
	}
	if cfg.Passphrase != "secret-pass" {
		t.Fatalf("expected passphrase to flow through, got %q", cfg.Passphrase)
	}
	if _, err := cryptossh.ParsePrivateKeyWithPassphrase([]byte(cfg.Secret), []byte(cfg.Passphrase)); err != nil {
		t.Fatalf("expected resolved key and passphrase to produce valid signer, got %v", err)
	}
}

func newManagedServerTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	t.Setenv(secrets.EnvSecretKey, key)
	if err := secrets.LoadKeyFromEnv(); err != nil {
		t.Fatal(err)
	}
	if err := secrets.LoadTemplatesFromDefaultPath(); err != nil {
		t.Fatal(err)
	}
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	ensureManagedServerTestCollections(t, app)
	return app
}

func ensureManagedServerTestCollections(t *testing.T, app *tests.TestApp) {
	t.Helper()
	if _, err := app.FindCollectionByNameOrId("secrets"); err != nil {
		col := core.NewBaseCollection("secrets")
		col.Fields.Add(&core.TextField{Name: "name"})
		col.Fields.Add(&core.TextField{Name: "access_mode"})
		col.Fields.Add(&core.TextField{Name: "scope"})
		col.Fields.Add(&core.TextField{Name: "created_by"})
		col.Fields.Add(&core.TextField{Name: "created_source"})
		col.Fields.Add(&core.TextField{Name: "template_id"})
		col.Fields.Add(&core.TextField{Name: "status"})
		col.Fields.Add(&core.TextField{Name: "payload_encrypted"})
		col.Fields.Add(&core.JSONField{Name: "payload_meta"})
		col.Fields.Add(&core.NumberField{Name: "version"})
		if err := app.Save(col); err != nil {
			t.Fatalf("create secrets collection: %v", err)
		}
	}

	if _, err := app.FindCollectionByNameOrId("servers"); err != nil {
		secretsCol, findErr := app.FindCollectionByNameOrId("secrets")
		if findErr != nil {
			t.Fatal(findErr)
		}
		col := core.NewBaseCollection("servers")
		col.Fields.Add(&core.TextField{Name: "name", Required: true})
		col.Fields.Add(&core.TextField{Name: "host"})
		col.Fields.Add(&core.NumberField{Name: "port", OnlyInt: true, Min: types.Pointer(1.0), Max: types.Pointer(65535.0)})
		col.Fields.Add(&core.TextField{Name: "user", Required: true})
		col.Fields.Add(&core.TextField{Name: "connect_type"})
		col.Fields.Add(&core.BoolField{Name: "is_enabled"})
		col.Fields.Add(&core.BoolField{Name: "is_local"})
		col.Fields.Add(&core.RelationField{Name: "credential", CollectionId: secretsCol.Id, MaxSelect: 1})
		col.Fields.Add(&core.TextField{Name: "shell"})
		col.Fields.Add(&core.TextField{Name: "tunnel_status"})
		col.Fields.Add(&core.DateField{Name: "tunnel_last_seen"})
		col.Fields.Add(&core.DateField{Name: "tunnel_connected_at"})
		col.Fields.Add(&core.TextField{Name: "tunnel_remote_addr"})
		col.Fields.Add(&core.DateField{Name: "tunnel_disconnect_at"})
		col.Fields.Add(&core.TextField{Name: "tunnel_disconnect_reason"})
		col.Fields.Add(&core.DateField{Name: "tunnel_pause_until"})
		col.Fields.Add(&core.JSONField{Name: "tunnel_forwards"})
		col.Fields.Add(&core.JSONField{Name: "tunnel_services"})
		col.Fields.Add(&core.TextField{Name: "description"})
		if err := app.Save(col); err != nil {
			t.Fatalf("create servers collection: %v", err)
		}
	}
}

func createManagedServerSecret(t *testing.T, app core.App, templateID string, payload map[string]any) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", "managed-server-secret")
	rec.Set("template_id", templateID)
	rec.Set("scope", secrets.ScopeGlobal)
	rec.Set("access_mode", secrets.AccessModeUseOnly)
	rec.Set("status", secrets.StatusActive)
	rec.Set("created_by", "operator-1")
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

func createManagedServerRecord(t *testing.T, app core.App, credentialID string) string {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("servers")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", "managed-server")
	rec.Set("host", "example.com")
	rec.Set("port", 22)
	rec.Set("user", "root")
	rec.Set("connect_type", string(ConnectionModeDirect))
	rec.Set("credential", credentialID)
	rec.Set("is_enabled", true)
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec.Id
}

func mustManagedEncryptedPrivateKeyPEM(t *testing.T, passphrase string) string {
	t.Helper()
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	block, err := cryptossh.MarshalPrivateKeyWithPassphrase(privateKey, "test", []byte(passphrase))
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(block))
}
