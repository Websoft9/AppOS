package metadata

import (
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"sync"

	"github.com/websoft9/appos/backend/domain/lifecycle/model"
	"gopkg.in/yaml.v3"
)

var (
	allowedFamilies             = sliceSet(model.PipelineFamilies)
	allowedPipelinePhases       = sliceSet(model.PipelinePhases)
	allowedCompensationPolicies = sliceSet(model.CompensationPolicies)
	allowedDomainObjects        = sliceSet(model.DomainObjects)
	allowedProjectionTargets    = sliceSet(model.ProjectionTargets)
	allowedOperationTypes       = sliceSet(model.OperationTypes)
	allowedOperationSources     = sliceSet(model.OperationTriggerSources)
	allowedOperationAdapters    = sliceSet(model.OperationAdapters)
	defaultRegistryOnce         sync.Once
	defaultRegistry             *Registry
	defaultRegistryErr          error
)

//go:embed families/*.yaml
var embeddedDefinitions embed.FS

type Registry struct {
	definitionsByOperation map[string][]model.Definition
	families               map[string]model.FamilyMetadata
}

type catalogFile struct {
	Family                    string             `yaml:"family"`
	Description               string             `yaml:"description"`
	Intent                    string             `yaml:"intent"`
	TouchesDomains            []string           `yaml:"touches_domains"`
	DefaultCompensationPolicy string             `yaml:"default_compensation_policy"`
	AppliesTo                 []string           `yaml:"applies_to"`
	Definitions               []model.Definition `yaml:"definitions"`
}

func DefaultRegistry() (*Registry, error) {
	defaultRegistryOnce.Do(func() {
		defaultRegistry, defaultRegistryErr = NewRegistryFromFS(embeddedDefinitions, "families/*.yaml")
	})

	return defaultRegistry, defaultRegistryErr
}

func DefinitionForOperation(operationType string) (model.Definition, error) {
	return DefinitionForSelector(model.DefinitionSelector{OperationType: operationType})
}

func DefinitionForSelector(selector model.DefinitionSelector) (model.Definition, error) {
	registry, err := DefaultRegistry()
	if err != nil {
		return model.Definition{}, err
	}

	return registry.DefinitionForSelector(selector)
}

func (r *Registry) DefinitionForOperation(operationType string) (model.Definition, error) {
	return r.DefinitionForSelector(model.DefinitionSelector{OperationType: operationType})
}

func (r *Registry) DefinitionForSelector(selector model.DefinitionSelector) (model.Definition, error) {
	if r == nil {
		return model.Definition{}, fmt.Errorf("lifecycle registry is nil")
	}

	normalizedOperation := normalizeToken(selector.OperationType)
	candidates, ok := r.definitionsByOperation[normalizedOperation]
	if !ok || len(candidates) == 0 {
		return model.Definition{}, fmt.Errorf("pipeline definition not found for operation type %q", normalizedOperation)
	}

	selected, err := selectDefinition(candidates, selector)
	if err != nil {
		return model.Definition{}, err
	}

	return selected, nil
}

func (r *Registry) Family(family string) (model.FamilyMetadata, error) {
	if r == nil {
		return model.FamilyMetadata{}, fmt.Errorf("lifecycle registry is nil")
	}

	normalized := strings.TrimSpace(family)
	metadata, ok := r.families[normalized]
	if !ok {
		return model.FamilyMetadata{}, fmt.Errorf("pipeline family metadata not found for %q", normalized)
	}

	return metadata, nil
}

func NewRegistry(data []byte) (*Registry, error) {
	var catalog catalogFile
	if err := yaml.Unmarshal(data, &catalog); err != nil {
		return nil, fmt.Errorf("unmarshal lifecycle definitions: %w", err)
	}

	return newRegistryFromCatalogs([]catalogFile{catalog})
}

func NewRegistryFromFS(definitionsFS fs.FS, pattern string) (*Registry, error) {
	matchedFiles, err := fs.Glob(definitionsFS, pattern)
	if err != nil {
		return nil, fmt.Errorf("glob lifecycle definitions: %w", err)
	}
	if len(matchedFiles) == 0 {
		return nil, fmt.Errorf("lifecycle definition files are empty")
	}
	sort.Strings(matchedFiles)

	catalogs := make([]catalogFile, 0, len(matchedFiles))
	for _, filePath := range matchedFiles {
		data, readErr := fs.ReadFile(definitionsFS, filePath)
		if readErr != nil {
			return nil, fmt.Errorf("read lifecycle definitions file %q: %w", filePath, readErr)
		}

		var catalog catalogFile
		if unmarshalErr := yaml.Unmarshal(data, &catalog); unmarshalErr != nil {
			return nil, fmt.Errorf("unmarshal lifecycle definitions file %q: %w", filePath, unmarshalErr)
		}

		catalogs = append(catalogs, catalog)
	}

	return newRegistryFromCatalogs(catalogs)
}

