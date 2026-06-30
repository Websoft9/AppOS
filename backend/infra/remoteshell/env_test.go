package remoteshell

import (
	"strings"
	"testing"

	servers "github.com/websoft9/appos/backend/domain/resource/servers"
)

func TestWrapInteractiveShellIncludesExportsAndExec(t *testing.T) {
	env := map[string]string{
		"HTTPS_PROXY": "http://proxy.example.com:8080",
		"HTTP_PROXY":  "http://proxy.example.com:8080",
	}

	wrapped := wrapInteractiveShell("/bin/zsh -l", env)
	if !strings.HasPrefix(wrapped, "sh -lc ") {
		t.Fatalf("expected shell wrapper prefix, got %q", wrapped)
	}
	if !strings.Contains(wrapped, "export HTTP_PROXY=") {
		t.Fatalf("expected HTTP_PROXY export in wrapper, got %q", wrapped)
	}
	if !strings.Contains(wrapped, "http://proxy.example.com:8080") {
		t.Fatalf("expected proxy URL in wrapper, got %q", wrapped)
	}
	if !strings.Contains(wrapped, "export HTTPS_PROXY=") {
		t.Fatalf("expected HTTPS_PROXY export in wrapper, got %q", wrapped)
	}
	if !strings.Contains(wrapped, "exec /bin/zsh -l") {
		t.Fatalf("expected wrapped shell to exec original shell, got %q", wrapped)
	}
}

func TestClassifyTransportUsesLocalhostAsTunnelControlPath(t *testing.T) {
	transport := classifyTransport(servers.AccessConfig{Host: "127.0.0.1", Port: 22022})
	if transport != TransportTunnelControlSSH {
		t.Fatalf("expected tunnel control transport, got %q", transport)
	}

	transport = classifyTransport(servers.AccessConfig{Host: "remote.example.com", Port: 22})
	if transport != TransportDirectSSH {
		t.Fatalf("expected direct ssh transport, got %q", transport)
	}
}
