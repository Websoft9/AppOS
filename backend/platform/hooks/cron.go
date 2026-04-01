package hooks

import (
	"errors"
	"fmt"

	comp "github.com/websoft9/appos/backend/platform/components"
	"github.com/websoft9/appos/backend/infra/cronutil"

	"github.com/pocketbase/pocketbase"
)

const componentsInventoryCronJobID = "appos_components_inventory_probe"

func registerCronHooks(app *pocketbase.PocketBase) {
	app.Cron().MustAdd(
		componentsInventoryCronJobID,
		"*/15 * * * *",
		cronutil.Wrap(app, componentsInventoryCronJobID, func() {
			if err := runComponentsInventoryProbe(); err != nil {
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
