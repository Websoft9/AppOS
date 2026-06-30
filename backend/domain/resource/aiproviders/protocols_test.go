package aiproviders

import "testing"

func TestNormalizeProtocolConfigSyncsDefaultEndpoint(t *testing.T) {
	template := Template{
		ID:              "generic-llm",
		DefaultEndpoint: "",
		Protocols:       []TemplateProtocol{{ID: ProtocolOpenAI, Label: "OpenAI", Default: true}, {ID: ProtocolAnthropic, Label: "Anthropic"}},
	}
	endpoint, config := NormalizeProtocolConfig(template, "https://api.example.com/v1", map[string]any{})
	if endpoint != "https://api.example.com/v1" {
		t.Fatalf("expected active endpoint preserved, got %q", endpoint)
	}
	if got := firstConfigString(config, configDefaultProtocolKey); got != ProtocolOpenAI {
		t.Fatalf("expected default protocol %q, got %q", ProtocolOpenAI, got)
	}
	endpoints := protocolEndpointsFromConfig(config)
	if endpoints[ProtocolOpenAI] != "https://api.example.com/v1" {
		t.Fatalf("expected openai endpoint stored, got %#v", endpoints)
	}
}

func TestActiveEndpointUsesSelectedProtocol(t *testing.T) {
	provider := RestoreAIProvider(Snapshot{
		TemplateID: "generic-llm",
		Endpoint:   "https://api.openai.example/v1",
		Config: map[string]any{
			configDefaultProtocolKey: ProtocolAnthropic,
			configProtocolEndpointsKey: map[string]any{
				ProtocolOpenAI:    "https://api.openai.example/v1",
				ProtocolAnthropic: "https://api.anthropic.example",
			},
		},
	})
	if got := ActiveEndpoint(provider); got != "https://api.anthropic.example" {
		t.Fatalf("expected anthropic endpoint, got %q", got)
	}
	if got := EndpointForProtocol(provider, ProtocolOpenAI); got != "https://api.openai.example/v1" {
		t.Fatalf("expected openai endpoint, got %q", got)
	}
}

func TestTemplateProtocolsFallbackForAnthropic(t *testing.T) {
	protocols := TemplateProtocols(Template{ID: "anthropic", DefaultEndpoint: "https://api.anthropic.com"})
	if len(protocols) != 1 || protocols[0].ID != ProtocolAnthropic {
		t.Fatalf("expected anthropic fallback protocol, got %#v", protocols)
	}
	if !protocols[0].Default {
		t.Fatalf("expected anthropic protocol to be default")
	}
}
