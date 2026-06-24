package service

import (
	"context"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/deploy"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

var (
	installPreflightBaselineOnce sync.Once
	installPreflightBaselineDir  string
	installPreflightBaselineErr  error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if installPreflightBaselineDir != "" {
		_ = os.RemoveAll(installPreflightBaselineDir)
	}
	os.Exit(code)
}

type installPreflightProbeStub struct {
	ports []InstallPreflightPublishedPort
}

func (p *installPreflightProbeStub) CheckPorts(_ context.Context, _ string, ports []InstallPreflightPublishedPort) (InstallPreflightPortsCheck, []string, error) {
	p.ports = append([]InstallPreflightPublishedPort(nil), ports...)
	hasConflict := false
	items := make([]InstallPreflightPortItem, 0, len(ports))
	for _, port := range ports {
		conflict := port.Port == 8080 && port.Protocol == "tcp"
		if conflict {
			hasConflict = true
		}
		items = append(items, InstallPreflightPortItem{
			Port:      port.Port,
			Protocol:  port.Protocol,
			Conflict:  conflict,
			Occupied:  conflict,
			Occupancy: map[string]any{"occupied": conflict},
			Reservation: map[string]any{
				"reserved": false,
				"sources":  []map[string]any{},
			},
		})
	}
	check := InstallPreflightCheck{OK: !hasConflict, Status: "ok", Message: "No host-port conflicts detected"}
	if hasConflict {
		check = InstallPreflightCheck{OK: false, Conflict: true, Status: "conflict", Message: "One or more declared host ports are already occupied or reserved"}
	}
	return InstallPreflightPortsCheck{InstallPreflightCheck: check, Items: items}, nil, nil
}

func (p *installPreflightProbeStub) CheckContainerNames(context.Context, string, []string) (InstallPreflightContainerNamesCheck, []string, error) {
	return InstallPreflightContainerNamesCheck{InstallPreflightCheck: InstallPreflightCheck{OK: true, Status: "not_applicable", Message: "compose does not declare explicit container_name values"}}, nil, nil
}

func (p *installPreflightProbeStub) CheckDockerAvailability(context.Context, string) (InstallPreflightDockerCheck, []string, error) {
	return InstallPreflightDockerCheck{InstallPreflightCheck: InstallPreflightCheck{OK: true, Status: "ok", Message: "Docker daemon is available"}, ServerVersion: "test"}, nil, nil
}

func (p *installPreflightProbeStub) CheckDiskSpace(context.Context, string, string, int64, int64) (InstallPreflightDiskSpaceCheck, []string, error) {
	return InstallPreflightDiskSpaceCheck{InstallPreflightCheck: InstallPreflightCheck{OK: true, Status: "ok", Message: "disk space is sufficient"}}, nil, nil
}

func newInstallPreflightTestApp(t *testing.T) *tests.TestApp {
	t.Helper()

	installPreflightBaselineOnce.Do(func() {
		app, err := tests.NewTestApp()
		if err != nil {
			installPreflightBaselineErr = err
			return
		}
		installPreflightBaselineDir = app.DataDir()
		installPreflightBaselineErr = app.ResetBootstrapState()
	})
	if installPreflightBaselineErr != nil {
		t.Fatal(installPreflightBaselineErr)
	}

	app, err := tests.NewTestApp(installPreflightBaselineDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		app.Cleanup()
	})
	return app
}

