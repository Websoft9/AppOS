package tunnelpb

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
)

func ensureTunnelServersCollection(t *testing.T, app core.App) {
	t.Helper()

	if _, err := app.FindCollectionByNameOrId("servers"); err == nil {
		return
	}

	col := core.NewBaseCollection("servers")
	col.Fields.Add(&core.TextField{Name: "name", Required: true})
	col.Fields.Add(&core.TextField{Name: "host"})
	col.Fields.Add(&core.NumberField{Name: "port"})
	col.Fields.Add(&core.TextField{Name: "user"})
	col.Fields.Add(&core.TextField{Name: "auth_type"})
	col.Fields.Add(&core.TextField{Name: "connect_type"})
	col.Fields.Add(&core.TextField{Name: "credential"})
	col.Fields.Add(&core.TextField{Name: "shell"})
	col.Fields.Add(&core.TextField{Name: "description"})
	col.Fields.Add(&core.TextField{Name: "tunnel_status"})
	col.Fields.Add(&core.DateField{Name: "tunnel_last_seen"})
	col.Fields.Add(&core.DateField{Name: "tunnel_connected_at"})
	col.Fields.Add(&core.TextField{Name: "tunnel_remote_addr"})
	col.Fields.Add(&core.DateField{Name: "tunnel_disconnect_at"})
	col.Fields.Add(&core.TextField{Name: "tunnel_disconnect_reason"})
	col.Fields.Add(&core.DateField{Name: "tunnel_pause_until"})
	col.Fields.Add(&core.JSONField{Name: "tunnel_services"})
	col.Fields.Add(&core.JSONField{Name: "tunnel_forwards"})

	if err := app.Save(col); err != nil {
		t.Fatalf("create servers collection: %v", err)
	}
}

func createTunnelRepositoryServerRecord(t *testing.T, app core.App, name, connectType string, services []tunnelcore.Service) *core.Record {
	t.Helper()

	ensureTunnelServersCollection(t, app)

	serversCol, err := app.FindCollectionByNameOrId("servers")
	if err != nil {
		t.Fatal(err)
	}

	record := core.NewRecord(serversCol)
	record.Set("name", name)
	record.Set("host", "127.0.0.1")
	record.Set("port", 22)
	record.Set("user", "root")
	record.Set("auth_type", "password")
	record.Set("connect_type", connectType)
	if services != nil {
		raw, err := json.Marshal(services)
		if err != nil {
			t.Fatal(err)
		}
		record.Set("tunnel_services", string(raw))
	}

	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}

	return record
}

func TestTunnelRepositoryLoadExistingPortRecordsReturnsTunnelAssignments(t *testing.T) {
	app := newTunnelApp(t)
	defer app.Cleanup()

	tunnelServer := createTunnelRepositoryServerRecord(t, app, "tunnel-edge", "tunnel", []tunnelcore.Service{{Name: "ssh", LocalPort: 22, TunnelPort: 42001}})
	createTunnelRepositoryServerRecord(t, app, "ssh-edge", "ssh", []tunnelcore.Service{{Name: "ssh", LocalPort: 22, TunnelPort: 43001}})
	createTunnelRepositoryServerRecord(t, app, "empty-tunnel", "tunnel", nil)

	repo := tunnelRepository{app: app}
	portRecords, err := repo.loadExistingPortRecords()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(portRecords) != 1 {
		t.Fatalf("expected 1 tunnel port record, got %d", len(portRecords))
	}
	if portRecords[0].ClientID != tunnelServer.Id {
		t.Fatalf("expected client ID %q, got %q", tunnelServer.Id, portRecords[0].ClientID)
	}
	if len(portRecords[0].Services) != 1 || portRecords[0].Services[0].TunnelPort != 42001 {
		t.Fatalf("expected stored tunnel service assignment, got %#v", portRecords[0].Services)
	}
}

func TestTunnelRepositorySaveConnectedStatePersistsRuntimeFields(t *testing.T) {
	app := newTunnelApp(t)
	defer app.Cleanup()

	record := createTunnelRepositoryServerRecord(t, app, "connected-edge", "tunnel", nil)
	repo := tunnelRepository{app: app}
	connectedAt := time.Date(2026, time.April, 9, 10, 0, 0, 0, time.UTC)
	services := []tunnelcore.Service{{Name: "ssh", LocalPort: 22, TunnelPort: 42001}}

	if err := repo.saveConnectedState(record.Id, connectedAt, "10.0.0.1:12345", services); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	reloaded, err := app.FindRecordById("servers", record.Id)
	if err != nil {
		t.Fatalf("expected reloaded record, got %v", err)
	}
	runtime := servers.TunnelRuntimeFromRecord(reloaded)
	if runtime.Status != servers.TunnelStatusOnline {
		t.Fatalf("expected online status, got %q", runtime.Status)
	}
	if runtime.RemoteAddr != "10.0.0.1:12345" {
		t.Fatalf("expected remote addr to be persisted, got %q", runtime.RemoteAddr)
	}
	if !runtime.ConnectedAt.Equal(connectedAt) {
		t.Fatalf("expected connectedAt %s, got %s", connectedAt, runtime.ConnectedAt)
	}
	if len(runtime.Services()) != 1 || runtime.Services()[0].TunnelPort != 42001 {
		t.Fatalf("expected persisted services, got %#v", runtime.Services())
	}
	if !runtime.PauseUntil.IsZero() {
		t.Fatalf("expected pause_until to be cleared, got %s", runtime.PauseUntil)
	}
}

func TestTunnelRepositorySaveDisconnectedStatePersistsStatusAndReason(t *testing.T) {
	app := newTunnelApp(t)
	defer app.Cleanup()

	record := createTunnelRepositoryServerRecord(t, app, "disconnected-edge", "tunnel", nil)
	repo := tunnelRepository{app: app}
	disconnectedAt := time.Date(2026, time.April, 9, 11, 0, 0, 0, time.UTC)

	if err := repo.saveDisconnectedState(record.Id, tunnelcore.DisconnectReasonOperatorDisconnect, disconnectedAt); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	reloaded, err := app.FindRecordById("servers", record.Id)
	if err != nil {
		t.Fatalf("expected reloaded record, got %v", err)
	}
	runtime := servers.TunnelRuntimeFromRecord(reloaded)
	if runtime.Status != servers.TunnelStatusOffline {
		t.Fatalf("expected offline status, got %q", runtime.Status)
	}
	if runtime.DisconnectReason != string(tunnelcore.DisconnectReasonOperatorDisconnect) {
		t.Fatalf("expected disconnect reason to persist, got %q", runtime.DisconnectReason)
	}
	if !runtime.DisconnectAt.Equal(disconnectedAt) {
		t.Fatalf("expected disconnectAt %s, got %s", disconnectedAt, runtime.DisconnectAt)
	}
}
