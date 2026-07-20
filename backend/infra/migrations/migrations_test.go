package migrations_test

import (
	"fmt"
	"slices"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	"github.com/websoft9/appos/backend/domain/feeds"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	"github.com/websoft9/appos/backend/domain/secrets"
	appschema "github.com/websoft9/appos/backend/infra/schema"

	// trigger init() registrations
	_ "github.com/websoft9/appos/backend/infra/migrations"
)

// TestResourceCollectionsCreated verifies that all resource collections
// are created after running migrations.
func TestResourceCollectionsCreated(t *testing.T) {
	app := newMigrationsTestApp(t)

	expected := []string{
		"assets",
		"secrets",
		"user_files",
		"feed_sources",
		"feed_items",
		"env_sets",
		"env_set_vars",
		"servers",
		"databases",
		"cloud_accounts",
		"certificates",
		"provider_accounts",
		"app_instances",
		"app_operations",
		"app_releases",
		"app_exposures",
		"pipeline_runs",
		"pipeline_node_runs",
	}

	for _, name := range expected {
		col, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Errorf("collection %q not found: %v", name, err)
			continue
		}
		if col.Name != name {
			t.Errorf("expected collection name %q, got %q", name, col.Name)
		}
		if col.Type != core.CollectionTypeBase {
			t.Errorf("collection %q: expected type %q, got %q", name, core.CollectionTypeBase, col.Type)
		}
	}
}

func TestSpaceFilesCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("user_files")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "owner", core.FieldTypeText, true)
	assertFieldExists(t, col, "name", core.FieldTypeText, true)
	assertFieldExists(t, col, "content", core.FieldTypeFile, false)
	assertFieldExists(t, col, "mime_type", core.FieldTypeText, false)
	assertFieldExists(t, col, "share_token", core.FieldTypeText, false)
	assertFieldExists(t, col, "share_expires_at", core.FieldTypeText, false)
	assertFieldExists(t, col, "is_folder", core.FieldTypeBool, false)
	assertFieldExists(t, col, "parent", core.FieldTypeText, false)
	assertFieldExists(t, col, "size", core.FieldTypeNumber, false)
	assertFieldExists(t, col, "is_deleted", core.FieldTypeBool, false)
	assertFieldExists(t, col, "created", core.FieldTypeAutodate, false)
	assertFieldExists(t, col, "updated", core.FieldTypeAutodate, false)

	if col.ListRule == nil || col.ViewRule == nil || col.CreateRule == nil || col.UpdateRule == nil || col.DeleteRule == nil {
		t.Fatal("user_files should be owner-scoped for all operations")
	}
}

func TestAppInstancesCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("app_instances")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "key", core.FieldTypeText, true)
	assertFieldExists(t, col, "name", core.FieldTypeText, true)
	assertFieldExists(t, col, "template_key", core.FieldTypeText, false)
	assertFieldExists(t, col, "server_id", core.FieldTypeText, true)
	assertFieldExists(t, col, "lifecycle_state", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "desired_state", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "health_summary", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "current_release", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "last_operation", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "primary_exposure", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "publication_summary", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "channel", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "installed_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "last_healthy_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "retired_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "state_reason", core.FieldTypeText, false)
	assertFieldExists(t, col, "access_username", core.FieldTypeText, false)
	assertFieldExists(t, col, "access_secret_hint", core.FieldTypeText, false)
	assertFieldExists(t, col, "access_retrieval_method", core.FieldTypeText, false)
	assertFieldExists(t, col, "access_notes", core.FieldTypeText, false)
	assertFieldExists(t, col, "access_endpoints", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "created", core.FieldTypeAutodate, false)
	assertFieldExists(t, col, "updated", core.FieldTypeAutodate, false)
	assertRelationTarget(t, app, col, "current_release", "app_releases")
	assertRelationTarget(t, app, col, "last_operation", "app_operations")
	assertRelationTarget(t, app, col, "primary_exposure", "app_exposures")
	assertSelectFieldValues(t, col, "lifecycle_state", model.AppLifecycleStates)
	assertSelectFieldValues(t, col, "desired_state", model.DesiredAppStates)
	assertSelectFieldValues(t, col, "health_summary", model.HealthSummaries)
	assertSelectFieldValues(t, col, "publication_summary", model.PublicationSummaries)
	assertSelectFieldValues(t, col, "channel", model.OperationChannels)

	if col.ListRule == nil || col.ViewRule == nil {
		t.Fatal("app_instances should be readable by authenticated users")
	}
}

func TestAppOperationsCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("app_operations")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "app", core.FieldTypeRelation, true)
	assertFieldExists(t, col, "server_id", core.FieldTypeText, true)
	assertFieldExists(t, col, "operation_type", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "rule_profile", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "trigger", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "execution_mode", core.FieldTypeText, false)
	assertFieldExists(t, col, "requested_by", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "phase", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "terminal_status", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "failure_reason", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "app_outcome", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "spec_json", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "compose_project_name", core.FieldTypeText, false)
	assertFieldExists(t, col, "project_dir", core.FieldTypeText, false)
	assertFieldExists(t, col, "rendered_compose", core.FieldTypeText, false)
	assertFieldExists(t, col, "resolved_env_json", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "execution_log", core.FieldTypeText, false)
	assertFieldExists(t, col, "execution_log_truncated", core.FieldTypeBool, false)
	assertFieldExists(t, col, "baseline_release", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "candidate_release", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "result_release", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "pipeline_run", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "log_cursor", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "error_message", core.FieldTypeText, false)
	assertFieldExists(t, col, "queued_at", core.FieldTypeDate, true)
	assertFieldExists(t, col, "started_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "ended_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "cancel_requested_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "created", core.FieldTypeAutodate, false)
	assertFieldExists(t, col, "updated", core.FieldTypeAutodate, false)
	assertRelationTarget(t, app, col, "app", "app_instances")
	assertRelationTarget(t, app, col, "requested_by", "users")
	assertRelationTarget(t, app, col, "baseline_release", "app_releases")
	assertRelationTarget(t, app, col, "candidate_release", "app_releases")
	assertRelationTarget(t, app, col, "result_release", "app_releases")
	assertRelationTarget(t, app, col, "pipeline_run", "pipeline_runs")
	assertSelectFieldValues(t, col, "operation_type", model.OperationTypes)
	assertSelectFieldValues(t, col, "rule_profile", model.RuleProfileKeys)
	assertSelectFieldValues(t, col, "trigger", model.OperationTriggers)
	assertSelectFieldValues(t, col, "phase", model.OperationPhases)
	assertSelectFieldValues(t, col, "terminal_status", []string{"success", "failed", "cancelled", "compensated", "manual_intervention_required"})
	assertSelectFieldValues(t, col, "failure_reason", []string{"timeout", "validation_error", "resource_conflict", "dependency_unavailable", "execution_error", "verification_failed", "compensation_failed", "unknown"})
	assertSelectFieldValues(t, col, "app_outcome", []string{"new_release_active", "previous_release_active", "no_healthy_release", "state_unknown"})

	if col.ListRule == nil || col.ViewRule == nil {
		t.Fatal("app_operations should be readable by authenticated users")
	}
}

func TestAuditLogsCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("audit_logs")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "user_id", core.FieldTypeText, true)
	assertFieldExists(t, col, "action", core.FieldTypeText, true)
	assertFieldExists(t, col, "status", core.FieldTypeSelect, true)
	assertSelectFieldValues(t, col, "status", []string{"pending", "success", "failed", "attention_required"})
	if col.ListRule == nil || col.ViewRule == nil {
		t.Fatal("audit_logs should be readable by owner or superuser")
	}
}

func TestAppReleasesCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("app_releases")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "app", core.FieldTypeRelation, true)
	assertFieldExists(t, col, "created_by_operation", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "release_role", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "version_label", core.FieldTypeText, false)
	assertFieldExists(t, col, "channel", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "source_ref", core.FieldTypeText, false)
	assertFieldExists(t, col, "rendered_compose", core.FieldTypeText, true)
	assertFieldExists(t, col, "resolved_env_json", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "config_digest", core.FieldTypeText, false)
	assertFieldExists(t, col, "artifact_digest", core.FieldTypeText, false)
	assertFieldExists(t, col, "is_active", core.FieldTypeBool, false)
	assertFieldExists(t, col, "is_last_known_good", core.FieldTypeBool, false)
	assertFieldExists(t, col, "activated_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "superseded_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "notes", core.FieldTypeText, false)
	assertRelationTarget(t, app, col, "app", "app_instances")
	assertRelationTarget(t, app, col, "created_by_operation", "app_operations")
	assertSelectFieldValues(t, col, "release_role", []string{"candidate", "active", "last_known_good", "historical"})
	assertSelectFieldValues(t, col, "channel", model.OperationChannels)
}

func TestAppExposuresCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("app_exposures")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "app", core.FieldTypeRelation, true)
	assertFieldExists(t, col, "release", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "exposure_type", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "is_primary", core.FieldTypeBool, false)
	assertFieldExists(t, col, "domain", core.FieldTypeText, false)
	assertFieldExists(t, col, "path", core.FieldTypeText, false)
	assertFieldExists(t, col, "target_port", core.FieldTypeNumber, false)
	assertFieldExists(t, col, "certificate", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "publication_state", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "health_state", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "last_verified_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "disabled_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "notes", core.FieldTypeText, false)
	assertRelationTarget(t, app, col, "app", "app_instances")
	assertRelationTarget(t, app, col, "release", "app_releases")
	assertRelationTarget(t, app, col, "certificate", "certificates")
	assertSelectFieldValues(t, col, "exposure_type", []string{"domain", "path", "port", "internal_only"})
	assertSelectFieldValues(t, col, "publication_state", []string{"unpublished", "publishing", "published", "published_degraded", "unpublishing", "publication_failed", "publication_attention_required"})
	assertSelectFieldValues(t, col, "health_state", []string{"healthy", "degraded", "unknown"})
}

func TestPipelineRunsCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("pipeline_runs")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "operation", core.FieldTypeRelation, true)
	assertFieldExists(t, col, "pipeline_family", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "pipeline_definition_key", core.FieldTypeText, true)
	assertFieldExists(t, col, "pipeline_version", core.FieldTypeText, false)
	assertFieldExists(t, col, "current_phase", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "status", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "node_count", core.FieldTypeNumber, true)
	assertFieldExists(t, col, "completed_node_count", core.FieldTypeNumber, false)
	assertFieldExists(t, col, "failed_node_key", core.FieldTypeText, false)
	assertFieldExists(t, col, "started_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "ended_at", core.FieldTypeDate, false)
	assertRelationTarget(t, app, col, "operation", "app_operations")
	assertSelectFieldValues(t, col, "pipeline_family", model.PipelineFamilies)
	assertSelectFieldValues(t, col, "current_phase", model.PipelinePhases)
	assertSelectFieldValues(t, col, "status", []string{"active", "completed", "failed", "cancelled"})
}

func TestPipelineNodeRunsCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("pipeline_node_runs")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "pipeline_run", core.FieldTypeRelation, true)
	assertFieldExists(t, col, "node_key", core.FieldTypeText, true)
	assertFieldExists(t, col, "node_type", core.FieldTypeText, true)
	assertFieldExists(t, col, "display_name", core.FieldTypeText, true)
	assertFieldExists(t, col, "phase", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "depends_on_json", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "status", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "retry_count", core.FieldTypeNumber, false)
	assertFieldExists(t, col, "compensation_node_key", core.FieldTypeText, false)
	assertFieldExists(t, col, "error_code", core.FieldTypeText, false)
	assertFieldExists(t, col, "error_message", core.FieldTypeText, false)
	assertFieldExists(t, col, "execution_log", core.FieldTypeText, false)
	assertFieldExists(t, col, "execution_log_truncated", core.FieldTypeBool, false)
	assertFieldExists(t, col, "started_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "ended_at", core.FieldTypeDate, false)
	assertRelationTarget(t, app, col, "pipeline_run", "pipeline_runs")
	assertSelectFieldValues(t, col, "phase", model.PipelinePhases)
	assertSelectFieldValues(t, col, "status", []string{"pending", "running", "succeeded", "failed", "skipped", "cancelled", "compensated", "waiting", "manual_gate"})
}

// TestSecretsCollectionFields verifies the secrets collection schema.
func TestSecretsCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}

	// Secrets: name (text, required), type (select, relaxed), value (text, hidden), description (text)
	assertFieldExists(t, col, "name", core.FieldTypeText, true)
	assertFieldExists(t, col, "type", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "value", core.FieldTypeText, false)
	assertFieldExists(t, col, "description", core.FieldTypeText, false)
	assertFieldExists(t, col, "template_id", core.FieldTypeText, false)
	assertFieldExists(t, col, "visible_to", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "scope", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "access_mode", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "payload_encrypted", core.FieldTypeText, false)
	assertFieldExists(t, col, "payload_meta", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "status", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "version", core.FieldTypeNumber, false)
	assertFieldExists(t, col, "created_source", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "last_used_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "expires_at", core.FieldTypeText, false)
	assertFieldExists(t, col, "last_used_by", core.FieldTypeText, false)
	assertFieldExists(t, col, "created_by", core.FieldTypeText, false)

	// value field must be hidden
	valueField := col.Fields.GetByName("value")
	if valueField == nil {
		t.Fatal("value field not found")
	}
	if !valueField.GetHidden() {
		t.Error("secrets.value field should be hidden")
	}
	payloadField := col.Fields.GetByName("payload_encrypted")
	if payloadField == nil {
		t.Fatal("payload_encrypted field not found")
	}
	if !payloadField.GetHidden() {
		t.Error("secrets.payload_encrypted field should be hidden")
	}

	// Authenticated read/create
	if col.ListRule == nil {
		t.Error("secrets.ListRule should allow authenticated users")
	}
	if col.ViewRule == nil {
		t.Error("secrets.ViewRule should allow authenticated users")
	}
}

