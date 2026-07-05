package bootstrap

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/resource/aiproviders"
	"github.com/websoft9/appos/backend/infra/egress"
)

func TestNewAIProviderPruneHTTPClientFallsBackToDirectOnPlanError(t *testing.T) {
	original := newAIProviderPruneHTTPClientPlan
	defer func() { newAIProviderPruneHTTPClientPlan = original }()

	newAIProviderPruneHTTPClientPlan = func(app core.App, consumerKey string, timeout time.Duration, skipTLSVerify bool) (egress.HTTPClientPlan, error) {
		return egress.HTTPClientPlan{}, errors.New("boom")
	}

	provider := aiproviders.RestoreAIProvider(aiproviders.Snapshot{ID: "provider-1", Name: "Provider"})
	client, err := newAIProviderPruneHTTPClient(nil, provider)
	if err != nil {
		t.Fatalf("expected direct fallback client, got error: %v", err)
	}
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
}
