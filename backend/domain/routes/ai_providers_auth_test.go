package routes

import (
	"net/http"
	"testing"
)

func TestApplyAuthSchemeHeaders(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "https://example.com/models", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer stale")
	req.Header.Set("x-api-key", "stale")

	applyAuthSchemeHeaders(req, "secret-token", "api_key")
	if got := req.Header.Get("Authorization"); got != "" {
		t.Fatalf("expected Authorization header to be cleared, got %q", got)
	}
	if got := req.Header.Get("x-api-key"); got != "secret-token" {
		t.Fatalf("expected x-api-key header, got %q", got)
	}

	applyAuthSchemeHeaders(req, "secret-token", "bearer")
	if got := req.Header.Get("Authorization"); got != "Bearer secret-token" {
		t.Fatalf("expected bearer header, got %q", got)
	}
	if got := req.Header.Get("x-api-key"); got != "" {
		t.Fatalf("expected x-api-key header to be cleared, got %q", got)
	}

	applyAuthSchemeHeaders(req, "secret-token", "none")
	if got := req.Header.Get("Authorization"); got != "" {
		t.Fatalf("expected Authorization header to be removed, got %q", got)
	}
	if got := req.Header.Get("x-api-key"); got != "" {
		t.Fatalf("expected x-api-key header to be removed, got %q", got)
	}
}