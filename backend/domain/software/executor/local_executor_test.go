package executor

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/websoft9/appos/backend/domain/software"
	"github.com/websoft9/appos/backend/infra/process"
)

func TestLocalExecutorVerifyTreatsUninterruptibleAsDegraded(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "uptime"), []byte("500.00 0.00\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "stat"), []byte("cpu  1 1 1 1 1 1 1 1 1 1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	writeProcEntry(t, root, 101, "traefik", "D", 200)

	restore := process.SetProcRootForTesting(root)
	defer restore()

	executor := &LocalExecutor{}
	detail, err := executor.Verify(context.Background(), "", software.ResolvedTemplate{
		ComponentKey: "reverse-proxy",
		TemplateKind: software.TemplateKindBinary,
		Verify: software.VerifySpec{
			Strategy:    "process-running",
			ServiceName: "traefik",
		},
	})
	if err != nil {
		t.Fatalf("Verify returned error: %v", err)
	}
	if detail.VerificationState != software.VerificationStateDegraded {
		t.Fatalf("expected degraded verification state, got %q", detail.VerificationState)
	}
}

func writeProcEntry(t *testing.T, root string, pid int, comm, state string, startTicks int) {
	t.Helper()
	dir := filepath.Join(root, fmt.Sprintf("%d", pid))
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "comm"), []byte(comm+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "cmdline"), []byte("/usr/bin/"+comm+"\x00--flag\x00"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "status"), []byte("VmRSS:\t2048 kB\n"), 0600); err != nil {
		t.Fatal(err)
	}
	tail := []string{"0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", fmt.Sprintf("%d", startTicks)}
	stat := fmt.Sprintf("%d (%s) %s %s\n", pid, comm, state, strings.Join(tail, " "))
	if err := os.WriteFile(filepath.Join(dir, "stat"), []byte(stat), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "statm"), []byte("100 2\n"), 0600); err != nil {
		t.Fatal(err)
	}
}
