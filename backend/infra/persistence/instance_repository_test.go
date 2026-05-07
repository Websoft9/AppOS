package persistence

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	domaininstances "github.com/websoft9/appos/backend/domain/resource/instances"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func createProviderAccountRecord(t *testing.T, app *tests.TestApp, name string) *core.Record {
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

func TestInstanceRepositorySaveGetDelete(t *testing.T) {
	app := newPersistenceTestApp(t)
	providerAccount := createProviderAccountRecord(t, app, "platform-root")

	repo := NewInstanceRepository(app)
	item, err := repo.New()
	if err != nil {
		t.Fatal(err)
	}
	item.ApplySaveInput(domaininstances.SaveInput{
		Name:              "Primary Redis",
		Kind:              domaininstances.KindRedis,
		TemplateID:        "generic-redis",
		Endpoint:          "redis://cache.internal:6379",
		ProviderAccountID: providerAccount.Id,
		Config: map[string]any{
			"database": float64(1),
		},
	})
	if err := repo.Save(item); err != nil {
		t.Fatal(err)
	}
	if item.ID() == "" {
		t.Fatal("expected saved instance id")
	}

	loaded, err := repo.Get(item.ID())
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Name() != "Primary Redis" {
		t.Fatalf("expected saved name, got %q", loaded.Name())
	}
	if loaded.Kind() != domaininstances.KindRedis {
		t.Fatalf("expected kind %q, got %q", domaininstances.KindRedis, loaded.Kind())
	}
	if loaded.ProviderAccountID() != providerAccount.Id {
		t.Fatalf("expected provider_account %q, got %q", providerAccount.Id, loaded.ProviderAccountID())
	}

	if err := repo.Delete(item); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Get(item.ID()); err == nil {
		t.Fatal("expected deleted instance lookup to fail")
	}
}

func TestInstanceRepositorySaveMapsDuplicateNameToConflict(t *testing.T) {
	app := newPersistenceTestApp(t)
	var err error

	repo := NewInstanceRepository(app)
	first, err := repo.New()
	if err != nil {
		t.Fatal(err)
	}
	first.ApplySaveInput(domaininstances.SaveInput{
		Name:       "Primary Redis",
		Kind:       domaininstances.KindRedis,
		TemplateID: "generic-redis",
	})
	if err := repo.Save(first); err != nil {
		t.Fatal(err)
	}

	second, err := repo.New()
	if err != nil {
		t.Fatal(err)
	}
	second.ApplySaveInput(domaininstances.SaveInput{
		Name:       "Primary Redis",
		Kind:       domaininstances.KindKafka,
		TemplateID: "generic-kafka",
	})
	err = repo.Save(second)
	if err == nil {
		t.Fatal("expected duplicate name save to fail")
	}
	var conflictErr *domaininstances.ConflictError
	if !errors.As(err, &conflictErr) {
		t.Fatalf("expected conflict error, got %v", err)
	}
}
