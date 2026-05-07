package persistence

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	domainconnectors "github.com/websoft9/appos/backend/domain/resource/connectors"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func createPersistenceProviderAccountRecord(t *testing.T, app *tests.TestApp, name string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("provider_accounts")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", name)
	rec.Set("kind", "aws")
	rec.Set("template_id", "generic-aws-account")
	rec.Set("identifier", name+"-id")
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func TestConnectorRepositorySaveGetDelete(t *testing.T) {
	app := newPersistenceTestApp(t)
	providerAccount := createPersistenceProviderAccountRecord(t, app, "ops-root")

	repo := NewConnectorRepository(app)
	item, err := repo.New()
	if err != nil {
		t.Fatal(err)
	}
	item.ApplySaveInput(domainconnectors.SaveInput{
		Name:              "Primary SMTP",
		Kind:              domainconnectors.KindSMTP,
		TemplateID:        "generic-smtp",
		Endpoint:          "smtp://smtp.example.com:587",
		ProviderAccountID: providerAccount.Id,
	})
	if err := repo.Save(item); err != nil {
		t.Fatal(err)
	}
	if item.ID() == "" {
		t.Fatal("expected saved connector id")
	}

	loaded, err := repo.Get(item.ID())
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Name() != "Primary SMTP" {
		t.Fatalf("expected saved name, got %q", loaded.Name())
	}
	if loaded.ProviderAccountID() != providerAccount.Id {
		t.Fatalf("expected provider_account %q, got %q", providerAccount.Id, loaded.ProviderAccountID())
	}

	if err := repo.Delete(item); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Get(item.ID()); err == nil {
		t.Fatal("expected deleted connector lookup to fail")
	}
}

func TestConnectorRepositoryClearDefaultsByKind(t *testing.T) {
	app := newPersistenceTestApp(t)

	repo := NewConnectorRepository(app)
	first, _ := repo.New()
	first.ApplySaveInput(domainconnectors.SaveInput{Name: "One", Kind: domainconnectors.KindLLM, IsDefault: true, TemplateID: "openai"})
	if err := repo.Save(first); err != nil {
		t.Fatal(err)
	}
	second, _ := repo.New()
	second.ApplySaveInput(domainconnectors.SaveInput{Name: "Two", Kind: domainconnectors.KindLLM, IsDefault: true, TemplateID: "anthropic"})
	if err := repo.Save(second); err != nil {
		t.Fatal(err)
	}

	if err := repo.ClearDefaultsByKind(domainconnectors.KindLLM, second.ID()); err != nil {
		t.Fatal(err)
	}

	loadedFirst, err := repo.Get(first.ID())
	if err != nil {
		t.Fatal(err)
	}
	loadedSecond, err := repo.Get(second.ID())
	if err != nil {
		t.Fatal(err)
	}
	if loadedFirst.IsDefault() {
		t.Fatal("expected excluded default clear to unset first connector")
	}
	if !loadedSecond.IsDefault() {
		t.Fatal("expected excluded connector to remain default")
	}
}

func TestConnectorRepositorySaveMapsDuplicateNameToConflict(t *testing.T) {
	app := newPersistenceTestApp(t)
	var err error

	repo := NewConnectorRepository(app)
	first, _ := repo.New()
	first.ApplySaveInput(domainconnectors.SaveInput{Name: "Primary SMTP", Kind: domainconnectors.KindSMTP, TemplateID: "generic-smtp"})
	if err := repo.Save(first); err != nil {
		t.Fatal(err)
	}

	second, _ := repo.New()
	second.ApplySaveInput(domainconnectors.SaveInput{Name: "Primary SMTP", Kind: domainconnectors.KindLLM, TemplateID: "openai"})
	err = repo.Save(second)
	if err == nil {
		t.Fatal("expected duplicate name save to fail")
	}
	var conflictErr *domainconnectors.ConflictError
	if !errors.As(err, &conflictErr) {
		t.Fatalf("expected conflict error, got %v", err)
	}
}

func TestConnectorRepositoryExistsByName(t *testing.T) {
	app := newPersistenceTestApp(t)

	repo := NewConnectorRepository(app)
	item, _ := repo.New()
	item.ApplySaveInput(domainconnectors.SaveInput{Name: "SMTP Test", Kind: domainconnectors.KindSMTP, TemplateID: "generic-smtp"})
	if err := repo.Save(item); err != nil {
		t.Fatal(err)
	}

	exists, err := repo.ExistsByName("SMTP Test", "")
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("expected ExistsByName to return true for existing name")
	}

	exists, err = repo.ExistsByName("SMTP Test", item.ID())
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatal("expected ExistsByName to exclude own ID")
	}

	exists, err = repo.ExistsByName("nonexistent", "")
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatal("expected ExistsByName to return false for nonexistent name")
	}
}
