package servers

import "testing"

func TestTunnelRuntimeServicesAndWaitingForFirstConnect(t *testing.T) {
	runtime := TunnelRuntime{
		Status:      "offline",
		ServicesRaw: `[{"service_name":"ssh","local_port":22,"tunnel_port":42001}]`,
	}

	services := runtime.Services()
	if len(services) != 1 {
		t.Fatalf("expected one service, got %d", len(services))
	}
	if services[0].Name != "ssh" {
		t.Fatalf("expected ssh service, got %q", services[0].Name)
	}
	if !runtime.WaitingForFirstConnect() {
		t.Fatal("expected offline zero-value runtime to be waiting for first connect")
	}
}
