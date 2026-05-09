package routes

import "testing"

func TestParseSystemdServicesOutputAllowsMissingDescription(t *testing.T) {
	raw := "\x1b[31m●\x1b[0m auditd.service not-found inactive dead auditd.service\n● not-found inactive dead display-manager.service\nconnman.service loaded inactive dead\nbackup-task.service loaded active exited Backup task\n"

	services := parseSystemdServicesOutput(raw, "")
	if len(services) != 4 {
		t.Fatalf("expected 4 services, got %d", len(services))
	}

	if services[0]["name"] != "auditd.service" {
		t.Fatalf("expected auditd.service, got %#v", services[0])
	}
	if services[0]["load_state"] != "not-found" {
		t.Fatalf("expected not-found load_state, got %q", services[0]["load_state"])
	}

	if services[1]["name"] != "display-manager.service" {
		t.Fatalf("expected display-manager.service, got %#v", services[1])
	}
	if services[1]["description"] != "" {
		t.Fatalf("expected empty description for display-manager, got %q", services[1]["description"])
	}
	if services[1]["sub_state"] != "dead" {
		t.Fatalf("expected dead sub_state, got %q", services[1]["sub_state"])
	}

	if services[3]["name"] != "backup-task.service" {
		t.Fatalf("expected backup task entry, got %#v", services[3])
	}
	if services[3]["sub_state"] != "exited" {
		t.Fatalf("expected exited sub_state, got %q", services[3]["sub_state"])
	}
}

func TestParseSystemdServicesOutputFiltersByKeyword(t *testing.T) {
	raw := "display-manager.service loaded inactive dead\nbackup-task.service loaded active exited Backup task\n"

	services := parseSystemdServicesOutput(raw, "backup")
	if len(services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(services))
	}
	if services[0]["name"] != "backup-task.service" {
		t.Fatalf("expected backup-task.service, got %#v", services[0])
	}
}

func TestParseSystemdServicesOutputRejectsMalformedTrailingTokens(t *testing.T) {
	raw := "● not-found inactive dead auditd.service dead auditd.service\nconnman.service loaded inactive dead\n"

	services := parseSystemdServicesOutput(raw, "")
	if len(services) != 1 {
		t.Fatalf("expected 1 valid service, got %d (%#v)", len(services), services)
	}
	if services[0]["name"] != "connman.service" {
		t.Fatalf("expected connman.service, got %#v", services[0])
	}
}
