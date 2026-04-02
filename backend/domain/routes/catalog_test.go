package routes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
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

	for _, url := range []string{
		"/api/catalog/categories",
		"/api/catalog/apps",
		"/api/catalog/apps/wordpress",
		"/api/catalog/apps/wordpress/deploy-source",
	} {
		rec := te.doCatalog(t, http.MethodGet, url, "", false)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s: expected 401, got %d: %s", url, rec.Code, rec.Body.String())
		}
	}
}

func TestCatalogReadRoutesReturnNotImplementedWhenAuthenticated(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tests := []struct {
		url      string
		endpoint string
	}{
		{url: "/api/catalog/categories", endpoint: "categories"},
		{url: "/api/catalog/apps", endpoint: "apps.list"},
		{url: "/api/catalog/apps/wordpress", endpoint: "apps.detail"},
		{url: "/api/catalog/apps/wordpress/deploy-source", endpoint: "apps.deploy-source"},
	}

	for _, tc := range tests {
		rec := te.doCatalog(t, http.MethodGet, tc.url, "", true)
		if rec.Code != http.StatusNotImplemented {
			t.Fatalf("%s: expected 501, got %d: %s", tc.url, rec.Code, rec.Body.String())
		}
		payload := parseJSON(t, rec)
		if payload["endpoint"] != tc.endpoint {
			t.Fatalf("%s: expected endpoint %q, got %v", tc.url, tc.endpoint, payload["endpoint"])
		}
	}
}