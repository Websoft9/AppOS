package process

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListMatchedProcessesUsesProgramAndOldestPID(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "uptime"), []byte("500.00 0.00\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "stat"), []byte("cpu  1 1 1 1 1 1 1 1 1 1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	writeProcEntry(t, root, 101, "nginx", "S", 200)
	writeProcEntry(t, root, 102, "nginx", "R", 300)
	writeProcEntry(t, root, 201, "redis-server", "S", 250)

	restore := SetProcRootForTesting(root)
	defer restore()

	items, err := ListMatchedProcesses([]MatchTarget{{Name: "nginx", Program: "nginx"}, {Name: "redis", Program: "redis-server"}})
	if err != nil {
		t.Fatalf("ListMatchedProcesses: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 matched processes, got %d", len(items))
	}
	if items[0].Name != "nginx" || items[0].PID != 101 {
		t.Fatalf("expected nginx to pick oldest pid 101, got %+v", items[0])
	}
	if items[1].Name != "redis" || items[1].PID != 201 {
		t.Fatalf("expected redis pid 201, got %+v", items[1])
	}
	if items[0].StateName != "sleeping" {
		t.Fatalf("expected sleeping state, got %q", items[0].StateName)
	}
	if items[0].Uptime != 498 {
		t.Fatalf("expected uptime 498, got %d", items[0].Uptime)
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
