package service

import "testing"

func TestNormalizeServiceName(t *testing.T) {
	service, err := NormalizeServiceName("  nginx  ")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if service != "nginx.service" {
		t.Fatalf("expected nginx.service, got %q", service)
	}

	service, err = NormalizeServiceName("docker.service")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if service != "docker.service" {
		t.Fatalf("expected docker.service, got %q", service)
	}

	if _, err := NormalizeServiceName("bad;service"); err == nil {
		t.Fatal("expected invalid service name to fail")
	}
}

func TestValidateSystemdAction(t *testing.T) {
	action, err := ValidateSystemdAction(" Restart ")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if action != "restart" {
		t.Fatalf("expected restart, got %q", action)
	}

	if _, err := ValidateSystemdAction("reload"); err == nil {
		t.Fatal("expected unsupported action to fail")
	}
}

func TestParseSystemdShowProperties(t *testing.T) {
	raw := "Id=nginx.service\nActiveState=active\nSubState=running\nInvalidLine\n"
	details := ParseSystemdShowProperties(raw)
	if details["Id"] != "nginx.service" {
		t.Fatalf("expected Id parsed, got %#v", details)
	}
	if details["ActiveState"] != "active" || details["SubState"] != "running" {
		t.Fatalf("expected ActiveState/SubState parsed, got %#v", details)
	}
}

func TestResolveSystemdUnitPath(t *testing.T) {
	path, err := ResolveSystemdUnitPath(" /etc/systemd/system/nginx.service \n")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if path != "/etc/systemd/system/nginx.service" {
		t.Fatalf("expected trimmed unit path, got %q", path)
	}

	if _, err := ResolveSystemdUnitPath("/dev/null"); err == nil {
		t.Fatal("expected /dev/null path to fail")
	}
}
