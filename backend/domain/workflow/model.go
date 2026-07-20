package workflow

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	TriggerManual = "manual"
	TriggerCron   = "cron"

	OverlapPolicySkip = "skip"

	NodeTypeShell       = "shell"
	NodeTypeHTTP        = "http"
	NodeTypeLLM         = "llm"
	NodeTypeAgent       = "agent"
	NodeTypeDocker      = "docker"
	NodeTypeSMTP        = "smtp"
	NodeTypeCondition   = "condition"
	NodeTypeManualGate  = "manual_gate"
	NodeTypeSubworkflow = "subworkflow"

	RunStatusPending    = "pending"
	RunStatusRunning    = "running"
	RunStatusSucceeded  = "succeeded"
	RunStatusFailed     = "failed"
	RunStatusCancelled  = "cancelled"
	RunStatusWaiting    = "waiting"
	RunStatusManualGate = "manual_gate"

	NodeStatusPending    = "pending"
	NodeStatusRunning    = "running"
	NodeStatusSucceeded  = "succeeded"
	NodeStatusFailed     = "failed"
	NodeStatusSkipped    = "skipped"
	NodeStatusCancelled  = "cancelled"
	NodeStatusWaiting    = "waiting"
	NodeStatusManualGate = "manual_gate"
)

var SupportedTriggerTypes = []string{TriggerManual, TriggerCron}

var SupportedNodeTypes = []string{
	NodeTypeShell,
	NodeTypeHTTP,
	NodeTypeLLM,
	NodeTypeAgent,
	NodeTypeDocker,
	NodeTypeSMTP,
	NodeTypeCondition,
	NodeTypeManualGate,
	NodeTypeSubworkflow,
}

var TerminalRunStatuses = []string{
	RunStatusSucceeded,
	RunStatusFailed,
	RunStatusCancelled,
	RunStatusWaiting,
	RunStatusManualGate,
}

type DefinitionRecord struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Description      string `json:"description"`
	IsEnabled        bool   `json:"is_enabled"`
	DefinitionYAML   string `json:"definition_yaml"`
	DefaultServerID  string `json:"default_server_id"`
	TriggerTypesJSON string `json:"trigger_types_json"`
	NodeCount        int    `json:"node_count"`
	HasAINodes       bool   `json:"has_ai_nodes"`
	CreatedBy        string `json:"created_by"`
	Created          string `json:"created"`
	Updated          string `json:"updated"`
}

type RunRecord struct {
	ID               string `json:"id"`
	WorkflowID       string `json:"workflow_id"`
	DefinitionYAML   string `json:"definition_yaml"`
	Status           string `json:"status"`
	TriggerType      string `json:"trigger_type"`
	ExecutionOwnerID string `json:"execution_owner_id"`
	RequestedBy      string `json:"requested_by"`
	RequestedByEmail string `json:"requested_by_email"`
	ParamsJSON       string `json:"params_json"`
	ResolvedServerID string `json:"resolved_server_id"`
	OverlapPolicy    string `json:"overlap_policy"`
	StartedAt        string `json:"started_at"`
	EndedAt          string `json:"ended_at"`
	ErrorMessage     string `json:"error_message"`
	Created          string `json:"created"`
	Updated          string `json:"updated"`
}

type NodeRunRecord struct {
	ID                    string `json:"id"`
	WorkflowRunID         string `json:"workflow_run_id"`
	NodeKey               string `json:"node_key"`
	NodeType              string `json:"node_type"`
	DisplayName           string `json:"display_name"`
	DependsOnJSON         string `json:"depends_on_json"`
	Status                string `json:"status"`
	RetryCount            int    `json:"retry_count"`
	OutputJSON            string `json:"output_json"`
	ErrorMessage          string `json:"error_message"`
	ExecutionLog          string `json:"execution_log"`
	ExecutionLogTruncated bool   `json:"execution_log_truncated"`
	StartedAt             string `json:"started_at"`
	EndedAt               string `json:"ended_at"`
	Created               string `json:"created"`
	Updated               string `json:"updated"`
}

type Definition struct {
	Name            string           `yaml:"name" json:"name"`
	Description     string           `yaml:"description,omitempty" json:"description,omitempty"`
	Params          []Parameter      `yaml:"params,omitempty" json:"params,omitempty"`
	Triggers        []Trigger        `yaml:"triggers,omitempty" json:"triggers,omitempty"`
	OverlapPolicy   string           `yaml:"overlap_policy,omitempty" json:"overlap_policy,omitempty"`
	DefaultServerID string           `yaml:"default_server_id,omitempty" json:"default_server_id,omitempty"`
	Nodes           []NodeDefinition `yaml:"nodes" json:"nodes"`
}

type Parameter struct {
	Name    string `yaml:"name" json:"name"`
	Type    string `yaml:"type" json:"type"`
	Default any    `yaml:"default,omitempty" json:"default,omitempty"`
}

