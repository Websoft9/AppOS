package assets

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func newAssetsApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	ensureAssetsCollection(t, app)
	return app
}

func ensureAssetsCollection(t *testing.T, app *tests.TestApp) {
	t.Helper()

	if _, err := app.FindCollectionByNameOrId(Collection); err == nil {
		return
	}

	col := core.NewBaseCollection(Collection)
	col.Fields.Add(&core.TextField{Name: "name", Required: true})
	col.Fields.Add(&core.TextField{Name: "description"})
	col.Fields.Add(&core.TextField{Name: "kind", Required: true})
	col.Fields.Add(&core.TextField{Name: "storage_kind", Required: true})
	col.Fields.Add(&core.TextField{Name: "source_kind", Required: true})
	col.Fields.Add(&core.TextField{Name: "language"})
	col.Fields.Add(&core.TextField{Name: "reference"})
	col.Fields.Add(&core.TextField{Name: "path"})
	col.Fields.Add(&core.TextField{Name: "entrypoint"})

	if err := app.Save(col); err != nil {
		t.Fatalf("create assets collection: %v", err)
	}
}

func newAssetRecord(t *testing.T) (*tests.TestApp, *core.Record) {
	t.Helper()
	app := newAssetsApp(t)
	col, err := app.FindCollectionByNameOrId(Collection)
	if err != nil {
		t.Fatal(err)
	}
	return app, core.NewRecord(col)
}

func TestSlugName(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "simple", in: "Backup Script", want: "backup-script"},
		{name: "symbols", in: " skill@v1 / demo ", want: "skill-v1-demo"},
		{name: "empty", in: "   ", want: "asset"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := SlugName(tt.in); got != tt.want {
				t.Fatalf("expected %q, got %q", tt.want, got)
			}
		})
	}
}

func TestStorageDirName(t *testing.T) {
	got := StorageDirName("Backup Script", "abc123")
	if got != "backup-script-abc123" {
		t.Fatalf("expected backup-script-abc123, got %q", got)
	}
}

func TestStoragePath(t *testing.T) {
	got := StoragePath("Backup Script", "abc123")
	want := "/appos/data/assets/backup-script-abc123"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestScriptFileName(t *testing.T) {
	tests := []struct {
		name     string
		language string
		want     string
	}{
		{name: "shell", language: LanguageShell, want: "backup-script-abc123.sh"},
		{name: "python", language: LanguagePython, want: "backup-script-abc123.py"},
		{name: "other", language: LanguageOther, want: "backup-script-abc123.txt"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ScriptFileName("Backup Script", "abc123", tt.language); got != tt.want {
				t.Fatalf("expected %q, got %q", tt.want, got)
			}
		})
	}
}

func TestAssetAccessorsAndHelpers(t *testing.T) {
	app, rec := newAssetRecord(t)
	defer app.Cleanup()

	rec.Set("name", "Backup Script")
	rec.Set("description", "Script for backups")
	rec.Set("kind", KindScript)
	rec.Set("storage_kind", StorageFile)
	rec.Set("source_kind", SourceLocal)
	rec.Set("language", LanguageShell)
	rec.Set("reference", "https://example.com/script.sh")
	rec.Set("path", "backup-script.sh")
	rec.Set("entrypoint", "main.sh")

	asset := From(rec)
	if asset.Name() != "Backup Script" {
		t.Fatalf("unexpected name %q", asset.Name())
	}
	if asset.Description() != "Script for backups" {
		t.Fatalf("unexpected description %q", asset.Description())
	}
	if !asset.IsLocal() {
		t.Fatal("expected local asset")
	}
	if asset.Language() != LanguageShell {
		t.Fatalf("unexpected language %q", asset.Language())
	}
	if asset.Reference() != "https://example.com/script.sh" {
		t.Fatalf("unexpected reference %q", asset.Reference())
	}
	if !asset.IsSingleFile() {
		t.Fatal("expected single-file asset")
	}
	if asset.IsFolder() {
		t.Fatal("did not expect folder asset")
	}
	if got := asset.StorageDirName(); got != "backup-script" {
		t.Fatalf("expected backup-script for unsaved record, got %q", got)
	}
	if got := asset.StoragePath(); got != "/appos/data/assets/backup-script" {
		t.Fatalf("unexpected storage path %q", got)
	}
	if asset.Entrypoint() != "main.sh" {
		t.Fatalf("unexpected entrypoint %q", asset.Entrypoint())
	}
}