// TestServersCollectionFields verifies the servers collection schema and relations.
func TestServersCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("servers")
	if err != nil {
		t.Fatal(err)
	}
	assertFieldMissing(t, col, "state") // Ensure state field is missing
	assertFieldExists(t, col, "name", core.FieldTypeText, true)
	assertFieldExists(t, col, "host", core.FieldTypeText, false)
	assertFieldExists(t, col, "port", core.FieldTypeNumber, false)
	assertFieldExists(t, col, "user", core.FieldTypeText, true)
	assertFieldExists(t, col, "connect_type", core.FieldTypeText, false)
	assertFieldExists(t, col, "is_enabled", core.FieldTypeBool, false)
	assertFieldExists(t, col, "is_local", core.FieldTypeBool, false)
	// auth_type removed in migration 1762700000 — credential type is inferred from secret.template_id
	assertFieldExists(t, col, "credential", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "shell", core.FieldTypeText, false)
	assertFieldExists(t, col, "tunnel_status", core.FieldTypeText, false)
	assertFieldExists(t, col, "tunnel_last_seen", core.FieldTypeDate, false)
	assertFieldExists(t, col, "tunnel_connected_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "tunnel_remote_addr", core.FieldTypeText, false)
	assertFieldExists(t, col, "tunnel_disconnect_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "tunnel_disconnect_reason", core.FieldTypeText, false)
	assertFieldExists(t, col, "tunnel_pause_until", core.FieldTypeDate, false)
	assertFieldExists(t, col, "tunnel_forwards", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "tunnel_services", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "description", core.FieldTypeText, false)
	assertFieldExists(t, col, "created_by", core.FieldTypeText, false)
	assertFieldExists(t, col, "created", core.FieldTypeAutodate, false)
	assertFieldExists(t, col, "updated", core.FieldTypeAutodate, false)
	assertFieldExists(t, col, "facts_json", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "facts_observed_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "access_status", core.FieldTypeText, false)
	assertFieldExists(t, col, "access_reason", core.FieldTypeText, false)
	assertFieldExists(t, col, "access_checked_at", core.FieldTypeDate, false)

	// Verify credential relation points to secrets
	assertRelationTarget(t, app, col, "credential", "secrets")

	// Authenticated users can list/view
	if col.ListRule == nil {
		t.Error("servers.ListRule should allow authenticated users")
	}
}

// TestEnvSetVarsCollectionFields verifies env_set_vars schema and relations.
func TestEnvSetVarsCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("env_set_vars")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "set", core.FieldTypeRelation, true)
	assertFieldExists(t, col, "key", core.FieldTypeText, true)
	assertFieldExists(t, col, "value", core.FieldTypeText, false)
	assertFieldExists(t, col, "is_secret", core.FieldTypeBool, false)
	assertFieldExists(t, col, "secret", core.FieldTypeRelation, false)

	assertRelationTarget(t, app, col, "set", "env_sets")
	assertRelationTarget(t, app, col, "secret", "secrets")

	// Cascade delete: deleting env_set should delete child vars
	setField := col.Fields.GetByName("set")
	rf, ok := setField.(*core.RelationField)
	if !ok {
		t.Fatal("env_set_vars.set is not a RelationField")
	}
	if !rf.CascadeDelete {
		t.Error("env_set_vars.set should have CascadeDelete enabled")
	}
}

// TestDatabasesCollectionFields verifies databases schema and relations.
func TestDatabasesCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("databases")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "name", core.FieldTypeText, true)
	assertFieldExists(t, col, "type", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "host", core.FieldTypeText, false)
	assertFieldExists(t, col, "port", core.FieldTypeNumber, false)
	assertFieldExists(t, col, "db_name", core.FieldTypeText, false)
	assertFieldExists(t, col, "user", core.FieldTypeText, false)
	assertFieldExists(t, col, "password", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "description", core.FieldTypeText, false)

	assertRelationTarget(t, app, col, "password", "secrets")
}

// TestCloudAccountsCollectionFields verifies cloud_accounts schema and relations.
func TestCloudAccountsCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("cloud_accounts")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "name", core.FieldTypeText, true)
	assertFieldExists(t, col, "provider", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "access_key_id", core.FieldTypeText, false)
	assertFieldExists(t, col, "secret", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "region", core.FieldTypeText, false)
	assertFieldExists(t, col, "extra", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "description", core.FieldTypeText, false)

	assertRelationTarget(t, app, col, "secret", "secrets")
}

// TestCertificatesCollectionFields verifies certificates schema and relations.
func TestCertificatesCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("certificates")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "name", core.FieldTypeText, true)
	assertFieldExists(t, col, "domain", core.FieldTypeText, false)
	assertFieldExists(t, col, "template_id", core.FieldTypeText, false)
	assertFieldExists(t, col, "kind", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "cert_pem", core.FieldTypeText, false)
	assertFieldExists(t, col, "key", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "private_key_secret", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "issuer", core.FieldTypeText, false)
	assertFieldExists(t, col, "subject", core.FieldTypeText, false)
	assertFieldExists(t, col, "expires_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "issued_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "serial_number", core.FieldTypeText, false)
	assertFieldExists(t, col, "signature_algorithm", core.FieldTypeText, false)
	assertFieldExists(t, col, "key_bits", core.FieldTypeNumber, false)
	assertFieldExists(t, col, "cert_version", core.FieldTypeNumber, false)
	assertFieldExists(t, col, "status", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "auto_renew", core.FieldTypeBool, false)
	assertFieldExists(t, col, "description", core.FieldTypeText, false)
	assertFieldExists(t, col, "created", core.FieldTypeAutodate, false)
	assertFieldExists(t, col, "updated", core.FieldTypeAutodate, false)

	assertRelationTarget(t, app, col, "key", "secrets")
	assertRelationTarget(t, app, col, "private_key_secret", "secrets")
}

// ─── Helpers ─────────────────────────────────────────────

func assertFieldMissing(t *testing.T, col *core.Collection, name string) {
	t.Helper()
	if col.Fields.GetByName(name) != nil {
		t.Errorf("collection %q: field %q should not exist", col.Name, name)
	}
}

func assertFieldExists(t *testing.T, col *core.Collection, name, fieldType string, required bool) {
	t.Helper()
	f := col.Fields.GetByName(name)
	if f == nil {
		t.Errorf("collection %q: field %q not found", col.Name, name)
		return
	}
	if f.Type() != fieldType {
		t.Errorf("collection %q.%s: expected type %q, got %q", col.Name, name, fieldType, f.Type())
	}
	// Check required via type assertion on known field types
	var actualRequired bool
	switch tf := f.(type) {
	case *core.TextField:
		actualRequired = tf.Required
	case *core.SelectField:
		actualRequired = tf.Required
	case *core.NumberField:
		actualRequired = tf.Required
	case *core.RelationField:
		actualRequired = tf.Required
	default:
		return // skip required check for types without Required field
	}
	if actualRequired != required {
		t.Errorf("collection %q.%s: expected required=%v, got %v", col.Name, name, required, actualRequired)
	}
}

func assertRelationTarget(t *testing.T, app core.App, col *core.Collection, fieldName, targetCollection string) {
	t.Helper()
	f := col.Fields.GetByName(fieldName)
	if f == nil {
		t.Errorf("collection %q: field %q not found", col.Name, fieldName)
		return
	}
	rf, ok := f.(*core.RelationField)
	if !ok {
		t.Errorf("collection %q.%s: expected RelationField, got %T", col.Name, fieldName, f)
		return
	}
	target, err := app.FindCollectionByNameOrId(rf.CollectionId)
	if err != nil {
		t.Errorf("collection %q.%s: relation target collection not found: %v", col.Name, fieldName, err)
		return
	}
	if target.Name != targetCollection {
		t.Errorf("collection %q.%s: expected relation to %q, got %q", col.Name, fieldName, targetCollection, target.Name)
	}
}

func assertSelectFieldValues(t *testing.T, col *core.Collection, fieldName string, expected []string) {
	t.Helper()
	f := col.Fields.GetByName(fieldName)
	if f == nil {
		t.Errorf("collection %q: field %q not found", col.Name, fieldName)
		return
	}
	sf, ok := f.(*core.SelectField)
	if !ok {
		t.Errorf("collection %q.%s: expected SelectField, got %T", col.Name, fieldName, f)
		return
	}
	for _, value := range expected {
		if !slices.Contains(sf.Values, value) {
			t.Errorf("collection %q.%s: expected select value %q to exist", col.Name, fieldName, value)
		}
	}
}

