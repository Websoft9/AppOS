package supervisor

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultConfigUsesUnixSocketByDefault(t *testing.T) {
	t.Setenv("SUPERVISOR_URL", "")
	t.Setenv("SUPERVISOR_SOCKET", "")
	t.Setenv("SUPERVISOR_USERNAME", "")
	t.Setenv("SUPERVISOR_PASSWORD", "")

	cfg := DefaultConfig()
	if cfg.URL != "http://unix/RPC2" {
		t.Fatalf("expected unix RPC URL, got %q", cfg.URL)
	}
	if cfg.SocketPath != "/var/run/supervisor.sock" {
		t.Fatalf("expected default socket path, got %q", cfg.SocketPath)
	}
	if cfg.Username != "" || cfg.Password != "" {
		t.Fatalf("expected no auth for unix socket mode, got username=%q password-set=%t", cfg.Username, cfg.Password != "")
	}
}

func TestDefaultConfigAllowsExplicitHTTPOverride(t *testing.T) {
	t.Setenv("SUPERVISOR_URL", "http://127.0.0.1:9001/RPC2")
	t.Setenv("SUPERVISOR_SOCKET", "/tmp/ignored.sock")
	t.Setenv("SUPERVISOR_USERNAME", "admin")
	t.Setenv("SUPERVISOR_PASSWORD", "secret")

	cfg := DefaultConfig()
	if cfg.URL != "http://127.0.0.1:9001/RPC2" {
		t.Fatalf("expected explicit URL override, got %q", cfg.URL)
	}
	if cfg.SocketPath != "" {
		t.Fatalf("expected no socket path in HTTP mode, got %q", cfg.SocketPath)
	}
	if cfg.Username != "admin" || cfg.Password != "secret" {
		t.Fatalf("expected HTTP auth override, got username=%q password=%q", cfg.Username, cfg.Password)
	}
}

func TestClientGetAllProcessInfoOverUnixSocket(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "supervisor.sock")
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatalf("listen unix socket: %v", err)
	}
	defer listener.Close()
	t.Cleanup(func() {
		_ = os.Remove(socketPath)
	})

	server := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/RPC2" {
				t.Errorf("expected /RPC2 path, got %q", r.URL.Path)
			}
			body, readErr := io.ReadAll(r.Body)
			if readErr != nil {
				t.Errorf("read request body: %v", readErr)
			}
			if !strings.Contains(string(body), "supervisor.getAllProcessInfo") {
				t.Errorf("expected supervisor.getAllProcessInfo method, got %s", string(body))
			}
			w.Header().Set("Content-Type", "text/xml")
			_, _ = fmt.Fprint(w, `<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value>
        <array>
          <data>
            <value>
              <struct>
                <member><name>name</name><value><string>appos</string></value></member>
                <member><name>group</name><value><string>appos</string></value></member>
                <member><name>statename</name><value><string>RUNNING</string></value></member>
                <member><name>state</name><value><int>20</int></value></member>
                <member><name>pid</name><value><int>123</int></value></member>
                <member><name>now</name><value><int>200</int></value></member>
                <member><name>start</name><value><int>100</int></value></member>
              </struct>
            </value>
          </data>
        </array>
      </value>
    </param>
  </params>
</methodResponse>`)
		}),
	}
	defer server.Close()
	go func() {
		_ = server.Serve(listener)
	}()

	client := NewClient(Config{URL: "http://unix/RPC2", SocketPath: socketPath})
	processes, err := client.GetAllProcessInfo()
	if err != nil {
		t.Fatalf("GetAllProcessInfo over unix socket: %v", err)
	}
	if len(processes) != 1 {
		t.Fatalf("expected 1 process, got %d", len(processes))
	}
	if processes[0].Name != "appos" || processes[0].PID != 123 || processes[0].Uptime != 100 {
		t.Fatalf("unexpected process info: %+v", processes[0])
	}
}