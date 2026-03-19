package migrations_test

import (
	"slices"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/internal/deploy"

	// trigger init() registrations
	_ "github.com/websoft9/appos/backend/internal/migrations"
)

// TestResourceCollectionsCreated verifies that all resource collections
// are created after running migrations.
func TestResourceCollectionsCreated(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	expected := []string{
		"secrets",
		"env_sets",
		"env_set_vars",
		"servers",
		"databases",
		"cloud_accounts",
		"certificates",
		"deployments",
		"app_instances",
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

func TestAppInstancesCollectionFields(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	col, err := app.FindCollectionByNameOrId("app_instances")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "deployment_id", core.FieldTypeText, false)
	assertFieldExists(t, col, "server_id", core.FieldTypeText, false)
	assertFieldExists(t, col, "name", core.FieldTypeText, true)
	assertFieldExists(t, col, "project_dir", core.FieldTypeText, true)
	assertFieldExists(t, col, "source", core.FieldTypeText, false)
	assertFieldExists(t, col, "status", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "runtime_status", core.FieldTypeText, false)
	assertFieldExists(t, col, "runtime_reason", core.FieldTypeText, false)
	assertFieldExists(t, col, "last_deployment_status", core.FieldTypeText, false)
	assertFieldExists(t, col, "last_action", core.FieldTypeText, false)
	assertFieldExists(t, col, "last_action_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "last_deployed_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "config_rollback_snapshot", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "created", core.FieldTypeAutodate, false)
	assertFieldExists(t, col, "updated", core.FieldTypeAutodate, false)

	if col.ListRule == nil || col.ViewRule == nil {
		t.Fatal("app_instances should be readable by authenticated users")
	}
}

func TestDeploymentsCollectionFields(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	col, err := app.FindCollectionByNameOrId("deployments")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "server_id", core.FieldTypeText, false)
	assertFieldExists(t, col, "source", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "status", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "adapter", core.FieldTypeText, false)
	assertFieldExists(t, col, "compose_project_name", core.FieldTypeText, false)
	assertFieldExists(t, col, "project_dir", core.FieldTypeText, false)
	assertFieldExists(t, col, "spec", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "rendered_compose", core.FieldTypeText, false)
	assertFieldExists(t, col, "execution_log", core.FieldTypeText, false)
	assertFieldExists(t, col, "execution_log_truncated", core.FieldTypeBool, false)
	assertFieldExists(t, col, "error_summary", core.FieldTypeText, false)
	assertFieldExists(t, col, "release_snapshot", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "started_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "finished_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "created", core.FieldTypeAutodate, false)
	assertFieldExists(t, col, "updated", core.FieldTypeAutodate, false)
	assertSelectFieldValues(t, col, "status", deploy.StatusValues())

	if col.ListRule == nil || col.ViewRule == nil {
		t.Fatal("deployments should be readable by authenticated users")
	}
}

// TestSecretsCollectionFields verifies the secrets collection schema.
func TestSecretsCollectionFields(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

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
	assertFieldExists(t, col, "scope", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "access_mode", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "payload_encrypted", core.FieldTypeText, false)
	assertFieldExists(t, col, "payload_meta", core.FieldTypeJSON, false)
	assertFieldExists(t, col, "status", core.FieldTypeSelect, false)
	assertFieldExists(t, col, "version", core.FieldTypeNumber, false)
	assertFieldExists(t, col, "last_used_at", core.FieldTypeDate, false)
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
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	col, err := app.FindCollectionByNameOrId("servers")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "name", core.FieldTypeText, true)
	assertFieldExists(t, col, "host", core.FieldTypeText, true)
	assertFieldExists(t, col, "port", core.FieldTypeNumber, false)
	assertFieldExists(t, col, "user", core.FieldTypeText, true)
	// auth_type removed in migration 1762700000 — credential type is inferred from secret.template_id
	assertFieldExists(t, col, "credential", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "description", core.FieldTypeText, false)

	// Verify credential relation points to secrets
	assertRelationTarget(t, app, col, "credential", "secrets")

	// Authenticated users can list/view
	if col.ListRule == nil {
		t.Error("servers.ListRule should allow authenticated users")
	}
}

// TestEnvSetVarsCollectionFields verifies env_set_vars schema and relations.
func TestEnvSetVarsCollectionFields(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

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
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

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
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

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
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

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
}

// ─── Helpers ─────────────────────────────────────────────

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

// ═══════════════════════════════════════════════════════════
// Apps collection with resource bindings
// ═══════════════════════════════════════════════════════════

func TestAppsCollectionExists(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	col, err := app.FindCollectionByNameOrId("apps")
	if err != nil {
		t.Fatal("apps collection not found:", err)
	}
	if col.Type != core.CollectionTypeBase {
		t.Errorf("expected base collection, got %q", col.Type)
	}
}

func TestAppsCollectionResourceFields(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

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
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	col, err := app.FindCollectionByNameOrId("groups")
	if err != nil {
		t.Fatal("groups collection not found:", err)
	}
	if col.Type != core.CollectionTypeBase {
		t.Errorf("expected base collection, got %q", col.Type)
	}
}

func TestGroupsCollectionFields(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	col, err := app.FindCollectionByNameOrId("groups")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "name", core.FieldTypeText, true)
	assertFieldExists(t, col, "description", core.FieldTypeText, false)
	assertFieldExists(t, col, "created_by", core.FieldTypeText, false)

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
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	col, err := app.FindCollectionByNameOrId("group_items")
	if err != nil {
		t.Fatal("group_items collection not found:", err)
	}
	if col.Type != core.CollectionTypeBase {
		t.Errorf("expected base collection, got %q", col.Type)
	}
}

func TestGroupItemsCollectionFields(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

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
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	_, err = app.FindCollectionByNameOrId("resource_groups")
	if err == nil {
		t.Error("resource_groups collection should not exist after migration")
	}
}

// TestResourceCollectionsHaveNoGroupsField verifies that the legacy groups
// relation field has been removed from all 8 resource collections.
func TestResourceCollectionsHaveNoGroupsField(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	collections := []string{
		"servers", "secrets", "env_sets",
		"databases", "cloud_accounts", "certificates",
		"integrations", "scripts",
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

// TestGroupsAndGroupItemsExistAfterMigration verifies that the new groups and
// group_items collections are present (created by Story 21.1).
func TestGroupsAndGroupItemsExistAfterMigration(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	if _, err := app.FindCollectionByNameOrId("groups"); err != nil {
		t.Error("groups collection not found after migration:", err)
	}
	if _, err := app.FindCollectionByNameOrId("group_items"); err != nil {
		t.Error("group_items collection not found after migration:", err)
	}
}

// ═══════════════════════════════════════════════════════════
// Epic 24: Shared Envs
// ═══════════════════════════════════════════════════════════

// TestLegacyEnvGroupsRemoved verifies that old env_groups / env_group_vars
// collections no longer exist after the migration.
func TestLegacyEnvGroupsRemoved(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	if _, err := app.FindCollectionByNameOrId("env_groups"); err == nil {
		t.Error("env_groups collection should not exist after Epic 24 migration")
	}
	if _, err := app.FindCollectionByNameOrId("env_group_vars"); err == nil {
		t.Error("env_group_vars collection should not exist after Epic 24 migration")
	}
}

// TestEnvSetsCollectionFields verifies the env_sets collection schema.
func TestEnvSetsCollectionFields(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

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

// TestAppsEnvSetsField verifies that apps collection has env_sets relation field.
func TestAppsEnvSetsField(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

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
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

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
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

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
