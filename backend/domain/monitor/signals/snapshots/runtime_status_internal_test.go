package snapshots

import (
	"testing"
	"time"

	"github.com/websoft9/appos/backend/domain/monitor"
)

func TestBuildAppRuntimeEventUsesRegistryPolicy(t *testing.T) {
	observedAt := time.Date(2026, 4, 20, 9, 0, 0, 0, time.UTC)
	entry := monitor.TargetRegistryEntry{
		StatusPriority: map[string]int{
			monitor.StatusHealthy: 1,
			monitor.StatusOffline: 6,
		},
		Checks: monitor.TargetCheckPolicies{
			AppHealth: &monitor.AppHealthTargetPolicy{
				StatusMap: map[string]string{
					monitor.StatusOffline: monitor.StatusUnknown,
				},
				ReasonMap: map[string]string{
					monitor.StatusOffline: "custom runtime stop mapping",
				},
				ReasonCodeMap: map[string]string{
					monitor.StatusOffline: "custom_app_runtime_stop",
				},
			},
		},
	}
	summary := map[string]any{"runtime_state": "stopped", "server_id": "server-1"}

	event := buildAppRuntimeEvent(entry, "Demo App", "server-1", "appinstance0001", "stopped", monitor.SignalSourceAppOS, observedAt, summary)
	if event.Status != monitor.StatusUnknown {
		t.Fatalf("expected custom app-health status mapping, got %q", event.Status)
	}
	if event.Reason != "custom runtime stop mapping" {
		t.Fatalf("expected custom app-health reason mapping, got %q", event.Reason)
	}
	if summary["reason_code"] != "custom_app_runtime_stop" {
		t.Fatalf("expected custom app-health reason code mapping, got %+v", summary)
	}
	if event.StatusPriorityMap[monitor.StatusOffline] != 6 {
		t.Fatalf("expected event to preserve registry status priority, got %+v", event.StatusPriorityMap)
	}
	if event.LastSuccessAt != nil {
		t.Fatal("expected stopped app runtime event to have no last success timestamp")
	}
	if event.LastFailureAt != nil {
		t.Fatal("expected stopped app runtime event to have no last failure timestamp when mapped to unknown")
	}
}

func TestBuildServerRuntimeEventUsesRegistryPolicy(t *testing.T) {
	observedAt := time.Date(2026, 4, 20, 9, 0, 0, 0, time.UTC)
	entry := monitor.TargetRegistryEntry{
		StatusPriority: map[string]int{
			monitor.StatusHealthy: 1,
			monitor.StatusOffline: 6,
		},
		Checks: monitor.TargetCheckPolicies{
			Runtime: &monitor.RuntimeSummaryTargetPolicy{
				StatusMap: map[string]string{
					"stopped": monitor.StatusOffline,
				},
				ReasonMap: map[string]string{
					"stopped": "custom server runtime stop mapping",
				},
				ReasonCodeMap: map[string]string{
					"stopped": "custom_server_runtime_stop",
				},
			},
		},
	}
	summary := map[string]any{"runtime_state": "stopped"}

	event := buildServerRuntimeEvent(entry, "Primary Server", "server-1", "stopped", monitor.SignalSourceAppOS, observedAt, summary)
	if event.Status != monitor.StatusOffline {
		t.Fatalf("expected custom server runtime status mapping, got %q", event.Status)
	}
	if event.Reason != "custom server runtime stop mapping" {
		t.Fatalf("expected custom server runtime reason mapping, got %q", event.Reason)
	}
	if summary["reason_code"] != "custom_server_runtime_stop" {
		t.Fatalf("expected custom server runtime reason code mapping, got %+v", summary)
	}
	if event.StatusPriorityMap[monitor.StatusOffline] != 6 {
		t.Fatalf("expected event to preserve registry status priority, got %+v", event.StatusPriorityMap)
	}
	if event.LastSuccessAt != nil {
		t.Fatal("expected stopped server runtime event to have no last success timestamp")
	}
	if event.LastFailureAt != nil {
		t.Fatal("expected stopped server runtime event to have no last failure timestamp when mapped to offline")
	}
	if failures := *event.ConsecutiveFailures; failures != 0 {
		t.Fatalf("expected stopped server runtime event to keep zero consecutive failures, got %d", failures)
	}
}
