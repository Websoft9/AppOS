package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		authRule := types.Pointer("@request.auth.id != ''")

		for _, name := range []string{
			"pipeline_node_runs",
			"pipeline_runs",
			"app_exposures",
			"app_releases",
			"app_operations",
			"app_instances",
			"deployments",
		} {
			if col, err := app.FindCollectionByNameOrId(name); err == nil {
				if err := app.Delete(col); err != nil {
					return err
				}
			}
		}

		usersCol, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		certificatesCol, err := app.FindCollectionByNameOrId("certificates")
		if err != nil {
			return err
		}

		appInstances := core.NewBaseCollection("app_instances")
		appInstances.ListRule = authRule
		appInstances.ViewRule = authRule
		appInstances.CreateRule = authRule
		appInstances.UpdateRule = authRule
		appInstances.DeleteRule = nil
		appInstances.Fields.Add(&core.TextField{Name: "key", Required: true})
		appInstances.Fields.Add(&core.TextField{Name: "name", Required: true})
		appInstances.Fields.Add(&core.TextField{Name: "template_key"})
		appInstances.Fields.Add(&core.TextField{Name: "server_id", Required: true})
		appInstances.Fields.Add(&core.SelectField{
			Name:      "lifecycle_state",
			Required:  true,
			MaxSelect: 1,
			Values: []string{
				"registered",
				"installing",
				"running_healthy",
				"running_degraded",
				"maintenance",
				"updating",
				"recovering",
				"stopped",
				"attention_required",
				"retired",
			},
		})
		appInstances.Fields.Add(&core.SelectField{
			Name:      "desired_state",
			MaxSelect: 1,
			Values:    []string{"running", "stopped", "retired"},
		})
		appInstances.Fields.Add(&core.SelectField{
			Name:      "health_summary",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"healthy", "degraded", "unknown", "stopped"},
		})
		appInstances.Fields.Add(&core.SelectField{
			Name:      "publication_summary",
			MaxSelect: 1,
			Values:    []string{"unpublished", "published", "degraded", "unknown"},
		})
		appInstances.Fields.Add(&core.DateField{Name: "installed_at"})
		appInstances.Fields.Add(&core.DateField{Name: "last_healthy_at"})
		appInstances.Fields.Add(&core.DateField{Name: "retired_at"})
		appInstances.Fields.Add(&core.TextField{Name: "state_reason"})
		appInstances.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		appInstances.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
		appInstances.AddIndex("idx_app_instances_key", true, "`key`", "")
		appInstances.AddIndex("idx_app_instances_server_id", false, "`server_id`", "")
		appInstances.AddIndex("idx_app_instances_lifecycle_state", false, "`lifecycle_state`", "")
		appInstances.AddIndex("idx_app_instances_server_lifecycle", false, "`server_id`, `lifecycle_state`", "")
		if err := app.Save(appInstances); err != nil {
			return err
		}

		appOperations := core.NewBaseCollection("app_operations")
		appOperations.ListRule = authRule
		appOperations.ViewRule = authRule
		appOperations.CreateRule = authRule
		appOperations.UpdateRule = nil
		appOperations.DeleteRule = nil
		appOperations.Fields.Add(&core.RelationField{
			Name:         "app",
			CollectionId: appInstances.Id,
			Required:     true,
			MaxSelect:    1,
		})
		appOperations.Fields.Add(&core.TextField{Name: "server_id", Required: true})
		appOperations.Fields.Add(&core.SelectField{
			Name:      "operation_type",
			Required:  true,
			MaxSelect: 1,
			Values: []string{
				"install",
				"start",
				"stop",
				"upgrade",
				"redeploy",
				"reconfigure",
				"publish",
				"unpublish",
				"backup",
				"recover",
				"rollback",
				"maintain",
				"uninstall",
			},
		})
		appOperations.Fields.Add(&core.SelectField{
			Name:      "trigger_source",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"manualops", "fileops", "gitops", "store", "system"},
		})
		appOperations.Fields.Add(&core.TextField{Name: "adapter"})
		appOperations.Fields.Add(&core.RelationField{
			Name:         "requested_by",
			CollectionId: usersCol.Id,
			MaxSelect:    1,
		})
		appOperations.Fields.Add(&core.SelectField{
			Name:      "phase",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"queued", "validating", "preparing", "executing", "verifying", "compensating"},
		})
		appOperations.Fields.Add(&core.SelectField{
			Name:      "terminal_status",
			MaxSelect: 1,
			Values:    []string{"success", "failed", "cancelled", "compensated", "manual_intervention_required"},
		})
		appOperations.Fields.Add(&core.SelectField{
			Name:      "failure_reason",
			MaxSelect: 1,
			Values: []string{
				"timeout",
				"validation_error",
				"resource_conflict",
				"dependency_unavailable",
				"execution_error",
				"verification_failed",
				"compensation_failed",
				"unknown",
			},
		})
		appOperations.Fields.Add(&core.SelectField{
			Name:      "app_outcome",
			MaxSelect: 1,
			Values:    []string{"new_release_active", "previous_release_active", "no_healthy_release", "state_unknown"},
		})
		appOperations.Fields.Add(&core.JSONField{Name: "spec_json"})
		appOperations.Fields.Add(&core.TextField{Name: "compose_project_name"})
		appOperations.Fields.Add(&core.TextField{Name: "project_dir"})
		appOperations.Fields.Add(&core.TextField{Name: "rendered_compose"})
		appOperations.Fields.Add(&core.JSONField{Name: "resolved_env_json"})
		appOperations.Fields.Add(&core.JSONField{Name: "log_cursor"})
		appOperations.Fields.Add(&core.TextField{Name: "error_message"})
		appOperations.Fields.Add(&core.DateField{Name: "queued_at", Required: true})
		appOperations.Fields.Add(&core.DateField{Name: "started_at"})
		appOperations.Fields.Add(&core.DateField{Name: "ended_at"})
		appOperations.Fields.Add(&core.DateField{Name: "cancel_requested_at"})
		appOperations.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		appOperations.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
		appOperations.AddIndex("idx_app_operations_app", false, "`app`", "")
		appOperations.AddIndex("idx_app_operations_server_id", false, "`server_id`", "")
		appOperations.AddIndex("idx_app_operations_phase", false, "`phase`", "")
		appOperations.AddIndex("idx_app_operations_terminal_status", false, "`terminal_status`", "")
		appOperations.AddIndex("idx_app_operations_operation_type", false, "`operation_type`", "")
		appOperations.AddIndex("idx_app_operations_queued_at", false, "`queued_at`", "")
		appOperations.AddIndex("idx_app_operations_server_phase", false, "`server_id`, `phase`", "")
		if err := app.Save(appOperations); err != nil {
			return err
		}

		appReleases := core.NewBaseCollection("app_releases")
		appReleases.ListRule = authRule
		appReleases.ViewRule = authRule
		appReleases.CreateRule = nil
		appReleases.UpdateRule = nil
		appReleases.DeleteRule = nil
		appReleases.Fields.Add(&core.RelationField{
			Name:          "app",
			CollectionId:  appInstances.Id,
			Required:      true,
			MaxSelect:     1,
			CascadeDelete: true,
		})
		appReleases.Fields.Add(&core.RelationField{
			Name:         "created_by_operation",
			CollectionId: appOperations.Id,
			MaxSelect:    1,
		})
		appReleases.Fields.Add(&core.SelectField{
			Name:      "release_role",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"candidate", "active", "last_known_good", "historical"},
		})
		appReleases.Fields.Add(&core.TextField{Name: "version_label"})
		appReleases.Fields.Add(&core.SelectField{
			Name:      "source_type",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"template", "git", "file", "image", "manual"},
		})
		appReleases.Fields.Add(&core.TextField{Name: "source_ref"})
		appReleases.Fields.Add(&core.TextField{Name: "rendered_compose", Required: true})
		appReleases.Fields.Add(&core.JSONField{Name: "resolved_env_json"})
		appReleases.Fields.Add(&core.TextField{Name: "config_digest"})
		appReleases.Fields.Add(&core.TextField{Name: "artifact_digest"})
		appReleases.Fields.Add(&core.BoolField{Name: "is_active"})
		appReleases.Fields.Add(&core.BoolField{Name: "is_last_known_good"})
		appReleases.Fields.Add(&core.DateField{Name: "activated_at"})
		appReleases.Fields.Add(&core.DateField{Name: "superseded_at"})
		appReleases.Fields.Add(&core.TextField{Name: "notes"})
		appReleases.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		appReleases.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
		appReleases.AddIndex("idx_app_releases_app", false, "`app`", "")
		appReleases.AddIndex("idx_app_releases_is_active", false, "`is_active`", "")
		appReleases.AddIndex("idx_app_releases_is_last_known_good", false, "`is_last_known_good`", "")
		appReleases.AddIndex("idx_app_releases_activated_at", false, "`activated_at`", "")
		if err := app.Save(appReleases); err != nil {
			return err
		}

		appExposures := core.NewBaseCollection("app_exposures")
		appExposures.ListRule = authRule
		appExposures.ViewRule = authRule
		appExposures.CreateRule = authRule
		appExposures.UpdateRule = authRule
		appExposures.DeleteRule = nil
		appExposures.Fields.Add(&core.RelationField{
			Name:          "app",
			CollectionId:  appInstances.Id,
			Required:      true,
			MaxSelect:     1,
			CascadeDelete: true,
		})
		appExposures.Fields.Add(&core.RelationField{
			Name:         "release",
			CollectionId: appReleases.Id,
			MaxSelect:    1,
		})
		appExposures.Fields.Add(&core.SelectField{
			Name:      "exposure_type",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"domain", "path", "port", "internal_only"},
		})
		appExposures.Fields.Add(&core.BoolField{Name: "is_primary"})
		appExposures.Fields.Add(&core.TextField{Name: "domain"})
		appExposures.Fields.Add(&core.TextField{Name: "path"})
		appExposures.Fields.Add(&core.NumberField{Name: "target_port", OnlyInt: true})
		appExposures.Fields.Add(&core.RelationField{
			Name:         "certificate",
			CollectionId: certificatesCol.Id,
			MaxSelect:    1,
		})
		appExposures.Fields.Add(&core.SelectField{
			Name:      "publication_state",
			Required:  true,
			MaxSelect: 1,
			Values: []string{
				"unpublished",
				"publishing",
				"published",
				"published_degraded",
				"unpublishing",
				"publication_failed",
				"publication_attention_required",
			},
		})
		appExposures.Fields.Add(&core.SelectField{
			Name:      "health_state",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"healthy", "degraded", "unknown"},
		})
		appExposures.Fields.Add(&core.DateField{Name: "last_verified_at"})
		appExposures.Fields.Add(&core.DateField{Name: "disabled_at"})
		appExposures.Fields.Add(&core.TextField{Name: "notes"})
		appExposures.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		appExposures.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
		appExposures.AddIndex("idx_app_exposures_app", false, "`app`", "")
		appExposures.AddIndex("idx_app_exposures_publication_state", false, "`publication_state`", "")
		appExposures.AddIndex("idx_app_exposures_domain", false, "`domain`", "")
		if err := app.Save(appExposures); err != nil {
			return err
		}

		pipelineRuns := core.NewBaseCollection("pipeline_runs")
		pipelineRuns.ListRule = authRule
		pipelineRuns.ViewRule = authRule
		pipelineRuns.CreateRule = nil
		pipelineRuns.UpdateRule = nil
		pipelineRuns.DeleteRule = nil
		pipelineRuns.Fields.Add(&core.RelationField{
			Name:          "operation",
			CollectionId:  appOperations.Id,
			Required:      true,
			MaxSelect:     1,
			CascadeDelete: true,
		})
		pipelineRuns.Fields.Add(&core.SelectField{
			Name:      "pipeline_family",
			Required:  true,
			MaxSelect: 1,
			Values: []string{
				"ProvisionPipeline",
				"ChangePipeline",
				"ExposurePipeline",
				"RecoveryPipeline",
				"MaintenancePipeline",
				"RetirePipeline",
			},
		})
		pipelineRuns.Fields.Add(&core.TextField{Name: "pipeline_version"})
		pipelineRuns.Fields.Add(&core.SelectField{
			Name:      "current_phase",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"validating", "preparing", "executing", "verifying", "compensating"},
		})
		pipelineRuns.Fields.Add(&core.SelectField{
			Name:      "status",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"active", "completed", "failed", "cancelled"},
		})
		pipelineRuns.Fields.Add(&core.NumberField{Name: "node_count", Required: true, OnlyInt: true})
		pipelineRuns.Fields.Add(&core.NumberField{Name: "completed_node_count", OnlyInt: true})
		pipelineRuns.Fields.Add(&core.TextField{Name: "failed_node_key"})
		pipelineRuns.Fields.Add(&core.DateField{Name: "started_at"})
		pipelineRuns.Fields.Add(&core.DateField{Name: "ended_at"})
		pipelineRuns.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		pipelineRuns.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
		pipelineRuns.AddIndex("idx_pipeline_runs_operation", false, "`operation`", "")
		pipelineRuns.AddIndex("idx_pipeline_runs_status", false, "`status`", "")
		pipelineRuns.AddIndex("idx_pipeline_runs_started_at", false, "`started_at`", "")
		if err := app.Save(pipelineRuns); err != nil {
			return err
		}

		pipelineNodeRuns := core.NewBaseCollection("pipeline_node_runs")
		pipelineNodeRuns.ListRule = authRule
		pipelineNodeRuns.ViewRule = authRule
		pipelineNodeRuns.CreateRule = nil
		pipelineNodeRuns.UpdateRule = nil
		pipelineNodeRuns.DeleteRule = nil
		pipelineNodeRuns.Fields.Add(&core.RelationField{
			Name:          "pipeline_run",
			CollectionId:  pipelineRuns.Id,
			Required:      true,
			MaxSelect:     1,
			CascadeDelete: true,
		})
		pipelineNodeRuns.Fields.Add(&core.TextField{Name: "node_key", Required: true})
		pipelineNodeRuns.Fields.Add(&core.TextField{Name: "node_type", Required: true})
		pipelineNodeRuns.Fields.Add(&core.TextField{Name: "display_name", Required: true})
		pipelineNodeRuns.Fields.Add(&core.SelectField{
			Name:      "phase",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"validating", "preparing", "executing", "verifying", "compensating"},
		})
		pipelineNodeRuns.Fields.Add(&core.JSONField{Name: "depends_on_json"})
		pipelineNodeRuns.Fields.Add(&core.SelectField{
			Name:      "status",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"pending", "running", "succeeded", "failed", "skipped", "cancelled", "compensated"},
		})
		pipelineNodeRuns.Fields.Add(&core.NumberField{Name: "retry_count", OnlyInt: true})
		pipelineNodeRuns.Fields.Add(&core.TextField{Name: "compensation_node_key"})
		pipelineNodeRuns.Fields.Add(&core.TextField{Name: "error_code"})
		pipelineNodeRuns.Fields.Add(&core.TextField{Name: "error_message"})
		pipelineNodeRuns.Fields.Add(&core.DateField{Name: "started_at"})
		pipelineNodeRuns.Fields.Add(&core.DateField{Name: "ended_at"})
		pipelineNodeRuns.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		pipelineNodeRuns.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
		pipelineNodeRuns.AddIndex("idx_pipeline_node_runs_pipeline_run", false, "`pipeline_run`", "")
		pipelineNodeRuns.AddIndex("idx_pipeline_node_runs_status", false, "`status`", "")
		pipelineNodeRuns.AddIndex("idx_pipeline_node_runs_phase", false, "`phase`", "")
		if err := app.Save(pipelineNodeRuns); err != nil {
			return err
		}

		appInstances, err = app.FindCollectionByNameOrId("app_instances")
		if err != nil {
			return err
		}
		appInstances.Fields.Add(&core.RelationField{Name: "current_release", CollectionId: appReleases.Id, MaxSelect: 1})
		appInstances.Fields.Add(&core.RelationField{Name: "last_operation", CollectionId: appOperations.Id, MaxSelect: 1})
		appInstances.Fields.Add(&core.RelationField{Name: "primary_exposure", CollectionId: appExposures.Id, MaxSelect: 1})
		if err := app.Save(appInstances); err != nil {
			return err
		}

		appOperations, err = app.FindCollectionByNameOrId("app_operations")
		if err != nil {
			return err
		}
		appOperations.Fields.Add(&core.RelationField{Name: "baseline_release", CollectionId: appReleases.Id, MaxSelect: 1})
		appOperations.Fields.Add(&core.RelationField{Name: "candidate_release", CollectionId: appReleases.Id, MaxSelect: 1})
		appOperations.Fields.Add(&core.RelationField{Name: "result_release", CollectionId: appReleases.Id, MaxSelect: 1})
		appOperations.Fields.Add(&core.RelationField{Name: "pipeline_run", CollectionId: pipelineRuns.Id, MaxSelect: 1})
		return app.Save(appOperations)
	}, func(app core.App) error {
		for _, name := range []string{
			"pipeline_node_runs",
			"pipeline_runs",
			"app_exposures",
			"app_releases",
			"app_operations",
			"app_instances",
		} {
			if col, err := app.FindCollectionByNameOrId(name); err == nil {
				if err := app.Delete(col); err != nil {
					return err
				}
			}
		}
		return nil
	})
}