type Trigger struct {
	Type     string `yaml:"type" json:"type"`
	Schedule string `yaml:"schedule,omitempty" json:"schedule,omitempty"`
}

type RetryPolicy struct {
	Limit int `yaml:"limit,omitempty" json:"limit,omitempty"`
}

type NodeDefinition struct {
	Key        string         `yaml:"key" json:"key"`
	Name       string         `yaml:"name,omitempty" json:"name,omitempty"`
	Type       string         `yaml:"type" json:"type"`
	DependsOn  []string       `yaml:"depends_on,omitempty" json:"depends_on,omitempty"`
	TimeoutSec int            `yaml:"timeout_sec,omitempty" json:"timeout_sec,omitempty"`
	Retry      RetryPolicy    `yaml:"retry,omitempty" json:"retry,omitempty"`
	Config     map[string]any `yaml:"config,omitempty" json:"config,omitempty"`
}

func ParseDefinition(definitionYAML string) (*Definition, error) {
	trimmed := strings.TrimSpace(definitionYAML)
	if trimmed == "" {
		return nil, fmt.Errorf("definition_yaml is required")
	}
	var def Definition
	if err := yaml.Unmarshal([]byte(trimmed), &def); err != nil {
		return nil, err
	}
	if err := ValidateDefinition(&def); err != nil {
		return nil, err
	}
	return &def, nil
}

func ValidateDefinition(def *Definition) error {
	if def == nil {
		return fmt.Errorf("definition is required")
	}
	if strings.TrimSpace(def.Name) == "" {
		return fmt.Errorf("name is required")
	}
	if len(def.Nodes) == 0 {
		return fmt.Errorf("at least one node is required")
	}
	if strings.TrimSpace(def.OverlapPolicy) == "" {
		def.OverlapPolicy = OverlapPolicySkip
	}
	if def.OverlapPolicy != OverlapPolicySkip {
		return fmt.Errorf("unsupported overlap_policy %q", def.OverlapPolicy)
	}

	nodesByKey := make(map[string]NodeDefinition, len(def.Nodes))
	for _, node := range def.Nodes {
		key := strings.TrimSpace(node.Key)
		if key == "" {
			return fmt.Errorf("node key is required")
		}
		if _, exists := nodesByKey[key]; exists {
			return fmt.Errorf("duplicate node key %q", key)
		}
		if !contains(SupportedNodeTypes, strings.TrimSpace(node.Type)) {
			return fmt.Errorf("unsupported node type %q", node.Type)
		}
		nodesByKey[key] = node
	}

	for _, trigger := range def.Triggers {
		if !contains(SupportedTriggerTypes, strings.TrimSpace(trigger.Type)) {
			return fmt.Errorf("unsupported trigger type %q", trigger.Type)
		}
		if trigger.Type == TriggerCron && strings.TrimSpace(trigger.Schedule) == "" {
			return fmt.Errorf("cron trigger requires schedule")
		}
	}

	for _, node := range def.Nodes {
		for _, dep := range node.DependsOn {
			if _, ok := nodesByKey[strings.TrimSpace(dep)]; !ok {
				return fmt.Errorf("node %q depends on unknown node %q", node.Key, dep)
			}
		}
		if (node.Type == NodeTypeShell || node.Type == NodeTypeDocker) && strings.TrimSpace(def.DefaultServerID) == "" {
			return fmt.Errorf("node type %q requires default_server_id", node.Type)
		}
	}
	if hasCycle(def.Nodes) {
		return fmt.Errorf("workflow definition contains a cycle")
	}
	return nil
}

func DefinitionTriggerTypes(def *Definition) []string {
	if def == nil || len(def.Triggers) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	result := make([]string, 0, len(def.Triggers))
	for _, trigger := range def.Triggers {
		t := strings.TrimSpace(trigger.Type)
		if t == "" {
			continue
		}
		if _, ok := seen[t]; ok {
			continue
		}
		seen[t] = struct{}{}
		result = append(result, t)
	}
	return result
}

func DefinitionHasAINodes(def *Definition) bool {
	if def == nil {
		return false
	}
	for _, node := range def.Nodes {
		if node.Type == NodeTypeLLM || node.Type == NodeTypeAgent {
			return true
		}
	}
	return false
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func hasCycle(nodes []NodeDefinition) bool {
	graph := make(map[string][]string, len(nodes))
	for _, node := range nodes {
		graph[node.Key] = append([]string(nil), node.DependsOn...)
	}
	visiting := map[string]bool{}
	visited := map[string]bool{}
	var visit func(string) bool
	visit = func(nodeKey string) bool {
		if visiting[nodeKey] {
			return true
		}
		if visited[nodeKey] {
			return false
		}
		visiting[nodeKey] = true
		for _, dep := range graph[nodeKey] {
			if visit(strings.TrimSpace(dep)) {
				return true
			}
		}
		visiting[nodeKey] = false
		visited[nodeKey] = true
		return false
	}
	for _, node := range nodes {
		if visit(node.Key) {
			return true
		}
	}
	return false
}
