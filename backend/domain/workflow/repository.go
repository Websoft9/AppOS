package workflow

import "context"

type Repository interface {
	ListDefinitions(ctx context.Context) ([]*DefinitionRecord, error)
	GetDefinition(ctx context.Context, id string) (*DefinitionRecord, error)
	CreateDefinition(ctx context.Context, input CreateDefinitionInput) (*DefinitionRecord, error)
	UpdateDefinition(ctx context.Context, id string, input UpdateDefinitionInput) (*DefinitionRecord, error)
	DeleteDefinition(ctx context.Context, id string) error

	CreatePreparedRun(ctx context.Context, input CreateRunInput, nodes []NodeRunSeed) (*RunRecord, []*NodeRunRecord, error)
	CreateRun(ctx context.Context, input CreateRunInput) (*RunRecord, error)
	GetRun(ctx context.Context, id string) (*RunRecord, error)
	UpdateRun(ctx context.Context, id string, input UpdateRunInput) (*RunRecord, error)
	ListRunsByWorkflow(ctx context.Context, workflowID string) ([]*RunRecord, error)

	CreateNodeRuns(ctx context.Context, workflowRunID string, nodes []NodeRunSeed) ([]*NodeRunRecord, error)
	ListNodeRunsByRun(ctx context.Context, workflowRunID string) ([]*NodeRunRecord, error)
	UpdateNodeRun(ctx context.Context, id string, input UpdateNodeRunInput) (*NodeRunRecord, error)
	ListActiveRunsByWorkflow(ctx context.Context, workflowID string) ([]*RunRecord, error)
	ListOrphanedRuns(ctx context.Context) ([]*RunRecord, error)
	ListCronEnabledDefinitions(ctx context.Context) ([]*DefinitionRecord, error)
}

type CreateDefinitionInput struct {
	Name             string
	Description      string
	IsEnabled        bool
	DefinitionYAML   string
	DefaultServerID  string
	CreatedBy        string
	TriggerTypesJSON string
	NodeCount        int
	HasAINodes       bool
}

type UpdateDefinitionInput struct {
	Name             string
	Description      string
	IsEnabled        bool
	DefinitionYAML   string
	DefaultServerID  string
	TriggerTypesJSON string
	NodeCount        int
	HasAINodes       bool
}

type CreateRunInput struct {
	WorkflowID       string
	DefinitionYAML   string
	Status           string
	TriggerType      string
	RequestedBy      string
	RequestedByEmail string
	ParamsJSON       string
	ResolvedServerID string
	OverlapPolicy    string
	ErrorMessage     string
}

type UpdateRunInput struct {
	Status       *string
	StartedAt    *string
	EndedAt      *string
	ErrorMessage *string
}

type NodeRunSeed struct {
	NodeKey       string
	NodeType      string
	DisplayName   string
	DependsOnJSON string
	Status        string
}

type UpdateNodeRunInput struct {
	Status                *string
	RetryCount            *int
	OutputJSON            *string
	ErrorMessage          *string
	ExecutionLog          *string
	ExecutionLogTruncated *bool
	StartedAt             *string
	EndedAt               *string
}