func TestParseAppRequiredDiskBytes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		metadata map[string]any
		want     int64
	}{
		{name: "nil metadata", metadata: nil, want: 0},
		{name: "missing field", metadata: map[string]any{"foo": "bar"}, want: 0},
		{name: "int", metadata: map[string]any{"app_required_disk_bytes": 1024}, want: 1024},
		{name: "int64", metadata: map[string]any{"app_required_disk_bytes": int64(2048)}, want: 2048},
		{name: "float64", metadata: map[string]any{"app_required_disk_bytes": float64(4096)}, want: 4096},
		{name: "string", metadata: map[string]any{"app_required_disk_bytes": "8192"}, want: 8192},
		{name: "negative", metadata: map[string]any{"app_required_disk_bytes": -1}, want: 0},
		{name: "invalid string", metadata: map[string]any{"app_required_disk_bytes": "oops"}, want: 0},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := parseAppRequiredDiskBytes(tt.metadata)
			if got != tt.want {
				t.Fatalf("parseAppRequiredDiskBytes() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestResourceChecksBlocking(t *testing.T) {
	t.Parallel()

	nonBlocking := InstallPreflightChecks{
		Compose:            InstallPreflightCheck{OK: true, Status: "ok"},
		AppName:            InstallPreflightCheck{OK: true, Status: "ok"},
		Ports:              InstallPreflightPortsCheck{InstallPreflightCheck: InstallPreflightCheck{OK: true, Status: "ok"}},
		ContainerNames:     InstallPreflightContainerNamesCheck{InstallPreflightCheck: InstallPreflightCheck{OK: true, Status: "ok"}},
		DockerAvailability: InstallPreflightDockerCheck{InstallPreflightCheck: InstallPreflightCheck{OK: true, Status: "unavailable"}},
		DiskSpace:          InstallPreflightDiskSpaceCheck{InstallPreflightCheck: InstallPreflightCheck{OK: true, Status: "warning"}},
	}
	if resourceChecksBlocking(nonBlocking) {
		t.Fatal("resourceChecksBlocking() should be false for warning/unavailable statuses")
	}

	conflict := nonBlocking
	conflict.Ports.InstallPreflightCheck = InstallPreflightCheck{OK: false, Conflict: true, Status: "conflict"}
	if !resourceChecksBlocking(conflict) {
		t.Fatal("resourceChecksBlocking() should be true when a conflict exists")
	}

	failed := nonBlocking
	failed.DockerAvailability.InstallPreflightCheck = InstallPreflightCheck{OK: false, Status: "failed"}
	if !resourceChecksBlocking(failed) {
		t.Fatal("resourceChecksBlocking() should be true for non-allowed failing status")
	}
}

func TestExtractComposePublishedPortsForTest(t *testing.T) {
	t.Parallel()

	compose := `services:
  web:
    ports:
      - "8080:80"
      - "127.0.0.1:5353:53/udp"
      - target: 80
        published: "9090"
        protocol: tcp
      - target: 53
        published: 5353
        protocol: udp
  api:
    ports:
      - "8080:8080"
`

	ports, err := ExtractComposePublishedPortsForTest(compose)
	if err != nil {
		t.Fatalf("ExtractComposePublishedPortsForTest() error = %v", err)
	}

	want := []InstallPreflightPublishedPort{
		{Port: 8080, Protocol: "tcp"},
		{Port: 9090, Protocol: "tcp"},
		{Port: 5353, Protocol: "udp"},
	}

	if len(ports) != len(want) {
		t.Fatalf("ports length = %d, want %d: %#v", len(ports), len(want), ports)
	}
	for i := range want {
		if ports[i] != want[i] {
			t.Fatalf("ports[%d] = %#v, want %#v", i, ports[i], want[i])
		}
	}
}

func TestExtractComposeExternalNetworkNamesForTest(t *testing.T) {
	t.Parallel()

	compose := `services:
  web:
    image: nginx:alpine
networks:
  default:
    name: websoft9
    external: true
  sidecar:
    external:
      name: ignored-by-compose
    name: custom-net
  internal:
    driver: bridge
`

	networks, err := ExtractComposeExternalNetworkNamesForTest(compose)
	if err != nil {
		t.Fatalf("ExtractComposeExternalNetworkNamesForTest() error = %v", err)
	}

	want := []string{"custom-net", "websoft9"}
	if len(networks) != len(want) {
		t.Fatalf("networks length = %d, want %d: %#v", len(networks), len(want), networks)
	}
	for i := range want {
		if networks[i] != want[i] {
			t.Fatalf("networks[%d] = %q, want %q", i, networks[i], want[i])
		}
	}
}

func TestCheckInstallFromComposeIncludesExposureIntentPortInChecks(t *testing.T) {
	t.Parallel()

	app := newInstallPreflightTestApp(t)
	probe := &installPreflightProbeStub{}

	result, err := CheckInstallFromCompose(app, InstallPreflightRequest{InstallResolutionRequest: InstallResolutionRequest{
		ServerID:    "server-1",
		ProjectName: "Exposure Demo",
		Compose:     "services:\n  web:\n    image: nginx:alpine\n",
		Trigger:     string(model.TriggerManual),
		Channel:     string(model.ChannelCustom),
		ExecutionMode: deploy.ExecutionModeCompose,
		ExposureIntent: &ExposureIntent{
			ExposureType: "port",
			TargetPort:   8080,
		},
	}}, probe)
	if err != nil {
		t.Fatalf("CheckInstallFromCompose() error = %v", err)
	}
	if result.OK {
		t.Fatal("expected preflight to fail when exposure intent port conflicts")
	}
	if len(probe.ports) != 1 || probe.ports[0].Port != 8080 || probe.ports[0].Protocol != "tcp" {
		t.Fatalf("expected exposure intent port to be checked, got %#v", probe.ports)
	}
	if !result.Checks.Ports.Conflict {
		t.Fatalf("expected port conflict in preflight checks, got %#v", result.Checks.Ports)
	}
}

func TestPreflightAndCreateOperationFromComposeBlocksExposureIntentPortConflict(t *testing.T) {
	t.Parallel()

	app := newInstallPreflightTestApp(t)
	probe := &installPreflightProbeStub{}

	_, err := PreflightAndCreateOperationFromCompose(app, nil, ComposeOperationRequest{
		ServerID:    "server-1",
		ProjectName: "Exposure Demo",
		Compose:     "services:\n  web:\n    image: nginx:alpine\n",
		Trigger:     string(model.TriggerManual),
		Channel:     string(model.ChannelCustom),
		ExecutionMode: deploy.ExecutionModeCompose,
		ExposureIntent: &ExposureIntent{
			ExposureType: "port",
			TargetPort:   8080,
		},
	}, ComposeOperationOptions{}, probe)
	if err == nil {
		t.Fatal("expected create preflight to block exposure intent port conflict")
	}
	if !strings.Contains(err.Error(), "install preflight blocked") {
		t.Fatalf("expected install preflight blocked error, got %v", err)
	}
	if len(probe.ports) != 1 || probe.ports[0].Port != 8080 || probe.ports[0].Protocol != "tcp" {
		t.Fatalf("expected exposure intent port to be checked before create, got %#v", probe.ports)
	}
}
