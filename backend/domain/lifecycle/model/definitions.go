package model

type FamilyMetadata struct {
	Family                    string   `yaml:"family"`
	Description               string   `yaml:"description"`
	Intent                    string   `yaml:"intent"`
	TouchesDomains            []string `yaml:"touches_domains"`
	DefaultCompensationPolicy string   `yaml:"default_compensation_policy"`
	AppliesTo                 []string `yaml:"applies_to"`
	DefinitionKeys            []string `yaml:"-"`
}

type Definition struct {
	Key            string           `yaml:"key"`
	Version        string           `yaml:"version"`
	Family         string           `yaml:"family"`
	OperationTypes []string         `yaml:"operation_types"`
	Sources        []string         `yaml:"sources"`
	Adapters       []string         `yaml:"adapters"`
	InitialPhase   string           `yaml:"initial_phase"`
	Nodes          []NodeDefinition `yaml:"nodes"`
}

type DefinitionSelector struct {
	OperationType string
	Source        string
	Adapter       string
}

type NodeDefinition struct {
	Key                 string   `yaml:"key"`
	NodeType            string   `yaml:"node_type"`
	DisplayName         string   `yaml:"display_name"`
	Phase               string   `yaml:"phase"`
	DependsOn           []string `yaml:"depends_on"`
	Retryable           bool     `yaml:"retryable"`
	ManualGate          bool     `yaml:"manual_gate"`
	WritesProjection    []string `yaml:"writes_projection"`
	CompensationNodeKey string   `yaml:"compensation_node_key"`
}