func assertAuthenticatedReadOnlyRules(t *testing.T, col *core.Collection, collectionName string) {
	t.Helper()
	if col.ListRule == nil {
		t.Errorf("%s.ListRule should allow authenticated users", collectionName)
	}
	if col.ViewRule == nil {
		t.Errorf("%s.ViewRule should allow authenticated users", collectionName)
	}
	if col.CreateRule != nil {
		t.Errorf("%s.CreateRule should be nil for superuser-only writes", collectionName)
	}
	if col.UpdateRule != nil {
		t.Errorf("%s.UpdateRule should be nil for superuser-only writes", collectionName)
	}
	if col.DeleteRule != nil {
		t.Errorf("%s.DeleteRule should be nil for superuser-only writes", collectionName)
	}
}

type collectionShape struct {
	FieldDescriptors []string
	Indexes          []string
	ListRule         string
	ViewRule         string
	CreateRule       string
	UpdateRule       string
	DeleteRule       string
}

func snapshotCollectionShape(col *core.Collection) collectionShape {
	shape := collectionShape{
		FieldDescriptors: make([]string, 0, len(col.Fields)),
		Indexes:          append([]string(nil), col.Indexes...),
		ListRule:         pointerValue(col.ListRule),
		ViewRule:         pointerValue(col.ViewRule),
		CreateRule:       pointerValue(col.CreateRule),
		UpdateRule:       pointerValue(col.UpdateRule),
		DeleteRule:       pointerValue(col.DeleteRule),
	}
	for _, field := range col.Fields {
		shape.FieldDescriptors = append(shape.FieldDescriptors, fieldDescriptor(field))
	}
	return shape
}

func pointerValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func fieldDescriptor(field core.Field) string {
	descriptor := fmt.Sprintf("%s:%s:%t", field.GetName(), field.Type(), fieldRequired(field))
	if relation, ok := field.(*core.RelationField); ok {
		descriptor += ":rel=" + relation.CollectionId
	}
	return descriptor
}

func fieldRequired(field core.Field) bool {
	switch typed := field.(type) {
	case *core.TextField:
		return typed.Required
	case *core.SelectField:
		return typed.Required
	case *core.NumberField:
		return typed.Required
	case *core.RelationField:
		return typed.Required
	default:
		return false
	}
}

func deleteCollectionIfPresent(t *testing.T, app core.App, collectionName string) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		return
	}
	if err := app.Delete(col); err != nil {
		t.Fatalf("delete collection %s: %v", collectionName, err)
	}
}

func requireCollection(t *testing.T, app core.App, collectionName string) *core.Collection {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		t.Fatalf("find collection %s: %v", collectionName, err)
	}
	return col
}

func TestResourceSchemaEnsureFunctionsAreIdempotent(t *testing.T) {
	app := newIsolatedMigrationsTestApp(t)

	tests := []struct {
		name           string
		collectionName string
		ensure         func(core.App) error
	}{
		{name: "provider accounts", collectionName: "provider_accounts", ensure: appschema.EnsureProviderAccountsCollection},
		{name: "instances", collectionName: "instances", ensure: appschema.EnsureInstancesCollection},
		{name: "connectors", collectionName: "connectors", ensure: appschema.EnsureConnectorsCollection},
		{name: "ai providers", collectionName: "ai_providers", ensure: appschema.EnsureAIProvidersCollection},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.ensure(app); err != nil {
				t.Fatalf("first ensure failed: %v", err)
			}
			before := snapshotCollectionShape(requireCollection(t, app, tt.collectionName))
			if err := tt.ensure(app); err != nil {
				t.Fatalf("second ensure failed: %v", err)
			}
			after := snapshotCollectionShape(requireCollection(t, app, tt.collectionName))
			if !slices.Equal(before.FieldDescriptors, after.FieldDescriptors) {
				t.Fatalf("field descriptors changed after repeated ensure for %s\nbefore=%v\nafter=%v", tt.collectionName, before.FieldDescriptors, after.FieldDescriptors)
			}
			if !slices.Equal(before.Indexes, after.Indexes) {
				t.Fatalf("indexes changed after repeated ensure for %s\nbefore=%v\nafter=%v", tt.collectionName, before.Indexes, after.Indexes)
			}
			if before.ListRule != after.ListRule || before.ViewRule != after.ViewRule || before.CreateRule != after.CreateRule || before.UpdateRule != after.UpdateRule || before.DeleteRule != after.DeleteRule {
				t.Fatalf("rules changed after repeated ensure for %s", tt.collectionName)
			}
		})
	}
}

func TestEnsureProviderAccountDependentsOnlyBuildsDependentCollections(t *testing.T) {
	app := newIsolatedMigrationsTestApp(t)

	deleteCollectionIfPresent(t, app, "instances")
	deleteCollectionIfPresent(t, app, "connectors")
	deleteCollectionIfPresent(t, app, "ai_providers")

	if err := appschema.EnsureProviderAccountDependents(app); err != nil {
		t.Fatalf("ensure provider account dependents: %v", err)
	}

	requireCollection(t, app, "instances")
	requireCollection(t, app, "connectors")
	if _, err := app.FindCollectionByNameOrId("ai_providers"); err == nil {
		t.Fatal("EnsureProviderAccountDependents should not create ai_providers")
	}

	instancesCol := requireCollection(t, app, "instances")
	connectorsCol := requireCollection(t, app, "connectors")
	if instancesCol.Fields.GetByName("provider_account") == nil {
		t.Fatal("instances.provider_account relation should exist after dependent ensure")
	}
	if connectorsCol.Fields.GetByName("provider_account") == nil {
		t.Fatal("connectors.provider_account relation should exist after dependent ensure")
	}
}

func TestEnsureAllCollectionsRebuildsAndStaysStable(t *testing.T) {
	app := newIsolatedMigrationsTestApp(t)

	for _, collectionName := range []string{"ai_providers", "connectors", "instances", "provider_accounts"} {
		deleteCollectionIfPresent(t, app, collectionName)
	}

	if err := appschema.EnsureAllCollections(app); err != nil {
		t.Fatalf("ensure all collections: %v", err)
	}

	providerAccountsCol := requireCollection(t, app, "provider_accounts")
	instancesCol := requireCollection(t, app, "instances")
	connectorsCol := requireCollection(t, app, "connectors")
	aiProvidersCol := requireCollection(t, app, "ai_providers")

	if providerAccountsCol.Fields.GetByName("identifier") == nil {
		t.Fatal("provider_accounts.identifier should exist after EnsureAllCollections")
	}
	if instancesCol.Fields.GetByName("provider_account") == nil {
		t.Fatal("instances.provider_account should exist after EnsureAllCollections")
	}
	if connectorsCol.Fields.GetByName("provider_account") == nil {
		t.Fatal("connectors.provider_account should exist after EnsureAllCollections")
	}
	if aiProvidersCol.Fields.GetByName("provider_account") == nil {
		t.Fatal("ai_providers.provider_account should exist after EnsureAllCollections")
	}

	before := snapshotCollectionShape(aiProvidersCol)
	if err := appschema.EnsureAllCollections(app); err != nil {
		t.Fatalf("repeat ensure all collections: %v", err)
	}
	after := snapshotCollectionShape(requireCollection(t, app, "ai_providers"))
	if !slices.Equal(before.FieldDescriptors, after.FieldDescriptors) || !slices.Equal(before.Indexes, after.Indexes) {
		t.Fatal("EnsureAllCollections should be idempotent for ai_providers shape")
	}
}

