package terminal

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	cryptossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

var (
	hostKeyCallbackMu sync.Mutex
	hostKeyCallback   cryptossh.HostKeyCallback
	hostKeyCallbackOK bool
)

// HostKeyCallback resolves the SSH host-key verification policy shared by
// interactive terminal sessions and one-shot SSH command execution.
func HostKeyCallback() (cryptossh.HostKeyCallback, error) {
	hostKeyCallbackMu.Lock()
	defer hostKeyCallbackMu.Unlock()

	if hostKeyCallbackOK {
		return hostKeyCallback, nil
	}

	cb, err := resolveHostKeyCallback()
	if err != nil {
		return nil, err
	}
	hostKeyCallback = cb
	hostKeyCallbackOK = true
	return cb, nil
}

func resolveHostKeyCallback() (cryptossh.HostKeyCallback, error) {
	knownHostsPath := strings.TrimSpace(os.Getenv("APPOS_SSH_KNOWN_HOSTS"))
	candidates := make([]string, 0, 3)
	if knownHostsPath != "" {
		candidates = append(candidates, knownHostsPath)
	}
	if homeDir, err := os.UserHomeDir(); err == nil && homeDir != "" {
		candidates = append(candidates, filepath.Join(homeDir, ".ssh", "known_hosts"))
	}
	candidates = append(candidates, "/etc/ssh/ssh_known_hosts")

	existing := make([]string, 0, len(candidates))
	seen := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			existing = append(existing, candidate)
		}
	}

	if len(existing) > 0 {
		callback, err := knownhosts.New(existing...)
		if err != nil {
			return nil, fmt.Errorf("load known_hosts: %w", err)
		}
		return callback, nil
	}

	requireStrict := strings.ToLower(strings.TrimSpace(os.Getenv("APPOS_REQUIRE_SSH_HOST_KEY")))
	if requireStrict == "1" || requireStrict == "true" || requireStrict == "yes" {
		return nil, fmt.Errorf("ssh host key verification required: no known_hosts file found (set by APPOS_REQUIRE_SSH_HOST_KEY)")
	}

	return cryptossh.InsecureIgnoreHostKey(), nil //nolint:gosec // intentional fallback when strict mode is not enabled
}
