package service

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/lifecycle/metadata"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
	"github.com/websoft9/appos/backend/domain/lifecycle/orchestration"
	"github.com/websoft9/appos/backend/domain/lifecycle/projection"
)

var ErrDuplicateAppName = errors.New("application name already exists")

type ComposeOperationOptions struct {
	ExistingAppID      string
	OperationType      string
	ProjectDir         string
	ComposeProjectName string
}

type ComposeOperationRequest struct {
	ServerID       string
	ProjectName    string
	Compose        string
	Source         string
	Adapter        string
	ResolvedEnv    map[string]any
	ExposureIntent *ExposureIntent
	Metadata       map[string]any
	RuntimeInputs  *InstallRuntimeInputs
	SourceBuild    *InstallSourceBuildInput
}

func PreflightAndCreateOperationFromCompose(app core.App, auth *core.Record, request ComposeOperationRequest, options ComposeOperationOptions, probe InstallPreflightProbe) (*core.Record, error) {
	if strings.TrimSpace(options.ExistingAppID) == "" {
		resolutionRequest := BuildInstallResolutionRequest(
			request.ServerID,
			request.ProjectName,
			request.Compose,
			request.Source,
			request.Adapter,
			InstallIngressOptions{
				OperationType:      options.OperationType,
				ProjectDir:         options.ProjectDir,
				ComposeProjectName: options.ComposeProjectName,
				UserID:             operationUserID(auth),
				Env:                request.ResolvedEnv,
				ExposureIntent:     request.ExposureIntent,
				Metadata:           request.Metadata,
				RuntimeInputs:      request.RuntimeInputs,
				SourceBuild:        request.SourceBuild,
			},
		)
		preflightResult, err := CheckInstallFromCompose(app, InstallPreflightRequest{InstallResolutionRequest: resolutionRequest}, probe)
		if err != nil {
			return nil, err
		}
		if !preflightResult.OK {
			return nil, fmt.Errorf("install preflight blocked: %v", preflightResult.Message)
		}
	}

	return CreateOperationFromCompose(app, auth, request, options)
}

func CreateOperationFromCompose(app core.App, auth *core.Record, request ComposeOperationRequest, options ComposeOperationOptions) (*core.Record, error) {
	normalizedSpec, err := ResolveInstallFromCompose(app, BuildInstallResolutionRequest(
		request.ServerID,
		request.ProjectName,
		request.Compose,
		request.Source,
		request.Adapter,
		InstallIngressOptions{
			OperationType:      options.OperationType,
			ProjectDir:         options.ProjectDir,
			ComposeProjectName: options.ComposeProjectName,
			UserID:             operationUserID(auth),
			Env:                request.ResolvedEnv,
			ExposureIntent:     request.ExposureIntent,
			Metadata:           request.Metadata,
			RuntimeInputs:      request.RuntimeInputs,
			SourceBuild:        request.SourceBuild,
		},
	))
	if err != nil {
		return nil, err
	}
	return CreateOperationFromNormalizedInstallSpec(app, auth, normalizedSpec, options)
}

func CreateOperationFromNormalizedInstallSpec(app core.App, auth *core.Record, normalizedSpec NormalizedInstallSpec, options ComposeOperationOptions) (*core.Record, error) {
	pipelineDefinition, err := metadata.DefinitionForSelector(model.DefinitionSelector{
		OperationType: normalizedSpec.OperationType,
		Source:        normalizedSpec.Source,
		Adapter:       normalizedSpec.Adapter,
	})
	if err != nil {
		return nil, err
	}

	spec := normalizedSpec.OperationSpec()

	var operationRecord *core.Record
	err = app.RunInTransaction(func(txApp core.App) error {
		appInstancesCol, err := txApp.FindCollectionByNameOrId("app_instances")
		if err != nil {
			return err
		}
		operationsCol, err := txApp.FindCollectionByNameOrId("app_operations")
		if err != nil {
			return err
		}

		var appRecord *core.Record
		if existingAppID := strings.TrimSpace(options.ExistingAppID); existingAppID != "" {
			appRecord, err = txApp.FindRecordById("app_instances", existingAppID)
			if err != nil {
				return err
			}
		} else {
			existing, err := txApp.FindRecordsByFilter(
				appInstancesCol,
				fmt.Sprintf("name = '%s' && lifecycle_state != '%s'", escapeServiceFilterValue(normalizedSpec.ComposeProjectName), escapeServiceFilterValue(string(model.AppStateRetired))),
				"",
				1,
				0,
			)
			if err != nil {
				return err
			}
			if len(existing) > 0 {
				return fmt.Errorf("%w: %s", ErrDuplicateAppName, normalizedSpec.ComposeProjectName)
			}

			appRecord = core.NewRecord(appInstancesCol)
			appRecord.Set("key", fmt.Sprintf("%s-%d", normalizedSpec.ProjectName, time.Now().UnixNano()))
			appRecord.Set("name", normalizedSpec.ComposeProjectName)
			appRecord.Set("server_id", normalizedSpec.ServerID)
			appRecord.Set("lifecycle_state", string(model.AppStateInstalling))
			appRecord.Set("desired_state", string(model.DesiredStateRunning))
			appRecord.Set("health_summary", string(model.HealthUnknown))
			appRecord.Set("publication_summary", string(model.PublicationUnpublished))
			appRecord.Set("state_reason", "operation queued")
			if err := txApp.Save(appRecord); err != nil {
				return err
			}
		}

		operationRecord = core.NewRecord(operationsCol)
		operationRecord.Set("app", appRecord.Id)
		operationRecord.Set("server_id", normalizedSpec.ServerID)
		operationRecord.Set("operation_type", normalizedSpec.OperationType)
		operationRecord.Set("trigger_source", normalizedSpec.Source)
		operationRecord.Set("adapter", normalizedSpec.Adapter)
		if auth != nil && auth.Collection() != nil && auth.Collection().Name == "users" {
			operationRecord.Set("requested_by", auth.Id)
		}
		operationRecord.Set("phase", string(model.OperationPhaseQueued))
		operationRecord.Set("spec_json", spec)
		operationRecord.Set("compose_project_name", normalizedSpec.ComposeProjectName)
		operationRecord.Set("project_dir", normalizedSpec.ProjectDir)
		operationRecord.Set("rendered_compose", normalizedSpec.RenderedCompose)
		if len(normalizedSpec.ResolvedEnv) > 0 {
			operationRecord.Set("resolved_env_json", normalizedSpec.ResolvedEnv)
		}
		operationRecord.Set("queued_at", time.Now())
		if err := txApp.Save(operationRecord); err != nil {
			return err
		}

		pipelineRun, err := orchestration.SeedPipelineRun(txApp, operationRecord, pipelineDefinition)
		if err != nil {
			return err
		}

		projection.ApplyOperationQueued(appRecord, operationRecord, projection.QueueOptions{
			ExistingApp: strings.TrimSpace(options.ExistingAppID) != "",
		})
		if err := txApp.Save(appRecord); err != nil {
			return err
		}

		operationRecord.Set("pipeline_run", pipelineRun.Id)
		return txApp.Save(operationRecord)
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create operation: %w", err)
	}

	return operationRecord, nil
}

func operationUserID(auth *core.Record) string {
	if auth == nil {
		return ""
	}
	return strings.TrimSpace(auth.Id)
}

func escapeServiceFilterValue(value string) string {
	return strings.ReplaceAll(value, "'", "\\'")
}
