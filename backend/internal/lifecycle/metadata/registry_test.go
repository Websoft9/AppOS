package metadata

import (
	"testing"

	"github.com/websoft9/appos/backend/internal/lifecycle/model"
)

func TestDefaultRegistryCoversLifecycleOperations(t *testing.T) {
	registry, err := DefaultRegistry()
	if err != nil {
		t.Fatalf("default registry: %v", err)
	}

	operations := []struct {
		selector      model.DefinitionSelector
		family        string
		definitionKey string
	}{
		{selector: model.DefinitionSelector{OperationType: string(model.OperationTypeInstall), Source: string(model.TriggerSourceManualOps), Adapter: string(model.AdapterManualCompose)}, family: model.ProvisionPipeline, definitionKey: "provision.install.manual_compose"},
		{selector: model.DefinitionSelector{OperationType: string(model.OperationTypeInstall), Source: string(model.TriggerSourceGitOps), Adapter: string(model.AdapterGitCompose)}, family: model.ProvisionPipeline, definitionKey: "provision.install.git_compose"},
		{selector: model.DefinitionSelector{OperationType: string(model.OperationTypeStart)}, family: model.ProvisionPipeline, definitionKey: "provision.start"},
		{selector: model.DefinitionSelector{OperationType: string(model.OperationTypeRestart)}, family: model.ProvisionPipeline, definitionKey: "provision.restart"},
		{selector: model.DefinitionSelector{OperationType: string(model.OperationTypeUpgrade)}, family: model.ChangePipeline, definitionKey: "change.upgrade"},
		{selector: model.DefinitionSelector{OperationType: string(model.OperationTypeRedeploy)}, family: model.ChangePipeline, definitionKey: "change.redeploy"},
		{selector: model.DefinitionSelector{OperationType: string(model.OperationTypeReconfigure)}, family: model.ChangePipeline, definitionKey: "change.reconfigure"},
		{selector: model.DefinitionSelector{OperationType: string(model.OperationTypePublish)}, family: model.ExposurePipeline, definitionKey: "exposure.publish"},
		{selector: model.DefinitionSelector{OperationType: string(model.OperationTypeUnpublish)}, family: model.ExposurePipeline, definitionKey: "exposure.unpublish"},
		{selector: model.DefinitionSelector{OperationType: string(model.OperationTypeRecover)}, family: model.RecoveryPipeline, definitionKey: "recovery.recover"},
		{selector: model.DefinitionSelector{OperationType: string(model.OperationTypeRollback)}, family: model.RecoveryPipeline, definitionKey: "recovery.rollback"},
		{selector: model.DefinitionSelector{OperationType: string(model.OperationTypeMaintain)}, family: model.MaintenancePipeline, definitionKey: "maintenance.maintain"},
		{selector: model.DefinitionSelector{OperationType: string(model.OperationTypeBackup)}, family: model.MaintenancePipeline, definitionKey: "maintenance.backup"},
		{selector: model.DefinitionSelector{OperationType: string(model.OperationTypeStop)}, family: model.RetirePipeline, definitionKey: "retire.stop"},
		{selector: model.DefinitionSelector{OperationType: string(model.OperationTypeUninstall)}, family: model.RetirePipeline, definitionKey: "retire.uninstall"},
	}

	for _, item := range operations {
		definition, definitionErr := registry.DefinitionForSelector(item.selector)
		if definitionErr != nil {
			t.Fatalf("definition for %+v: %v", item.selector, definitionErr)
		}
		if definition.Family != item.family {
			t.Fatalf("operation %+v expected family %s, got %s", item.selector, item.family, definition.Family)
		}
		if definition.Key != item.definitionKey {
			t.Fatalf("operation %+v expected definition key %s, got %s", item.selector, item.definitionKey, definition.Key)
		}
		if len(definition.Nodes) == 0 {
			t.Fatalf("operation %+v should have nodes", item.selector)
		}
	}
}

func TestDefinitionForOperationNormalizesInput(t *testing.T) {
	definition, err := DefinitionForSelector(model.DefinitionSelector{OperationType: "  INSTALL ", Source: " manualops ", Adapter: " manual-compose "})
	if err != nil {
		t.Fatalf("definition lookup failed: %v", err)
	}

	if definition.Family != model.ProvisionPipeline {
		t.Fatalf("expected %s, got %s", model.ProvisionPipeline, definition.Family)
	}
	if definition.InitialPhase != string(model.PipelinePhaseValidating) {
		t.Fatalf("expected validating initial phase, got %s", definition.InitialPhase)
	}
	if definition.Key != "provision.install.manual_compose" {
		t.Fatalf("expected manual compose install definition, got %s", definition.Key)
	}
	if definition.Nodes[0].Key != "validate_spec" {
		t.Fatalf("expected first install node validate_spec, got %s", definition.Nodes[0].Key)
	}
	if definition.Nodes[0].Retryable {
		t.Fatal("expected validate_spec to be non-retryable")
	}
	if len(definition.Nodes[1].DependsOn) != 1 || definition.Nodes[1].DependsOn[0] != "validate_spec" {
		t.Fatalf("expected prepare_workspace to depend on validate_spec, got %v", definition.Nodes[1].DependsOn)
	}
}

