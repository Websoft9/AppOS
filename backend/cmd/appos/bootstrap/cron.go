package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/core"
	"github.com/robfig/cron/v3"
	"github.com/websoft9/appos/backend/domain/feeds"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/resource/aiproviders"
	"github.com/websoft9/appos/backend/domain/secrets"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
	swinventory "github.com/websoft9/appos/backend/domain/software/inventory"
	"github.com/websoft9/appos/backend/domain/worker"
	"github.com/websoft9/appos/backend/domain/workflow"
	"github.com/websoft9/appos/backend/infra/cronutil"
	"github.com/websoft9/appos/backend/infra/egress"
	"github.com/websoft9/appos/backend/infra/persistence"

	"github.com/pocketbase/pocketbase"
)

const componentsInventoryCronJobID = "appos_components_inventory_probe"
const monitorInstanceReachabilityCronJobID = "monitor_instance_reachability_checks"
const monitorAIProviderReachabilityCronJobID = "monitor_ai_provider_reachability_checks"
const monitorConnectorReachabilityCronJobID = "monitor_connector_reachability_checks"
const monitorMetricsFreshnessCronJobID = "monitor_metrics_freshness"
const monitorServerReachabilityCronJobID = "monitor_server_reachability_checks"
const monitorFactsPullCronJobID = "monitor_facts_pull"
const monitorRuntimeSnapshotPullCronJobID = "monitor_runtime_snapshot_pull"
const monitorCredentialCronJobID = "monitor_credential_checks"
const monitorAppHealthCronJobID = "monitor_app_health_checks"
const feedsPollCronJobID = "feeds_poll"
const feedsRetentionCronJobID = "feeds_retention_sweep"
const aiProviderEnabledModelsPruneCronJobID = "ai_provider_enabled_models_prune"
const workflowDispatchCronJobID = "workflow_cron_dispatch"

