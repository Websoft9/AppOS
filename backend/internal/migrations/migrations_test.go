package migrations_test

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	// trigger init() registrations
	_ "github.com/websoft9/appos/backend/internal/migrations"
)

// TestResourceCollectionsCreated verifies that all 7 resource collections
// are created after running migrations.
func TestResourceCollectionsCreated(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	expected := []string{
		"secrets",
		"env_groups",
		"env_group_vars",
		"servers",
		"databases",
		"cloud_accounts",
		"certificates",
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

	// Secrets: name (text, required), type (select), value (text, hidden), description (text)
	assertFieldExists(t, col, "name", core.FieldTypeText, true)
	assertFieldExists(t, col, "type", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "value", core.FieldTypeText, false)
	assertFieldExists(t, col, "description", core.FieldTypeText, false)

	// value field must be hidden
	valueField := col.Fields.GetByName("value")
	if valueField == nil {
		t.Fatal("value field not found")
	}
	if !valueField.GetHidden() {
		t.Error("secrets.value field should be hidden")
	}

	// Superuser-only rules (nil = superuser only in PB)
	if col.ListRule != nil {
		t.Error("secrets.ListRule should be nil (superuser only)")
	}
	if col.ViewRule != nil {
		t.Error("secrets.ViewRule should be nil (superuser only)")
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
	assertFieldExists(t, col, "auth_type", core.FieldTypeSelect, true)
	assertFieldExists(t, col, "credential", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "description", core.FieldTypeText, false)

	// Verify credential relation points to secrets
	assertRelationTarget(t, app, col, "credential", "secrets")

	// Authenticated users can list/view
	if col.ListRule == nil {
		t.Error("servers.ListRule should allow authenticated users")
	}
}

// TestEnvGroupVarsCollectionFields verifies env_group_vars schema and relations.
func TestEnvGroupVarsCollectionFields(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	col, err := app.FindCollectionByNameOrId("env_group_vars")
	if err != nil {
		t.Fatal(err)
	}

	assertFieldExists(t, col, "group", core.FieldTypeRelation, true)
	assertFieldExists(t, col, "key", core.FieldTypeText, true)
	assertFieldExists(t, col, "value", core.FieldTypeText, false)
	assertFieldExists(t, col, "is_secret", core.FieldTypeBool, false)
	assertFieldExists(t, col, "secret", core.FieldTypeRelation, false)

	assertRelationTarget(t, app, col, "group", "env_groups")
	assertRelationTarget(t, app, col, "secret", "secrets")
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
	assertFieldExists(t, col, "cert_pem", core.FieldTypeText, false)
	assertFieldExists(t, col, "key", core.FieldTypeRelation, false)
	assertFieldExists(t, col, "expires_at", core.FieldTypeDate, false)
	assertFieldExists(t, col, "auto_renew", core.FieldTypeBool, false)
	assertFieldExists(t, col, "description", core.FieldTypeText, false)

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
	assertRelationTarget(t, app, col, "env_groups", "env_groups")
	assertRelationTarget(t, app, col, "databases", "databases")
	assertRelationTarget(t, app, col, "cloud_accounts", "cloud_accounts")
	assertRelationTarget(t, app, col, "certificates", "certificates")
}
