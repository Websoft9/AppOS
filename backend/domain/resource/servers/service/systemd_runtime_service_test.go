package service

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestSystemdRuntimeServiceListServices(t *testing.T) {
	service := SystemdRuntimeService{
		Run: func(_ context.Context, command string, timeout time.Duration) (string, error) {
			if command != "systemctl list-units --type=service --all --plain --no-legend --no-pager" {
				t.Fatalf("unexpected command: %q", command)
			}
			if timeout != 20*time.Second {
				t.Fatalf("unexpected timeout: %v", timeout)
			}
			return "backup-task.service loaded active exited Backup task\ndisplay-manager.service loaded inactive dead\n", nil
		},
	}

	items, err := service.ListServices(context.Background(), "backup")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(items) != 1 || items[0].Name != "backup-task.service" {
		t.Fatalf("unexpected items: %#v", items)
	}
}

func TestSystemdRuntimeServiceStatus(t *testing.T) {
	call := 0
	service := SystemdRuntimeService{
		Run: func(_ context.Context, command string, timeout time.Duration) (string, error) {
			call++
			if timeout != 20*time.Second {
				t.Fatalf("unexpected timeout: %v", timeout)
			}
			switch call {
			case 1:
				if !strings.Contains(command, "systemctl show nginx.service") {
					t.Fatalf("unexpected show command: %q", command)
				}
				return "Id=nginx.service\nActiveState=active\nSubState=running\n", nil
			case 2:
				if !strings.Contains(command, "systemctl status nginx.service") {
					t.Fatalf("unexpected status command: %q", command)
				}
				return "active (running)", nil
			default:
				t.Fatalf("unexpected extra call %d", call)
				return "", nil
			}
		},
	}

	result, err := service.Status(context.Background(), "nginx.service")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.Properties["Id"] != "nginx.service" || result.Properties["ActiveState"] != "active" {
		t.Fatalf("unexpected status properties: %#v", result.Properties)
	}
	if result.StatusText != "active (running)" {
		t.Fatalf("unexpected status text: %q", result.StatusText)
	}
}

func TestSystemdRuntimeServiceLogsAndContent(t *testing.T) {
	service := SystemdRuntimeService{
		Run: func(_ context.Context, command string, timeout time.Duration) (string, error) {
			switch {
			case strings.Contains(command, "journalctl -u nginx.service -n 50"):
				if timeout != 25*time.Second {
					t.Fatalf("unexpected log timeout: %v", timeout)
				}
				return "2026-05-19 nginx[1]: ready\n\n2026-05-19 nginx[1]: reloaded\n", nil
			case strings.Contains(command, "systemctl cat nginx.service"):
				if timeout != 20*time.Second {
					t.Fatalf("unexpected content timeout: %v", timeout)
				}
				return "[Unit]\nDescription=Nginx\n", nil
			default:
				t.Fatalf("unexpected command: %q", command)
				return "", nil
			}
		},
	}

	logs, err := service.Logs(context.Background(), "nginx.service", 50)
	if err != nil {
		t.Fatalf("logs failed: %v", err)
	}
	if logs.Lines != 50 || len(logs.Entries) != 2 {
		t.Fatalf("unexpected logs result: %#v", logs)
	}

	content, err := service.Content(context.Background(), "nginx.service")
	if err != nil {
		t.Fatalf("content failed: %v", err)
	}
	if !strings.Contains(content, "Description=Nginx") {
		t.Fatalf("unexpected content: %q", content)
	}
}

func TestSystemdRuntimeServiceResolveUnitPath(t *testing.T) {
	service := SystemdRuntimeService{
		Run: func(_ context.Context, command string, timeout time.Duration) (string, error) {
			if !strings.Contains(command, "systemctl show nginx.service --property=FragmentPath") {
				t.Fatalf("unexpected command: %q", command)
			}
			if timeout != 20*time.Second {
				t.Fatalf("unexpected timeout: %v", timeout)
			}
			return " /etc/systemd/system/nginx.service \n", nil
		},
	}

	path, err := service.ResolveUnitPath(context.Background(), "nginx.service")
	if err != nil {
		t.Fatalf("resolve path failed: %v", err)
	}
	if path != "/etc/systemd/system/nginx.service" {
		t.Fatalf("unexpected path: %q", path)
	}
}

func TestValidateSystemdUnitContent(t *testing.T) {
	if err := ValidateSystemdUnitContent("[Unit]\nDescription=Nginx\n"); err != nil {
		t.Fatalf("expected valid content, got %v", err)
	}
	if err := ValidateSystemdUnitContent("   "); err == nil {
		t.Fatal("expected blank content to fail")
	}
	tooLarge := strings.Repeat("x", MaxSystemdUnitContentBytes+1)
	if err := ValidateSystemdUnitContent(tooLarge); err == nil {
		t.Fatal("expected oversized content to fail")
	}
}

