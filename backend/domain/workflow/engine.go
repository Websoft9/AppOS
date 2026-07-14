package workflow

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/robfig/cron/v3"
)

type PreparedRun struct {
	Definition *DefinitionRecord
	Run        *RunRecord
	NodeRuns   []*NodeRunRecord
}

type PrepareRunInput struct {
	WorkflowID       string
	TriggerType      string
	ExecutionOwnerID string
	RequestedBy      string
	RequestedByEmail string
	Params           map[string]any
}

func (s *Service) PrepareRun(ctx context.Context, input PrepareRunInput) (*PreparedRun, error) {
	definition, err := s.repo.GetDefinition(ctx, input.WorkflowID)
	if err != nil {
		return nil, err
	}
	def, err := ParseDefinition(definition.DefinitionYAML)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(input.TriggerType) == "" {
		input.TriggerType = TriggerManual
	}
	if input.TriggerType == TriggerCron {
		hasCron := false
		for _, trigger := range def.Triggers {
			if trigger.Type == TriggerCron {
				hasCron = true
				break
			}
		}
		if !hasCron {
			return nil, fmt.Errorf("workflow does not declare cron trigger")
		}
	}
	if !definition.IsEnabled && input.TriggerType == TriggerCron {
		return nil, fmt.Errorf("workflow is disabled")
	}
	if strings.TrimSpace(input.ExecutionOwnerID) == "" {
		input.ExecutionOwnerID = strings.TrimSpace(definition.CreatedBy)
	}
	if strings.TrimSpace(input.ExecutionOwnerID) == "" {
		return nil, fmt.Errorf("workflow execution owner is required")
	}
	paramsJSON, _ := json.Marshal(input.Params)
	seeds := make([]NodeRunSeed, 0, len(def.Nodes))
	for _, node := range def.Nodes {
		depends, _ := json.Marshal(node.DependsOn)
		displayName := strings.TrimSpace(node.Name)
		if displayName == "" {
			displayName = node.Key
		}
		seeds = append(seeds, NodeRunSeed{
			NodeKey:       node.Key,
			NodeType:      node.Type,
			DisplayName:   displayName,
			DependsOnJSON: string(depends),
			Status:        NodeStatusPending,
		})
	}
	run, nodeRuns, err := s.repo.CreatePreparedRun(ctx, CreateRunInput{
		WorkflowID:       definition.ID,
		DefinitionYAML:   definition.DefinitionYAML,
		Status:           RunStatusPending,
		TriggerType:      input.TriggerType,
		ExecutionOwnerID: input.ExecutionOwnerID,
		RequestedBy:      input.RequestedBy,
		RequestedByEmail: input.RequestedByEmail,
		ParamsJSON:       string(paramsJSON),
		ResolvedServerID: definition.DefaultServerID,
		OverlapPolicy:    def.OverlapPolicy,
	}, seeds)
	if err != nil {
		return nil, err
	}
	return &PreparedRun{Definition: definition, Run: run, NodeRuns: nodeRuns}, nil
}

var ErrOverlapSkipped = fmt.Errorf("workflow overlap policy skipped run")

func CronSchedules(definitionYAML string) ([]string, error) {
	def, err := ParseDefinition(definitionYAML)
	if err != nil {
		return nil, err
	}
	parser := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	result := make([]string, 0)
	for _, trigger := range def.Triggers {
		if trigger.Type != TriggerCron {
			continue
		}
		schedule := strings.TrimSpace(trigger.Schedule)
		if schedule == "" {
			continue
		}
		if _, err := parser.Parse(schedule); err != nil {
			return nil, err
		}
		result = append(result, schedule)
	}
	return result, nil
}
