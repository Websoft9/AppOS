package aiproviders

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type recordingHTTPDoer struct {
	request *http.Request
	calls   int
}

func (d *recordingHTTPDoer) Do(req *http.Request) (*http.Response, error) {
	d.calls++
	d.request = req.Clone(req.Context())
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(`{"data":[{"id":"gpt-4.1-mini"}]}`)),
		Request:    req,
	}, nil
}

func TestFetchModelsUsesInjectedHTTPClient(t *testing.T) {
	doer := &recordingHTTPDoer{}
	result, err := FetchModels(context.Background(), "https://provider.example/v1", "test-key", "", "bearer", doer)
	if err != nil {
		t.Fatalf("fetch models: %v", err)
	}
	if doer.calls != 1 {
		t.Fatalf("expected one injected client call, got %d", doer.calls)
	}
	if doer.request == nil {
		t.Fatal("expected captured request")
	}
	if got := doer.request.URL.String(); got != "https://provider.example/v1/models" {
		t.Fatalf("expected /models endpoint, got %q", got)
	}
	if got := doer.request.Header.Get("Authorization"); got != "Bearer test-key" {
		t.Fatalf("expected bearer authorization header, got %q", got)
	}
	if got := doer.request.Header.Get("Accept"); got != "application/json" {
		t.Fatalf("expected Accept header, got %q", got)
	}
	if len(result.Models) != 1 || result.Models[0].ID != "gpt-4.1-mini" {
		t.Fatalf("unexpected result payload: %#v", result.Models)
	}
}