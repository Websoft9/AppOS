package routes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func (te *testEnv) doCatalog(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	g := r.Group("/api")
	g.Bind(apis.RequireAuth())
	registerCatalogRoutes(g)

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if authenticated {
		req.Header.Set("Authorization", te.token)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestCatalogReadRoutesRequireAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tests := []struct {
		method string
		url    string
		body   string
	}{
		{method: http.MethodGet, url: "/api/catalog/categories"},
		{method: http.MethodGet, url: "/api/catalog/apps"},
		{method: http.MethodGet, url: "/api/catalog/apps/wordpress"},
		{method: http.MethodGet, url: "/api/catalog/apps/wordpress/deploy-source"},
		{method: http.MethodGet, url: "/api/catalog/me/apps"},
		{method: http.MethodPut, url: "/api/catalog/me/apps/wordpress/favorite", body: `{"isFavorite":true}`},
		{method: http.MethodPut, url: "/api/catalog/me/apps/wordpress/note", body: `{"note":"hi"}`},
		{method: http.MethodDelete, url: "/api/catalog/me/apps/wordpress/note"},
	}

	for _, tc := range tests {
		rec := te.doCatalog(t, tc.method, tc.url, tc.body, false)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s: expected 401, got %d: %s", tc.method, tc.url, rec.Code, rec.Body.String())
		}
	}
}

func TestCatalogReadRoutesReturnPayloadsWhenAuthenticated(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tests := []struct {
		url    string
		status int
	}{
		{url: "/api/catalog/categories", status: http.StatusOK},
		{url: "/api/catalog/apps", status: http.StatusOK},
		{url: "/api/catalog/apps/wordpress", status: http.StatusOK},
		{url: "/api/catalog/apps/wordpress/deploy-source", status: http.StatusOK},
		{url: "/api/catalog/me/apps", status: http.StatusOK},
	}

	for _, tc := range tests {
		rec := te.doCatalog(t, http.MethodGet, tc.url, "", true)
		if rec.Code != tc.status {
			t.Fatalf("%s: expected %d, got %d: %s", tc.url, tc.status, rec.Code, rec.Body.String())
		}
	}
}

func TestCatalogCategoriesAndAppsReturnProjectionPayloads(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	categories := te.doCatalog(t, http.MethodGet, "/api/catalog/categories?locale=en", "", true)
	if categories.Code != http.StatusOK {
		t.Fatalf("categories: expected 200, got %d: %s", categories.Code, categories.Body.String())
	}
	categoryPayload := parseJSON(t, categories)
	categoryItems, ok := categoryPayload["items"].([]any)
	if !ok || len(categoryItems) == 0 {
		t.Fatalf("categories: expected non-empty items, got %T %v", categoryPayload["items"], categoryPayload["items"])
	}
	meta, ok := categoryPayload["meta"].(map[string]any)
	if !ok || meta["locale"] != "en" {
		t.Fatalf("categories: expected locale=en, got %v", categoryPayload["meta"])
	}

	apps := te.doCatalog(t, http.MethodGet, "/api/catalog/apps?locale=en&limit=5", "", true)
	if apps.Code != http.StatusOK {
		t.Fatalf("apps: expected 200, got %d: %s", apps.Code, apps.Body.String())
	}
	appPayload := parseJSON(t, apps)
	appItems, ok := appPayload["items"].([]any)
	if !ok || len(appItems) == 0 {
		t.Fatalf("apps: expected non-empty items, got %T %v", appPayload["items"], appPayload["items"])
	}
	first, ok := appItems[0].(map[string]any)
	if !ok {
		t.Fatalf("apps: expected first item map, got %T", appItems[0])
	}
	if _, ok := first["personalization"].(map[string]any); !ok {
		t.Fatalf("apps: expected personalization object, got %v", first["personalization"])
	}
	page, ok := appPayload["page"].(map[string]any)
	if !ok || int(page["limit"].(float64)) != 5 {
		t.Fatalf("apps: expected page.limit=5, got %v", appPayload["page"])
	}
}

