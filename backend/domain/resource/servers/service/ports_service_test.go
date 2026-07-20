package service

import (
	"strings"
	"testing"
	"time"
)

func TestBuildPortListResultSortsAndDefaults(t *testing.T) {
	result := BuildPortListResult(
		"srv-1",
		"tcp",
		"all",
		map[int]map[string]any{8080: {"occupied": true}},
		map[int][]map[string]any{80: {{"source": "kernel"}}},
		map[string]any{"available": true, "status": "ok"},
		time.Date(2025, 1, 2, 3, 4, 5, 0, time.UTC),
	)

	ports := result["ports"].([]map[string]any)
	if len(ports) != 2 {
		t.Fatalf("expected 2 ports, got %d", len(ports))
	}
	if ports[0]["port"].(int) != 80 || ports[1]["port"].(int) != 8080 {
		t.Fatalf("expected sorted ports [80,8080], got %#v", ports)
	}
	occupancy := ports[0]["occupancy"].(map[string]any)
	if occupancy["occupied"].(bool) {
		t.Fatalf("expected default unoccupied entry for port 80")
	}
	if result["detected_at"].(string) != "2025-01-02T03:04:05Z" {
		t.Fatalf("unexpected detected_at: %v", result["detected_at"])
	}
}

func TestParseSSPortListenersParsesProcessesAndPIDs(t *testing.T) {
	raw := `LISTEN 0 128 *:22 *:* users:(("sshd",pid=101,fd=3),("systemd",pid=1,fd=44))`
	listeners := ParseSSPortListeners(raw, `\("([^"]+)",pid=([0-9]+),fd=[0-9]+\)`)
	if len(listeners) != 1 {
		t.Fatalf("expected 1 listener, got %d", len(listeners))
	}
	listener := listeners[0]
	if listener["local_address"].(string) != "*:22" {
		t.Fatalf("unexpected local address: %v", listener["local_address"])
	}
	pids := listener["pids"].([]int)
	if len(pids) != 2 || pids[0] != 1 || pids[1] != 101 {
		t.Fatalf("unexpected pids: %#v", pids)
	}
}

func TestParseRangePortsNormalizesInput(t *testing.T) {
	ports := ParseRangePorts("443, 100-98, 0-2, 70000, 5-1035")
	if len(ports) != 6 {
		t.Fatalf("expected 6 ports, got %d: %#v", len(ports), ports)
	}
	if ports[0] != 1 || ports[1] != 2 || ports[2] != 98 || ports[3] != 99 || ports[4] != 100 || ports[5] != 443 {
		t.Fatalf("unexpected normalized ports: %#v", ports)
	}
}

func TestParseContainerDeclaredReservationsAllProtocols(t *testing.T) {
	raw := "abc123\tweb\tUp 1 hour\t0.0.0.0:80->80/tcp, [::]:53->53/udp\n"
	byKey, probe := ParseContainerDeclaredReservationsAllProtocols(raw, `:([0-9]+)->[^/]+/(tcp|udp)`)
	if probe["status"] != "ok" {
		t.Fatalf("unexpected probe: %#v", probe)
	}
	if len(byKey) != 2 {
		t.Fatalf("expected 2 keys, got %d", len(byKey))
	}
	if len(byKey[PortProtocolKey{Port: 80, Protocol: "tcp"}]) != 1 {
		t.Fatalf("expected tcp port 80 reservation")
	}
	if len(byKey[PortProtocolKey{Port: 53, Protocol: "udp"}]) != 1 {
		t.Fatalf("expected udp port 53 reservation")
	}
}

func TestParseContainerDeclaredReservationsDockerUnavailable(t *testing.T) {
	matches, probe := ParseContainerDeclaredReservations("__DOCKER_NOT_AVAILABLE__", 8080, "tcp", `:([0-9]+)->[^/]+/(tcp|udp)`)
	if len(matches) != 0 {
		t.Fatalf("expected no matches, got %d", len(matches))
	}
	available, _ := probe["available"].(bool)
	if available {
		t.Fatalf("expected docker probe available=false")
	}
	status, _ := probe["status"].(string)
	if status != "not_available" {
		t.Fatalf("expected not_available status, got %q", status)
	}
}

