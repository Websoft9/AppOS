package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/workflow"
	"github.com/websoft9/appos/backend/infra/collections"
)

type pocketBaseWorkflowRepository struct {
	app core.App
}

func NewWorkflowRepository(app core.App) workflow.Repository {
	return &pocketBaseWorkflowRepository{app: app}
}

func (r *pocketBaseWorkflowRepository) ListDefinitions(_ context.Context) ([]*workflow.DefinitionRecord, error) {
	records, err := r.app.FindRecordsByFilter(collections.Workflows, "", "-updated", 0, 0)
	if err != nil {
		return nil, err
	}
	items := make([]*workflow.DefinitionRecord, 0, len(records))
	for _, record := range records {
		items = append(items, workflowDefinitionFromRecord(record))
	}
	return items, nil
}

func (r *pocketBaseWorkflowRepository) GetDefinition(_ context.Context, id string) (*workflow.DefinitionRecord, error) {
	record, err := r.app.FindRecordById(collections.Workflows, id)
	if err != nil {
		return nil, err
	}
	return workflowDefinitionFromRecord(record), nil
}

func (r *pocketBaseWorkflowRepository) CreateDefinition(_ context.Context, input workflow.CreateDefinitionInput) (*workflow.DefinitionRecord, error) {
	col, err := r.app.FindCollectionByNameOrId(collections.Workflows)
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(col)
	applyWorkflowDefinitionRecord(record, input.Name, input.Description, input.IsEnabled, input.DefinitionYAML, input.DefaultServerID, input.TriggerTypesJSON, input.NodeCount, input.HasAINodes, input.CreatedBy)
	if err := r.app.Save(record); err != nil {
		return nil, err
	}
	return workflowDefinitionFromRecord(record), nil
}

func (r *pocketBaseWorkflowRepository) UpdateDefinition(_ context.Context, id string, input workflow.UpdateDefinitionInput) (*workflow.DefinitionRecord, error) {
	record, err := r.app.FindRecordById(collections.Workflows, id)
	if err != nil {
		return nil, err
	}
	applyWorkflowDefinitionRecord(record, input.Name, input.Description, input.IsEnabled, input.DefinitionYAML, input.DefaultServerID, input.TriggerTypesJSON, input.NodeCount, input.HasAINodes, record.GetString("created_by"))
	if err := r.app.Save(record); err != nil {
		return nil, err
	}
	return workflowDefinitionFromRecord(record), nil
}

func (r *pocketBaseWorkflowRepository) DeleteDefinition(_ context.Context, id string) error {
	record, err := r.app.FindRecordById(collections.Workflows, id)
	if err != nil {
		return err
	}
	return r.app.Delete(record)
}

