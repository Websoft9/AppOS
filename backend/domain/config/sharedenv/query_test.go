package sharedenv_test

import (
	"encoding/base64"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/config/sharedenv"
	"github.com/websoft9/appos/backend/domain/secrets"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func TestGetSetAndListVars(t *testing.T) {
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	t.Setenv(secrets.EnvSecretKey, key)
	if err := secrets.LoadKeyFromEnv(); err != nil {
		t.Fatalf("load secret key: %v", err)
	}

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	setCol, err := app.FindCollectionByNameOrId(sharedenv.SetCollection)
	if err != nil {
		t.Fatalf("find env_sets collection: %v", err)
	}
	setRecord := core.NewRecord(setCol)
	setRecord.Set("name", "demo-set")
	setRecord.Set("description", "demo description")
	if err := app.Save(setRecord); err != nil {
		t.Fatalf("save env_set: %v", err)
	}

	varCol, err := app.FindCollectionByNameOrId(sharedenv.VarCollection)
	if err != nil {
		t.Fatalf("find env_set_vars collection: %v", err)
	}

	plainVar := core.NewRecord(varCol)
	plainVar.Set("set", setRecord.Id)
	plainVar.Set("key", "APP_ENV")
	plainVar.Set("value", "staging")
	plainVar.Set("is_secret", false)
	if err := app.Save(plainVar); err != nil {
		t.Fatalf("save plain env_set_var: %v", err)
	}

	secretCol, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatalf("find secrets collection: %v", err)
	}
	secretRecord := core.NewRecord(secretCol)
	secretRecord.Set("name", "shared-env-secret")
	secretRecord.Set("template_id", "single_value")
	secretRecord.Set("scope", "global")
	secretRecord.Set("access_mode", "use_only")
	secretRecord.Set("status", "active")
	secretRecord.Set("created_by", "")
	secretRecord.Set("version", 1)
	enc, err := secrets.EncryptPayload(map[string]any{"value": "super-secret"})
	if err != nil {
		t.Fatalf("encrypt secret payload: %v", err)
	}
	secretRecord.Set("payload_encrypted", enc)
	if err := app.Save(secretRecord); err != nil {
		t.Fatalf("save secret record: %v", err)
	}

	secretVar := core.NewRecord(varCol)
	secretVar.Set("set", setRecord.Id)
	secretVar.Set("key", "DB_PASSWORD")
	secretVar.Set("value", "")
	secretVar.Set("is_secret", true)
	secretVar.Set("secret", secretRecord.Id)
	if err := app.Save(secretVar); err != nil {
		t.Fatalf("save secret env_set_var: %v", err)
	}

	set, err := sharedenv.GetSet(app, setRecord.Id)
	if err != nil {
		t.Fatalf("get set: %v", err)
	}
	if set.Name != "demo-set" || set.Description != "demo description" {
		t.Fatalf("unexpected set normalization: %+v", set)
	}

	vars, err := sharedenv.ListVars(app, setRecord.Id)
	if err != nil {
		t.Fatalf("list vars: %v", err)
	}
	if len(vars) != 2 {
		t.Fatalf("expected 2 vars, got %d", len(vars))
	}
	if vars[0].SetID != setRecord.Id || vars[0].Key != "APP_ENV" || vars[0].Value != "staging" || vars[0].IsSecret {
		t.Fatalf("unexpected first var: %+v", vars[0])
	}
	if vars[1].Key != "DB_PASSWORD" || !vars[1].IsSecret || vars[1].SecretID != secretRecord.Id {
		t.Fatalf("unexpected second var: %+v", vars[1])
	}

	resolvedVar, err := sharedenv.FindVar(app, sharedenv.VarLookup{SetID: setRecord.Id, SourceKey: "APP_ENV"})
	if err != nil {
		t.Fatalf("find var by source key: %v", err)
	}
	if resolvedVar.ID != plainVar.Id {
		t.Fatalf("expected plain var id %q, got %q", plainVar.Id, resolvedVar.ID)
	}
}

