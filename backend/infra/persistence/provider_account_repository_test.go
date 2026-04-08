package persistence

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	domainaccounts "github.com/websoft9/appos/backend/domain/resource/accounts"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func createProviderAccountReferenceInstance(t *testing.T, app *tests.TestApp, accountID string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("instances")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", "ref-instance")
	rec.Set("kind", "redis")
	rec.Set("template_id", "generic-redis")
	rec.Set("provider_account", accountID)
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func TestProviderAccountRepositorySaveGetDelete(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	repo := NewProviderAccountRepository(app)
	item, err := repo.New()
	if err != nil {
		t.Fatal(err)
	}
	item.ApplySaveInput(domainaccounts.SaveInput{
		Name:       "Primary AWS",
		Kind:       domainaccounts.KindAWS,
		TemplateID: "generic-aws-account",
		Identifier: "123456789012",
		Config: map[string]any{
			"region": "us-east-1",
		},
	})
	if err := repo.Save(item); err != nil {
		t.Fatal(err)
	}
	if item.ID() == "" {
		t.Fatal("expected saved provider account id")
	}

	loaded, err := repo.Get(item.ID())
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Name() != "Primary AWS" {
		t.Fatalf("expected saved name, got %q", loaded.Name())
	}
	if loaded.Kind() != domainaccounts.KindAWS {
		t.Fatalf("expected kind %q, got %q", domainaccounts.KindAWS, loaded.Kind())
	}
	if loaded.Identifier() != "123456789012" {
		t.Fatalf("expected identifier to round-trip, got %q", loaded.Identifier())
	}

	if err := repo.Delete(item); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Get(item.ID()); err == nil {
		t.Fatal("expected deleted provider account lookup to fail")
	}
}

func TestProviderAccountRepositorySaveMapsDuplicateNameToConflict(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	repo := NewProviderAccountRepository(app)
	first, err := repo.New()
	if err != nil {
		t.Fatal(err)
	}
	first.ApplySaveInput(domainaccounts.SaveInput{
		Name:       "Primary Provider",
		Kind:       domainaccounts.KindAWS,
		TemplateID: "generic-aws-account",
		Identifier: "acct-1",
	})
	if err := repo.Save(first); err != nil {
		t.Fatal(err)
	}

	second, err := repo.New()
	if err != nil {
		t.Fatal(err)
	}
	second.ApplySaveInput(domainaccounts.SaveInput{
		Name:       "Primary Provider",
		Kind:       domainaccounts.KindGitHub,
		TemplateID: "github-app-installation",
		Identifier: "acct-2",
	})
	err = repo.Save(second)
	if err == nil {
		t.Fatal("expected duplicate name save to fail")
	}
	var conflictErr *domainaccounts.ConflictError
	if !errors.As(err, &conflictErr) {
		t.Fatalf("expected conflict error, got %v", err)
	}
}

func TestProviderAccountRepositoryHasReferences(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	repo := NewProviderAccountRepository(app)
	item, err := repo.New()
	if err != nil {
		t.Fatal(err)
	}
	item.ApplySaveInput(domainaccounts.SaveInput{
		Name:       "Primary AWS",
		Kind:       domainaccounts.KindAWS,
		TemplateID: "generic-aws-account",
		Identifier: "acct-1",
	})
	if err := repo.Save(item); err != nil {
		t.Fatal(err)
	}

	hasReferences, err := repo.HasReferences(item.ID())
	if err != nil {
		t.Fatal(err)
	}
	if hasReferences {
		t.Fatal("expected fresh provider account to have no references")
	}

	createProviderAccountReferenceInstance(t, app, item.ID())

	hasReferences, err = repo.HasReferences(item.ID())
	if err != nil {
		t.Fatal(err)
	}
	if !hasReferences {
		t.Fatal("expected provider account references to be detected")
	}
}