// ═══════════════════════════════════════════════════════════
// Apps collection with resource bindings
// ═══════════════════════════════════════════════════════════

func TestAppsCollectionExists(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("apps")
	if err != nil {
		t.Fatal("apps collection not found:", err)
	}
	if col.Type != core.CollectionTypeBase {
		t.Errorf("expected base collection, got %q", col.Type)
	}
}

func TestAppsCollectionResourceFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("apps")
	if err != nil {
		t.Fatal(err)
	}

	// Core field
	assertFieldExists(t, col, "name", "text", true)

	// JSON fields
	assertFieldExists(t, col, "env_vars", "json", false)
	assertFieldExists(t, col, "credentials", "json", false)

	// Relation fields
	assertRelationTarget(t, app, col, "server", "servers")
	assertRelationTarget(t, app, col, "secrets", "secrets")
	assertRelationTarget(t, app, col, "env_sets", "env_sets")
	assertRelationTarget(t, app, col, "databases", "databases")
	assertRelationTarget(t, app, col, "cloud_accounts", "cloud_accounts")
	assertRelationTarget(t, app, col, "certificates", "certificates")
}

// ═══════════════════════════════════════════════════════════
// Groups collections (Story 21.1)
// ═══════════════════════════════════════════════════════════

func TestGroupsCollectionExists(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("groups")
	if err != nil {
		t.Fatal("groups collection not found:", err)
	}
	if col.Type != core.CollectionTypeBase {
		t.Errorf("expected base collection, got %q", col.Type)
	}
}

func TestGroupsCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("groups")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "name", core.FieldTypeText, true)
	assertFieldExists(t, col, "description", core.FieldTypeText, false)
	assertFieldExists(t, col, "created_by", core.FieldTypeText, false)
	assertFieldExists(t, col, "is_default", core.FieldTypeBool, false)

	// Autodate fields
	if col.Fields.GetByName("created") == nil {
		t.Error("groups: field \"created\" not found")
	}
	if col.Fields.GetByName("updated") == nil {
		t.Error("groups: field \"updated\" not found")
	}

	// List/View allow authenticated; CUD superuser-only
	if col.ListRule == nil {
		t.Error("groups.ListRule should allow authenticated users")
	}
	if col.ViewRule == nil {
		t.Error("groups.ViewRule should allow authenticated users")
	}
	if col.CreateRule != nil {
		t.Error("groups.CreateRule should be nil (superuser only)")
	}
	if col.UpdateRule != nil {
		t.Error("groups.UpdateRule should be nil (superuser only)")
	}
	if col.DeleteRule != nil {
		t.Error("groups.DeleteRule should be nil (superuser only)")
	}
}

func TestGroupItemsCollectionExists(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("group_items")
	if err != nil {
		t.Fatal("group_items collection not found:", err)
	}
	if col.Type != core.CollectionTypeBase {
		t.Errorf("expected base collection, got %q", col.Type)
	}
}

func TestGroupItemsCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("group_items")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "group_id", core.FieldTypeRelation, true)
	assertFieldExists(t, col, "object_type", core.FieldTypeText, true)
	assertFieldExists(t, col, "object_id", core.FieldTypeText, true)

	// Autodate fields
	if col.Fields.GetByName("created") == nil {
		t.Error("group_items: field \"created\" not found")
	}
	if col.Fields.GetByName("updated") == nil {
		t.Error("group_items: field \"updated\" not found")
	}

	// Relation target
	assertRelationTarget(t, app, col, "group_id", "groups")

	// Cascade delete on group_id
	f := col.Fields.GetByName("group_id")
	rf, ok := f.(*core.RelationField)
	if !ok {
		t.Fatal("group_items.group_id is not a RelationField")
	}
	if !rf.CascadeDelete {
		t.Error("group_items.group_id should have CascadeDelete enabled")
	}

	// List/View allow authenticated; CUD superuser-only
	if col.ListRule == nil {
		t.Error("group_items.ListRule should allow authenticated users")
	}
	if col.ViewRule == nil {
		t.Error("group_items.ViewRule should allow authenticated users")
	}
	if col.CreateRule != nil {
		t.Error("group_items.CreateRule should be nil (superuser only)")
	}
}

// ═══════════════════════════════════════════════════════════
// Story 21.3: Groups Migration
// ═══════════════════════════════════════════════════════════

// TestResourceGroupsCollectionRemoved verifies that the legacy resource_groups
// collection no longer exists after the migration runs.
func TestResourceGroupsCollectionRemoved(t *testing.T) {
	app := newMigrationsTestApp(t)
	var err error

	_, err = app.FindCollectionByNameOrId("resource_groups")
	if err == nil {
		t.Error("resource_groups collection should not exist after migration")
	}
}

// TestResourceCollectionsHaveNoGroupsField verifies that the legacy groups
// relation field has been removed from all 8 resource collections.
func TestResourceCollectionsHaveNoGroupsField(t *testing.T) {
	app := newMigrationsTestApp(t)

	collections := []string{
		"servers", "secrets", "env_sets",
		"databases", "cloud_accounts", "certificates", "provider_accounts",
		"connectors", "ai_providers",
	}
	for _, colName := range collections {
		col, err := app.FindCollectionByNameOrId(colName)
		if err != nil {
			t.Errorf("collection %q not found: %v", colName, err)
			continue
		}
		if col.Fields.GetByName("groups") != nil {
			t.Errorf("collection %q still has a legacy 'groups' field after migration", colName)
		}
	}
}

func TestLegacyScriptsCollectionRemoved(t *testing.T) {
	app := newMigrationsTestApp(t)

	if _, err := app.FindCollectionByNameOrId("scripts"); err == nil {
		t.Fatal("legacy scripts collection should not exist after migrations")
	}
}

// TestGroupsAndGroupItemsExistAfterMigration verifies that the new groups and
// group_items collections are present (created by Story 21.1).
func TestGroupsAndGroupItemsExistAfterMigration(t *testing.T) {
	app := newMigrationsTestApp(t)

	if _, err := app.FindCollectionByNameOrId("groups"); err != nil {
		t.Error("groups collection not found after migration:", err)
	}
	if _, err := app.FindCollectionByNameOrId("group_items"); err != nil {
		t.Error("group_items collection not found after migration:", err)
	}
}

func TestInstancesCollectionExistsAfterMigration(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("instances")
	if err != nil {
		t.Fatal("instances collection not found after migration:", err)
	}

	for _, fieldName := range []string{"name", "kind", "is_enabled", "template_id", "endpoint", "provider_account", "credential", "config", "description"} {
		if col.Fields.GetByName(fieldName) == nil {
			t.Fatalf("instances collection missing field %q", fieldName)
		}
	}
	assertFieldExists(t, col, "is_enabled", core.FieldTypeBool, false)
	assertRelationTarget(t, app, col, "provider_account", "provider_accounts")
}

func TestAssetsCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("assets")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "name", core.FieldTypeText, true)
	assertFieldExists(t, col, "description", core.FieldTypeText, false)
	assertFieldExists(t, col, "kind", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "storage_kind", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "source_kind", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "language", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "script_extension", core.FieldTypeText, false)
	assertFieldExists(t, col, "reference", core.FieldTypeText, false)
	assertFieldExists(t, col, "path", core.FieldTypeText, false)
	assertFieldExists(t, col, "entrypoint", core.FieldTypeText, false)
	assertFieldExists(t, col, "template_key", core.FieldTypeText, false)
	assertFieldExists(t, col, "is_system", core.FieldTypeBool, false)
	assertFieldExists(t, col, "is_template", core.FieldTypeBool, false)
	assertFieldExists(t, col, "prompt_scope", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "created", core.FieldTypeAutodate, false)
	assertFieldExists(t, col, "updated", core.FieldTypeAutodate, false)
	assertSelectFieldValues(t, col, "kind", []string{"script", "skill", "prompt"})
	assertSelectFieldValues(t, col, "storage_kind", []string{"file", "folder"})
	assertSelectFieldValues(t, col, "source_kind", []string{"local", "reference"})
	assertSelectFieldValues(t, col, "prompt_scope", []string{"system", "task"})
	assertSelectFieldValues(t, col, "language", []string{"shell", "bash", "zsh", "python", "javascript", "typescript", "powershell", "ruby", "perl", "php", "lua", "groovy", "r", "other"})

	if col.ListRule == nil || col.ViewRule == nil {
		t.Fatal("assets should be readable by authenticated users")
	}
	if col.CreateRule != nil || col.UpdateRule != nil || col.DeleteRule != nil {
		t.Fatal("assets write rules should remain nil for superuser-only write access")
	}
	if len(col.Indexes) == 0 {
		t.Fatal("assets should define at least one index")
	}
}

func TestMediaCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("media")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "category", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "scope", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "owner_type", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "owner_id", core.FieldTypeText, false)
	assertFieldExists(t, col, "original_name", core.FieldTypeText, true)
	assertFieldExists(t, col, "content_type", core.FieldTypeText, true)
	assertFieldExists(t, col, "size", core.FieldTypeNumber, true)
	assertFieldExists(t, col, "storage_path", core.FieldTypeText, true)
	assertFieldExists(t, col, "public_url", core.FieldTypeText, false)
	assertFieldExists(t, col, "created_by", core.FieldTypeText, false)
	assertFieldExists(t, col, "created", core.FieldTypeAutodate, false)
	assertFieldExists(t, col, "updated", core.FieldTypeAutodate, false)
	assertSelectFieldValues(t, col, "category", []string{"branding", "avatar", "general"})
	assertSelectFieldValues(t, col, "scope", []string{"public", "private"})
	assertSelectFieldValues(t, col, "owner_type", []string{"system", "user", "other"})
	if col.ListRule == nil || col.ViewRule == nil {
		t.Fatal("media should be readable by authenticated users")
	}
	if len(col.Indexes) == 0 {
		t.Fatal("media should define at least one index")
	}
}

func TestProviderAccountsCollectionExistsAfterMigration(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("provider_accounts")
	if err != nil {
		t.Fatal("provider_accounts collection not found after migration:", err)
	}

	for _, fieldName := range []string{"name", "kind", "is_enabled", "template_id", "identifier", "credential", "config", "description"} {
		if col.Fields.GetByName(fieldName) == nil {
			t.Fatalf("provider_accounts collection missing field %q", fieldName)
		}
	}
	assertFieldExists(t, col, "is_enabled", core.FieldTypeBool, false)
	assertFieldExists(t, col, "identifier", core.FieldTypeText, true)
	assertRelationTarget(t, app, col, "credential", "secrets")
}

func TestConnectorsCollectionHasProviderAccountRelation(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("connectors")
	if err != nil {
		t.Fatal(err)
	}
	if col.Fields.GetByName("provider_account") == nil {
		t.Fatal("connectors collection missing field \"provider_account\"")
	}
	assertFieldExists(t, col, "is_enabled", core.FieldTypeBool, false)
	assertRelationTarget(t, app, col, "provider_account", "provider_accounts")
	assertSelectFieldValues(t, col, "kind", connectors.AllowedKinds())
}

func TestConnectorsCollectionSchemaBaseline(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("connectors")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "name", core.FieldTypeText, true)
	assertFieldExists(t, col, "kind", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "is_enabled", core.FieldTypeBool, false)
	assertFieldExists(t, col, "template_id", core.FieldTypeText, false)
	assertFieldExists(t, col, "endpoint", core.FieldTypeText, false)
	assertFieldExists(t, col, "auth_scheme", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "provider_account", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "credential", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "config", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "description", core.FieldTypeText, false)
	assertFieldMissing(t, col, "is_default")
	assertRelationTarget(t, app, col, "credential", "secrets")
	assertSelectFieldValues(t, col, "auth_scheme", []string{"none", "api_key", "bearer", "basic"})
	assertAuthenticatedReadOnlyRules(t, col, "connectors")
	if len(col.Indexes) < 2 {
		t.Fatal("connectors should define name and kind/template indexes")
	}
}

func TestAIProvidersCollectionExistsAfterMigration(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("ai_providers")
	if err != nil {
		t.Fatal("ai_providers collection not found after migration:", err)
	}

	for _, fieldName := range []string{"name", "kind", "is_enabled", "template_id", "endpoint", "provider_account", "credential", "config", "description"} {
		if col.Fields.GetByName(fieldName) == nil {
			t.Fatalf("ai_providers collection missing field %q", fieldName)
		}
	}
	assertFieldExists(t, col, "is_enabled", core.FieldTypeBool, false)
	assertRelationTarget(t, app, col, "provider_account", "provider_accounts")
	assertRelationTarget(t, app, col, "credential", "secrets")
}

func TestAIProvidersCollectionSchemaBaseline(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("ai_providers")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "name", core.FieldTypeText, true)
	assertFieldExists(t, col, "kind", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "is_enabled", core.FieldTypeBool, false)
	assertFieldExists(t, col, "is_default", core.FieldTypeBool, false)
	assertFieldExists(t, col, "template_id", core.FieldTypeText, false)
	assertFieldExists(t, col, "endpoint", core.FieldTypeText, false)
	assertFieldExists(t, col, "auth_scheme", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "provider_account", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "credential", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "config", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "description", core.FieldTypeText, false)
	assertSelectFieldValues(t, col, "kind", []string{"llm"})
	assertSelectFieldValues(t, col, "auth_scheme", []string{"none", "api_key", "bearer", "basic"})
	assertRelationTarget(t, app, col, "provider_account", "provider_accounts")
	assertRelationTarget(t, app, col, "credential", "secrets")
	assertAuthenticatedReadOnlyRules(t, col, "ai_providers")
	if len(col.Indexes) < 2 {
		t.Fatal("ai_providers should define name and kind/template indexes")
	}
}

func TestResourceCollectionsUseAuthenticatedReadAndSuperuserWriteRules(t *testing.T) {
	app := newMigrationsTestApp(t)

	for _, collectionName := range []string{"instances", "provider_accounts", "connectors", "ai_providers"} {
		col, err := app.FindCollectionByNameOrId(collectionName)
		if err != nil {
			t.Fatalf("collection %q not found: %v", collectionName, err)
		}
		assertAuthenticatedReadOnlyRules(t, col, collectionName)
	}
}

// ═══════════════════════════════════════════════════════════
// Epic 24: Shared Envs
// ═══════════════════════════════════════════════════════════

