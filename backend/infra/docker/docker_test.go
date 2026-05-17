package docker

import (
	"context"
	"errors"
	"io"
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
