package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/space"
	"github.com/websoft9/appos/backend/infra/egress/fetchstore"
	"github.com/websoft9/appos/backend/infra/filesvc"
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

func TestSpaceFetchUsesFetchStoreAndPersistsFile(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	original := spaceFetchStoreDownload
	spaceFetchStoreDownload = func(_ context.Context, _ core.App, service *filesvc.LocalService, req fetchstore.Request) (fetchstore.Result, error) {
		if req.RetryCount != 2 {
			return fetchstore.Result{}, fmt.Errorf("unexpected retry count %d", req.RetryCount)
		}
		if req.RetryBackoff <= 0 {
			return fetchstore.Result{}, fmt.Errorf("expected positive retry backoff")
		}
		entry, err := service.WriteFile(req.DestinationPath, []byte("hello from fetchstore"), true)
		if err != nil {
			return fetchstore.Result{}, err
		}
		return fetchstore.Result{
			Path:         entry.Path,
			BytesWritten: int64(len("hello from fetchstore")),
			ContentType:  "text/plain",
			SourceURL:    req.URL,
		}, nil
	}
	defer func() { spaceFetchStoreDownload = original }()

	rec := te.doSpace(t, http.MethodPost, "/api/space/fetch", `{"url":"https://example.com/demo.txt","name":"demo.txt"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for space fetch, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	name, _ := payload["name"].(string)
	mimeType, _ := payload["mime_type"].(string)
	if name != "demo.txt" || mimeType != "text/plain" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
	fileID, _ := payload["id"].(string)
	stored, err := te.app.FindRecordById(space.Collection, fileID)
	if err != nil {
		t.Fatalf("expected stored file record: %v", err)
	}
	if stored.GetString("content") == "" {
		t.Fatalf("expected saved pocketbase file content, got empty content field")
	}
	if stored.GetInt("size") != len("hello from fetchstore") {
		t.Fatalf("unexpected stored size: %d", stored.GetInt("size"))
	}
}

func TestSpaceFetchMapsFetchStoreSizeErrors(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	original := spaceFetchStoreDownload
	spaceFetchStoreDownload = func(_ context.Context, _ core.App, _ *filesvc.LocalService, _ fetchstore.Request) (fetchstore.Result, error) {
		return fetchstore.Result{}, fmt.Errorf("remote content exceeds 1048576 bytes")
	}
	defer func() { spaceFetchStoreDownload = original }()

	rec := te.doSpace(t, http.MethodPost, "/api/space/fetch", `{"url":"https://example.com/demo.txt","name":"demo.txt"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for oversized fetch, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(strings.ToLower(rec.Body.String()), "remote file exceeds size limit") {
		t.Fatalf("expected size limit message, got %s", rec.Body.String())
	}
}