// TestLegacyEnvGroupsRemoved verifies that old env_groups / env_group_vars
// collections no longer exist after the migration.
func TestLegacyEnvGroupsRemoved(t *testing.T) {
	app := newMigrationsTestApp(t)

	if _, err := app.FindCollectionByNameOrId("env_groups"); err == nil {
		t.Error("env_groups collection should not exist after Epic 24 migration")
	}
	if _, err := app.FindCollectionByNameOrId("env_group_vars"); err == nil {
		t.Error("env_group_vars collection should not exist after Epic 24 migration")
	}
}

// TestEnvSetsCollectionFields verifies the env_sets collection schema.
func TestEnvSetsCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("env_sets")
	if err != nil {
		t.Fatal("env_sets collection not found:", err)
	}
	if col.Type != core.CollectionTypeBase {
		t.Errorf("expected base collection, got %q", col.Type)
	}

	assertFieldExists(t, col, "name", core.FieldTypeText, true)
	assertFieldExists(t, col, "description", core.FieldTypeText, false)

	// Authenticated read; superuser-only CUD
	if col.ListRule == nil {
		t.Error("env_sets.ListRule should allow authenticated users")
	}
	if col.ViewRule == nil {
		t.Error("env_sets.ViewRule should allow authenticated users")
	}
	if col.CreateRule != nil {
		t.Error("env_sets.CreateRule should be nil (superuser only)")
	}
	if col.UpdateRule != nil {
		t.Error("env_sets.UpdateRule should be nil (superuser only)")
	}
	if col.DeleteRule != nil {
		t.Error("env_sets.DeleteRule should be nil (superuser only)")
	}
}

func TestFeedSourcesCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("feed_sources")
	if err != nil {
		t.Fatal("feed_sources collection not found:", err)
	}
	if col.Type != core.CollectionTypeBase {
		t.Fatalf("expected base collection, got %q", col.Type)
	}

	assertFieldExists(t, col, "name", core.FieldTypeText, true)
	assertFieldExists(t, col, "url", core.FieldTypeText, true)
	assertFieldExists(t, col, "format", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "status", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "failure_streak", core.FieldTypeNumber, false)
	assertFieldExists(t, col, "next_poll_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "item_count", core.FieldTypeNumber, false)
	assertFieldExists(t, col, "favicon_url", core.FieldTypeURL, false)
	assertFieldExists(t, col, "last_fetched_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "last_success_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "last_error", core.FieldTypeText, false)
	assertFieldExists(t, col, "created", core.FieldTypeAutodate, false)
	assertFieldExists(t, col, "updated", core.FieldTypeAutodate, false)
	assertSelectFieldValues(t, col, "format", []string{"rss", "atom"})
	assertSelectFieldValues(t, col, "status", []string{"active", "paused", "archived"})

	if col.ListRule == nil || col.ViewRule == nil {
		t.Fatal("feed_sources should allow authenticated reads")
	}
	if col.CreateRule == nil || col.UpdateRule == nil || col.DeleteRule == nil {
		t.Fatal("feed_sources writes should be limited by explicit superuser rules")
	}
	if len(col.Indexes) == 0 {
		t.Fatal("feed_sources should define a unique URL index")
	}
}

func TestFeedSourcesRejectDuplicateURL(t *testing.T) {
	app := newIsolatedMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("feed_sources")
	if err != nil {
		t.Fatal(err)
	}

	first := core.NewRecord(col)
	first.Set("name", "App release feed")
	first.Set("url", "https://example.com/feed.xml")
	first.Set("format", "rss")
	first.Set("status", "active")
	first.Set("failure_streak", 0)
	if err := app.Save(first); err != nil {
		t.Fatalf("failed to save first feed source: %v", err)
	}

	duplicate := core.NewRecord(col)
	duplicate.Set("name", "Same URL")
	duplicate.Set("url", "https://example.com/feed.xml")
	duplicate.Set("format", "rss")
	duplicate.Set("status", "paused")
	duplicate.Set("failure_streak", 0)
	if err := app.Save(duplicate); err == nil {
		t.Fatal("expected duplicate feed source URL to be rejected")
	}
}

func TestFeedSourcesPausedAndArchivedStatusesPersist(t *testing.T) {
	app := newIsolatedMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("feed_sources")
	if err != nil {
		t.Fatal(err)
	}

	statuses := []string{"paused", "archived"}
	for _, status := range statuses {
		rec := core.NewRecord(col)
		rec.Set("name", "feed-"+status)
		rec.Set("url", "https://example.com/"+status+".xml")
		rec.Set("format", "atom")
		rec.Set("status", status)
		rec.Set("failure_streak", 0)
		if err := app.Save(rec); err != nil {
			t.Fatalf("failed to save feed source with status %q: %v", status, err)
		}

		stored, err := app.FindRecordById("feed_sources", rec.Id)
		if err != nil {
			t.Fatalf("failed to reload feed source with status %q: %v", status, err)
		}
		if got := stored.GetString("status"); got != status {
			t.Fatalf("expected status %q, got %q", status, got)
		}
	}
}

func TestFeedItemsCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("feed_items")
	if err != nil {
		t.Fatal("feed_items collection not found:", err)
	}
	if col.Type != core.CollectionTypeBase {
		t.Fatalf("expected base collection, got %q", col.Type)
	}

	assertFieldExists(t, col, "source_id", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "origin_type", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "external_id", core.FieldTypeText, true)
	assertFieldExists(t, col, "title", core.FieldTypeText, true)
	assertFieldExists(t, col, "link", core.FieldTypeText, true)
	assertFieldExists(t, col, "published_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "summary", core.FieldTypeText, false)
	assertFieldExists(t, col, "favicon_url", core.FieldTypeURL, false)
	assertFieldExists(t, col, "keywords_json", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "tags_json", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "read_state", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "is_starred", core.FieldTypeBool, false)
	assertFieldMissing(t, col, "state")
	assertFieldExists(t, col, "created", core.FieldTypeAutodate, false)
	assertFieldExists(t, col, "updated", core.FieldTypeAutodate, false)
	assertRelationTarget(t, app, col, "source_id", "feed_sources")
	assertSelectFieldValues(t, col, "origin_type", []string{"feed", "bookmark"})
	assertSelectFieldValues(t, col, "read_state", []string{"unread", "read"})

	field := col.Fields.GetByName("source_id")
	rf, ok := field.(*core.RelationField)
	if !ok {
		t.Fatalf("source_id should be a relation field, got %T", field)
	}
	if !rf.CascadeDelete {
		t.Fatal("feed_items.source_id should have CascadeDelete enabled")
	}

	if col.ListRule == nil || col.ViewRule == nil {
		t.Fatal("feed_items should allow authenticated reads")
	}
	if col.CreateRule != nil || col.UpdateRule != nil || col.DeleteRule != nil {
		t.Fatal("feed_items writes must remain backend-owned")
	}
}

