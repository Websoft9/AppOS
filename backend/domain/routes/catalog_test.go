package routes

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
		{method: http.MethodGet, url: "/api/catalog/admin/status"},
		{method: http.MethodPost, url: "/api/catalog/admin/reindex"},
		{method: http.MethodGet, url: "/api/catalog/admin/categories/raw"},
		{method: http.MethodGet, url: "/api/catalog/admin/apps/wordpress/raw"},
		{method: http.MethodGet, url: "/api/catalog/custom-apps"},
		{method: http.MethodPost, url: "/api/catalog/custom-apps", body: `{"key":"demo","trademark":"Demo","overview":"Demo","category_keys":["cms"],"compose_yaml":"","visibility":"private"}`},
		{method: http.MethodGet, url: "/api/catalog/apps"},
		{method: http.MethodGet, url: "/api/catalog/apps/wordpress"},
		{method: http.MethodGet, url: "/api/catalog/apps/wordpress/deploy-source"},
		{method: http.MethodGet, url: "/api/catalog/apps/wordpress/template"},
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

func TestCatalogAdminRoutesRequireSuperuser(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	userToken := createRegularUserToken(t, te)
	for _, tc := range []struct {
		method string
		url    string
	}{
		{method: http.MethodGet, url: "/api/catalog/admin/status"},
		{method: http.MethodPost, url: "/api/catalog/admin/reindex"},
		{method: http.MethodGet, url: "/api/catalog/admin/categories/raw?locale=en"},
		{method: http.MethodGet, url: "/api/catalog/admin/apps/wordpress/raw?locale=en"},
	} {
		rec := doCatalogWithToken(t, te, tc.method, tc.url, "", userToken)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s %s: expected 403 for non-superuser, got %d: %s", tc.method, tc.url, rec.Code, rec.Body.String())
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
		{url: "/api/catalog/custom-apps", status: http.StatusOK},
		{url: "/api/catalog/apps", status: http.StatusOK},
		{url: "/api/catalog/apps/wordpress", status: http.StatusOK},
		{url: "/api/catalog/apps/wordpress/deploy-source", status: http.StatusOK},
		{url: "/api/catalog/apps/wordpress/template", status: http.StatusOK},
		{url: "/api/catalog/me/apps", status: http.StatusOK},
	}

	for _, tc := range tests {
		rec := te.doCatalog(t, http.MethodGet, tc.url, "", true)
		if rec.Code != tc.status {
			t.Fatalf("%s: expected %d, got %d: %s", tc.url, tc.status, rec.Code, rec.Body.String())
		}
	}
}