func TestFindVarSupportsQuotedKeyAndRejectsInconsistentLookup(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	setCol, err := app.FindCollectionByNameOrId(sharedenv.SetCollection)
	if err != nil {
		t.Fatalf("find env_sets collection: %v", err)
	}
	setRecord := core.NewRecord(setCol)
	setRecord.Set("name", "quoted-key-set")
	if err := app.Save(setRecord); err != nil {
		t.Fatalf("save env_set: %v", err)
	}

	varCol, err := app.FindCollectionByNameOrId(sharedenv.VarCollection)
	if err != nil {
		t.Fatalf("find env_set_vars collection: %v", err)
	}
	quotedVar := core.NewRecord(varCol)
	quotedVar.Set("set", setRecord.Id)
	quotedVar.Set("key", "DB'HOST")
	quotedVar.Set("value", "localhost")
	quotedVar.Set("is_secret", false)
	if err := app.Save(quotedVar); err != nil {
		t.Fatalf("save quoted env_set_var: %v", err)
	}

	resolvedVar, err := sharedenv.FindVar(app, sharedenv.VarLookup{SetID: setRecord.Id, SourceKey: "DB'HOST"})
	if err != nil {
		t.Fatalf("find quoted var by source key: %v", err)
	}
	if resolvedVar.ID != quotedVar.Id {
		t.Fatalf("expected quoted var id %q, got %q", quotedVar.Id, resolvedVar.ID)
	}

	resolvedVar, err = sharedenv.FindVar(app, sharedenv.VarLookup{SetID: setRecord.Id, VarID: quotedVar.Id, SourceKey: "DB'HOST"})
	if err != nil {
		t.Fatalf("find var with consistent criteria: %v", err)
	}
	if resolvedVar.ID != quotedVar.Id {
		t.Fatalf("expected consistent lookup id %q, got %q", quotedVar.Id, resolvedVar.ID)
	}

	if _, err := sharedenv.FindVar(app, sharedenv.VarLookup{SetID: setRecord.Id, VarID: quotedVar.Id, SourceKey: "OTHER"}); err == nil {
		t.Fatal("expected inconsistent lookup criteria to fail")
	}
}

func TestAttachedSetIDs(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	appCol, err := app.FindCollectionByNameOrId("apps")
	if err != nil {
		t.Fatalf("find apps collection: %v", err)
	}
	record := core.NewRecord(appCol)
	record.Set(sharedenv.AttachedSetsField, []string{"set-a", " set-b ", "set-a", ""})

	ids := sharedenv.AttachedSetIDs(record)
	if len(ids) != 2 {
		t.Fatalf("expected 2 attached ids, got %d", len(ids))
	}
	if ids[0] != "set-a" || ids[1] != "set-b" {
		t.Fatalf("unexpected attachment order: %#v", ids)
	}
	if got := sharedenv.AttachedSetIDs(nil); got != nil {
		t.Fatalf("expected nil for nil record, got %#v", got)
	}
}

func TestLoadAttachedVars(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	setCol, err := app.FindCollectionByNameOrId(sharedenv.SetCollection)
	if err != nil {
		t.Fatalf("find env_sets collection: %v", err)
	}
	varCol, err := app.FindCollectionByNameOrId(sharedenv.VarCollection)
	if err != nil {
		t.Fatalf("find env_set_vars collection: %v", err)
	}
	appCol, err := app.FindCollectionByNameOrId("apps")
	if err != nil {
		t.Fatalf("find apps collection: %v", err)
	}

	newSet := func(name string) *core.Record {
		rec := core.NewRecord(setCol)
		rec.Set("name", name)
		if err := app.Save(rec); err != nil {
			t.Fatalf("save env_set %q: %v", name, err)
		}
		return rec
	}
	newVar := func(setID, key, value string) {
		rec := core.NewRecord(varCol)
		rec.Set("set", setID)
		rec.Set("key", key)
		rec.Set("value", value)
		rec.Set("is_secret", false)
		if err := app.Save(rec); err != nil {
			t.Fatalf("save env_set_var %q: %v", key, err)
		}
	}

	baseSet := newSet("base")
	overrideSet := newSet("override")
	newVar(baseSet.Id, "APP_ENV", "staging")
	newVar(baseSet.Id, "REGION", "ap-south")
	newVar(overrideSet.Id, "APP_ENV", "prod")

	consumer := core.NewRecord(appCol)
	consumer.Set(sharedenv.AttachedSetsField, []string{baseSet.Id, overrideSet.Id})

	items, err := sharedenv.LoadAttachedVars(app, consumer)
	if err != nil {
		t.Fatalf("load attached vars: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("expected 3 attached vars, got %d", len(items))
	}
	if items[0].SetID != baseSet.Id || items[0].SetName != "base" || items[0].Var.Key != "APP_ENV" || items[0].Var.Value != "staging" {
		t.Fatalf("unexpected first attached var: %+v", items[0])
	}
	if items[1].SetID != baseSet.Id || items[1].Var.Key != "REGION" {
		t.Fatalf("unexpected second attached var: %+v", items[1])
	}
	if items[2].SetID != overrideSet.Id || items[2].SetName != "override" || items[2].Var.Key != "APP_ENV" || items[2].Var.Value != "prod" {
		t.Fatalf("unexpected override attached var: %+v", items[2])
	}

	emptyConsumer := core.NewRecord(appCol)
	loaded, err := sharedenv.LoadAttachedVars(app, emptyConsumer)
	if err != nil {
		t.Fatalf("load attached vars for empty consumer: %v", err)
	}
	if loaded != nil {
		t.Fatalf("expected nil attached vars for empty consumer, got %#v", loaded)
	}
}
