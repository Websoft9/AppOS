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
	"github.com/websoft9/appos/backend/domain/topics"
)

func (te *testEnv) doTopics(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	registerTopicRoutes(&core.ServeEvent{Router: r})
	registerTopicPublicRoutes(&core.ServeEvent{Router: r})

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

func seedTopicForRouteTest(t *testing.T, te *testEnv) *core.Record {
	t.Helper()

	owner, err := te.app.FindFirstRecordByData(core.CollectionNameSuperusers, "email", "admin@test.com")
	if err != nil {
		t.Fatal(err)
	}

	col, err := te.app.FindCollectionByNameOrId(topics.Collection)
	if err != nil {
		t.Fatal(err)
	}

	rec := core.NewRecord(col)
	rec.Set("title", "Route test topic")
	rec.Set("description", "Seeded topic for route tests")
	rec.Set("created_by", owner.Id)
	rec.Set("closed", false)
	rec.Set("share_token", "")
	rec.Set("share_expires_at", time.Time{}.Format(time.RFC3339))
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}

	return rec
}

func seedSharedTopicForRouteTest(t *testing.T, te *testEnv, closed bool) *core.Record {
	t.Helper()

	rec := seedTopicForRouteTest(t, te)
	rec.Set("closed", closed)
	rec.Set("share_token", "share-token")
	rec.Set("share_expires_at", time.Now().UTC().Add(time.Hour).Format(time.RFC3339))
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func seedSharedTopicWithExpiryForRouteTest(t *testing.T, te *testEnv, expiresAt string) *core.Record {
	t.Helper()

	rec := seedTopicForRouteTest(t, te)
	rec.Set("share_token", "share-token")
	rec.Set("share_expires_at", expiresAt)
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func TestTopicShareCreateRejectsInvalidJSON(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	topicRecord := seedTopicForRouteTest(t, te)

	rec := te.doTopics(t, http.MethodPost, "/api/topics/share/"+topicRecord.Id, "{", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid JSON, got %d: %s", rec.Code, rec.Body.String())
	}

	reloaded, err := te.app.FindRecordById(topics.Collection, topicRecord.Id)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.GetString("share_token") != "" {
		t.Fatalf("expected invalid JSON not to create a share token, got %q", reloaded.GetString("share_token"))
	}
}

func TestTopicShareCreatePersistsShareToken(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	topicRecord := seedTopicForRouteTest(t, te)

	rec := te.doTopics(t, http.MethodPost, "/api/topics/share/"+topicRecord.Id, `{"minutes":15}`, true)
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

	reloaded, err := te.app.FindRecordById(topics.Collection, topicRecord.Id)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.GetString("share_token") != shareToken {
		t.Fatalf("expected persisted share token %q, got %q", shareToken, reloaded.GetString("share_token"))
	}
}

func TestTopicShareCommentRejectsClosedTopic(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	topicRecord := seedSharedTopicForRouteTest(t, te, true)

	rec := te.doTopics(t, http.MethodPost, "/api/topics/share/"+topicRecord.GetString("share_token")+"/comments", `{"body":"hello"}`, false)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for closed shared topic comment, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "This topic is closed") {
		t.Fatalf("expected closed topic message, got %s", rec.Body.String())
	}
}

func TestTopicShareResolveRejectsExpiredTopic(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	topicRecord := seedSharedTopicWithExpiryForRouteTest(t, te, time.Now().UTC().Add(-time.Minute).Format(time.RFC3339))

	rec := te.doTopics(t, http.MethodGet, "/api/topics/share/"+topicRecord.GetString("share_token"), "", false)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for expired shared topic, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "share link has expired") {
		t.Fatalf("expected expired share message, got %s", rec.Body.String())
	}
}

func TestTopicShareResolveRejectsMissingExpiry(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	topicRecord := seedSharedTopicWithExpiryForRouteTest(t, te, "")

	rec := te.doTopics(t, http.MethodGet, "/api/topics/share/"+topicRecord.GetString("share_token"), "", false)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for missing-expiry shared topic, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "share link has no expiry set") {
		t.Fatalf("expected missing-expiry message, got %s", rec.Body.String())
	}
}

func TestTopicShareCommentDefaultsGuestName(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	topicRecord := seedSharedTopicForRouteTest(t, te, false)

	rec := te.doTopics(t, http.MethodPost, "/api/topics/share/"+topicRecord.GetString("share_token")+"/comments", `{"body":"hello"}`, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for anonymous comment with default guest name, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if payload["created_by"] != topics.GuestAuthorID(topics.DefaultGuestName) {
		t.Fatalf("expected default guest author id, got %v", payload["created_by"])
	}
}
