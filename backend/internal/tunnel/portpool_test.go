package tunnel

import (
	"fmt"
	"net"
	"testing"
)

// testPoolRange is the port range used across pool tests.
// Chosen to be above 49152 (ephemeral) and unlikely to conflict on CI.
const (
	testStart = 59100
	testEnd   = 59199
)

func newTestPool() *PortPool {
	return NewPortPool(testStart, testEnd)
}

// ---- LoadExisting --------------------------------------------------------

func TestPortPool_LoadExisting_ReservesKnownPorts(t *testing.T) {
	p := newTestPool()
	p.LoadExisting([]PortRecord{
		{ServerID: "srv1", Services: []Service{
			{Name: "ssh", LocalPort: 22, TunnelPort: testStart},
			{Name: "http", LocalPort: 80, TunnelPort: testStart + 1},
		}},
	})

	// srv1 should reuse the loaded ports.
	svcs, conflicts := p.AcquireOrReuse("srv1")
	if len(conflicts) != 0 {
		t.Fatalf("unexpected conflicts: %+v", conflicts)
	}
	if len(svcs) != 2 {
		t.Fatalf("expected 2 services, got %d", len(svcs))
	}
	if svcs[0].TunnelPort != testStart {
		t.Errorf("ssh tunnel port = %d, want %d", svcs[0].TunnelPort, testStart)
	}
	if svcs[1].TunnelPort != testStart+1 {
		t.Errorf("http tunnel port = %d, want %d", svcs[1].TunnelPort, testStart+1)
	}
}

func TestPortPool_LoadExisting_PreventReassignment(t *testing.T) {
	p := newTestPool()
	p.LoadExisting([]PortRecord{
		{ServerID: "srv1", Services: []Service{
			{Name: "ssh", LocalPort: 22, TunnelPort: testStart},
			{Name: "http", LocalPort: 80, TunnelPort: testStart + 1},
		}},
	})

	// A new server must not receive the ports already claimed by srv1.
	svcs, _ := p.AcquireOrReuse("srv2")
	for _, svc := range svcs {
		if svc.TunnelPort == testStart || svc.TunnelPort == testStart+1 {
			t.Errorf("new server received already-assigned port %d", svc.TunnelPort)
		}
	}
}

// ---- AcquireOrReuse ------------------------------------------------------

func TestPortPool_AcquireOrReuse_NewServer(t *testing.T) {
	p := newTestPool()
	svcs, conflicts := p.AcquireOrReuse("new-server")

	if len(conflicts) != 0 {
		t.Fatalf("new server: unexpected conflicts: %+v", conflicts)
	}
	if len(svcs) != len(defaultServiceSpecs) {
		t.Fatalf("new server: expected %d services, got %d", len(defaultServiceSpecs), len(svcs))
	}
	// Verify port is within range.
	for _, svc := range svcs {
		if svc.TunnelPort < testStart || svc.TunnelPort > testEnd {
			t.Errorf("allocated port %d is outside range [%d,%d]", svc.TunnelPort, testStart, testEnd)
		}
	}
}

func TestPortPool_AcquireOrReuse_SamePortsOnReconnect(t *testing.T) {
	p := newTestPool()

	first, _ := p.AcquireOrReuse("srv1")
	second, _ := p.AcquireOrReuse("srv1")

	if len(first) != len(second) {
		t.Fatalf("port count mismatch on reconnect: %d vs %d", len(first), len(second))
	}
	for i := range first {
		if first[i].TunnelPort != second[i].TunnelPort {
			t.Errorf("service[%d] port changed: %d → %d", i, first[i].TunnelPort, second[i].TunnelPort)
		}
	}
}

func TestPortPool_AcquireOrReuse_DifferentServersGetDifferentPorts(t *testing.T) {
	p := newTestPool()

	svc1, _ := p.AcquireOrReuse("srv1")
	svc2, _ := p.AcquireOrReuse("srv2")

	ports1 := portSet(svc1)
	for _, svc := range svc2 {
		if ports1[svc.TunnelPort] {
			t.Errorf("srv2 received a port already assigned to srv1: %d", svc.TunnelPort)
		}
	}
}

func TestPortPool_AcquireOrReuse_NoDuplicatePortsWithinServer(t *testing.T) {
	p := newTestPool()
	svcs, _ := p.AcquireOrReuse("srv1")

	seen := make(map[int]bool)
	for _, svc := range svcs {
		if seen[svc.TunnelPort] {
			t.Errorf("duplicate tunnel port within same server: %d", svc.TunnelPort)
		}
		seen[svc.TunnelPort] = true
	}
}

// ---- Release -------------------------------------------------------------

func TestPortPool_Release_FreedPortsReassignable(t *testing.T) {
	p := newTestPool()

	svcs1, _ := p.AcquireOrReuse("srv1")
	p.Release("srv1")

	// srv2 should be able to take the same ports that srv1 had.
	svcs2, _ := p.AcquireOrReuse("srv2")
	// At least one port from srv1 should appear in srv2 (range is small enough).
	freed := portSet(svcs1)
	var reused bool
	for _, svc := range svcs2 {
		if freed[svc.TunnelPort] {
			reused = true
		}
	}
	if !reused {
		t.Error("freed ports were not made available for reassignment")
	}
}

func TestPortPool_Release_Noop(t *testing.T) {
	// Release on unknown serverID must not panic.
	p := newTestPool()
	p.Release("nobody")
}

// ---- Conflict resolution -------------------------------------------------

func TestPortPool_Conflict_OSPortInUse(t *testing.T) {
	// Book a port at the OS level before the pool starts, then load it as an
	// existing assignment. AcquireOrReuse must detect the conflict and return a
	// ConflictResolution with a different port.
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", testStart+50))
	if err != nil {
		t.Skipf("cannot bind test port %d: %v", testStart+50, err)
	}
	defer ln.Close()

	p := newTestPool()
	p.LoadExisting([]PortRecord{
		{ServerID: "srv1", Services: []Service{
			{Name: "ssh", LocalPort: 22, TunnelPort: testStart + 50}, // ← occupied
			{Name: "http", LocalPort: 80, TunnelPort: testStart + 51},
		}},
	})

	svcs, conflicts := p.AcquireOrReuse("srv1")

	if len(conflicts) == 0 {
		t.Fatal("expected a ConflictResolution for the occupied port, got none")
	}
	found := false
	for _, cf := range conflicts {
		if cf.OldPort == testStart+50 {
			found = true
			if cf.NewPort == testStart+50 {
				t.Error("ConflictResolution: NewPort must differ from OldPort")
			}
		}
	}
	if !found {
		t.Errorf("ConflictResolution did not mention port %d: %+v", testStart+50, conflicts)
	}

	// The returned services must not contain the old (occupied) port.
	for _, svc := range svcs {
		if svc.TunnelPort == testStart+50 {
			t.Errorf("occupied port %d still present in returned services", testStart+50)
		}
	}
}

// ---- helpers -------------------------------------------------------------

func portSet(svcs []Service) map[int]bool {
	m := make(map[int]bool, len(svcs))
	for _, s := range svcs {
		m[s.TunnelPort] = true
	}
	return m
}