func (r *pocketBaseWorkflowRepository) CreatePreparedRun(_ context.Context, input workflow.CreateRunInput, nodes []workflow.NodeRunSeed) (*workflow.RunRecord, []*workflow.NodeRunRecord, error) {
	var createdRun *workflow.RunRecord
	var createdNodeRuns []*workflow.NodeRunRecord
	err := r.app.RunInTransaction(func(txApp core.App) error {
		txRepo := &pocketBaseWorkflowRepository{app: txApp}
		activeRuns, err := txRepo.ListActiveRunsByWorkflow(context.Background(), input.WorkflowID)
		if err != nil {
			return err
		}
		if len(activeRuns) > 0 && input.OverlapPolicy == workflow.OverlapPolicySkip {
			return workflow.ErrOverlapSkipped
		}
		createdRun, err = txRepo.CreateRun(context.Background(), input)
		if err != nil {
			return err
		}
		createdNodeRuns, err = txRepo.CreateNodeRuns(context.Background(), createdRun.ID, nodes)
		if err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return createdRun, createdNodeRuns, nil
}

func (r *pocketBaseWorkflowRepository) CreateRun(_ context.Context, input workflow.CreateRunInput) (*workflow.RunRecord, error) {
	col, err := r.app.FindCollectionByNameOrId(collections.WorkflowRuns)
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(col)
	record.Set("workflow_definition", input.WorkflowID)
	record.Set("definition_yaml", strings.TrimSpace(input.DefinitionYAML))
	record.Set("status", strings.TrimSpace(input.Status))
	record.Set("trigger_type", strings.TrimSpace(input.TriggerType))
	record.Set("requested_by", strings.TrimSpace(input.RequestedBy))
	record.Set("requested_by_email", strings.TrimSpace(input.RequestedByEmail))
	record.Set("params_json", mustDecodeJSONMap(input.ParamsJSON))
	record.Set("resolved_server_id", strings.TrimSpace(input.ResolvedServerID))
	record.Set("overlap_policy", strings.TrimSpace(input.OverlapPolicy))
	record.Set("error_message", strings.TrimSpace(input.ErrorMessage))
	if err := r.app.Save(record); err != nil {
		return nil, err
	}
	return workflowRunFromRecord(record), nil
}

func (r *pocketBaseWorkflowRepository) GetRun(_ context.Context, id string) (*workflow.RunRecord, error) {
	record, err := r.app.FindRecordById(collections.WorkflowRuns, id)
	if err != nil {
		return nil, err
	}
	return workflowRunFromRecord(record), nil
}

func (r *pocketBaseWorkflowRepository) UpdateRun(_ context.Context, id string, input workflow.UpdateRunInput) (*workflow.RunRecord, error) {
	record, err := r.app.FindRecordById(collections.WorkflowRuns, id)
	if err != nil {
		return nil, err
	}
	if input.Status != nil {
		record.Set("status", strings.TrimSpace(*input.Status))
	}
	if input.StartedAt != nil {
		record.Set("started_at", parseDateTime(*input.StartedAt))
	}
	if input.EndedAt != nil {
		record.Set("ended_at", parseDateTime(*input.EndedAt))
	}
	if input.ErrorMessage != nil {
		record.Set("error_message", strings.TrimSpace(*input.ErrorMessage))
	}
	if err := r.app.Save(record); err != nil {
		return nil, err
	}
	return workflowRunFromRecord(record), nil
}

func (r *pocketBaseWorkflowRepository) ListRunsByWorkflow(_ context.Context, workflowID string) ([]*workflow.RunRecord, error) {
	records, err := r.app.FindRecordsByFilter(collections.WorkflowRuns, "workflow_definition = {:workflow}", "-created", 0, 0, map[string]any{"workflow": workflowID})
	if err != nil {
		return nil, err
	}
	items := make([]*workflow.RunRecord, 0, len(records))
	for _, record := range records {
		items = append(items, workflowRunFromRecord(record))
	}
	return items, nil
}

func (r *pocketBaseWorkflowRepository) CreateNodeRuns(_ context.Context, workflowRunID string, nodes []workflow.NodeRunSeed) ([]*workflow.NodeRunRecord, error) {
	col, err := r.app.FindCollectionByNameOrId(collections.WorkflowNodeRuns)
	if err != nil {
		return nil, err
	}
	items := make([]*workflow.NodeRunRecord, 0, len(nodes))
	for _, node := range nodes {
		record := core.NewRecord(col)
		record.Set("workflow_run", workflowRunID)
		record.Set("node_key", strings.TrimSpace(node.NodeKey))
		record.Set("node_type", strings.TrimSpace(node.NodeType))
		record.Set("display_name", strings.TrimSpace(node.DisplayName))
		record.Set("depends_on_json", mustDecodeJSONArray(node.DependsOnJSON))
		record.Set("status", strings.TrimSpace(node.Status))
		record.Set("retry_count", 0)
		record.Set("output_json", map[string]any{})
		if err := r.app.Save(record); err != nil {
			return nil, err
		}
		items = append(items, workflowNodeRunFromRecord(record))
	}
	return items, nil
}

func (r *pocketBaseWorkflowRepository) ListNodeRunsByRun(_ context.Context, workflowRunID string) ([]*workflow.NodeRunRecord, error) {
	records, err := r.app.FindRecordsByFilter(collections.WorkflowNodeRuns, "workflow_run = {:run}", "created", 0, 0, map[string]any{"run": workflowRunID})
	if err != nil {
		return nil, err
	}
	items := make([]*workflow.NodeRunRecord, 0, len(records))
	for _, record := range records {
		items = append(items, workflowNodeRunFromRecord(record))
	}
	return items, nil
}

func (r *pocketBaseWorkflowRepository) UpdateNodeRun(_ context.Context, id string, input workflow.UpdateNodeRunInput) (*workflow.NodeRunRecord, error) {
	record, err := r.app.FindRecordById(collections.WorkflowNodeRuns, id)
	if err != nil {
		return nil, err
	}
	if input.Status != nil {
		record.Set("status", strings.TrimSpace(*input.Status))
	}
	if input.RetryCount != nil {
		record.Set("retry_count", *input.RetryCount)
	}
	if input.OutputJSON != nil {
		record.Set("output_json", mustDecodeJSONMap(*input.OutputJSON))
	}
	if input.ErrorMessage != nil {
		record.Set("error_message", strings.TrimSpace(*input.ErrorMessage))
	}
	if input.ExecutionLog != nil {
		record.Set("execution_log", *input.ExecutionLog)
	}
	if input.ExecutionLogTruncated != nil {
		record.Set("execution_log_truncated", *input.ExecutionLogTruncated)
	}
	if input.StartedAt != nil {
		record.Set("started_at", parseDateTime(*input.StartedAt))
	}
	if input.EndedAt != nil {
		record.Set("ended_at", parseDateTime(*input.EndedAt))
	}
	if err := r.app.Save(record); err != nil {
		return nil, err
	}
	return workflowNodeRunFromRecord(record), nil
}

func (r *pocketBaseWorkflowRepository) ListActiveRunsByWorkflow(_ context.Context, workflowID string) ([]*workflow.RunRecord, error) {
	records, err := r.app.FindRecordsByFilter(collections.WorkflowRuns, "workflow_definition = {:workflow} && status != 'succeeded' && status != 'failed' && status != 'cancelled'", "-created", 0, 0, map[string]any{"workflow": workflowID})
	if err != nil {
		return nil, err
	}
	items := make([]*workflow.RunRecord, 0, len(records))
	for _, record := range records {
		items = append(items, workflowRunFromRecord(record))
	}
	return items, nil
}

func (r *pocketBaseWorkflowRepository) ListOrphanedRuns(_ context.Context) ([]*workflow.RunRecord, error) {
	records, err := r.app.FindRecordsByFilter(collections.WorkflowRuns, "status = 'running'", "-updated", 0, 0)
	if err != nil {
		return nil, err
	}
	items := make([]*workflow.RunRecord, 0, len(records))
	for _, record := range records {
		items = append(items, workflowRunFromRecord(record))
	}
	return items, nil
}

func (r *pocketBaseWorkflowRepository) ListCronEnabledDefinitions(_ context.Context) ([]*workflow.DefinitionRecord, error) {
	records, err := r.app.FindRecordsByFilter(collections.Workflows, "is_enabled = true", "updated", 0, 0)
	if err != nil {
		return nil, err
	}
	items := make([]*workflow.DefinitionRecord, 0, len(records))
	for _, record := range records {
		items = append(items, workflowDefinitionFromRecord(record))
	}
	return items, nil
}

func workflowDefinitionFromRecord(record *core.Record) *workflow.DefinitionRecord {
	return &workflow.DefinitionRecord{
		ID:               record.Id,
		Name:             record.GetString("name"),
		Description:      record.GetString("description"),
		IsEnabled:        record.GetBool("is_enabled"),
		DefinitionYAML:   record.GetString("definition_yaml"),
		DefaultServerID:  record.GetString("default_server_id"),
		TriggerTypesJSON: marshalJSONString(record.Get("trigger_types_json")),
		NodeCount:        record.GetInt("node_count"),
		HasAINodes:       record.GetBool("has_ai_nodes"),
		CreatedBy:        record.GetString("created_by"),
		Created:          record.GetString("created"),
		Updated:          record.GetString("updated"),
	}
}

func workflowRunFromRecord(record *core.Record) *workflow.RunRecord {
	return &workflow.RunRecord{
		ID:               record.Id,
		WorkflowID:       record.GetString("workflow_definition"),
		DefinitionYAML:   record.GetString("definition_yaml"),
		Status:           record.GetString("status"),
		TriggerType:      record.GetString("trigger_type"),
		RequestedBy:      record.GetString("requested_by"),
		RequestedByEmail: record.GetString("requested_by_email"),
		ParamsJSON:       marshalJSONString(record.Get("params_json")),
		ResolvedServerID: record.GetString("resolved_server_id"),
		OverlapPolicy:    record.GetString("overlap_policy"),
		StartedAt:        record.GetString("started_at"),
		EndedAt:          record.GetString("ended_at"),
		ErrorMessage:     record.GetString("error_message"),
		Created:          record.GetString("created"),
		Updated:          record.GetString("updated"),
	}
}

func workflowNodeRunFromRecord(record *core.Record) *workflow.NodeRunRecord {
	return &workflow.NodeRunRecord{
		ID:                    record.Id,
		WorkflowRunID:         record.GetString("workflow_run"),
		NodeKey:               record.GetString("node_key"),
		NodeType:              record.GetString("node_type"),
		DisplayName:           record.GetString("display_name"),
		DependsOnJSON:         marshalJSONString(record.Get("depends_on_json")),
		Status:                record.GetString("status"),
		RetryCount:            record.GetInt("retry_count"),
		OutputJSON:            marshalJSONString(record.Get("output_json")),
		ErrorMessage:          record.GetString("error_message"),
		ExecutionLog:          record.GetString("execution_log"),
		ExecutionLogTruncated: record.GetBool("execution_log_truncated"),
		StartedAt:             record.GetString("started_at"),
		EndedAt:               record.GetString("ended_at"),
		Created:               record.GetString("created"),
		Updated:               record.GetString("updated"),
	}
}

func applyWorkflowDefinitionRecord(record *core.Record, name, description string, isEnabled bool, definitionYAML, defaultServerID, triggerTypesJSON string, nodeCount int, hasAINodes bool, createdBy string) {
	record.Set("name", strings.TrimSpace(name))
	record.Set("description", strings.TrimSpace(description))
	record.Set("is_enabled", isEnabled)
	record.Set("definition_yaml", strings.TrimSpace(definitionYAML))
	record.Set("default_server_id", strings.TrimSpace(defaultServerID))
	record.Set("trigger_types_json", mustDecodeJSONArray(triggerTypesJSON))
	record.Set("node_count", nodeCount)
	record.Set("has_ai_nodes", hasAINodes)
	if strings.TrimSpace(createdBy) != "" {
		record.Set("created_by", strings.TrimSpace(createdBy))
	}
}

func marshalJSONString(value any) string {
	if value == nil {
		return ""
	}
	data, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(data)
}

func mustDecodeJSONMap(value string) map[string]any {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return map[string]any{}
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(trimmed), &decoded); err != nil {
		return map[string]any{}
	}
	return decoded
}

func mustDecodeJSONArray(value string) []any {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return []any{}
	}
	var decoded []any
	if err := json.Unmarshal([]byte(trimmed), &decoded); err != nil {
		return []any{}
	}
	return decoded
}

func parseDateTime(value string) any {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return trimmed
	}
	return parsed
}

var _ = sql.ErrNoRows
