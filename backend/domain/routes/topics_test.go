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
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
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

func TestTopicImportPolicyGetReturnsConfiguredPolicy(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	if err := sysconfig.SetGroup(te.app, "topic", "import-policy", map[string]any{
		"maxDescriptionImportKB": 2048,
		"textOnly":               false,
	}); err != nil {
		t.Fatal(err)
	}

	rec := te.doTopics(t, http.MethodGet, "/api/topics/policy/import", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for topic import policy get, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if int(payload["maxDescriptionImportBytes"].(float64)) != 2048*1024 {
		t.Fatalf("expected configured maxDescriptionImportBytes, got %v", payload["maxDescriptionImportBytes"])
	}
	if payload["textOnly"] != false {
		t.Fatalf("expected configured textOnly=false, got %v", payload["textOnly"])
	}
}

func TestTopicSharePolicyGetReturnsConfiguredPolicy(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	if err := sysconfig.SetGroup(te.app, "topic", "share", map[string]any{
		"shareMaxMinutes":     90,
		"shareDefaultMinutes": 45,
	}); err != nil {
		t.Fatal(err)
	}

	rec := te.doTopics(t, http.MethodGet, "/api/topics/policy/share", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for topic share policy get, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if int(payload["shareMaxMinutes"].(float64)) != 90 {
		t.Fatalf("expected configured shareMaxMinutes, got %v", payload["shareMaxMinutes"])
	}
	if int(payload["shareDefaultMinutes"].(float64)) != 45 {
		t.Fatalf("expected configured shareDefaultMinutes, got %v", payload["shareDefaultMinutes"])
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

func TestTopicShareCommentRejectsWhenGuestCommentsDisabled(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	if err := sysconfig.SetGroup(te.app, "topic", "comment-policy", map[string]any{
		"allowGuestComments":   false,
		"defaultGuestName":     "Guest",
		"maxGuestNameLength":   100,
		"maxCommentBodyLength": 10000,
	}); err != nil {
		t.Fatal(err)
	}

	topicRecord := seedSharedTopicForRouteTest(t, te, false)

	rec := te.doTopics(t, http.MethodPost, "/api/topics/share/"+topicRecord.GetString("share_token")+"/comments", `{"body":"hello"}`, false)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when guest comments are disabled, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Guest comments are disabled") {
		t.Fatalf("expected guest comments disabled message, got %s", rec.Body.String())
	}
}

func TestTopicShareCommentUsesConfiguredDefaultGuestName(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	if err := sysconfig.SetGroup(te.app, "topic", "comment-policy", map[string]any{
		"allowGuestComments":   true,
		"defaultGuestName":     "Visitor",
		"maxGuestNameLength":   100,
		"maxCommentBodyLength": 10000,
	}); err != nil {
		t.Fatal(err)
	}

	topicRecord := seedSharedTopicForRouteTest(t, te, false)

	rec := te.doTopics(t, http.MethodPost, "/api/topics/share/"+topicRecord.GetString("share_token")+"/comments", `{"body":"hello"}`, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for anonymous comment with configured default guest name, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if payload["created_by"] != topics.GuestAuthorID("Visitor") {
		t.Fatalf("expected configured guest author id, got %v", payload["created_by"])
	}
}

func TestTopicShareCommentRejectsGuestNameOverConfiguredLimit(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	if err := sysconfig.SetGroup(te.app, "topic", "comment-policy", map[string]any{
		"allowGuestComments":   true,
		"defaultGuestName":     "Guest",
		"maxGuestNameLength":   3,
		"maxCommentBodyLength": 10000,
	}); err != nil {
		t.Fatal(err)
	}

	topicRecord := seedSharedTopicForRouteTest(t, te, false)

	rec := te.doTopics(t, http.MethodPost, "/api/topics/share/"+topicRecord.GetString("share_token")+"/comments", `{"body":"hello","guest_name":"Long"}`, false)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when guest name exceeds configured limit, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Guest name must be at most 3 characters") {
		t.Fatalf("expected configured guest-name limit message, got %s", rec.Body.String())
	}
}

func TestTopicShareCommentRejectsBodyOverConfiguredLimit(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	if err := sysconfig.SetGroup(te.app, "topic", "comment-policy", map[string]any{
		"allowGuestComments":   true,
		"defaultGuestName":     "Guest",
		"maxGuestNameLength":   100,
		"maxCommentBodyLength": 4,
	}); err != nil {
		t.Fatal(err)
	}

	topicRecord := seedSharedTopicForRouteTest(t, te, false)

	rec := te.doTopics(t, http.MethodPost, "/api/topics/share/"+topicRecord.GetString("share_token")+"/comments", `{"body":"hello"}`, false)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when comment body exceeds configured limit, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "at most 4 characters") {
		t.Fatalf("expected configured comment-body limit message, got %s", rec.Body.String())
	}
}
