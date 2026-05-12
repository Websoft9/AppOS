package bootstrap

import (
	"errors"
	"fmt"

	"github.com/hibiken/asynq"
	comp "github.com/websoft9/appos/backend/domain/components"
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

func registerCronHooks(app *pocketbase.PocketBase, asynqClient *asynq.Client) {
	app.Cron().MustAdd(
		componentsInventoryCronJobID,
		"*/15 * * * *",
		cronutil.Wrap(app, componentsInventoryCronJobID, func() {
			if err := runComponentsInventoryProbe(); err != nil {
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
			if err := worker.EnqueueMonitorReachabilitySweep(asynqClient); err != nil {
				panic(err)
			}
		}),
	)

	app.Cron().MustAdd(
		monitorMetricsFreshnessCronJobID,
		"*/1 * * * *",
		cronutil.Wrap(app, monitorMetricsFreshnessCronJobID, func() {
			if err := worker.EnqueueMonitorMetricsFreshness(asynqClient); err != nil {
				panic(err)
			}
		}),
	)

	app.Cron().MustAdd(
		monitorControlReachabilityCronJobID,
		"*/1 * * * *",
		cronutil.Wrap(app, monitorControlReachabilityCronJobID, func() {
			if err := worker.EnqueueMonitorControlReachability(asynqClient); err != nil {
				panic(err)
			}
		}),
	)

	app.Cron().MustAdd(
		monitorFactsPullCronJobID,
		"*/15 * * * *",
		cronutil.Wrap(app, monitorFactsPullCronJobID, func() {
			if err := worker.EnqueueMonitorFactsPull(asynqClient); err != nil {
				panic(err)
			}
		}),
	)

	app.Cron().MustAdd(
		monitorRuntimeSnapshotPullCronJobID,
		"*/1 * * * *",
		cronutil.Wrap(app, monitorRuntimeSnapshotPullCronJobID, func() {
			if err := worker.EnqueueMonitorRuntimeSnapshotPull(asynqClient); err != nil {
				panic(err)
			}
		}),
	)

	app.Cron().MustAdd(
		monitorCredentialCronJobID,
		"*/5 * * * *",
		cronutil.Wrap(app, monitorCredentialCronJobID, func() {
			if err := worker.EnqueueMonitorCredentialSweep(asynqClient); err != nil {
				panic(err)
			}
		}),
	)

	app.Cron().MustAdd(
		monitorAppHealthCronJobID,
		"*/1 * * * *",
		cronutil.Wrap(app, monitorAppHealthCronJobID, func() {
			if err := worker.EnqueueMonitorAppHealthSweep(asynqClient); err != nil {
				panic(err)
			}
		}),
	)
}

func runComponentsInventoryProbe() error {
	registry, err := comp.LoadRegistry()
	if err != nil {
		return err
	}

	var probeErrors []error
	for _, component := range registry.EnabledComponents() {
		if _, err := comp.DetectVersion(component.VersionProbe); err != nil {
			probeErrors = append(probeErrors, fmt.Errorf("%s version probe: %w", component.ID, err))
		}
		if _, err := comp.CheckAvailability(component.AvailabilityProbe); err != nil {
			probeErrors = append(probeErrors, fmt.Errorf("%s availability probe: %w", component.ID, err))
		}
		_ = comp.DetectUpdateTime(component.UpdateProbe)
	}

	return errors.Join(probeErrors...)
}
