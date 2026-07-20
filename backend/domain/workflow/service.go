package workflow

import (
	"context"
	"encoding/json"
	"strings"
)

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) ListDefinitions(ctx context.Context) ([]*DefinitionRecord, error) {
	return s.repo.ListDefinitions(ctx)
}

func (s *Service) GetDefinition(ctx context.Context, id string) (*DefinitionRecord, error) {
	return s.repo.GetDefinition(ctx, id)
}

func (s *Service) CreateDefinition(ctx context.Context, input CreateDefinitionInput) (*DefinitionRecord, error) {
	def, err := ParseDefinition(input.DefinitionYAML)
	if err != nil {
		return nil, err
	}
	input.Name = strings.TrimSpace(def.Name)
	input.Description = strings.TrimSpace(def.Description)
	input.DefaultServerID = strings.TrimSpace(def.DefaultServerID)
	triggerTypes, _ := json.Marshal(DefinitionTriggerTypes(def))
	input.TriggerTypesJSON = string(triggerTypes)
	input.NodeCount = len(def.Nodes)
	input.HasAINodes = DefinitionHasAINodes(def)
	return s.repo.CreateDefinition(ctx, input)
}

func (s *Service) UpdateDefinition(ctx context.Context, id string, input UpdateDefinitionInput) (*DefinitionRecord, error) {
	def, err := ParseDefinition(input.DefinitionYAML)
	if err != nil {
		return nil, err
	}
	input.Name = strings.TrimSpace(def.Name)
	input.Description = strings.TrimSpace(def.Description)
	input.DefaultServerID = strings.TrimSpace(def.DefaultServerID)
	triggerTypes, _ := json.Marshal(DefinitionTriggerTypes(def))
	input.TriggerTypesJSON = string(triggerTypes)
	input.NodeCount = len(def.Nodes)
	input.HasAINodes = DefinitionHasAINodes(def)
	return s.repo.UpdateDefinition(ctx, id, input)
}

func (s *Service) ListCronEnabledDefinitions(ctx context.Context) ([]*DefinitionRecord, error) {
	return s.repo.ListCronEnabledDefinitions(ctx)
}