func TestDefinitionForSelectorChoosesGitComposeInstall(t *testing.T) {
	definition, err := DefinitionForSelector(model.DefinitionSelector{OperationType: string(model.OperationTypeInstall), Source: string(model.TriggerSourceGitOps), Adapter: string(model.AdapterGitCompose)})
	if err != nil {
		t.Fatalf("definition lookup failed: %v", err)
	}
	if definition.Key != "provision.install.git_compose" {
		t.Fatalf("expected git compose install definition, got %s", definition.Key)
	}
}

func TestDefinitionForOperationRejectsAmbiguousInstall(t *testing.T) {
	_, err := DefinitionForOperation(string(model.OperationTypeInstall))
	if err == nil {
		t.Fatal("expected ambiguous install definition error")
	}
}

func TestDefinitionForOperationExposesNodeMetadata(t *testing.T) {
	definition, err := DefinitionForOperation(string(model.OperationTypeUpgrade))
	if err != nil {
		t.Fatalf("definition lookup failed: %v", err)
	}

	if len(definition.Nodes) < 2 {
		t.Fatalf("expected upgrade nodes, got %d", len(definition.Nodes))
	}

	if definition.Nodes[0].Key != "validate_change_request" || definition.Nodes[0].Retryable {
		t.Fatalf("expected validate_change_request to be first and non-retryable, got %+v", definition.Nodes[0])
	}
	if definition.Nodes[1].Key != "create_candidate_release" {
		t.Fatalf("expected create_candidate_release as second node, got %s", definition.Nodes[1].Key)
	}
	if len(definition.Nodes[1].WritesProjection) != 1 || definition.Nodes[1].WritesProjection[0] != string(model.ProjectionTargetReleaseSnapshot) {
		t.Fatalf("expected create_candidate_release to write ReleaseSnapshot projection, got %v", definition.Nodes[1].WritesProjection)
	}
}

func TestDefaultRegistryExposesFamilyMetadata(t *testing.T) {
	registry, err := DefaultRegistry()
	if err != nil {
		t.Fatalf("default registry: %v", err)
	}

	metadata, err := registry.Family(model.ChangePipeline)
	if err != nil {
		t.Fatalf("change family metadata: %v", err)
	}

	if metadata.Family != model.ChangePipeline {
		t.Fatalf("expected family %s, got %s", model.ChangePipeline, metadata.Family)
	}
	if metadata.Description == "" {
		t.Fatal("expected change family description")
	}
	if metadata.Intent == "" {
		t.Fatal("expected change family intent")
	}
	if metadata.DefaultCompensationPolicy != string(model.CompensationPolicyStrict) {
		t.Fatalf("expected strict compensation policy, got %s", metadata.DefaultCompensationPolicy)
	}
	if len(metadata.TouchesDomains) != 5 {
		t.Fatalf("expected 5 touched domains, got %d", len(metadata.TouchesDomains))
	}
	if len(metadata.AppliesTo) != 3 {
		t.Fatalf("expected 3 applies_to entries, got %d", len(metadata.AppliesTo))
	}
	if len(metadata.DefinitionKeys) != 3 {
		t.Fatalf("expected 3 definition keys, got %d", len(metadata.DefinitionKeys))
	}
}

func TestNewRegistryRejectsUnknownDependency(t *testing.T) {
	_, err := NewRegistry([]byte(`family: ProvisionPipeline
description: Broken catalog
intent: Broken intent
touches_domains: [AppInstance]
default_compensation_policy: best_effort
applies_to: [install]
definitions:
  - key: broken.pipeline
    version: v1
    family: ProvisionPipeline
    operation_types: [install]
    initial_phase: validating
    nodes:
      - key: prepare_workspace
        node_type: workspace
        display_name: Prepare Workspace
        phase: preparing
        depends_on: [missing_node]
`))
	if err == nil {
		t.Fatal("expected dependency validation error")
	}
}

func TestNewRegistryRejectsFamilyMismatch(t *testing.T) {
	_, err := NewRegistry([]byte(`family: ProvisionPipeline
description: Broken catalog
intent: Broken intent
touches_domains: [AppInstance]
default_compensation_policy: best_effort
applies_to: [install]
definitions:
  - key: broken.pipeline
    version: v1
    family: ChangePipeline
    operation_types: [install]
    initial_phase: validating
    nodes:
      - key: validate_spec
        node_type: validation
        display_name: Validate Spec
        phase: validating
`))
	if err == nil {
		t.Fatal("expected family mismatch validation error")
	}
}

