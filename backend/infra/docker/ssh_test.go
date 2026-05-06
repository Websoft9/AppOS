package docker

import (
	"crypto/ed25519"
	"crypto/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

func TestBuildShellCommandQuotesArguments(t *testing.T) {
	got := buildShellCommand("docker", "compose", "-f", "/srv/app dir/docker-compose.yml", "up;touch /tmp/pwn", "quo'te")
	want := "'docker' 'compose' '-f' '/srv/app dir/docker-compose.yml' 'up;touch /tmp/pwn' 'quo'\\''te'"
	if got != want {
		t.Fatalf("unexpected shell command\nwant: %s\n got: %s", want, got)
	}
}

func TestResolveHostKeyCallbackStrictWithoutKnownHostsFails(t *testing.T) {
	t.Setenv("APPOS_SSH_KNOWN_HOSTS", filepath.Join(t.TempDir(), "missing_known_hosts"))
	t.Setenv("APPOS_REQUIRE_SSH_HOST_KEY", "true")
	t.Setenv("HOME", t.TempDir())

	_, err := resolveHostKeyCallback()
	if err == nil {
		t.Fatal("expected missing known_hosts to fail in strict mode")
	}
	if !strings.Contains(err.Error(), "ssh host key verification required") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestResolveHostKeyCallbackUsesConfiguredKnownHosts(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("APPOS_REQUIRE_SSH_HOST_KEY", "true")

	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(privateKey)
	if err != nil {
		t.Fatal(err)
	}

	knownHostsPath := filepath.Join(homeDir, "known_hosts")
	line := knownhosts.Line([]string{"example.com"}, signer.PublicKey())
	if err := os.WriteFile(knownHostsPath, []byte(line+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("APPOS_SSH_KNOWN_HOSTS", knownHostsPath)

	callback, err := resolveHostKeyCallback()
	if err != nil {
		t.Fatalf("expected configured known_hosts to load, got %v", err)
	}
	if callback == nil {
		t.Fatal("expected non-nil host key callback")
	}
}