func TestParseContainerDeclaredReservationsByPortAndProtocol(t *testing.T) {
	raw := strings.Join([]string{
		"abc123\tweb\tExited (0) 3 hours ago\t0.0.0.0:8080->80/tcp, [::]:8080->80/tcp",
		"def456\tdns\tUp 2 hours\t0.0.0.0:5353->53/udp",
	}, "\n")

	matches, probe := ParseContainerDeclaredReservations(raw, 8080, "tcp", `:([0-9]+)->[^/]+/(tcp|udp)`)
	if len(matches) != 1 {
		t.Fatalf("expected one match, got %d", len(matches))
	}
	if matches[0]["container_name"] != "web" {
		t.Fatalf("expected container web, got %#v", matches[0]["container_name"])
	}
	available, _ := probe["available"].(bool)
	if !available {
		t.Fatalf("expected docker probe available=true")
	}
}

func TestParseContainerDeclaredReservationsAllDockerUnavailable(t *testing.T) {
	all, probe := ParseContainerDeclaredReservationsAll("__DOCKER_NOT_AVAILABLE__", "tcp", `:([0-9]+)->[^/]+/(tcp|udp)`)
	if len(all) != 0 {
		t.Fatalf("expected no reservations, got %d", len(all))
	}
	available, _ := probe["available"].(bool)
	if available {
		t.Fatalf("expected docker probe available=false")
	}
}

func TestParseDockerPublishedPorts(t *testing.T) {
	ports := ParseDockerPublishedPorts("0.0.0.0:8080->80/tcp, [::]:8080->80/tcp, 0.0.0.0:5353->53/udp", "tcp", `:([0-9]+)->[^/]+/(tcp|udp)`)
	if len(ports) != 1 || ports[0] != 8080 {
		t.Fatalf("expected [8080], got %#v", ports)
	}
}

func TestParseSSPortListenersIncludesPIDs(t *testing.T) {
	listeners := ParseSSPortListeners("LISTEN 0 4096 0.0.0.0:8080 0.0.0.0:* users:((\"nginx\",pid=123,fd=6),(\"nginx\",pid=124,fd=7))", `\("([^"]+)",pid=([0-9]+),fd=[0-9]+\)`)
	if len(listeners) != 1 {
		t.Fatalf("expected one listener, got %d", len(listeners))
	}
	pids, ok := listeners[0]["pids"].([]int)
	if !ok {
		t.Fatalf("expected []int pids, got %#v", listeners[0]["pids"])
	}
	if len(pids) != 2 || pids[0] != 123 || pids[1] != 124 {
		t.Fatalf("expected [123 124], got %#v", pids)
	}
}

func TestParseRangePortsEdgeCases(t *testing.T) {
	if len(ParseRangePorts("")) != 0 {
		t.Fatal("expected empty for empty input")
	}

	result := ParseRangePorts("8080")
	if len(result) != 1 || result[0] != 8080 {
		t.Fatalf("expected [8080], got %v", result)
	}

	result = ParseRangePorts("100-103")
	if len(result) != 4 || result[0] != 100 || result[3] != 103 {
		t.Fatalf("expected [100 101 102 103], got %v", result)
	}

	result = ParseRangePorts("200-198")
	if len(result) != 3 || result[0] != 198 || result[2] != 200 {
		t.Fatalf("expected [198 199 200], got %v", result)
	}

	result = ParseRangePorts("80,80-82,81")
	if len(result) != 3 || result[0] != 80 || result[2] != 82 {
		t.Fatalf("expected [80 81 82], got %v", result)
	}

	result = ParseRangePorts("1-2000, 8080")
	if len(result) != 1 || result[0] != 8080 {
		t.Fatalf("expected [8080] with large range skipped, got %v", result)
	}

	result = ParseRangePorts("abc, 443, -")
	if len(result) != 1 || result[0] != 443 {
		t.Fatalf("expected [443], got %v", result)
	}

	result = ParseRangePorts("0, 70000, 22")
	if len(result) != 1 || result[0] != 22 {
		t.Fatalf("expected [22], got %v", result)
	}
}