func TestNewRegistryRejectsUncoveredAppliesTo(t *testing.T) {
	_, err := NewRegistry([]byte(`family: ProvisionPipeline
description: Broken catalog
intent: Broken intent
touches_domains: [AppInstance]
default_compensation_policy: best_effort
applies_to: [install, start]
definitions:
  - key: provision.install
    version: v1
    family: ProvisionPipeline
    operation_types: [install]
    initial_phase: validating
    nodes:
      - key: validate_spec
        node_type: validation
        display_name: Validate Spec
        phase: validating
`))
	if err == nil {
		t.Fatal("expected applies_to coverage validation error")
	}
}

func TestNewRegistryRejectsUnsupportedCompensationPolicy(t *testing.T) {
	_, err := NewRegistry([]byte(`family: ProvisionPipeline
description: Broken catalog
intent: Broken intent
touches_domains: [AppInstance]
default_compensation_policy: invalid
applies_to: [install]
definitions:
  - key: provision.install
    version: v1
    family: ProvisionPipeline
    operation_types: [install]
    initial_phase: validating
    nodes:
      - key: validate_spec
        node_type: validation
        display_name: Validate Spec
        phase: validating
`))
	if err == nil {
		t.Fatal("expected compensation policy validation error")
	}
}

func TestNewRegistryRejectsUnsupportedTouchedDomain(t *testing.T) {
	_, err := NewRegistry([]byte(`family: ProvisionPipeline
description: Broken catalog
intent: Broken intent
touches_domains: [UnknownDomain]
default_compensation_policy: best_effort
applies_to: [install]
definitions:
  - key: provision.install
    version: v1
    family: ProvisionPipeline
    operation_types: [install]
    initial_phase: validating
    nodes:
      - key: validate_spec
        node_type: validation
        display_name: Validate Spec
        phase: validating
`))
	if err == nil {
		t.Fatal("expected touched domain validation error")
	}
}

func TestNewRegistryRejectsUnsupportedWritesProjection(t *testing.T) {
	_, err := NewRegistry([]byte(`family: ProvisionPipeline
description: Broken catalog
intent: Broken intent
touches_domains: [AppInstance]
default_compensation_policy: best_effort
applies_to: [install]
definitions:
  - key: provision.install
    version: v1
    family: ProvisionPipeline
    operation_types: [install]
    initial_phase: validating
    nodes:
      - key: validate_spec
        node_type: validation
        display_name: Validate Spec
        phase: validating
        retryable: false
        writes_projection: [UnknownProjection]
`))
	if err == nil {
		t.Fatal("expected writes_projection validation error")
	}
}

func TestNewRegistryRejectsUnsupportedSource(t *testing.T) {
	_, err := NewRegistry([]byte(`family: ProvisionPipeline
description: Broken catalog
intent: Broken intent
touches_domains: [AppInstance]
default_compensation_policy: best_effort
applies_to: [install]
definitions:
	- key: provision.install
		version: v1
		family: ProvisionPipeline
		operation_types: [install]
		sources: [unknownsource]
		initial_phase: validating
		nodes:
			- key: validate_spec
				node_type: validation
				display_name: Validate Spec
				phase: validating
`))
	if err == nil {
		t.Fatal("expected source validation error")
	}
}

func TestNewRegistryRejectsUnsupportedAdapter(t *testing.T) {
	_, err := NewRegistry([]byte(`family: ProvisionPipeline
description: Broken catalog
intent: Broken intent
touches_domains: [AppInstance]
default_compensation_policy: best_effort
applies_to: [install]
definitions:
	- key: provision.install
		version: v1
		family: ProvisionPipeline
		operation_types: [install]
		adapters: [unknown-adapter]
		initial_phase: validating
		nodes:
			- key: validate_spec
				node_type: validation
				display_name: Validate Spec
				phase: validating
`))
	if err == nil {
		t.Fatal("expected adapter validation error")
	}
}

func TestNewRegistryRejectsManualGateRetryableNode(t *testing.T) {
	_, err := NewRegistry([]byte(`family: ProvisionPipeline
description: Broken catalog
intent: Broken intent
touches_domains: [AppInstance]
default_compensation_policy: best_effort
applies_to: [install]
definitions:
  - key: provision.install
    version: v1
    family: ProvisionPipeline
    operation_types: [install]
    initial_phase: validating
    nodes:
      - key: approval
        node_type: manual
        display_name: Approval
        phase: verifying
        retryable: true
        manual_gate: true
`))
	if err == nil {
		t.Fatal("expected manual_gate retryable validation error")
	}
}
