package checks

import (
	"testing"

	snapshots "github.com/websoft9/appos/backend/domain/monitor/signals/snapshots"
)

func TestParseServerRuntimeCommandOutput(t *testing.T) {
	summary := ParseServerRuntimeCommandOutput("running\nrunning\nrestarting\nexited\ncreated\n")
	if summary.Running != 2 {
		t.Fatalf("expected 2 running containers, got %+v", summary)
	}
	if summary.Restarting != 1 {
		t.Fatalf("expected 1 restarting container, got %+v", summary)
	}
	if summary.Exited != 2 {
		t.Fatalf("expected 2 exited containers, got %+v", summary)
	}
}

func TestRuntimeStateFromContainerSummary(t *testing.T) {
	tests := []struct {
		name    string
		summary snapshots.RuntimeContainerSummary
		want    string
	}{
		{name: "restarting degrades", summary: snapshots.RuntimeContainerSummary{Running: 2, Restarting: 1}, want: "degraded"},
		{name: "running healthy", summary: snapshots.RuntimeContainerSummary{Running: 2}, want: "healthy"},
		{name: "exited stopped", summary: snapshots.RuntimeContainerSummary{Exited: 1}, want: "stopped"},
		{name: "empty unknown", summary: snapshots.RuntimeContainerSummary{}, want: "unknown"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := RuntimeStateFromContainerSummary(tt.summary); got != tt.want {
				t.Fatalf("expected %q, got %q", tt.want, got)
			}
		})
	}
}
