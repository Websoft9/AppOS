package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
	"github.com/websoft9/appos/backend/domain/feeds"
	"github.com/websoft9/appos/backend/domain/monitor"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
	swinventory "github.com/websoft9/appos/backend/domain/software/inventory"
	"github.com/websoft9/appos/backend/domain/worker"
	"github.com/websoft9/appos/backend/infra/cronutil"

	"github.com/pocketbase/pocketbase"
)

const componentsInventoryCronJobID = "appos_components_inventory_probe"
const monitorReachabilityCronJobID = "monitor_reachability_checks"
const monitorMetricsFreshnessCronJobID = "monitor_metrics_freshness"
const monitorControlReachabilityCronJobID = "monitor_control_reachability"
const monitorFactsPullCronJobID = "monitor_facts_pull"
const monitorRuntimeSnapshotPullCronJobID = "monitor_runtime_snapshot_pull"
const monitorCredentialCronJobID = "monitor_credential_checks"
const monitorAppHealthCronJobID = "monitor_app_health_checks"
const feedsPollCronJobID = "feeds_poll"
const feedsRetentionCronJobID = "feeds_retention_sweep"

func registerCronHooks(app *pocketbase.PocketBase, asynqClient *asynq.Client) {
	app.Cron().MustAdd(
		componentsInventoryCronJobID,
		"*/15 * * * *",
		cronutil.Wrap(app, componentsInventoryCronJobID, func() {
			if err := runComponentsInventoryProbe(app); err != nil {
				panic(err)
			}
		}),
	)

	app.Cron().MustAdd(
		feedsPollCronJobID,
		"*/5 * * * *",
		cronutil.Wrap(app, feedsPollCronJobID, func() {
			if _, err := feeds.PollDueSources(context.TODO(), app, nil, time.Now().UTC()); err != nil {
				panic(err)
			}
		}),
	)

	app.Cron().MustAdd(
		feedsRetentionCronJobID,
		"0 * * * *",
		cronutil.Wrap(app, feedsRetentionCronJobID, func() {
			if _, err := feeds.RunRetentionSweep(app); err != nil {
				panic(err)
			}
		}),
	)

	if asynqClient == nil {
		return
	}

	app.Cron().MustAdd(
		monitorReachabilityCronJobID,
		"*/1 * * * *",
		cronutil.Wrap(app, monitorReachabilityCronJobID, func() {
			if !shouldRunMonitorInterval(time.Now().UTC(), monitor.LoadSchedulingSettings(app).ReachabilityIntervalMinutes) {
				return
			}
			if err := worker.EnqueueMonitorReachabilitySweep(asynqClient); err != nil {
				panic(err)
			}
		}),
	)

	app.Cron().MustAdd(
		monitorMetricsFreshnessCronJobID,
		"*/1 * * * *",
		cronutil.Wrap(app, monitorMetricsFreshnessCronJobID, func() {
			if !shouldRunMonitorInterval(time.Now().UTC(), monitor.LoadSchedulingSettings(app).MetricsFreshnessIntervalMinutes) {
				return
			}
			if err := worker.EnqueueMonitorMetricsFreshness(asynqClient); err != nil {
				panic(err)
			}
		}),
	)

	app.Cron().MustAdd(
		monitorControlReachabilityCronJobID,
		"*/1 * * * *",
		cronutil.Wrap(app, monitorControlReachabilityCronJobID, func() {
			if !shouldRunMonitorInterval(time.Now().UTC(), monitor.LoadSchedulingSettings(app).ControlReachabilityIntervalMinutes) {
				return
			}
			if err := worker.EnqueueMonitorControlReachability(asynqClient); err != nil {
				panic(err)
			}
		}),
	)

	app.Cron().MustAdd(
		monitorFactsPullCronJobID,
		"*/1 * * * *",
		cronutil.Wrap(app, monitorFactsPullCronJobID, func() {
			if !shouldRunMonitorInterval(time.Now().UTC(), monitor.LoadSchedulingSettings(app).FactsPullIntervalMinutes) {
				return
			}
			if err := worker.EnqueueMonitorFactsPull(asynqClient); err != nil {
				panic(err)
			}
		}),
	)

	app.Cron().MustAdd(
		monitorRuntimeSnapshotPullCronJobID,
		"*/1 * * * *",
		cronutil.Wrap(app, monitorRuntimeSnapshotPullCronJobID, func() {
			if !shouldRunMonitorInterval(time.Now().UTC(), monitor.LoadSchedulingSettings(app).RuntimeSnapshotIntervalMinutes) {
				return
			}
			if err := worker.EnqueueMonitorRuntimeSnapshotPull(asynqClient); err != nil {
				panic(err)
			}
		}),
	)

	app.Cron().MustAdd(
		monitorCredentialCronJobID,
		"*/1 * * * *",
		cronutil.Wrap(app, monitorCredentialCronJobID, func() {
			if !shouldRunMonitorInterval(time.Now().UTC(), monitor.LoadSchedulingSettings(app).CredentialSweepIntervalMinutes) {
				return
			}
			if err := worker.EnqueueMonitorCredentialSweep(asynqClient); err != nil {
				panic(err)
			}
		}),
	)

	app.Cron().MustAdd(
		monitorAppHealthCronJobID,
		"*/1 * * * *",
		cronutil.Wrap(app, monitorAppHealthCronJobID, func() {
			if !shouldRunMonitorInterval(time.Now().UTC(), monitor.LoadSchedulingSettings(app).AppHealthIntervalMinutes) {
				return
			}
			if err := worker.EnqueueMonitorAppHealthSweep(asynqClient); err != nil {
				panic(err)
			}
		}),
	)
}

func shouldRunMonitorInterval(now time.Time, intervalMinutes int) bool {
	if intervalMinutes <= 1 {
		return true
	}
	now = now.UTC()
	totalMinutes := now.Hour()*60 + now.Minute()
	return totalMinutes%intervalMinutes == 0
}

func runComponentsInventoryProbe(app *pocketbase.PocketBase) error {
	registry, err := swcatalog.LoadLocalRegistry()
	if err != nil {
		return err
	}

	var probeErrors []error
	for _, component := range registry.EnabledComponents() {
		if _, err := swinventory.DetectVersion(app, component.VersionProbe); err != nil {
			probeErrors = append(probeErrors, fmt.Errorf("%s version probe: %w", component.ID, err))
		}
		if _, err := swinventory.CheckAvailability(app, component.AvailabilityProbe); err != nil {
			probeErrors = append(probeErrors, fmt.Errorf("%s availability probe: %w", component.ID, err))
		}
		_ = swinventory.DetectUpdateTime(component.UpdateProbe)
	}

	return errors.Join(probeErrors...)
}
