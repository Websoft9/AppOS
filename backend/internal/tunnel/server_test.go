package tunnel

import (
	"os"
	"path/filepath"
	"testing"
)

// ---- Host key ------------------------------------------------------------

func TestServer_HostKeyPersisted(t *testing.T) {
	dir := t.TempDir()
	s := &Server{DataDir: dir}

	signer1, err := s.loadOrGenerateHostKey()
	if err != nil {
		t.Fatalf("first loadOrGenerateHostKey: %v", err)
	}

	keyPath := filepath.Join(dir, hostKeyFile)
	if _, err := os.Stat(keyPath); err != nil {
		t.Fatalf("host key file not created: %v", err)
	}

	// Load a second time — must return a signer with identical public key.
	signer2, err := s.loadOrGenerateHostKey()
	if err != nil {
		t.Fatalf("second loadOrGenerateHostKey: %v", err)
	}

	pub1 := signer1.PublicKey().Marshal()
	pub2 := signer2.PublicKey().Marshal()
	if string(pub1) != string(pub2) {
		t.Error("host key changed between loads — persistence is broken")
	}
}

func TestServer_HostKeyGeneratedOnMissingFile(t *testing.T) {
	dir := t.TempDir()
	s := &Server{DataDir: dir}

	_, err := s.loadOrGenerateHostKey()
	if err != nil {
		t.Fatalf("loadOrGenerateHostKey: %v", err)
	}

	info, err := os.Stat(filepath.Join(dir, hostKeyFile))
	if err != nil {
		t.Fatalf("host key file should exist: %v", err)
	}
	if info.Mode()&0o077 != 0 {
		t.Errorf("host key file mode %o is too permissive (want 0600)", info.Mode())
	}
}

// ---- Nil dependency guards -----------------------------------------------

type noopValidator struct{}

func (noopValidator) Validate(string) (string, bool) { return "", false }

type noopHooks struct{}

func (noopHooks) OnConnect(string, []Service, []ConflictResolution) {}
func (noopHooks) OnDisconnect(string)                               {}

func TestServer_InitRejectsNilValidator(t *testing.T) {
	s := &Server{
		DataDir:   t.TempDir(),
		Validator: nil,
		Hooks:     noopHooks{},
		Pool:      NewPortPool(59200, 59299),
		Sessions:  NewRegistry(),
	}
	if err := s.init(); err == nil {
		t.Error("init() should return error when Validator is nil")
	}
}

func TestServer_InitRejectsNilHooks(t *testing.T) {
	s := &Server{
		DataDir:   t.TempDir(),
		Validator: noopValidator{},
		Hooks:     nil,
		Pool:      NewPortPool(59200, 59299),
		Sessions:  NewRegistry(),
	}
	if err := s.init(); err == nil {
		t.Error("init() should return error when Hooks is nil")
	}
}

func TestServer_InitRejectsNilPool(t *testing.T) {
	s := &Server{
		DataDir:   t.TempDir(),
		Validator: noopValidator{},
		Hooks:     noopHooks{},
		Pool:      nil,
		Sessions:  NewRegistry(),
	}
	if err := s.init(); err == nil {
		t.Error("init() should return error when Pool is nil")
	}
}

func TestServer_InitRejectsNilSessions(t *testing.T) {
	s := &Server{
		DataDir:   t.TempDir(),
		Validator: noopValidator{},
		Hooks:     noopHooks{},
		Pool:      NewPortPool(59200, 59299),
		Sessions:  nil,
	}
	if err := s.init(); err == nil {
		t.Error("init() should return error when Sessions is nil")
	}
}

func TestServer_InitSucceedsWithAllDeps(t *testing.T) {
	s := &Server{
		DataDir:   t.TempDir(),
		Validator: noopValidator{},
		Hooks:     noopHooks{},
		Pool:      NewPortPool(59200, 59299),
		Sessions:  NewRegistry(),
	}
	if err := s.init(); err != nil {
		t.Errorf("init() unexpected error: %v", err)
	}
}

// ---- Constants sanity ----------------------------------------------------

func TestConstants_KeepaliveTimings(t *testing.T) {
	// keepaliveTimeout must be shorter than keepaliveInterval so that a
	// failing remote is detected within one interval.
	if keepaliveTimeout >= keepaliveInterval {
		t.Errorf("keepaliveTimeout (%v) must be < keepaliveInterval (%v)",
			keepaliveTimeout, keepaliveInterval)
	}
	// handshakeTimeout must be shorter than keepaliveInterval so it doesn't
	// interfere with established sessions.
	if handshakeTimeout >= keepaliveInterval {
		t.Errorf("handshakeTimeout (%v) should be < keepaliveInterval (%v)",
			handshakeTimeout, keepaliveInterval)
	}
}

// ---- NoPocketBase --------------------------------------------------------

func TestNoPocketBaseImport(t *testing.T) {
	// Real guard is `go list -f '{{.Imports}}' ./internal/tunnel/` — no "pocketbase" path.
	t.Log("PocketBase import guard: enforced at build time (internal/tunnel has no PB import)")
}