func newRegistryFromCatalogs(catalogs []catalogFile) (*Registry, error) {
	if len(catalogs) == 0 {
		return nil, fmt.Errorf("lifecycle definitions are empty")
	}

	definitionCount := 0
	for _, catalog := range catalogs {
		definitionCount += len(catalog.Definitions)
	}
	if definitionCount == 0 {
		return nil, fmt.Errorf("lifecycle definitions are empty")
	}

	registry := &Registry{
		definitionsByOperation: make(map[string][]model.Definition, definitionCount),
		families:               make(map[string]model.FamilyMetadata, len(catalogs)),
	}
	definitionKeys := make(map[string]struct{}, definitionCount)

	for _, catalog := range catalogs {
		normalizedCatalog, err := normalizeCatalog(catalog)
		if err != nil {
			return nil, err
		}
		if _, exists := registry.families[normalizedCatalog.Family]; exists {
			return nil, fmt.Errorf("duplicate pipeline family metadata for %q", normalizedCatalog.Family)
		}

		metadata := model.FamilyMetadata{
			Family:                    normalizedCatalog.Family,
			Description:               normalizedCatalog.Description,
			Intent:                    normalizedCatalog.Intent,
			TouchesDomains:            append([]string(nil), normalizedCatalog.TouchesDomains...),
			DefaultCompensationPolicy: normalizedCatalog.DefaultCompensationPolicy,
			AppliesTo:                 append([]string(nil), normalizedCatalog.AppliesTo...),
			DefinitionKeys:            make([]string, 0, len(normalizedCatalog.Definitions)),
		}

		for _, definition := range normalizedCatalog.Definitions {
			if err := validateDefinition(definition); err != nil {
				return nil, err
			}
			if definition.Family != normalizedCatalog.Family {
				return nil, fmt.Errorf("pipeline definition %q family %q does not match file family %q", definition.Key, definition.Family, normalizedCatalog.Family)
			}
			metadata.DefinitionKeys = append(metadata.DefinitionKeys, definition.Key)
			if _, exists := definitionKeys[definition.Key]; exists {
				return nil, fmt.Errorf("duplicate pipeline definition key %q", definition.Key)
			}
			definitionKeys[definition.Key] = struct{}{}

			for _, operationType := range definition.OperationTypes {
				registry.definitionsByOperation[operationType] = append(registry.definitionsByOperation[operationType], definition)
			}
		}

		if err := validateCatalogCoverage(normalizedCatalog); err != nil {
			return nil, err
		}

		registry.families[metadata.Family] = metadata
	}

	return registry, nil
}

func normalizeCatalog(catalog catalogFile) (catalogFile, error) {
	catalog.Family = strings.TrimSpace(catalog.Family)
	catalog.Description = strings.TrimSpace(catalog.Description)
	catalog.Intent = strings.TrimSpace(catalog.Intent)
	catalog.TouchesDomains = normalizeCaseSensitiveStrings(catalog.TouchesDomains)
	catalog.DefaultCompensationPolicy = normalizeToken(catalog.DefaultCompensationPolicy)
	catalog.AppliesTo = normalizeTokens(catalog.AppliesTo)
	for index := range catalog.Definitions {
		catalog.Definitions[index] = normalizeDefinition(catalog.Definitions[index])
	}

	if catalog.Family == "" {
		return catalog, fmt.Errorf("pipeline family metadata is missing family")
	}
	if _, ok := allowedFamilies[catalog.Family]; !ok {
		return catalog, fmt.Errorf("pipeline family metadata has unsupported family %q", catalog.Family)
	}
	if catalog.Description == "" {
		return catalog, fmt.Errorf("pipeline family %q is missing description", catalog.Family)
	}
	if catalog.Intent == "" {
		return catalog, fmt.Errorf("pipeline family %q is missing intent", catalog.Family)
	}
	if len(catalog.TouchesDomains) == 0 {
		return catalog, fmt.Errorf("pipeline family %q must declare touches_domains", catalog.Family)
	}
	if _, ok := allowedCompensationPolicies[catalog.DefaultCompensationPolicy]; !ok {
		return catalog, fmt.Errorf("pipeline family %q has unsupported default_compensation_policy %q", catalog.Family, catalog.DefaultCompensationPolicy)
	}
	if len(catalog.AppliesTo) == 0 {
		return catalog, fmt.Errorf("pipeline family %q must declare applies_to", catalog.Family)
	}
	if len(catalog.Definitions) == 0 {
		return catalog, fmt.Errorf("pipeline family %q must declare at least one definition", catalog.Family)
	}

	seenDomains := make(map[string]struct{}, len(catalog.TouchesDomains))
	for _, domain := range catalog.TouchesDomains {
		if _, ok := allowedDomainObjects[domain]; !ok {
			return catalog, fmt.Errorf("pipeline family %q has unsupported touches_domains value %q", catalog.Family, domain)
		}
		if _, exists := seenDomains[domain]; exists {
			return catalog, fmt.Errorf("pipeline family %q has duplicate touches_domains value %q", catalog.Family, domain)
		}
		seenDomains[domain] = struct{}{}
	}

	return catalog, nil
}