var newAIProviderPruneHTTPClientPlan = egress.NewHTTPClientPlan

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
			client, err := egress.NewFetchHTTPClient(app, "http.general", 30*time.Second, false)
			if err != nil {
				panic(err)
			}
			if _, err := feeds.PollDueSources(context.TODO(), app, &client, time.Now().UTC()); err != nil {
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

	app.Cron().MustAdd(
		aiProviderEnabledModelsPruneCronJobID,
		"13 */6 * * *",
		cronutil.Wrap(app, aiProviderEnabledModelsPruneCronJobID, func() {
			if err := runAIProviderEnabledModelsPrune(app); err != nil {
				panic(err)
			}
		}),
	)

	if asynqClient == nil {
		return
	}

	app.Cron().MustAdd(
		workflowDispatchCronJobID,
		"*/1 * * * *",
		cronutil.Wrap(app, workflowDispatchCronJobID, func() {
			if err := dispatchWorkflowCronRuns(app, asynqClient, time.Now().UTC()); err != nil {
				panic(err)
			}
		}),
	)

	app.Cron().MustAdd(
		monitorInstanceReachabilityCronJobID,
		"0 * * * *",
		cronutil.Wrap(app, monitorInstanceReachabilityCronJobID, func() {
			if !shouldRunMonitorInterval(time.Now().UTC(), monitor.LoadSchedulingSettings(app).ReachabilityIntervalMinutes) {
				return
			}
			if err := worker.EnqueueMonitorReachabilitySweep(asynqClient); err != nil {
				panic(err)
			}
		}),
	)

	app.Cron().MustAdd(
		monitorAIProviderReachabilityCronJobID,
		"0 * * * *",
		cronutil.Wrap(app, monitorAIProviderReachabilityCronJobID, func() {
			if !shouldRunMonitorInterval(time.Now().UTC(), monitor.LoadSchedulingSettings(app).ReachabilityIntervalMinutes) {
				return
			}
			if err := worker.EnqueueMonitorAIProviderReachabilitySweep(asynqClient); err != nil {
				panic(err)
			}
		}),
	)

	app.Cron().MustAdd(
		monitorConnectorReachabilityCronJobID,
		"0 * * * *",
		cronutil.Wrap(app, monitorConnectorReachabilityCronJobID, func() {
			if !shouldRunMonitorInterval(time.Now().UTC(), monitor.LoadSchedulingSettings(app).ReachabilityIntervalMinutes) {
				return
			}
			if err := worker.EnqueueMonitorConnectorReachabilitySweep(asynqClient); err != nil {
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
		monitorServerReachabilityCronJobID,
		"*/1 * * * *",
		cronutil.Wrap(app, monitorServerReachabilityCronJobID, func() {
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

func dispatchWorkflowCronRuns(app core.App, asynqClient *asynq.Client, now time.Time) error {
	repo := persistence.NewWorkflowRepository(app)
	svc := workflow.NewService(repo)
	definitions, err := svc.ListCronEnabledDefinitions(context.Background())
	if err != nil {
		return err
	}
	for _, definition := range definitions {
		schedules, err := workflow.CronSchedules(definition.DefinitionYAML)
		if err != nil {
			app.Logger().Error("workflow cron parse failed", "workflow_id", definition.ID, "error", err)
			continue
		}
		for _, schedule := range schedules {
			if !shouldRunWorkflowSchedule(now, schedule) {
				continue
			}
			prepared, prepErr := svc.PrepareRun(context.Background(), workflow.PrepareRunInput{
				WorkflowID:       definition.ID,
				TriggerType:      workflow.TriggerCron,
				RequestedBy:      secrets.CreatedSourceSystem,
				RequestedByEmail: secrets.CreatedSourceSystem,
				Params:           map[string]any{},
			})
			if prepErr != nil {
				if errors.Is(prepErr, workflow.ErrOverlapSkipped) {
					continue
				}
				return prepErr
			}
			if err := worker.EnqueueWorkflowRun(asynqClient, prepared.Run.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

func shouldRunWorkflowSchedule(now time.Time, schedule string) bool {
	parser := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	parsed, err := parser.Parse(strings.TrimSpace(schedule))
	if err != nil {
		return false
	}
	next := parsed.Next(now.Add(-1 * time.Minute))
	return next.UTC().Year() == now.UTC().Year() && next.UTC().Month() == now.UTC().Month() && next.UTC().Day() == now.UTC().Day() && next.UTC().Hour() == now.UTC().Hour() && next.UTC().Minute() == now.UTC().Minute()
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

func runAIProviderEnabledModelsPrune(app *pocketbase.PocketBase) error {
	repo := persistence.NewAIProviderRepository(app)
	result, err := aiproviders.PruneUnavailableEnabledModels(
		context.Background(),
		repo,
		func(ctx context.Context, provider *aiproviders.AIProvider) (string, error) {
			credentialID := strings.TrimSpace(provider.CredentialID())
			if credentialID == "" {
				return "", nil
			}
			record, findErr := app.FindRecordById("secrets", credentialID)
			if findErr != nil {
				return "", findErr
			}
			ownerID := strings.TrimSpace(record.GetString("created_by"))
			if ownerID == "" {
				ownerID = secrets.CreatedSourceSystem
			}
			resolved, resolveErr := secrets.Resolve(app, credentialID, ownerID)
			if resolveErr != nil {
				return "", resolveErr
			}
			return secrets.FirstStringFromPayload(resolved.Payload, "apiKey", "api_key", "token", "value"), nil
		},
		func(ctx context.Context, provider *aiproviders.AIProvider, apiKey string) (aiproviders.FetchModelsResponse, error) {
			client, clientErr := newAIProviderPruneHTTPClient(app, provider)
			if clientErr != nil {
				return aiproviders.FetchModelsResponse{}, clientErr
			}
			endpoint, protocol, protocolErr := aiproviders.ResolveActiveEndpointAndProtocol(provider)
			if protocolErr != nil {
				return aiproviders.FetchModelsResponse{}, protocolErr
			}
			return aiproviders.FetchModels(ctx, endpoint, apiKey, strings.TrimSpace(provider.TemplateID()), protocol, &client)
		},
	)
	app.Logger().Info(
		"ai provider enabled model prune completed",
		"providers_scanned", result.ProvidersScanned,
		"providers_updated", result.ProvidersUpdated,
		"models_removed", result.ModelsRemoved,
	)
	return err
}

func newAIProviderPruneHTTPClient(app *pocketbase.PocketBase, provider *aiproviders.AIProvider) (http.Client, error) {
	tpl, _, err := aiproviders.FindTemplate(strings.TrimSpace(provider.TemplateID()))
	if err != nil {
		return http.Client{}, err
	}
	plan, err := newAIProviderPruneHTTPClientPlan(app, "http.ai", 8*time.Second, tpl.SkipTLSCertVerify)
	if err != nil {
		if app != nil {
			app.Logger().Warn("ai provider proxy resolution failed", "consumer", "http.ai", "error", err)
		}
		return egress.NewDirectHTTPClient(8*time.Second, tpl.SkipTLSCertVerify), nil
	}
	for _, warning := range plan.Decision.Warnings {
		if strings.TrimSpace(warning.Message) == "" {
			continue
		}
		app.Logger().Warn("ai provider proxy warning", "consumer", "http.ai", "code", string(warning.Code), "message", warning.Message)
	}
	return plan.Client, nil
}
