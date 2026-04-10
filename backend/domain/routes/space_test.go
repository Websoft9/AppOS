package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/space"
)

func (te *testEnv) doSpace(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	registerSpaceRoutes(&core.ServeEvent{Router: r})
	registerSpacePublicRoutes(&core.ServeEvent{Router: r})

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

func seedSpaceFileForRouteTest(t *testing.T, te *testEnv) *core.Record {
	t.Helper()

	owner, err := te.app.FindFirstRecordByData(core.CollectionNameSuperusers, "email", "admin@test.com")
	if err != nil {
		t.Fatal(err)
	}

	col, err := te.app.FindCollectionByNameOrId(space.Collection)
	if err != nil {
		t.Fatal(err)
	}

	rec := core.NewRecord(col)
	rec.Set("name", "demo.txt")
	rec.Set("owner", owner.Id)
	rec.Set("mime_type", "text/plain")
	rec.Set("size", 12)
	rec.Set("is_folder", false)
	rec.Set("is_deleted", false)
	rec.Set("share_token", "")
	rec.Set("share_expires_at", "")
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}

	return rec
}

func seedSharedSpaceFileForRouteTest(t *testing.T, te *testEnv, expiresAt string) *core.Record {
	t.Helper()

	rec := seedSpaceFileForRouteTest(t, te)
	rec.Set("share_token", "space-share-token")
	rec.Set("share_expires_at", expiresAt)
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func TestFileShareCreateRejectsInvalidJSON(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	fileRecord := seedSpaceFileForRouteTest(t, te)

	rec := te.doSpace(t, http.MethodPost, "/api/space/share/"+fileRecord.Id, "{", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid JSON, got %d: %s", rec.Code, rec.Body.String())
	}

	reloaded, err := te.app.FindRecordById(space.Collection, fileRecord.Id)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.GetString("share_token") != "" {
		t.Fatalf("expected invalid JSON not to create a share token, got %q", reloaded.GetString("share_token"))
	}
}

func TestFileShareCreatePersistsShareToken(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	fileRecord := seedSpaceFileForRouteTest(t, te)

	rec := te.doSpace(t, http.MethodPost, "/api/space/share/"+fileRecord.Id, `{"minutes":15}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid share creation, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	shareToken, _ := payload["share_token"].(string)
	if shareToken == "" {
		t.Fatalf("expected response to include share_token, got %v", payload["share_token"])
	}

	reloaded, err := te.app.FindRecordById(space.Collection, fileRecord.Id)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.GetString("share_token") != shareToken {
		t.Fatalf("expected persisted share token %q, got %q", shareToken, reloaded.GetString("share_token"))
	}
}

func TestFileShareResolveRejectsExpiredShare(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	fileRecord := seedSharedSpaceFileForRouteTest(t, te, time.Now().UTC().Add(-time.Minute).Format(time.RFC3339))

	rec := te.doSpace(t, http.MethodGet, "/api/space/share/"+fileRecord.GetString("share_token"), "", false)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for expired share, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "share link has expired") {
		t.Fatalf("expected expired share message, got %s", rec.Body.String())
	}
}
