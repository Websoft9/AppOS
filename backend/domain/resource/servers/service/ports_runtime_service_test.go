package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestPortRuntimeServiceDetectAllPortOccupancy(t *testing.T) {
	service := PortRuntimeService{
		Run: func(_ context.Context, command string, timeout time.Duration) (string, error) {
			if command != "ss -lntpH 2>/dev/null || true" {
				t.Fatalf("unexpected command: %q", command)
			}
			if timeout != 20*time.Second {
				t.Fatalf("unexpected timeout: %v", timeout)
			}
			return "LISTEN 0 128 *:22 *:* users:((\"sshd\",pid=101,fd=3),(\"systemd\",pid=1,fd=44))\nLISTEN 0 128 0.0.0.0:8080 0.0.0.0:* users:((\"app\",pid=202,fd=9))\n", nil
		},
	}

	result, err := service.DetectAllPortOccupancy(context.Background(), "tcp")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(result) != 2 {
		t.Fatalf("expected 2 occupied ports, got %#v", result)
	}
	if !result[22]["occupied"].(bool) || result[8080]["process"].(map[string]any)["name"] != "app" {
		t.Fatalf("unexpected occupancy result: %#v", result)
	}
	pids := result[22]["pids"].([]int)
	if len(pids) != 2 || pids[0] != 1 || pids[1] != 101 {
		t.Fatalf("unexpected pids: %#v", pids)
	}
}

func TestPortRuntimeServiceDetectAllPortReservations(t *testing.T) {
	service := PortRuntimeService{
		Run: func(_ context.Context, command string, timeout time.Duration) (string, error) {
			if timeout != 20*time.Second {
				t.Fatalf("unexpected timeout: %v", timeout)
			}
			switch command {
			case "systemctl list-sockets --all --no-legend --no-pager 2>/dev/null || true":
				return "0.0.0.0:80 nginx.socket nginx.service\n[::]:53 named.socket named.service\n", nil
			case "cat /proc/sys/net/ipv4/ip_local_reserved_ports 2>/dev/null || true":
				return "443,1000-1001\n", nil
			case "if command -v docker >/dev/null 2>&1; then (docker ps -a --format '{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null || echo '__DOCKER_CLI_ERROR__'); else echo '__DOCKER_NOT_AVAILABLE__'; fi":
				return "cid1\tweb\tUp 1 hour\t0.0.0.0:80->80/tcp, [::]:53->53/udp\n", nil
			default:
				t.Fatalf("unexpected command: %q", command)
				return "", nil
			}
		},
	}

	result, probe, err := service.DetectAllPortReservations(context.Background(), "tcp")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if probe["status"] != "ok" {
		t.Fatalf("unexpected probe: %#v", probe)
	}
	if len(result[80]) != 2 {
		t.Fatalf("expected systemd and container reservation for port 80, got %#v", result[80])
	}
	if len(result[443]) != 1 || result[443][0]["type"] != "kernel_reserved" {
		t.Fatalf("expected kernel reservation for port 443, got %#v", result[443])
	}
	if len(result[53]) != 1 || result[53][0]["type"] != "systemd_socket" {
		t.Fatalf("expected only systemd socket reservation for port 53 in tcp view, got %#v", result[53])
	}
}

func TestPortRuntimeServiceDetectAllProtocolPortReservations(t *testing.T) {
	service := PortRuntimeService{
		Run: func(_ context.Context, command string, timeout time.Duration) (string, error) {
			if timeout != 20*time.Second {
				t.Fatalf("unexpected timeout: %v", timeout)
			}
			switch command {
			case "systemctl list-sockets --all --no-legend --no-pager 2>/dev/null || true":
				return "0.0.0.0:80 nginx.socket nginx.service\n", nil
			case "cat /proc/sys/net/ipv4/ip_local_reserved_ports 2>/dev/null || true":
				return "443\n", nil
			case "if command -v docker >/dev/null 2>&1; then (docker ps -a --format '{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null || echo '__DOCKER_CLI_ERROR__'); else echo '__DOCKER_NOT_AVAILABLE__'; fi":
				return "cid1\tweb\tUp 1 hour\t0.0.0.0:80->80/tcp, [::]:53->53/udp\n", nil
			default:
				t.Fatalf("unexpected command: %q", command)
				return "", nil
			}
		},
	}

	result, _, err := service.DetectAllProtocolPortReservations(context.Background())
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(result[PortProtocolKey{Port: 80, Protocol: "tcp"}]) != 2 {
		t.Fatalf("expected socket + container reservations for 80/tcp, got %#v", result)
	}
	if len(result[PortProtocolKey{Port: 80, Protocol: "udp"}]) != 1 {
		t.Fatalf("expected inherited systemd socket reservation for 80/udp, got %#v", result)
	}
	if len(result[PortProtocolKey{Port: 53, Protocol: "udp"}]) != 1 {
		t.Fatalf("expected container reservation for 53/udp, got %#v", result)
	}
}

func TestPortRuntimeServiceDetectRunningContainerByPort(t *testing.T) {
	service := PortRuntimeService{
		Run: func(_ context.Context, command string, timeout time.Duration) (string, error) {
			if !strings.Contains(command, "docker ps --format") {
				t.Fatalf("unexpected command: %q", command)
			}
			if timeout != 20*time.Second {
				t.Fatalf("unexpected timeout: %v", timeout)
			}
			return "cid1\tstopped\tExited (0) 1 hour ago\t0.0.0.0:80->80/tcp\ncid2\tweb\tUp 1 hour\t0.0.0.0:80->80/tcp\n", nil
		},
	}

	owner, probe, err := service.DetectRunningContainerByPort(context.Background(), 80, "tcp")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if probe["status"] != "ok" || owner["container_id"] != "cid2" {
		t.Fatalf("unexpected owner/probe: owner=%#v probe=%#v", owner, probe)
	}
}

