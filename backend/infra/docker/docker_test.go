package docker

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

type execCall struct {
	command string
	args    []string
}

type fakeExecutor struct {
	calls     []execCall
	run       func(command string, args ...string) (string, error)
	hostLabel string
}

func (f *fakeExecutor) Run(_ context.Context, command string, args ...string) (string, error) {
	f.calls = append(f.calls, execCall{command: command, args: append([]string(nil), args...)})
	if f.run == nil {
		return "", nil
	}
	return f.run(command, args...)
}

func (f *fakeExecutor) RunStream(context.Context, string, ...string) (io.ReadCloser, error) {
	return nil, errors.New("not implemented")
}

func (f *fakeExecutor) Ping(context.Context) error {
	return nil
}

func (f *fakeExecutor) Host() string {
	if f.hostLabel != "" {
		return f.hostLabel
	}
	return "fake"
}

func TestRegistryStatusUsesPullPathAndCleansUpProbeImage(t *testing.T) {
	exec := &fakeExecutor{}
	exec.run = func(command string, args ...string) (string, error) {
		if command != "docker" {
			t.Fatalf("unexpected command %q", command)
		}
		switch {
		case len(args) == 3 && args[0] == "image" && args[1] == "inspect" && args[2] == registryStatusProbeImage:
			return "", errors.New("No such image")
		case len(args) == 3 && args[0] == "pull" && args[1] == "--quiet" && args[2] == registryStatusProbeImage:
			return "pulled", nil
		case len(args) == 3 && args[0] == "image" && args[1] == "rm" && args[2] == registryStatusProbeImage:
			return "removed", nil
		default:
			t.Fatalf("unexpected args: %#v", args)
			return "", nil
		}
	}

	client := New(exec)
	output, err := client.RegistryStatus(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if output != "pulled" {
		t.Fatalf("unexpected output: %q", output)
	}
	if len(exec.calls) != 3 {
		t.Fatalf("expected 3 calls, got %d", len(exec.calls))
	}
	if got := exec.calls[0].args; len(got) != 3 || got[0] != "image" || got[1] != "inspect" || got[2] != registryStatusProbeImage {
		t.Fatalf("unexpected inspect call: %#v", got)
	}
	if got := exec.calls[1].args; len(got) != 3 || got[0] != "pull" || got[1] != "--quiet" || got[2] != registryStatusProbeImage {
		t.Fatalf("unexpected pull call: %#v", got)
	}
	if got := exec.calls[2].args; len(got) != 3 || got[0] != "image" || got[1] != "rm" || got[2] != registryStatusProbeImage {
		t.Fatalf("unexpected cleanup call: %#v", got)
	}
}

func TestRegistryStatusSkipsCleanupWhenProbeImageAlreadyExists(t *testing.T) {
	exec := &fakeExecutor{}
	exec.run = func(command string, args ...string) (string, error) {
		if command != "docker" {
			t.Fatalf("unexpected command %q", command)
		}
		switch {
		case len(args) == 3 && args[0] == "image" && args[1] == "inspect" && args[2] == registryStatusProbeImage:
			return "present", nil
		case len(args) == 3 && args[0] == "pull" && args[1] == "--quiet" && args[2] == registryStatusProbeImage:
			return "already up to date", nil
		default:
			t.Fatalf("unexpected args: %#v", args)
			return "", nil
		}
	}

	client := New(exec)
	if _, err := client.RegistryStatus(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(exec.calls) != 2 {
		t.Fatalf("expected 2 calls, got %d", len(exec.calls))
	}
}

func TestContainerInspectManyUsesSingleInspectCall(t *testing.T) {
	exec := &fakeExecutor{}
	client := New(exec)

	if _, err := client.ContainerInspectMany(context.Background(), []string{"ctr-1", "ctr-2"}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(exec.calls) != 1 {
		t.Fatalf("expected 1 call, got %d", len(exec.calls))
	}
	got := exec.calls[0]
	if got.command != "docker" {
		t.Fatalf("unexpected command %q", got.command)
	}
	if len(got.args) != 3 || got.args[0] != "inspect" || got.args[1] != "ctr-1" || got.args[2] != "ctr-2" {
		t.Fatalf("unexpected inspect-many args: %#v", got.args)
	}
}

func TestImageRemoveUsesForceFlag(t *testing.T) {
	exec := &fakeExecutor{}
	client := New(exec)

	if _, err := client.ImageRemove(context.Background(), "img-123"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(exec.calls) != 1 {
		t.Fatalf("expected 1 docker call, got %d", len(exec.calls))
	}
	got := exec.calls[0]
	if got.command != "docker" {
		t.Fatalf("unexpected command %q", got.command)
	}
	if len(got.args) != 4 || got.args[0] != "image" || got.args[1] != "rm" || got.args[2] != "-f" || got.args[3] != "img-123" {
		t.Fatalf("unexpected image remove args: %#v", got.args)
	}
}

func TestComposeConfigReadFallsBackToHostHelper(t *testing.T) {
	exec := &fakeExecutor{}
	exec.run = func(command string, args ...string) (string, error) {
		if command != "docker" {
			t.Fatalf("unexpected command %q", command)
		}
		switch {
		case len(args) == 5 && args[0] == "ps" && args[1] == "--filter":
			return "websoft9dev/appos:dev", nil
		case len(args) == 7 && args[0] == "run" && args[1] == "--rm":
			return "services:\n  web:\n    image: nginx\n", nil
		default:
			t.Fatalf("unexpected args: %#v", args)
			return "", nil
		}
	}

	client := New(exec)
	output, err := client.ComposeConfigRead("/missing/project")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if output != "services:\n  web:\n    image: nginx\n" {
		t.Fatalf("unexpected output: %q", output)
	}
	if len(exec.calls) != 2 {
		t.Fatalf("expected 2 docker calls, got %d", len(exec.calls))
	}
	if got := exec.calls[1].args; len(got) != 7 || got[0] != "run" || got[2] != "-v" {
		t.Fatalf("unexpected helper run args: %#v", got)
	}
	if got := exec.calls[1].args[3]; got != "/missing/project/docker-compose.yml:/appos-compose/docker-compose.yml:ro" {
		t.Fatalf("unexpected bind mount: %q", got)
	}
}

func TestComposeConfigWriteFallsBackToHostHelper(t *testing.T) {
	exec := &fakeExecutor{}
	exec.run = func(command string, args ...string) (string, error) {
		if command != "docker" {
			t.Fatalf("unexpected command %q", command)
		}
		switch {
		case len(args) == 5 && args[0] == "ps" && args[1] == "--filter":
			return "websoft9dev/appos:dev", nil
		case len(args) == 8 && args[0] == "run" && args[1] == "--rm":
			return "", nil
		default:
			t.Fatalf("unexpected args: %#v", args)
			return "", nil
		}
	}

	client := New(exec)
	if err := client.ComposeConfigWrite("/missing/project", "services:\n  web:\n"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(exec.calls) != 2 {
		t.Fatalf("expected 2 docker calls, got %d", len(exec.calls))
	}
	if got := exec.calls[1].args; len(got) != 8 || got[0] != "run" || got[2] != "-v" {
		t.Fatalf("unexpected helper run args: %#v", got)
	}
	if got := exec.calls[1].args[3]; got != "/missing/project/docker-compose.yml:/appos-compose/docker-compose.yml" {
		t.Fatalf("unexpected bind mount: %q", got)
	}
	if got := exec.calls[1].args[6]; got != "-lc" {
		t.Fatalf("unexpected shell args: %#v", got)
	}
}

func TestComposeConfigReadPrefersDirectFilesystemWhenAvailable(t *testing.T) {
	tempDir := t.TempDir()
	composePath := filepath.Join(tempDir, "docker-compose.yml")
	if err := os.WriteFile(composePath, []byte("services:\n  app:\n"), 0o600); err != nil {
		t.Fatalf("write compose file: %v", err)
	}

	exec := &fakeExecutor{}
	client := New(exec)
	output, err := client.ComposeConfigRead(tempDir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if output != "services:\n  app:\n" {
		t.Fatalf("unexpected output: %q", output)
	}
	if len(exec.calls) != 0 {
		t.Fatalf("expected no docker fallback calls, got %d", len(exec.calls))
	}
}
