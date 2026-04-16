package hooks

import (
	"errors"
	"fmt"

	"github.com/hibiken/asynq"
	"github.com/websoft9/appos/backend/domain/worker"
	"github.com/websoft9/appos/backend/infra/cronutil"
	comp "github.com/websoft9/appos/backend/platform/components"

	"github.com/pocketbase/pocketbase"
)

const componentsInventoryCronJobID = "appos_components_inventory_probe"
const monitorReachabilityCronJobID = "monitor_reachability_checks"
const monitorHeartbeatFreshnessCronJobID = "monitor_heartbeat_freshness"
const monitorCredentialCronJobID = "monitor_credential_checks"

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
		monitorHeartbeatFreshnessCronJobID,
		"*/1 * * * *",
		cronutil.Wrap(app, monitorHeartbeatFreshnessCronJobID, func() {
			if err := worker.EnqueueMonitorHeartbeatFreshness(asynqClient); err != nil {
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