func TestCatalogAdminRoutesReturnLocalSourcePayloads(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	status := te.doCatalog(t, http.MethodGet, "/api/catalog/admin/status", "", true)
	if status.Code != http.StatusOK {
		t.Fatalf("status: expected 200, got %d: %s", status.Code, status.Body.String())
	}
	statusPayload := parseJSON(t, status)
	if strings.TrimSpace(statusPayload["runtimeDir"].(string)) == "" {
		t.Fatalf("status: expected runtimeDir, got %v", statusPayload["runtimeDir"])
	}
	syncCapability, ok := statusPayload["syncCapability"].(map[string]any)
	if !ok || syncCapability["available"] != false {
		t.Fatalf("status: expected syncCapability.available=false, got %v", statusPayload["syncCapability"])
	}
	files, ok := statusPayload["files"].([]any)
	if !ok || len(files) != 4 {
		t.Fatalf("status: expected four seed files, got %T %v", statusPayload["files"], statusPayload["files"])
	}

	reindex := te.doCatalog(t, http.MethodPost, "/api/catalog/admin/reindex", "", true)
	if reindex.Code != http.StatusOK {
		t.Fatalf("reindex: expected 200, got %d: %s", reindex.Code, reindex.Body.String())
	}
	reindexPayload := parseJSON(t, reindex)
	if reindexPayload["ok"] != true {
		t.Fatalf("reindex: expected ok=true, got %v", reindexPayload["ok"])
	}

	rawCategories := te.doCatalog(t, http.MethodGet, "/api/catalog/admin/categories/raw?locale=en", "", true)
	if rawCategories.Code != http.StatusOK {
		t.Fatalf("raw categories: expected 200, got %d: %s", rawCategories.Code, rawCategories.Body.String())
	}
	rawCategoriesPayload := parseJSON(t, rawCategories)
	categoryItems, ok := rawCategoriesPayload["items"].([]any)
	if !ok || len(categoryItems) == 0 {
		t.Fatalf("raw categories: expected items, got %T %v", rawCategoriesPayload["items"], rawCategoriesPayload["items"])
	}
	if rawCategoriesPayload["meta"].(map[string]any)["locale"] != "en" {
		t.Fatalf("raw categories: expected locale=en, got %v", rawCategoriesPayload["meta"])
	}

	rawApp := te.doCatalog(t, http.MethodGet, "/api/catalog/admin/apps/wordpress/raw?locale=en", "", true)
	if rawApp.Code != http.StatusOK {
		t.Fatalf("raw app: expected 200, got %d: %s", rawApp.Code, rawApp.Body.String())
	}
	rawAppPayload := parseJSON(t, rawApp)
	item, ok := rawAppPayload["item"].(map[string]any)
	if !ok || item["key"] != "wordpress" {
		t.Fatalf("raw app: expected wordpress item, got %v", rawAppPayload["item"])
	}

	notFound := te.doCatalog(t, http.MethodGet, "/api/catalog/admin/apps/not-real/raw?locale=en", "", true)
	if notFound.Code != http.StatusNotFound {
		t.Fatalf("raw app missing: expected 404, got %d: %s", notFound.Code, notFound.Body.String())
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

func TestCatalogAppsListOrdersOfficialAppsByPopularityBeforeTitle(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doCatalog(t, http.MethodGet, "/api/catalog/apps?locale=en&source=official&limit=200", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	payload := parseJSON(t, rec)
	items, ok := payload["items"].([]any)
	if !ok || len(items) == 0 {
		t.Fatalf("expected official items, got %T %v", payload["items"], payload["items"])
	}

	mysqlIndex := -1
	safelineIndex := -1
	for index, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		switch item["key"] {
		case "mysql":
			mysqlIndex = index
		case "safeline":
			safelineIndex = index
		}
	}

	if mysqlIndex == -1 || safelineIndex == -1 {
		t.Fatalf("expected mysql and safeline in payload, got mysql=%d safeline=%d", mysqlIndex, safelineIndex)
	}
	if mysqlIndex >= safelineIndex {
		t.Fatalf("expected mysql (hotter app) before safeline, got mysql=%d safeline=%d", mysqlIndex, safelineIndex)
	}
}

func TestCatalogPrimaryCategoryCountsAndFilterUseAllParentMemberships(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	categoriesRec := te.doCatalog(t, http.MethodGet, "/api/catalog/categories?locale=en", "", true)
	if categoriesRec.Code != http.StatusOK {
		t.Fatalf("categories: expected 200, got %d: %s", categoriesRec.Code, categoriesRec.Body.String())
	}
	categoryPayload := parseJSON(t, categoriesRec)
	categoryItems, ok := categoryPayload["items"].([]any)
	if !ok || len(categoryItems) == 0 {
		t.Fatalf("expected category items, got %T %v", categoryPayload["items"], categoryPayload["items"])
	}

	analyticsCount := -1
	for _, raw := range categoryItems {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if item["key"] == "analytics" {
			analyticsCount = int(item["appCount"].(float64))
			break
		}
	}
	if analyticsCount <= 0 {
		t.Fatalf("expected analytics category count > 0, got %d", analyticsCount)
	}

	appsRec := te.doCatalog(t, http.MethodGet, "/api/catalog/apps?locale=en&source=official&primaryCategory=analytics&limit=200", "", true)
	if appsRec.Code != http.StatusOK {
		t.Fatalf("apps: expected 200, got %d: %s", appsRec.Code, appsRec.Body.String())
	}
	appPayload := parseJSON(t, appsRec)
	appItems, ok := appPayload["items"].([]any)
	if !ok || len(appItems) == 0 {
		t.Fatalf("expected analytics app items, got %T %v", appPayload["items"], appPayload["items"])
	}

	foundDoris := false
	for _, raw := range appItems {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if item["key"] == "doris" {
			foundDoris = true
			break
		}
	}
	if !foundDoris {
		t.Fatalf("expected analytics primary filter to include doris via secondary parent membership")
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

func TestCatalogAppTemplateReturnsTemplateContract(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doCatalog(t, http.MethodGet, "/api/catalog/apps/wordpress/template?locale=en", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	payload := parseJSON(t, rec)
	if payload["templateKey"] != "wordpress" {
		t.Fatalf("expected wordpress templateKey, got %v", payload["templateKey"])
	}
	manifest, ok := payload["manifest"].(map[string]any)
	if !ok || manifest["trademark"] != "WordPress" {
		t.Fatalf("expected manifest trademark, got %v", payload["manifest"])
	}
	inputs, ok := payload["inputs"].([]any)
	if !ok || len(inputs) == 0 {
		t.Fatalf("expected non-empty inputs, got %T %v", payload["inputs"], payload["inputs"])
	}
}

func TestCatalogDeploySourceReturnsCustomPrefill(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	authID := te.currentAuthID(t)
	seedCustomApp(t, te, authID, "shared-custom-app", []string{"cms"})
	ensureCustomAppTemplateFile(t, "shared-custom-app", "services:\n  app:\n    image: nginx:alpine\n")

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

func TestCatalogDeploySourceMarksCustomAppUnavailableWithoutTemplateFile(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	authID := te.currentAuthID(t)
	seedCustomApp(t, te, authID, "custom-no-template", []string{"cms"})

	rec := te.doCatalog(t, http.MethodGet, "/api/catalog/apps/custom-no-template/deploy-source?locale=en", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	payload := parseJSON(t, rec)
	capabilities, ok := payload["capabilities"].(map[string]any)
	if !ok || capabilities["hasComposeTemplate"] != false || capabilities["supportsDirectDeploy"] != false {
		t.Fatalf("expected custom app without template file to be unavailable, got %v", payload["capabilities"])
	}
	template, ok := payload["template"].(map[string]any)
	if !ok || template["available"] != false {
		t.Fatalf("expected template.available=false, got %v", payload["template"])
	}
}

func TestCatalogCustomAppsListReturnsVisibleRecords(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	authID := te.currentAuthID(t)
	seedCustomApp(t, te, authID, "owned-app", []string{"cms"})
	seedNamedCustomApp(t, te, "shared-app", "shared", "other-user")
	seedNamedCustomApp(t, te, "hidden-app", "private", "other-user")

	rec := te.doCatalog(t, http.MethodGet, "/api/catalog/custom-apps", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	payload := parseJSON(t, rec)
	items, ok := payload["items"].([]any)
	if !ok {
		t.Fatalf("expected items array, got %T", payload["items"])
	}
	keys := make([]string, 0, len(items))
	for _, item := range items {
		keys = append(keys, item.(map[string]any)["key"].(string))
	}
	if !containsCatalogTestString(keys, "owned-app") || !containsCatalogTestString(keys, "shared-app") || containsCatalogTestString(keys, "hidden-app") {
		t.Fatalf("unexpected visible custom apps: %v", keys)
	}
}

func TestCatalogCustomAppsCreateUpdateDeleteFlow(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	create := te.doCatalog(t, http.MethodPost, "/api/catalog/custom-apps", `{"key":"custom-api-app","trademark":"Custom API App","overview":"Overview","description":"Description","category_keys":["cms"],"compose_yaml":"services:\n  app:\n    image: nginx:alpine\n","env_text":"FOO=bar","visibility":"private"}`, true)
	if create.Code != http.StatusCreated {
		t.Fatalf("expected create 201, got %d: %s", create.Code, create.Body.String())
	}
	created := parseJSON(t, create)
	id := created["id"].(string)
	if created["created_by"] == "" {
		t.Fatalf("expected created_by, got %v", created)
	}

	update := te.doCatalog(t, http.MethodPatch, "/api/catalog/custom-apps/"+id, `{"key":"custom-api-app","trademark":"Custom API App 2","overview":"Updated overview","description":"Updated description","category_keys":["security-detection"],"compose_yaml":"services:\n  app:\n    image: httpd:alpine\n","env_text":"BAR=baz","visibility":"shared"}`, true)
	if update.Code != http.StatusOK {
		t.Fatalf("expected update 200, got %d: %s", update.Code, update.Body.String())
	}
	updated := parseJSON(t, update)
	if updated["trademark"] != "Custom API App 2" || updated["visibility"] != "shared" {
		t.Fatalf("unexpected updated payload: %v", updated)
	}

	remove := te.doCatalog(t, http.MethodDelete, "/api/catalog/custom-apps/"+id, "", true)
	if remove.Code != http.StatusOK {
		t.Fatalf("expected delete 200, got %d: %s", remove.Code, remove.Body.String())
	}
	if _, err := te.app.FindRecordById("store_custom_apps", id); err == nil {
		t.Fatalf("expected deleted custom app record to be removed")
	}
}

func TestCatalogCustomAppsCreateRejectsInvalidPayload(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doCatalog(t, http.MethodPost, "/api/catalog/custom-apps", `{"key":"invalid-custom-app","trademark":"Invalid","category_keys":["cms"],"compose_yaml":"","visibility":"private"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCatalogCustomAppsUpdateRejectsInvalidPayload(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	authID := te.currentAuthID(t)
	record := seedNamedCustomApp(t, te, "update-invalid", "private", authID)
	rec := te.doCatalog(t, http.MethodPatch, "/api/catalog/custom-apps/"+record.Id, `{"key":"update-invalid","trademark":"Update Invalid","overview":"Overview","category_keys":[],"compose_yaml":"","visibility":"public"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCatalogCustomAppsUpdateRejectsNonOwner(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	record := seedNamedCustomApp(t, te, "shared-locked", "shared", "other-user")
	rec := te.doCatalog(t, http.MethodPatch, "/api/catalog/custom-apps/"+record.Id, `{"key":"shared-locked","trademark":"Locked","overview":"Locked","category_keys":[],"compose_yaml":"","visibility":"shared"}`, true)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCatalogCustomAppsCreateRejectsKeyConflict(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doCatalog(t, http.MethodPost, "/api/catalog/custom-apps", `{"key":"wordpress","trademark":"WordPress Copy","overview":"Overview","category_keys":[],"compose_yaml":"","visibility":"private"}`, true)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCatalogAppsOwnedVisibilityIncludesOwnedSharedApps(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	authID := te.currentAuthID(t)
	seedCustomApp(t, te, authID, "owned-shared-app", []string{"cms"})
	seedNamedCustomApp(t, te, "other-shared-app", "shared", "other-user")

	rec := te.doCatalog(t, http.MethodGet, "/api/catalog/apps?source=custom&visibility=owned", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	payload := parseJSON(t, rec)
	items, ok := payload["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("expected one owned custom app, got %T %v", payload["items"], payload["items"])
	}
	item := items[0].(map[string]any)
	if item["key"] != "owned-shared-app" {
		t.Fatalf("expected owned-shared-app, got %v", item["key"])
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

func doCatalogWithToken(t *testing.T, te *testEnv, method, url, body, token string) *httptest.ResponseRecorder {
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
	if strings.TrimSpace(token) != "" {
		req.Header.Set("Authorization", token)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
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

func seedNamedCustomApp(t *testing.T, te *testEnv, key, visibility, createdBy string) *core.Record {
	t.Helper()
	col, err := te.app.FindCollectionByNameOrId("store_custom_apps")
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(col)
	record.Set("key", key)
	record.Set("trademark", key)
	record.Set("overview", "Custom overview")
	record.Set("description", "Custom description")
	record.Set("category_keys", []string{"cms"})
	record.Set("compose_yaml", "services:\n  app:\n    image: nginx:alpine\n")
	record.Set("visibility", visibility)
	record.Set("created_by", createdBy)
	if err := te.app.Save(record); err != nil {
		t.Fatal(err)
	}
	return record
}

func ensureCustomAppTemplateFile(t *testing.T, key, compose string) {
	t.Helper()
	dir := filepath.Join("/appos/data/templates/apps", key)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "docker-compose.yml")
	if err := os.WriteFile(path, []byte(compose), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = os.RemoveAll(dir)
	})
}

func containsCatalogTestString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
