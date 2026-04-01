package service

import "testing"

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
