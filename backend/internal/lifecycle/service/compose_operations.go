package service

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/deploy"
	"github.com/websoft9/appos/backend/internal/lifecycle/metadata"
	"github.com/websoft9/appos/backend/internal/lifecycle/model"
	"github.com/websoft9/appos/backend/internal/lifecycle/orchestration"
	"github.com/websoft9/appos/backend/internal/lifecycle/projection"
)

type ComposeOperationOptions struct {
	ExistingAppID      string
	OperationType      string
	ProjectDir         string
	ComposeProjectName string
}

type ComposeOperationRequest struct {
	ServerID    string
	ProjectName string
	Compose     string
	Source      string
	Adapter     string
}

func CreateOperationFromCompose(app core.App, auth *core.Record, request ComposeOperationRequest, options ComposeOperationOptions) (*core.Record, error) {
	if err := deploy.ValidateManualCompose(request.Compose); err != nil {
		return nil, err
	}

	normalizedProjectName := deploy.NormalizeProjectName(request.ProjectName)
	if normalizedProjectName == "" {
		normalizedProjectName = "app"
	}
	composeProjectName := normalizedProjectName
	if value := strings.TrimSpace(options.ComposeProjectName); value != "" {
		composeProjectName = value
	}
	projectDir := filepath.Join("/appos/data/apps/operations", normalizedProjectName)
	if value := strings.TrimSpace(options.ProjectDir); value != "" {
		projectDir = value
	}
	operationType := strings.TrimSpace(options.OperationType)
	if operationType == "" {
		operationType = string(model.OperationTypeInstall)
	}
	pipelineDefinition, err := metadata.DefinitionForSelector(model.DefinitionSelector{
		OperationType: operationType,
		Source:        request.Source,
		Adapter:       request.Adapter,
	})
	if err != nil {
		return nil, err
	}

	spec := map[string]any{
		"server_id":            request.ServerID,
		"source":               request.Source,
		"adapter":              request.Adapter,
		"compose_project_name": composeProjectName,
		"project_dir":          projectDir,
		"rendered_compose":     request.Compose,
		"operation_type":       operationType,
	}

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
			appRecord = core.NewRecord(appInstancesCol)
			appRecord.Set("key", fmt.Sprintf("%s-%d", normalizedProjectName, time.Now().UnixNano()))
			appRecord.Set("name", composeProjectName)
			appRecord.Set("server_id", request.ServerID)
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
		operationRecord.Set("server_id", request.ServerID)
		operationRecord.Set("operation_type", operationType)
		operationRecord.Set("trigger_source", request.Source)
		operationRecord.Set("adapter", request.Adapter)
		if auth != nil && auth.Collection() != nil && auth.Collection().Name == "users" {
			operationRecord.Set("requested_by", auth.Id)
		}
		operationRecord.Set("phase", string(model.OperationPhaseQueued))
		operationRecord.Set("spec_json", spec)
		operationRecord.Set("compose_project_name", composeProjectName)
		operationRecord.Set("project_dir", projectDir)
		operationRecord.Set("rendered_compose", request.Compose)
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
