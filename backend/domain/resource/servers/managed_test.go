package servers

import (
	"testing"
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
