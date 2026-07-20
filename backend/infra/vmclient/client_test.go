package vmclient

import (
	"net/http"
	"testing"
	"time"
)

func TestNewWithoutHTTPClientUsesDirectTransport(t *testing.T) {
	client := New(nil)
	if client == nil || client.httpClient == nil {
		t.Fatal("expected vmclient to build a default HTTP client")
	}
	if client.httpClient.Timeout != 30*time.Second {
		t.Fatalf("expected 30s timeout, got %s", client.httpClient.Timeout)
	}
	transport, ok := client.httpClient.Transport.(*http.Transport)
	if !ok || transport == nil {
		t.Fatalf("expected direct transport, got %#v", client.httpClient.Transport)
	}
	if transport.Proxy != nil {
		t.Fatal("expected default vmclient transport to disable proxy resolution")
	}
}
