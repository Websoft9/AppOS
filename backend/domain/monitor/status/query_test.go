package status_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/monitor/status"
	"github.com/websoft9/appos/backend/infra/collections"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func TestBuildOverviewReturnsMoreThanFiveHundredItems(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	col, err := app.FindCollectionByNameOrId(collections.MonitorLatestStatus)
	if err != nil {
		t.Fatal(err)
	}
	transitionAt := time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC)
	for index := 0; index < 501; index++ {
		rec := core.NewRecord(col)
		rec.Set("target_type", monitor.TargetTypeResource)
		rec.Set("target_id", fmt.Sprintf("inst-%03d", index))
		rec.Set("display_name", fmt.Sprintf("Instance %03d", index))
		rec.Set("status", monitor.StatusOffline)
		rec.Set("signal_source", monitor.SignalSourceAppOS)
		rec.Set("last_transition_at", transitionAt.Add(time.Duration(index)*time.Second).Format(time.RFC3339))
		if err := app.Save(rec); err != nil {
			t.Fatal(err)
		}
	}

	overview, err := status.BuildOverview(app)
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
