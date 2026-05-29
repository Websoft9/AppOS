package routes

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func (te *testEnv) doMedia(t *testing.T, req *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}
	registerMediaRoutes(&core.ServeEvent{Router: r})
	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func newMediaUploadRequest(t *testing.T, url string, fields map[string]string, filename, contentType string, data []byte) *http.Request {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatal(err)
		}
	}
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, url, body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if contentType != "" {
		req.Header.Set("X-Test-Content-Type", contentType)
	}
	return req
}

func TestMediaUploadRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()
	req := newMediaUploadRequest(t, "/api/media", nil, "logo.png", "image/png", []byte("png"))
	rec := te.doMedia(t, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMediaCreateGetContentDelete(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()
	req := newMediaUploadRequest(t, "/api/media", map[string]string{
		"category":   "branding",
		"scope":      "public",
		"owner_type": "system",
	}, "logo.svg", "image/svg+xml", []byte("<svg></svg>"))
	req.Header.Set("Authorization", te.token)
	rec := te.doMedia(t, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("create media: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	mediaID, _ := created["id"].(string)
	if mediaID == "" {
		t.Fatal("expected media id")
	}
	if created["public_url"] != "/api/media/"+mediaID+"/public" {
		t.Fatalf("unexpected public_url: %v", created["public_url"])
	}

	req = httptest.NewRequest(http.MethodGet, "/api/media/"+mediaID, nil)
	req.Header.Set("Authorization", te.token)
	rec = te.doMedia(t, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("get media: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/media/"+mediaID+"/content", nil)
	req.Header.Set("Authorization", te.token)
	rec = te.doMedia(t, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("get media content: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != "<svg></svg>" {
		t.Fatalf("unexpected content: %q", got)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/media/"+mediaID+"/public", nil)
	rec = te.doMedia(t, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("get public media: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/media/"+mediaID, nil)
	req.Header.Set("Authorization", te.token)
	rec = te.doMedia(t, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete media: expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := te.app.FindRecordById("media", mediaID); err == nil {
		t.Fatal("expected media record to be deleted")
	}
}

func TestMediaRejectsUnsupportedType(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()
	req := newMediaUploadRequest(t, "/api/media", nil, "notes.txt", "text/plain", []byte("hello"))
	req.Header.Set("Authorization", te.token)
	rec := te.doMedia(t, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(strings.ToLower(rec.Body.String()), "unsupported media type") {
		t.Fatalf("expected unsupported media type error, got %s", rec.Body.String())
	}
}

func TestPublicMediaHidesPrivateItems(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()
	req := newMediaUploadRequest(t, "/api/media", map[string]string{"scope": "private"}, "avatar.png", "image/png", []byte("png"))
	req.Header.Set("Authorization", te.token)
	rec := te.doMedia(t, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("create private media: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	created := parseJSON(t, rec)
	mediaID := created["id"].(string)
	req = httptest.NewRequest(http.MethodGet, "/api/media/"+mediaID+"/public", nil)
	rec = te.doMedia(t, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func parseMediaJSON(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatal(err)
	}
	return v
}

var _ = io.EOF