func TestCatalogAppsListMergesCustomAppsAndPersonalization(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	authID := te.currentAuthID(t)
	seedCustomApp(t, te, authID, "custom-demo", []string{"security-detection"})
	seedUserAppState(t, te, authID, "custom-demo", true, "demo note")
	assertSeededUserState(t, te, authID, "custom-demo")

	rec := te.doCatalog(t, http.MethodGet, "/api/catalog/apps?source=custom", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	payload := parseJSON(t, rec)
	items, ok := payload["items"].([]any)
	if !ok || len(items) == 0 {
		t.Fatalf("expected one item, got %T %v", payload["items"], payload["items"])
	}
	item, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("expected item map, got %T", items[0])
	}
	if item["key"] != "custom-demo" {
		t.Fatalf("expected custom-demo key, got %v", item["key"])
	}
	personalization := item["personalization"].(map[string]any)
	if personalization["isFavorite"] != true || personalization["hasNote"] != true {
		t.Fatalf("expected merged personalization, got %v", personalization)
	}
	if item["source"] != "custom" {
		t.Fatalf("expected custom source, got %v", item["source"])
	}

	favoriteOnly := te.doCatalog(t, http.MethodGet, "/api/catalog/apps?source=custom&favorite=true", "", true)
	if favoriteOnly.Code != http.StatusOK {
		t.Fatalf("expected favorite filter 200, got %d: %s", favoriteOnly.Code, favoriteOnly.Body.String())
	}
	favoritePayload := parseJSON(t, favoriteOnly)
	favoriteItems, ok := favoritePayload["items"].([]any)
	if !ok || len(favoriteItems) != 1 {
		t.Fatalf("expected one favorite-filtered item, got %T %v", favoritePayload["items"], favoritePayload["items"])
	}
}

