package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func TestBrandingPublicRouteResolvesMediaPublicURL(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	mediaCol, err := te.app.FindCollectionByNameOrId("media")
	if err != nil {
		t.Fatal(err)
	}
	mediaRecord := core.NewRecord(mediaCol)
	mediaRecord.Set("category", "branding")
	mediaRecord.Set("scope", "public")
	mediaRecord.Set("owner_type", "system")
	mediaRecord.Set("owner_id", "")
	mediaRecord.Set("original_name", "logo.svg")
	mediaRecord.Set("content_type", "image/svg+xml")
	mediaRecord.Set("size", 12)
	mediaRecord.Set("storage_path", "public/branding/test.svg")
	mediaRecord.Set("public_url", "/api/media/test-media/public")
	if err := te.app.Save(mediaRecord); err != nil {
		t.Fatal(err)
	}

	if err := sysconfig.SetGroup(te.app, "branding", "identity", map[string]any{
		"logoMediaId":      mediaRecord.Id,
		"logoUrl":          "",
		"wordmark":         "appos",
		"useLogoAsFavicon": false,
		"faviconMediaId":   "",
		"faviconUrl":       "",
	}); err != nil {
		t.Fatal(err)
	}

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}
	registerBrandingRoutes(&core.ServeEvent{Router: r})
	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/settings/public/branding", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["logoMediaId"] != mediaRecord.Id {
		t.Fatalf("expected logoMediaId %q, got %v", mediaRecord.Id, body["logoMediaId"])
	}
	if body["logoUrl"] != "/api/media/test-media/public" {
		t.Fatalf("expected resolved logoUrl, got %v", body["logoUrl"])
	}
}
