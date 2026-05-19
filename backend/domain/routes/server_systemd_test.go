package routes

import (
	"testing"

	serversvc "github.com/websoft9/appos/backend/domain/resource/servers/service"
)

func TestParseSystemdServicesOutputAllowsMissingDescription(t *testing.T) {
	raw := "\x1b[31m●\x1b[0m auditd.service not-found inactive dead auditd.service\n● not-found inactive dead display-manager.service\nconnman.service loaded inactive dead\nbackup-task.service loaded active exited Backup task\n"

	services := serversvc.ParseSystemdServicesOutput(raw, "")
	if len(services) != 4 {
		t.Fatalf("expected 4 services, got %d", len(services))
	}

	if services[0].Name != "auditd.service" {
		t.Fatalf("expected auditd.service, got %#v", services[0])
	}
	if services[0].LoadState != "not-found" {
		t.Fatalf("expected not-found load_state, got %q", services[0].LoadState)
	}

	if services[1].Name != "display-manager.service" {
		t.Fatalf("expected display-manager.service, got %#v", services[1])
	}
	if services[1].Description != "" {
		t.Fatalf("expected empty description for display-manager, got %q", services[1].Description)
	}
	if services[1].SubState != "dead" {
		t.Fatalf("expected dead sub_state, got %q", services[1].SubState)
	}

	if services[3].Name != "backup-task.service" {
		t.Fatalf("expected backup task entry, got %#v", services[3])
	}
	if services[3].SubState != "exited" {
		t.Fatalf("expected exited sub_state, got %q", services[3].SubState)
	}
}

func TestParseSystemdServicesOutputFiltersByKeyword(t *testing.T) {
	raw := "display-manager.service loaded inactive dead\nbackup-task.service loaded active exited Backup task\n"

	services := serversvc.ParseSystemdServicesOutput(raw, "backup")
	if len(services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(services))
	}
	if services[0].Name != "backup-task.service" {
		t.Fatalf("expected backup-task.service, got %#v", services[0])
	}
}

func TestParseSystemdServicesOutputRejectsMalformedTrailingTokens(t *testing.T) {
	raw := "● not-found inactive dead auditd.service dead auditd.service\nconnman.service loaded inactive dead\n"

	services := serversvc.ParseSystemdServicesOutput(raw, "")
	if len(services) != 1 {
		t.Fatalf("expected 1 valid service, got %d (%#v)", len(services), services)
	}
	if services[0].Name != "connman.service" {
		t.Fatalf("expected connman.service, got %#v", services[0])
	}
}
