package proxy

import (
	"errors"
	"testing"
)

func TestDefinitionSupportsMode(t *testing.T) {
	definition := Definition{
		Key:            "feeds.global",
		Title:          "Feeds",
		Location:       LocationLocal,
		Scope:          ScopeModule,
		AllowDirectUse: false,
		Adapter:        AdapterHTTPClient,
		TrafficClass:   TrafficClassPublicEgress,
		Support:        SupportProxyCapable,
		DefaultMode:    ModeFallback,
		AllowFallback:  true,
	}

	if !definition.SupportsMode(ModeDisabled) {
		t.Fatal("expected disabled mode to be supported")
	}
	if !definition.SupportsMode(ModeAlways) {
		t.Fatal("expected always mode to be supported")
	}
	if !definition.SupportsMode(ModeFallback) {
		t.Fatal("expected fallback mode to be supported")
	}

	bypassOnly := Definition{
		Key:            "servers.global",
		Title:          "Servers",
		Location:       LocationRemote,
		Scope:          ScopeModule,
		AllowDirectUse: false,
		Adapter:        AdapterDialer,
		TrafficClass:   TrafficClassControlPlane,
		Support:        SupportBypassOnly,
		DefaultMode:    ModeDisabled,
	}
	if bypassOnly.SupportsMode(ModeAlways) {
		t.Fatal("expected bypass-only definition to reject always mode")
	}
	if bypassOnly.SupportsMode(ModeFallback) {
		t.Fatal("expected bypass-only definition to reject fallback mode")
	}
}

func TestNewRegistryRejectsInvalidDefinitions(t *testing.T) {
	tests := []struct {
		name       string
		definition Definition
	}{
		{
			name: "module missing global suffix",
			definition: Definition{
				Key:            "feeds",
				Title:          "Feeds",
				Location:       LocationLocal,
				Scope:          ScopeModule,
				AllowDirectUse: false,
				Adapter:        AdapterHTTPClient,
				TrafficClass:   TrafficClassPublicEgress,
				Support:        SupportProxyCapable,
				DefaultMode:    ModeAlways,
			},
		},
		{
			name: "action missing module key",
			definition: Definition{
				Key:            "deploy.git_fetch",
				Title:          "Deploy Git Fetch",
				Location:       LocationLocal,
				Scope:          ScopeAction,
				AllowDirectUse: true,
				Adapter:        AdapterEnv,
				TrafficClass:   TrafficClassPublicEgress,
				Support:        SupportProxyCapable,
				DefaultMode:    ModeAlways,
			},
		},
		{
			name: "action family mismatch",
			definition: Definition{
				Key:            "deploy.git_fetch",
				Title:          "Deploy Git Fetch",
				Location:       LocationLocal,
				Scope:          ScopeAction,
				ModuleKey:      "feeds.global",
				AllowDirectUse: true,
				Adapter:        AdapterEnv,
				TrafficClass:   TrafficClassPublicEgress,
				Support:        SupportProxyCapable,
				DefaultMode:    ModeAlways,
			},
		},
		{
			name: "fallback without permission",
			definition: Definition{
				Key:            "platform_accounts.global",
				Title:          "Platform Accounts",
				Location:       LocationLocal,
				Scope:          ScopeModule,
				AllowDirectUse: false,
				Adapter:        AdapterHTTPClient,
				TrafficClass:   TrafficClassPublicEgress,
				Support:        SupportProxyCapable,
				DefaultMode:    ModeFallback,
			},
		},
		{
			name: "bypass only cannot allow fallback",
			definition: Definition{
				Key:            "servers.global",
				Title:          "Servers",
				Location:       LocationRemote,
				Scope:          ScopeModule,
				AllowDirectUse: false,
				Adapter:        AdapterDialer,
				TrafficClass:   TrafficClassControlPlane,
				Support:        SupportBypassOnly,
				DefaultMode:    ModeDisabled,
				AllowFallback:  true,
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := NewRegistry(test.definition); err == nil {
				t.Fatalf("expected validation failure for %+v", test.definition)
			}
		})
	}
}

func TestNewRegistryRejectsUnknownModuleReference(t *testing.T) {
	_, err := NewRegistry(
		Definition{
			Key:            "deploy.global",
			Title:          "Deploy",
			Location:       LocationLocal,
			Scope:          ScopeModule,
			AllowDirectUse: false,
			Adapter:        AdapterEnv,
			TrafficClass:   TrafficClassPublicEgress,
			Support:        SupportProxyCapable,
			DefaultMode:    ModeAlways,
		},
		Definition{
			Key:            "deploy.git_fetch",
			Title:          "Deploy Git Fetch",
			Location:       LocationLocal,
			Scope:          ScopeAction,
			ModuleKey:      "deploy_missing.global",
			AllowDirectUse: true,
			Adapter:        AdapterEnv,
			TrafficClass:   TrafficClassPublicEgress,
			Support:        SupportProxyCapable,
			DefaultMode:    ModeAlways,
		},
	)
	if err == nil {
		t.Fatal("expected missing module key validation error")
	}
}

func TestDefaultRegistryContainsExpectedDefinitions(t *testing.T) {
	registry, err := NewRegistry(
		Definition{
			Key:            "feeds.global",
			Title:          "Feeds",
			Location:       LocationLocal,
			Scope:          ScopeModule,
			AllowDirectUse: false,
			Adapter:        AdapterHTTPClient,
			TrafficClass:   TrafficClassPublicEgress,
			Support:        SupportProxyCapable,
			DefaultMode:    ModeAlways,
		},
		Definition{
			Key:            "feeds.fetch_source",
			Title:          "Feed Fetch Source",
			Location:       LocationLocal,
			Scope:          ScopeAction,
			ModuleKey:      "feeds.global",
			AllowDirectUse: true,
			Adapter:        AdapterHTTPClient,
			TrafficClass:   TrafficClassPublicEgress,
			Support:        SupportProxyCapable,
			DefaultMode:    ModeFallback,
			AllowFallback:  true,
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := registry.RequireDirectUse("feeds.global"); !errors.Is(err, ErrDirectUseDenied) {
		t.Fatalf("expected direct use denial for module-level key, got %v", err)
	}
	feedFetch, err := registry.RequireDirectUse("feeds.fetch_source")
	if err != nil {
		t.Fatal(err)
	}
	if !feedFetch.DirectUseAllowed() {
		t.Fatalf("expected action-level key to allow direct use, got %+v", feedFetch)
	}

	directUse := registry.DirectUse()
	if len(directUse) != 1 || directUse[0].Key != "feeds.fetch_source" {
		t.Fatalf("unexpected direct-use list: %+v", directUse)
	}

	enrollable := registry.Enrollable()
	if len(enrollable) != 2 {
		t.Fatalf("expected both definitions to be enrollable, got %+v", enrollable)
	}
}

func TestRegistryRequireReturnsUnknownConsumer(t *testing.T) {
	registry, err := NewRegistry(
		Definition{
			Key:            "feeds.global",
			Title:          "Feeds",
			Location:       LocationLocal,
			Scope:          ScopeModule,
			AllowDirectUse: false,
			Adapter:        AdapterHTTPClient,
			TrafficClass:   TrafficClassPublicEgress,
			Support:        SupportProxyCapable,
			DefaultMode:    ModeAlways,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	_, err = registry.Require("missing.consumer")
	if !errors.Is(err, ErrUnknownConsumer) {
		t.Fatalf("expected ErrUnknownConsumer, got %v", err)
	}
}