func validateCatalogCoverage(catalog catalogFile) error {
	allowedOperations := make(map[string]struct{}, len(catalog.AppliesTo))
	for _, operationType := range catalog.AppliesTo {
		allowedOperations[operationType] = struct{}{}
	}

	for _, definition := range catalog.Definitions {
		for _, operationType := range definition.OperationTypes {
			if _, ok := allowedOperations[operationType]; !ok {
				return fmt.Errorf("pipeline family %q missing applies_to entry for operation type %q", catalog.Family, operationType)
			}
		}
	}

	for operationType := range allowedOperations {
		covered := false
		for _, definition := range catalog.Definitions {
			for _, definitionOperation := range definition.OperationTypes {
				if definitionOperation == operationType {
					covered = true
					break
				}
			}
			if covered {
				break
			}
		}
		if !covered {
			return fmt.Errorf("pipeline family %q applies_to declares uncovered operation type %q", catalog.Family, operationType)
		}
	}

	return nil
}

func normalizeDefinition(definition model.Definition) model.Definition {
	definition.Key = strings.TrimSpace(definition.Key)
	definition.Version = strings.TrimSpace(definition.Version)
	definition.Family = strings.TrimSpace(definition.Family)
	definition.InitialPhase = strings.TrimSpace(definition.InitialPhase)
	definition.OperationTypes = normalizeTokens(definition.OperationTypes)
	definition.Sources = normalizeTokens(definition.Sources)
	definition.Adapters = normalizeTokens(definition.Adapters)
	for index := range definition.Nodes {
		definition.Nodes[index].Key = strings.TrimSpace(definition.Nodes[index].Key)
		definition.Nodes[index].NodeType = strings.TrimSpace(definition.Nodes[index].NodeType)
		definition.Nodes[index].DisplayName = strings.TrimSpace(definition.Nodes[index].DisplayName)
		definition.Nodes[index].Phase = strings.TrimSpace(definition.Nodes[index].Phase)
		definition.Nodes[index].DependsOn = normalizeTokens(definition.Nodes[index].DependsOn)
		definition.Nodes[index].WritesProjection = normalizeCaseSensitiveStrings(definition.Nodes[index].WritesProjection)
		definition.Nodes[index].CompensationNodeKey = strings.TrimSpace(definition.Nodes[index].CompensationNodeKey)
	}
	return definition
}

