package persistence

import (
	"testing"

	"github.com/pocketbase/pocketbase/tests"
	domainconnectors "github.com/websoft9/appos/backend/domain/resource/connectors"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func TestConnectorRepositorySaveGetDelete(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	repo := NewConnectorRepository(app)
	item, err := repo.New()
	if err != nil {
		t.Fatal(err)
	}
	item.ApplySaveInput(domainconnectors.SaveInput{
		Name:       "Primary SMTP",
		Kind:       domainconnectors.KindSMTP,
		TemplateID: "generic-smtp",
		Endpoint:   "smtp://smtp.example.com:587",
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

	if err := repo.Delete(item); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Get(item.ID()); err == nil {
		t.Fatal("expected deleted connector lookup to fail")
	}
}

func TestConnectorRepositoryClearDefaultsByKind(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

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
