package routes

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/infra/egress"
)

func TestNewAIProviderHTTPClientFallsBackToDirectOnPlanError(t *testing.T) {
	original := newAIProviderHTTPClientPlan
	defer func() { newAIProviderHTTPClientPlan = original }()

	newAIProviderHTTPClientPlan = func(app core.App, consumerKey string, timeout time.Duration, skipTLSVerify bool) (egress.HTTPClientPlan, error) {
		return egress.HTTPClientPlan{}, errors.New("boom")
	}

	client := newAIProviderHTTPClient(nil, true)
	if client.Timeout != 8*time.Second {
		t.Fatalf("expected 8s timeout, got %s", client.Timeout)
	}
	transport, ok := client.Transport.(*http.Transport)
	if !ok || transport == nil {
		t.Fatalf("expected direct transport fallback, got %#v", client.Transport)
	}
	if transport.Proxy != nil {
		t.Fatal("expected direct fallback transport to disable proxy resolution")
	}
	if transport.TLSClientConfig == nil || !transport.TLSClientConfig.InsecureSkipVerify {
		t.Fatal("expected direct fallback transport to preserve skip TLS verify")
	}
}
