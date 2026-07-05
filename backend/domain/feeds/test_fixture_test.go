package feeds

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func newFeedsTestApp(t *testing.T) *tests.TestApp {
	t.Helper()

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	ensureFeedsTestCollections(t, app)
	t.Cleanup(app.Cleanup)
	return app
}

func ensureFeedsTestCollections(t *testing.T, app *tests.TestApp) {
	t.Helper()
	ensureFeedsCustomSettingsCollection(t, app)
	ensureFeedSourcesCollection(t, app)
	ensureFeedItemsCollection(t, app)
}

func ensureFeedsCustomSettingsCollection(t *testing.T, app *tests.TestApp) {
	t.Helper()

	if _, err := app.FindCollectionByNameOrId("custom_settings"); err == nil {
		return
	}

	col := core.NewBaseCollection("custom_settings")
	col.Fields.Add(&core.TextField{Name: "module", Required: true})
	col.Fields.Add(&core.TextField{Name: "key", Required: true})
	col.Fields.Add(&core.JSONField{Name: "value"})
	col.Indexes = []string{
		"CREATE UNIQUE INDEX idx_custom_settings_module_key ON custom_settings (module, `key`)",
	}

	if err := app.Save(col); err != nil {
		t.Fatalf("create custom_settings collection: %v", err)
	}
}

func ensureFeedSourcesCollection(t *testing.T, app *tests.TestApp) {
	t.Helper()

	if _, err := app.FindCollectionByNameOrId(CollectionSources); err == nil {
		return
	}

	col := core.NewBaseCollection(CollectionSources)
	col.Fields.Add(&core.TextField{Name: "name", Required: true})
	col.Fields.Add(&core.TextField{Name: "url", Required: true})
	col.Fields.Add(&core.TextField{Name: "format", Required: true})
	col.Fields.Add(&core.TextField{Name: "status", Required: true})
	col.Fields.Add(&core.NumberField{Name: "failure_streak"})
	col.Fields.Add(&core.DateField{Name: "next_poll_at"})
	col.Fields.Add(&core.NumberField{Name: "item_count"})
	col.Fields.Add(&core.TextField{Name: "favicon_url"})
	col.Fields.Add(&core.DateField{Name: "last_fetched_at"})
	col.Fields.Add(&core.DateField{Name: "last_success_at"})
	col.Fields.Add(&core.TextField{Name: "last_error"})
	col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.Indexes = []string{
		"CREATE UNIQUE INDEX idx_feed_sources_url ON feed_sources (url)",
	}

	if err := app.Save(col); err != nil {
		t.Fatalf("create feed_sources collection: %v", err)
	}
}

func ensureFeedItemsCollection(t *testing.T, app *tests.TestApp) {
	t.Helper()

	if _, err := app.FindCollectionByNameOrId(CollectionItems); err == nil {
		return
	}

	col := core.NewBaseCollection(CollectionItems)
	col.Fields.Add(&core.TextField{Name: "source_id"})
	col.Fields.Add(&core.TextField{Name: "origin_type", Required: true})
	col.Fields.Add(&core.TextField{Name: "external_id", Required: true})
	col.Fields.Add(&core.TextField{Name: "title", Required: true})
	col.Fields.Add(&core.TextField{Name: "link", Required: true})
	col.Fields.Add(&core.DateField{Name: "published_at"})
	col.Fields.Add(&core.TextField{Name: "summary"})
	col.Fields.Add(&core.TextField{Name: "favicon_url"})
	col.Fields.Add(&core.JSONField{Name: "keywords_json"})
	col.Fields.Add(&core.JSONField{Name: "tags_json"})
	col.Fields.Add(&core.TextField{Name: "read_state", Required: true})
	col.Fields.Add(&core.BoolField{Name: "is_starred"})
	col.Fields.Add(&core.TextField{Name: "content_raw"})
	col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.Indexes = []string{
		"CREATE UNIQUE INDEX idx_feed_items_source_external_id ON feed_items (source_id, external_id)",
		"CREATE INDEX idx_feed_items_list ON feed_items (origin_type, published_at DESC, created DESC)",
	}

	if err := app.Save(col); err != nil {
		t.Fatalf("create feed_items collection: %v", err)
	}
}
