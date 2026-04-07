package persistence

import (
	"testing"

	"github.com/pocketbase/pocketbase/tests"
	domaininstances "github.com/websoft9/appos/backend/domain/resource/instances"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func TestInstanceRepositorySaveGetDelete(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	repo := NewInstanceRepository(app)
	item, err := repo.New()
	if err != nil {
		t.Fatal(err)
	}
	item.ApplySaveInput(domaininstances.SaveInput{
		Name:       "Primary Redis",
		Kind:       domaininstances.KindRedis,
		TemplateID: "generic-redis",
		Endpoint:   "redis://cache.internal:6379",
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

	if err := repo.Delete(item); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Get(item.ID()); err == nil {
		t.Fatal("expected deleted instance lookup to fail")
	}
}