func TestSystemdRuntimeServiceAction(t *testing.T) {
	service := SystemdRuntimeService{
		Run: func(_ context.Context, command string, timeout time.Duration) (string, error) {
			expected := "(sudo -n systemctl restart nginx.service || systemctl restart nginx.service)"
			if command != expected {
				t.Fatalf("unexpected action command: %q", command)
			}
			if timeout != 25*time.Second {
				t.Fatalf("unexpected timeout: %v", timeout)
			}
			return "ok", nil
		},
	}

	result, err := service.Action(context.Background(), "nginx.service", "restart")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.Action != "restart" || result.Status != "accepted" || result.Output != "ok" {
		t.Fatalf("unexpected action result: %#v", result)
	}
}

func TestSystemdRuntimeServiceWriteUnit(t *testing.T) {
	call := 0
	service := SystemdRuntimeService{
		Run: func(_ context.Context, command string, timeout time.Duration) (string, error) {
			call++
			switch call {
			case 1:
				if !strings.Contains(command, "systemctl show nginx.service --property=FragmentPath") {
					t.Fatalf("unexpected resolve command: %q", command)
				}
				if timeout != 20*time.Second {
					t.Fatalf("unexpected resolve timeout: %v", timeout)
				}
				return "/etc/systemd/system/nginx.service\n", nil
			case 2:
				if !strings.Contains(command, "tee '/etc/systemd/system/nginx.service'") {
					t.Fatalf("unexpected write command: %q", command)
				}
				if timeout != 25*time.Second {
					t.Fatalf("unexpected write timeout: %v", timeout)
				}
				return "written", nil
			default:
				t.Fatalf("unexpected extra call %d", call)
				return "", nil
			}
		},
	}

	result, err := service.WriteUnit(context.Background(), "nginx.service", "[Unit]\nDescription=Nginx\n")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.Path != "/etc/systemd/system/nginx.service" || result.Status != "saved" || result.Output != "written" {
		t.Fatalf("unexpected write result: %#v", result)
	}
}

func TestSystemdRuntimeServiceVerifyUnit(t *testing.T) {
	call := 0
	service := SystemdRuntimeService{
		Run: func(_ context.Context, command string, timeout time.Duration) (string, error) {
			call++
			switch call {
			case 1:
				return "/etc/systemd/system/nginx.service\n", nil
			case 2:
				if !strings.Contains(command, "systemd-analyze verify '/etc/systemd/system/nginx.service'") {
					t.Fatalf("unexpected verify command: %q", command)
				}
				if timeout != 25*time.Second {
					t.Fatalf("unexpected verify timeout: %v", timeout)
				}
				return "valid", nil
			default:
				t.Fatalf("unexpected extra call %d", call)
				return "", nil
			}
		},
	}

	result, err := service.VerifyUnit(context.Background(), "nginx.service")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.Path != "/etc/systemd/system/nginx.service" || result.Status != "valid" || result.VerifyOutput != "valid" {
		t.Fatalf("unexpected verify result: %#v", result)
	}
}

func TestSystemdRuntimeServiceApplyUnit(t *testing.T) {
	call := 0
	service := SystemdRuntimeService{
		Run: func(_ context.Context, command string, timeout time.Duration) (string, error) {
			call++
			switch call {
			case 1:
				if command != "(sudo -n systemctl daemon-reload || systemctl daemon-reload)" {
					t.Fatalf("unexpected reload command: %q", command)
				}
				if timeout != 20*time.Second {
					t.Fatalf("unexpected reload timeout: %v", timeout)
				}
				return "reloaded", nil
			case 2:
				if command != "(sudo -n systemctl try-restart nginx.service || systemctl try-restart nginx.service)" {
					t.Fatalf("unexpected apply command: %q", command)
				}
				if timeout != 25*time.Second {
					t.Fatalf("unexpected apply timeout: %v", timeout)
				}
				return "restarted", nil
			default:
				t.Fatalf("unexpected extra call %d", call)
				return "", nil
			}
		},
	}

	result, err := service.ApplyUnit(context.Background(), "nginx.service")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.Status != "applied" || result.ReloadOutput != "reloaded" || result.ApplyOutput != "restarted" {
		t.Fatalf("unexpected apply result: %#v", result)
	}
}

func TestSystemdRuntimeServiceRequiresRunner(t *testing.T) {
	service := SystemdRuntimeService{}
	_, err := service.Content(context.Background(), "nginx.service")
	if err == nil || !strings.Contains(err.Error(), "runner") {
		t.Fatalf("expected missing runner error, got %v", err)
	}
}

func TestSystemdRuntimeServicePropagatesRunnerError(t *testing.T) {
	service := SystemdRuntimeService{
		Run: func(context.Context, string, time.Duration) (string, error) {
			return "", fmt.Errorf("ssh unavailable")
		},
	}

	_, err := service.ListServices(context.Background(), "")
	if err == nil || !strings.Contains(err.Error(), "ssh unavailable") {
		t.Fatalf("expected propagated error, got %v", err)
	}
}
