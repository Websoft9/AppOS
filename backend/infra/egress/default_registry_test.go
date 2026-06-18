package egress

import (
	"errors"
	"testing"
)

func TestDefaultRegistrySeparatesPolicyAnchorsFromConcreteConsumers(t *testing.T) {
	registry, err := DefaultRegistry()
	if err != nil {
		t.Fatal(err)
	}

	if _, err := registry.RequireDirectUse("http.global"); !errors.Is(err, ErrDirectUseDenied) {
		t.Fatalf("expected module-level http.global to deny direct use, got %v", err)
	}

	if _, err := registry.RequireDirectUse("download.global"); !errors.Is(err, ErrDirectUseDenied) {
		t.Fatalf("expected module-level download.global to deny direct use, got %v", err)
	}
	if _, err := registry.RequireDirectUse("remote_shell.global"); !errors.Is(err, ErrDirectUseDenied) {
		t.Fatalf("expected module-level remote_shell.global to deny direct use, got %v", err)
	}

	for _, key := range []string{
		"http.general",
		"http.ai",
		"download.general",
		"git.general",
		"remote_shell.env",
		"remote_shell.tunnel_http",
		"remote_shell.tunnel_dialer",
	} {
		definition, err := registry.RequireDirectUse(key)
		if err != nil {
			t.Fatalf("expected direct-use consumer %q: %v", key, err)
		}
		if !definition.DirectUseAllowed() {
			t.Fatalf("expected %q to allow direct use", key)
		}
	}
}

func TestDefaultRegistryRemovesLegacyDockerLocalSocketSurface(t *testing.T) {
	registry, err := DefaultRegistry()
	if err != nil {
		t.Fatal(err)
	}

	if _, err := registry.Require("docker.local_socket"); !errors.Is(err, ErrUnknownConsumer) {
		t.Fatalf("expected docker.local_socket to be absent, got %v", err)
	}
	if _, err := registry.Require("docker.image_pull"); !errors.Is(err, ErrUnknownConsumer) {
		t.Fatalf("expected docker.image_pull to be absent, got %v", err)
	}
	for _, key := range []string{"ai_providers.fetch_models", "ai_providers.reachability", "servers.remote_shell"} {
		if _, err := registry.Require(key); !errors.Is(err, ErrUnknownConsumer) {
			t.Fatalf("expected %s to be absent, got %v", key, err)
		}
	}
}

func TestDefaultRegistryIncludesRemoteBypassOnlyServerControls(t *testing.T) {
	registry, err := DefaultRegistry()
	if err != nil {
		t.Fatal(err)
	}

	for _, key := range []string{"control_plane.ssh", "control_plane.sftp", "control_plane.reachability"} {
		definition, err := registry.Require(key)
		if err != nil {
			t.Fatalf("expected %s to exist: %v", key, err)
		}
		if definition.Enrollable() {
			t.Fatalf("expected %s to remain bypass-only", key)
		}
		if _, err := registry.RequireDirectUse(key); !errors.Is(err, ErrDirectUseDenied) {
			t.Fatalf("expected %s to deny direct use, got %v", key, err)
		}
	}
}
