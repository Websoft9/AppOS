package routes

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestAcquireServerRealtimeSSHReadSerializesSameServer(t *testing.T) {
	release, err := acquireServerRealtimeSSHRead(context.Background(), "srv-serial")
	if err != nil {
		t.Fatal(err)
	}
	defer release()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if blockedRelease, blockedErr := acquireServerRealtimeSSHRead(ctx, "srv-serial"); blockedErr == nil {
		blockedRelease()
		t.Fatal("expected second same-server realtime SSH read to wait until context expires")
	}
}

func TestAcquireServerRealtimeSSHReadAllowsDifferentServers(t *testing.T) {
	releaseA, err := acquireServerRealtimeSSHRead(context.Background(), "srv-a")
	if err != nil {
		t.Fatal(err)
	}
	defer releaseA()

	releaseB, err := acquireServerRealtimeSSHRead(context.Background(), "srv-b")
	if err != nil {
		t.Fatal(err)
	}
	defer releaseB()
}

func TestPortReservationDetectionUsesProvidedRunnerForAllProbes(t *testing.T) {
	var calls int32
	run := func(_ context.Context, command string, _ time.Duration) (string, error) {
		atomic.AddInt32(&calls, 1)
		switch {
		case command == "systemctl list-sockets --all --no-legend --no-pager 2>/dev/null || true":
			return "0.0.0.0:8080 app.socket app.service", nil
		case command == "cat /proc/sys/net/ipv4/ip_local_reserved_ports 2>/dev/null || true":
			return "10000-10001", nil
		default:
			return "abc123\tweb\tUp 1 minute\t0.0.0.0:9090->80/tcp", nil
		}
	}

	reservations, probe, err := detectAllPortReservationsWithRunner(context.Background(), run, "tcp")
	if err != nil {
		t.Fatal(err)
	}
	if atomic.LoadInt32(&calls) != 3 {
		t.Fatalf("expected three reservation probes through one provided runner, got %d", calls)
	}
	if probe["status"] != "ok" {
		t.Fatalf("expected docker probe ok, got %#v", probe)
	}
	for _, port := range []int{8080, 9090, 10000, 10001} {
		if len(reservations[port]) == 0 {
			t.Fatalf("expected reservation for port %d, got %#v", port, reservations)
		}
	}
}
