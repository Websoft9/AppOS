package copilot

import (
	"io"
	"net/http"
	"testing"
)

func TestAuthSchemeHeaders(t *testing.T) {
	headers := authSchemeHeaders("secret-token", "api_key")
	if got := headers["x-api-key"]; got != "secret-token" {
		t.Fatalf("expected x-api-key header, got %q", got)
	}
	if got := headers["Authorization"]; got != "" {
		t.Fatalf("expected no Authorization header, got %q", got)
	}

	headers = authSchemeHeaders("secret-token", "bearer")
	if got := headers["Authorization"]; got != "Bearer secret-token" {
		t.Fatalf("expected bearer Authorization header, got %q", got)
	}

	headers = authSchemeHeaders("secret-token", "none")
	if len(headers) != 0 {
		t.Fatalf("expected no auth headers, got %#v", headers)
	}
}

func TestWithProviderHeadersOverridesSDKAuthorizationForAPIKeyMode(t *testing.T) {
	var captured *http.Request
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		captured = req.Clone(req.Context())
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(http.NoBody),
			Request:    req,
		}, nil
	})}

	provider := &ProviderConfig{
		Endpoint:   "https://api.example.com/v1",
		APIKey:     "secret-token",
		AuthScheme: "api_key",
	}

	wrapped := withProviderHeaders(client, provider)
	req, err := http.NewRequest(http.MethodGet, "https://api.example.com/v1/models", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer stale")
	if _, err := wrapped.Do(req); err != nil {
		t.Fatalf("wrapped request failed: %v", err)
	}
	if captured == nil {
		t.Fatal("expected wrapped client to issue a request")
	}
	if got := captured.Header.Get("Authorization"); got != "" {
		t.Fatalf("expected Authorization header to be cleared, got %q", got)
	}
	if got := captured.Header.Get("x-api-key"); got != "secret-token" {
		t.Fatalf("expected x-api-key header, got %q", got)
	}
}