func TestPortRuntimeServiceRequiresRunner(t *testing.T) {
	_, err := (PortRuntimeService{}).DetectAllPortOccupancy(context.Background(), "tcp")
	if err == nil || !strings.Contains(err.Error(), "runner") {
		t.Fatalf("expected missing runner error, got %v", err)
	}
}

func TestPortRuntimeServicePropagatesRunnerError(t *testing.T) {
	wantErr := fmt.Errorf("boom")
	service := PortRuntimeService{
		Run: func(_ context.Context, _ string, _ time.Duration) (string, error) {
			return "", wantErr
		},
	}

	_, _, err := service.DetectAllPortReservations(context.Background(), "tcp")
	if err != wantErr {
		t.Fatalf("expected propagated error %v, got %v", wantErr, err)
	}
}

func TestPortRuntimeServiceReleasePortStopsContainer(t *testing.T) {
	call := 0
	service := PortRuntimeService{
		Run: func(_ context.Context, command string, timeout time.Duration) (string, error) {
			call++
			switch call {
			case 1:
				if command != "ss -lntpH 2>/dev/null || true" || timeout != 20*time.Second {
					t.Fatalf("unexpected occupancy command: %q timeout=%v", command, timeout)
				}
				return "LISTEN 0 128 0.0.0.0:80 0.0.0.0:* users:((\"docker-proxy\",pid=301,fd=3))\n", nil
			case 2:
				if !strings.Contains(command, "docker ps --format") || timeout != 20*time.Second {
					t.Fatalf("unexpected container detect command: %q timeout=%v", command, timeout)
				}
				return "cid1\tweb\tUp 1 hour\t0.0.0.0:80->80/tcp\n", nil
			case 3:
				if !strings.Contains(command, "docker stop 'cid1'") || timeout != 30*time.Second {
					t.Fatalf("unexpected release command: %q timeout=%v", command, timeout)
				}
				return "cid1\n", nil
			case 4:
				if command != "ss -lntpH 2>/dev/null || true" || timeout != 20*time.Second {
					t.Fatalf("unexpected post-release command: %q timeout=%v", command, timeout)
				}
				return "", nil
			default:
				t.Fatalf("unexpected extra call %d", call)
				return "", nil
			}
		},
		Pause: func(time.Duration) {},
	}

	result, err := service.ReleasePort(context.Background(), 80, "tcp", "graceful")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.OwnerType != "container" || result.ActionTaken != "docker stop" || !result.Released {
		t.Fatalf("unexpected release result: %#v", result)
	}
	if result.ContainerOwner["container_id"] != "cid1" {
		t.Fatalf("unexpected container owner: %#v", result.ContainerOwner)
	}
}

func TestPortRuntimeServiceReleasePortKillsHostProcessForce(t *testing.T) {
	call := 0
	service := PortRuntimeService{
		Run: func(_ context.Context, command string, timeout time.Duration) (string, error) {
			call++
			switch call {
			case 1:
				return "LISTEN 0 128 0.0.0.0:8080 0.0.0.0:* users:((\"app\",pid=202,fd=9))\n", nil
			case 2:
				return "__DOCKER_NOT_AVAILABLE__", nil
			case 3:
				if !strings.Contains(command, "kill -TERM") || !strings.Contains(command, "202") || timeout != 20*time.Second {
					t.Fatalf("unexpected term command: %q timeout=%v", command, timeout)
				}
				return "", nil
			case 4:
				if !strings.Contains(command, "kill -KILL") || !strings.Contains(command, "202") || timeout != 20*time.Second {
					t.Fatalf("unexpected kill command: %q timeout=%v", command, timeout)
				}
				return "", nil
			case 5:
				return "", nil
			default:
				t.Fatalf("unexpected extra call %d with %q", call, command)
				return "", nil
			}
		},
		Pause: func(time.Duration) {},
	}

	result, err := service.ReleasePort(context.Background(), 8080, "tcp", "force")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.OwnerType != "host_process" || result.ActionTaken != "kill -TERM then kill -KILL" || !result.Released {
		t.Fatalf("unexpected release result: %#v", result)
	}
	if len(result.PIDTargets) != 1 || result.PIDTargets[0] != 202 {
		t.Fatalf("unexpected pid targets: %#v", result.PIDTargets)
	}
}

func TestPortRuntimeServiceReleasePortConflictWithoutPID(t *testing.T) {
	call := 0
	service := PortRuntimeService{
		Run: func(_ context.Context, command string, _ time.Duration) (string, error) {
			call++
			switch call {
			case 1:
				return "LISTEN 0 128 0.0.0.0:9090 0.0.0.0:*\n", nil
			case 2:
				if !strings.Contains(command, "docker ps --format") {
					t.Fatalf("unexpected command: %q", command)
				}
				return "__DOCKER_NOT_AVAILABLE__", nil
			default:
				t.Fatalf("unexpected extra call %d", call)
				return "", nil
			}
		},
	}

	result, err := service.ReleasePort(context.Background(), 9090, "tcp", "graceful")
	if !errors.Is(err, ErrPortPIDNotResolvable) {
		t.Fatalf("expected pid-not-resolvable error, got %v", err)
	}
	if result.ContainerProbe["status"] != "not_available" {
		t.Fatalf("unexpected container probe: %#v", result.ContainerProbe)
	}
	if result.Before == nil || result.Before["occupied"] != true {
		t.Fatalf("unexpected before snapshot: %#v", result.Before)
	}
}