func TestCatalogAppDetailReturnsOfficialPayload(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doCatalog(t, http.MethodGet, "/api/catalog/apps/wordpress?locale=en", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	payload := parseJSON(t, rec)
	if payload["key"] != "wordpress" {
		t.Fatalf("expected wordpress key, got %v", payload["key"])
	}
	links, ok := payload["links"].(map[string]any)
	if !ok || links["docs"] == "" {
		t.Fatalf("expected docs link, got %v", payload["links"])
	}
	template, ok := payload["template"].(map[string]any)
	if !ok || template["source"] != "library" {
		t.Fatalf("expected library template, got %v", payload["template"])
	}
}

func TestCatalogAppDetailReturnsCustomPayload(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	authID := te.currentAuthID(t)
	col, err := te.app.FindCollectionByNameOrId("store_custom_apps")
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(col)
	record.Set("key", "my-custom-app")
	record.Set("trademark", "My Custom App")
	record.Set("overview", "Private custom app")
	record.Set("description", "Private app detail")
	record.Set("category_keys", []string{"cms"})
	record.Set("compose_yaml", "services:\n  app:\n    image: nginx:latest\n")
	record.Set("visibility", "private")
	record.Set("created_by", authID)
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}

	rec := te.doCatalog(t, http.MethodGet, "/api/catalog/apps/my-custom-app?locale=en", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	payload := parseJSON(t, rec)
	source, ok := payload["source"].(map[string]any)
	if !ok || source["kind"] != "custom" {
		t.Fatalf("expected custom source, got %v", payload["source"])
	}
	deploy, ok := payload["deploy"].(map[string]any)
	if !ok || deploy["sourceKind"] != "template" {
		t.Fatalf("expected template deploy source, got %v", payload["deploy"])
	}
}

func TestCatalogDeploySourceReturnsOfficialPrefill(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doCatalog(t, http.MethodGet, "/api/catalog/apps/wordpress/deploy-source?locale=en", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	payload := parseJSON(t, rec)
	install, ok := payload["install"].(map[string]any)
	if !ok || install["prefillSource"] != "library" {
		t.Fatalf("expected library prefill source, got %v", payload["install"])
	}
}

func TestCatalogDeploySourceReturnsCustomPrefill(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	authID := te.currentAuthID(t)
	seedCustomApp(t, te, authID, "shared-custom-app", []string{"cms"})

	rec := te.doCatalog(t, http.MethodGet, "/api/catalog/apps/shared-custom-app/deploy-source?locale=en", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	payload := parseJSON(t, rec)
	install, ok := payload["install"].(map[string]any)
	if !ok || install["prefillSource"] != "template" {
		t.Fatalf("expected template prefill source, got %v", payload["install"])
	}
	capabilities, ok := payload["capabilities"].(map[string]any)
	if !ok || capabilities["hasComposeTemplate"] != true {
		t.Fatalf("expected compose template capability, got %v", payload["capabilities"])
	}
}

func TestCatalogPersonalizationListReturnsCallerState(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	authID := te.currentAuthID(t)
	seedUserAppState(t, te, authID, "wordpress", true, "important note")

	rec := te.doCatalog(t, http.MethodGet, "/api/catalog/me/apps", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	payload := parseJSON(t, rec)
	items, ok := payload["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("expected one personalization item, got %T %v", payload["items"], payload["items"])
	}
	item := items[0].(map[string]any)
	if item["appKey"] != "wordpress" || item["isFavorite"] != true || item["note"] != "important note" {
		t.Fatalf("unexpected personalization item: %v", item)
	}
}

func TestCatalogFavoritePutIsIdempotent(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	first := te.doCatalog(t, http.MethodPut, "/api/catalog/me/apps/wordpress/favorite", `{"isFavorite":true}`, true)
	if first.Code != http.StatusOK {
		t.Fatalf("expected first favorite put 200, got %d: %s", first.Code, first.Body.String())
	}
	second := te.doCatalog(t, http.MethodPut, "/api/catalog/me/apps/wordpress/favorite", `{"isFavorite":true}`, true)
	if second.Code != http.StatusOK {
		t.Fatalf("expected second favorite put 200, got %d: %s", second.Code, second.Body.String())
	}

	records, err := te.app.FindAllRecords("store_user_apps")
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 {
		t.Fatalf("expected one personalization record, got %d", len(records))
	}
	if !records[0].GetBool("is_favorite") {
		t.Fatalf("expected stored favorite=true")
	}

	clear := te.doCatalog(t, http.MethodPut, "/api/catalog/me/apps/wordpress/favorite", `{"isFavorite":false}`, true)
	if clear.Code != http.StatusOK {
		t.Fatalf("expected clear favorite 200, got %d: %s", clear.Code, clear.Body.String())
	}
	records, err = te.app.FindAllRecords("store_user_apps")
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 0 {
		t.Fatalf("expected empty personalization records after clearing favorite, got %d", len(records))
	}
}

func TestCatalogNotePutAndDeleteAreIdempotent(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	put := te.doCatalog(t, http.MethodPut, "/api/catalog/me/apps/wordpress/note", `{"note":"hello"}`, true)
	if put.Code != http.StatusOK {
		t.Fatalf("expected note put 200, got %d: %s", put.Code, put.Body.String())
	}
	updated := te.doCatalog(t, http.MethodPut, "/api/catalog/me/apps/wordpress/note", `{"note":"changed"}`, true)
	if updated.Code != http.StatusOK {
		t.Fatalf("expected note update 200, got %d: %s", updated.Code, updated.Body.String())
	}
	payload := parseJSON(t, updated)
	if payload["note"] != "changed" {
		t.Fatalf("expected updated note, got %v", payload["note"])
	}

	clear := te.doCatalog(t, http.MethodDelete, "/api/catalog/me/apps/wordpress/note", "", true)
	if clear.Code != http.StatusOK {
		t.Fatalf("expected note delete 200, got %d: %s", clear.Code, clear.Body.String())
	}
	records, err := te.app.FindAllRecords("store_user_apps")
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 0 {
		t.Fatalf("expected no personalization records after note delete, got %d", len(records))
	}

	clearAgain := te.doCatalog(t, http.MethodDelete, "/api/catalog/me/apps/wordpress/note", "", true)
	if clearAgain.Code != http.StatusOK {
		t.Fatalf("expected repeated note delete 200, got %d: %s", clearAgain.Code, clearAgain.Body.String())
	}
}

func (te *testEnv) currentAuthID(t *testing.T) string {
	t.Helper()
	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}
	g := r.Group("/api")
	g.Bind(apis.RequireAuth())
	g.GET("/whoami", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, map[string]any{"id": e.Auth.Id})
	})
	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/whoami", nil)
	req.Header.Set("Authorization", te.token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("whoami failed: %d %s", rec.Code, rec.Body.String())
	}
	payload := parseJSON(t, rec)
	return payload["id"].(string)
}

func assertSeededUserState(t *testing.T, te *testEnv, expectedUserID, appKey string) {
	t.Helper()
	records, err := te.app.FindAllRecords("store_user_apps")
	if err != nil {
		t.Fatal(err)
	}
	for _, record := range records {
		if record.GetString("app_key") == appKey {
			t.Logf("seeded user state: user=%s favorite=%v note=%q", record.GetString("user"), record.GetBool("is_favorite"), record.GetString("note"))
			if record.GetString("user") != expectedUserID {
				t.Fatalf("expected seeded user id %s, got %s", expectedUserID, record.GetString("user"))
			}
			return
		}
	}
	t.Fatalf("seeded user state for %s not found", appKey)
}

func seedCustomApp(t *testing.T, te *testEnv, createdBy, key string, categoryKeys []string) {
	t.Helper()
	col, err := te.app.FindCollectionByNameOrId("store_custom_apps")
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(col)
	record.Set("key", key)
	record.Set("trademark", "Custom Demo")
	record.Set("overview", "Custom overview")
	record.Set("description", "Custom description")
	record.Set("category_keys", categoryKeys)
	record.Set("compose_yaml", "services:\n  app:\n    image: nginx:alpine\n")
	record.Set("visibility", "shared")
	record.Set("created_by", createdBy)
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}
}

func seedUserAppState(t *testing.T, te *testEnv, userID, appKey string, favorite bool, note string) {
	t.Helper()
	col, err := te.app.FindCollectionByNameOrId("store_user_apps")
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(col)
	record.Set("user", userID)
	record.Set("app_key", appKey)
	record.Set("is_favorite", favorite)
	record.Set("note", note)
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}
}