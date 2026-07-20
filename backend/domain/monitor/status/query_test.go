package status

import (
	"fmt"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
)

func TestBuildOverviewReturnsMoreThanFiveHundredItems(t *testing.T) {
	col := core.NewBaseCollection("monitor_latest_status")
	transitionAt := time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC)
	records := make([]*core.Record, 0, 501)
	for index := 0; index < 501; index++ {
		rec := core.NewRecord(col)
		rec.Id = fmt.Sprintf("status-%03d", index)
		rec.Set("target_type", monitor.TargetTypeResource)
		rec.Set("target_id", fmt.Sprintf("inst-%03d", index))
		rec.Set("display_name", fmt.Sprintf("Instance %03d", index))
		rec.Set("status", monitor.StatusOffline)
		rec.Set("signal_source", monitor.SignalSourceAppOS)
		rec.Set("last_transition_at", transitionAt.Add(time.Duration(index)*time.Second).Format(time.RFC3339))
		records = append(records, rec)
	}

	overview, err := buildOverviewFromRecords(records)
	if err != nil {
		t.Fatal(err)
	}
	if got := overview.Counts[monitor.StatusOffline]; got != 501 {
		t.Fatalf("expected offline count 501, got %d", got)
	}
	if got := len(overview.UnhealthyItems); got != 501 {
		t.Fatalf("expected 501 unhealthy items, got %d", got)
	}
}

func TestBuildOverviewSynthesizesPlatformTargetsWhenMissing(t *testing.T) {
	overview, err := buildOverviewFromRecords(nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := len(overview.PlatformItems); got != 3 {
		t.Fatalf("expected 3 synthesized platform items, got %d", got)
	}
	if got := overview.Counts[monitor.StatusUnknown]; got != 3 {
		t.Fatalf("expected unknown count 3, got %d", got)
	}
	if overview.PlatformItems[0].TargetID != "appos-core" {
		t.Fatalf("expected appos-core first, got %+v", overview.PlatformItems)
	}
	if overview.PlatformItems[0].Summary["monitoring_state"] != "awaiting_self_observation" {
		t.Fatalf("expected awaiting summary, got %+v", overview.PlatformItems[0].Summary)
	}
}

func TestGetTargetStatusSynthesizesPlatformTargetStatus(t *testing.T) {
	resp, err := synthesizePlatformTargetStatus("worker")
	if err != nil {
		t.Fatal(err)
	}
	if resp.Status != monitor.StatusUnknown {
		t.Fatalf("expected unknown platform status, got %q", resp.Status)
	}
	if resp.SignalSource != monitor.SignalSourceSelf {
		t.Fatalf("expected self signal source, got %q", resp.SignalSource)
	}
	if resp.Summary["monitoring_state"] != "awaiting_self_observation" {
		t.Fatalf("expected awaiting summary, got %+v", resp.Summary)
	}
}
