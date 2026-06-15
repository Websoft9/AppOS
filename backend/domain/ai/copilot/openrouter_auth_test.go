package copilot

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestValidateOpenRouterCredentialPrefersDirectUserNotFound(t *testing.T) {
	directServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/key" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("User not found"))
	}))
	defer directServer.Close()

	proxyClient := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       http.NoBody,
			Request:    req,
		}, nil
	})}

	err := ValidateOpenRouterCredential(context.Background(), proxyClient, directServer.URL, map[string]string{"X-Title": "AppOS"}, "sk-test")
	if err == nil {
		t.Fatal("expected credential rejection")
	}
	if got := err.Error(); got != "OpenRouter authentication failed on /auth/key: upstream returned 401 User not found" {
		t.Fatalf("unexpected error %q", got)
	}
}

func TestValidateOpenRouterCredentialFallsBackToProvidedClient(t *testing.T) {
	proxyClient := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/auth/key" {
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       http.NoBody,
			Request:    req,
		}, nil
	})}

	err := ValidateOpenRouterCredential(context.Background(), proxyClient, "http://127.0.0.1:1", map[string]string{"X-Title": "AppOS"}, "sk-test")
	if err != nil {
		t.Fatalf("expected fallback success, got %v", err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	resp, err := f(req)
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return nil, fmt.Errorf("nil response")
	}
	return resp, nil
}