func validateDefinition(definition model.Definition) error {
	if strings.TrimSpace(definition.Key) == "" {
		return fmt.Errorf("pipeline definition key is required")
	}
	if strings.TrimSpace(definition.Version) == "" {
		return fmt.Errorf("pipeline definition %q version is required", definition.Key)
	}
	if _, ok := allowedFamilies[strings.TrimSpace(definition.Family)]; !ok {
		return fmt.Errorf("pipeline definition %q has unsupported family %q", definition.Key, definition.Family)
	}
	if _, ok := allowedPipelinePhases[strings.TrimSpace(definition.InitialPhase)]; !ok {
		return fmt.Errorf("pipeline definition %q has unsupported initial phase %q", definition.Key, definition.InitialPhase)
	}
	if len(definition.OperationTypes) == 0 {
		return fmt.Errorf("pipeline definition %q must declare at least one operation type", definition.Key)
	}
	for _, operationType := range definition.OperationTypes {
		if _, ok := allowedOperationTypes[operationType]; !ok {
			return fmt.Errorf("pipeline definition %q has unsupported operation type %q", definition.Key, operationType)
		}
	}
	for _, source := range definition.Sources {
		if _, ok := allowedOperationSources[source]; !ok {
			return fmt.Errorf("pipeline definition %q has unsupported source %q", definition.Key, source)
		}
	}
	for _, adapter := range definition.Adapters {
		if _, ok := allowedOperationAdapters[adapter]; !ok {
			return fmt.Errorf("pipeline definition %q has unsupported adapter %q", definition.Key, adapter)
		}
	}
	if len(definition.Nodes) == 0 {
		return fmt.Errorf("pipeline definition %q must declare at least one node", definition.Key)
	}

	nodeKeys := make(map[string]struct{}, len(definition.Nodes))
	for _, node := range definition.Nodes {
		if strings.TrimSpace(node.Key) == "" {
			return fmt.Errorf("pipeline definition %q contains a node without key", definition.Key)
		}
		if strings.TrimSpace(node.NodeType) == "" {
			return fmt.Errorf("pipeline definition %q node %q is missing node_type", definition.Key, node.Key)
		}
		if strings.TrimSpace(node.DisplayName) == "" {
			return fmt.Errorf("pipeline definition %q node %q is missing display_name", definition.Key, node.Key)
		}
		if _, ok := allowedPipelinePhases[strings.TrimSpace(node.Phase)]; !ok {
			return fmt.Errorf("pipeline definition %q node %q has unsupported phase %q", definition.Key, node.Key, node.Phase)
		}
		seenProjectionTargets := make(map[string]struct{}, len(node.WritesProjection))
		for _, target := range node.WritesProjection {
			if _, ok := allowedProjectionTargets[target]; !ok {
				return fmt.Errorf("pipeline definition %q node %q has unsupported writes_projection target %q", definition.Key, node.Key, target)
			}
			if _, exists := seenProjectionTargets[target]; exists {
				return fmt.Errorf("pipeline definition %q node %q has duplicate writes_projection target %q", definition.Key, node.Key, target)
			}
			seenProjectionTargets[target] = struct{}{}
		}
		if node.ManualGate && node.Retryable {
			return fmt.Errorf("pipeline definition %q node %q cannot be both manual_gate and retryable", definition.Key, node.Key)
		}
		if _, exists := nodeKeys[strings.TrimSpace(node.Key)]; exists {
			return fmt.Errorf("pipeline definition %q has duplicate node key %q", definition.Key, node.Key)
		}
		nodeKeys[strings.TrimSpace(node.Key)] = struct{}{}
	}

	for _, node := range definition.Nodes {
		for _, dependency := range node.DependsOn {
			if _, ok := nodeKeys[strings.TrimSpace(dependency)]; !ok {
				return fmt.Errorf("pipeline definition %q node %q references unknown dependency %q", definition.Key, node.Key, dependency)
			}
		}
		if compensationNodeKey := strings.TrimSpace(node.CompensationNodeKey); compensationNodeKey != "" {
			if _, ok := nodeKeys[compensationNodeKey]; !ok {
				return fmt.Errorf("pipeline definition %q node %q references unknown compensation node %q", definition.Key, node.Key, compensationNodeKey)
			}
		}
	}

	return nil
}

func normalizeTokens(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		normalized := normalizeToken(value)
		if normalized != "" {
			result = append(result, normalized)
		}
	}
	return result
}

func selectDefinition(candidates []model.Definition, selector model.DefinitionSelector) (model.Definition, error) {
	normalizedOperation := normalizeToken(selector.OperationType)
	normalizedSource := normalizeToken(selector.Source)
	normalizedAdapter := normalizeToken(selector.Adapter)

	type scoredDefinition struct {
		definition model.Definition
		score      int
	}

	matches := make([]scoredDefinition, 0, len(candidates))
	for _, definition := range candidates {
		if !matchesSelectorValue(definition.Sources, normalizedSource) {
			continue
		}
		if !matchesSelectorValue(definition.Adapters, normalizedAdapter) {
			continue
		}

		score := 0
		if len(definition.Sources) > 0 && normalizedSource != "" {
			score += 1
		}
		if len(definition.Adapters) > 0 && normalizedAdapter != "" {
			score += 2
		}
		matches = append(matches, scoredDefinition{definition: definition, score: score})
	}

	if len(matches) == 0 {
		return model.Definition{}, fmt.Errorf("pipeline definition not found for operation type %q with source %q and adapter %q", normalizedOperation, normalizedSource, normalizedAdapter)
	}

	best := matches[0]
	ambiguous := false
	for _, candidate := range matches[1:] {
		if candidate.score > best.score {
			best = candidate
			ambiguous = false
			continue
		}
		if candidate.score == best.score {
			ambiguous = true
		}
	}

	if ambiguous {
		return model.Definition{}, fmt.Errorf("pipeline definition is ambiguous for operation type %q with source %q and adapter %q", normalizedOperation, normalizedSource, normalizedAdapter)
	}

	return best.definition, nil
}

func matchesSelectorValue(allowed []string, value string) bool {
	if len(allowed) == 0 {
		return true
	}
	if value == "" {
		return false
	}
	for _, allowedValue := range allowed {
		if allowedValue == value {
			return true
		}
	}
	return false
}

func normalizeCaseSensitiveStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		normalized := strings.TrimSpace(value)
		if normalized != "" {
			result = append(result, normalized)
		}
	}
	return result
}

func normalizeToken(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func sliceSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}