func TestFeedItemsOriginTypeStorageDefault(t *testing.T) {
	app := newIsolatedMigrationsTestApp(t)

	type sqliteColumnDefault struct {
		Name      string `db:"name"`
		DfltValue string `db:"dflt_value"`
	}

	var columns []sqliteColumnDefault
	if err := app.DB().NewQuery("PRAGMA table_info(`feed_items`)").All(&columns); err != nil {
		t.Fatal(err)
	}

	found := false
	for _, column := range columns {
		if column.Name != "origin_type" {
			continue
		}
		found = true
		if column.DfltValue != "'feed'" {
			t.Fatalf("expected origin_type storage default 'feed', got %q", column.DfltValue)
		}
	}
	if !found {
		t.Fatal("origin_type column not found in feed_items")
	}

	if _, err := app.DB().NewQuery("INSERT INTO feed_items (external_id, title, link, read_state, is_starred) VALUES ('raw-item-1', 'Raw item', 'https://example.com/raw-item', 'unread', FALSE)").Execute(); err != nil {
		t.Fatalf("raw insert without origin_type: %v", err)
	}

	stored, err := app.FindFirstRecordByFilter(feeds.CollectionItems, "external_id = {:external_id}", map[string]any{"external_id": "raw-item-1"})
	if err != nil {
		t.Fatal(err)
	}
	if stored.GetString("origin_type") != feeds.OriginTypeFeed {
		t.Fatalf("expected raw inserted item origin_type %q, got %q", feeds.OriginTypeFeed, stored.GetString("origin_type"))
	}
}

func TestFeedItemsRejectDuplicateSourceExternalID(t *testing.T) {
	app := newIsolatedMigrationsTestApp(t)

	sourceCol, err := app.FindCollectionByNameOrId("feed_sources")
	if err != nil {
		t.Fatal(err)
	}
	source := core.NewRecord(sourceCol)
	source.Set("name", "AppOS feed")
	source.Set("url", "https://example.com/feed.xml")
	source.Set("format", "rss")
	source.Set("status", "active")
	source.Set("failure_streak", 0)
	if err := app.Save(source); err != nil {
		t.Fatalf("failed to save feed source: %v", err)
	}

	itemsCol, err := app.FindCollectionByNameOrId("feed_items")
	if err != nil {
		t.Fatal(err)
	}

	first := core.NewRecord(itemsCol)
	first.Set("source_id", source.Id)
	first.Set("origin_type", "feed")
	first.Set("external_id", "item-123")
	first.Set("title", "Release 1.0")
	first.Set("link", "https://example.com/releases/1")
	first.Set("read_state", "unread")
	first.Set("is_starred", false)
	if err := app.Save(first); err != nil {
		t.Fatalf("failed to save first feed item: %v", err)
	}

	duplicate := core.NewRecord(itemsCol)
	duplicate.Set("source_id", source.Id)
	duplicate.Set("origin_type", "feed")
	duplicate.Set("external_id", "item-123")
	duplicate.Set("title", "Release 1.0 duplicate")
	duplicate.Set("link", "https://example.com/releases/1b")
	duplicate.Set("read_state", "read")
	duplicate.Set("is_starred", true)
	if err := app.Save(duplicate); err == nil {
		t.Fatal("expected duplicate source_id + external_id to be rejected")
	}
}

// TestAppsEnvSetsField verifies that apps collection has env_sets relation field.
func TestAppsEnvSetsField(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("apps")
	if err != nil {
		t.Fatal(err)
	}

	// Old field must be gone
	if col.Fields.GetByName("env_groups") != nil {
		t.Error("apps should not have legacy 'env_groups' field")
	}

	// New field must exist and point to env_sets
	assertRelationTarget(t, app, col, "env_sets", "env_sets")
}

// TestEnvSetVarsCascadeDelete verifies that deleting an env_set cascades
// to child env_set_vars records.
func TestEnvSetVarsCascadeDelete(t *testing.T) {
	app := newIsolatedMigrationsTestApp(t)

	// Create an env_set
	setCol, _ := app.FindCollectionByNameOrId("env_sets")
	rec := core.NewRecord(setCol)
	rec.Set("name", "test-cascade-set")
	if err := app.Save(rec); err != nil {
		t.Fatal("failed to create env_set:", err)
	}

	// Create a child var
	varCol, _ := app.FindCollectionByNameOrId("env_set_vars")
	varRec := core.NewRecord(varCol)
	varRec.Set("set", rec.Id)
	varRec.Set("key", "TEST_KEY")
	varRec.Set("value", "test_value")
	if err := app.Save(varRec); err != nil {
		t.Fatal("failed to create env_set_var:", err)
	}
	varId := varRec.Id

	// Delete parent — child should be cascade-deleted
	if err := app.Delete(rec); err != nil {
		t.Fatal("failed to delete env_set:", err)
	}

	if _, err := app.FindRecordById("env_set_vars", varId); err == nil {
		t.Error("env_set_var should be cascade-deleted when parent env_set is deleted")
	}
}

// TestEnvSetVarsSecretExpandHidesPayload verifies that expanding the secret
// relation on env_set_vars does NOT expose payload_encrypted.
func TestEnvSetVarsSecretExpandHidesPayload(t *testing.T) {
	app := newMigrationsTestApp(t)

	// Verify secrets.payload_encrypted is hidden
	secretsCol, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	payloadField := secretsCol.Fields.GetByName("payload_encrypted")
	if payloadField == nil {
		t.Fatal("secrets.payload_encrypted field not found")
	}
	if !payloadField.GetHidden() {
		t.Error("secrets.payload_encrypted must be hidden to prevent exposure via expand")
	}
}

func TestSoftwareInventorySnapshotsCollectionFields(t *testing.T) {
	app := newMigrationsTestApp(t)

	col, err := app.FindCollectionByNameOrId("software_inventory_snapshots")
	if err != nil {
		t.Fatal("software_inventory_snapshots collection not found:", err)
	}

	assertFieldExists(t, col, "target_type", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "target_id", core.FieldTypeText, true)
	assertFieldExists(t, col, "component_key", core.FieldTypeText, true)
	assertFieldExists(t, col, "label", core.FieldTypeText, true)
	assertFieldExists(t, col, "template_kind", core.FieldTypeText, true)
	assertFieldExists(t, col, "installed_state", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "detected_version", core.FieldTypeText, false)
	assertFieldExists(t, col, "packaged_version", core.FieldTypeText, false)
	assertFieldExists(t, col, "verification_state", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "service_name", core.FieldTypeText, false)
	assertFieldExists(t, col, "binary_path", core.FieldTypeText, false)
	assertFieldExists(t, col, "preflight_json", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "verification_json", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "last_action_json", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "created", core.FieldTypeAutodate, false)
	assertFieldExists(t, col, "updated", core.FieldTypeAutodate, false)

	if col.ListRule == nil || col.ViewRule == nil {
		t.Fatal("software_inventory_snapshots should allow authenticated reads")
	}
	if col.CreateRule != nil || col.UpdateRule != nil || col.DeleteRule != nil {
		t.Fatal("software_inventory_snapshots writes must remain backend-only")
	}
}

func TestSecretsPolicySeedExists(t *testing.T) {
	app := newMigrationsTestApp(t)

	value, err := sysconfig.GetGroup(app, "secrets", "policy", nil)
	if err != nil {
		t.Fatalf("expected seeded secrets/policy row: %v", err)
	}
	policy := secrets.NormalizePolicy(value)

	if policy.DefaultAccessMode != secrets.AccessModeUseOnly {
		t.Fatalf("expected defaultAccessMode use_only, got %#v", policy.DefaultAccessMode)
	}
	if policy.RevealDisabled != false {
		t.Fatalf("expected revealDisabled false, got %#v", policy.RevealDisabled)
	}
	if policy.ClipboardClearSeconds != 0 {
		t.Fatalf("expected clipboardClearSeconds 0, got %#v", policy.ClipboardClearSeconds)
	}
}
