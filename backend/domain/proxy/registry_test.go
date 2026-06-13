package proxy

import (
	"errors"
	"testing"

	proxyinfra "github.com/websoft9/appos/backend/infra/proxy"
)

func TestDefaultRegistrySeparatesPolicyAnchorsFromConcreteConsumers(t *testing.T) {
	registry, err := DefaultRegistry()
	if err != nil {
		t.Fatal(err)
	}

	if _, err := registry.RequireDirectUse("external_services.global"); !errors.Is(err, proxyinfra.ErrDirectUseDenied) {
		t.Fatalf("expected module-level external_services.global to deny direct use, got %v", err)
	}

	if _, err := registry.RequireDirectUse("platform_accounts.global"); !errors.Is(err, proxyinfra.ErrDirectUseDenied) {
		t.Fatalf("expected module-level platform_accounts.global to deny direct use, got %v", err)
	}

	for _, key := range []string{
		"ai_providers.global",
		"external_services.outbound_http",
		"platform_accounts.outbound_http",
		"servers.global",
		"feeds.fetch_source",
		"feeds.fetch_favicon",
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

	if _, err := registry.Require("docker.local_socket"); !errors.Is(err, proxyinfra.ErrUnknownConsumer) {
		t.Fatalf("expected docker.local_socket to be absent, got %v", err)
	}
	if _, err := registry.Require("docker.image_pull"); !errors.Is(err, proxyinfra.ErrUnknownConsumer) {
		t.Fatalf("expected docker.image_pull to be absent, got %v", err)
	}
	for _, key := range []string{"ai_providers.fetch_models", "ai_providers.reachability", "servers.remote_shell", "servers.ssh_control", "servers.sftp_control", "servers.reachability_probe"} {
		if _, err := registry.Require(key); !errors.Is(err, proxyinfra.ErrUnknownConsumer) {
			t.Fatalf("expected %s to be absent, got %v", key, err)
		}
	}
}