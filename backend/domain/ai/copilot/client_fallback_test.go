package copilot

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/infra/egress"
)

func TestProviderHTTPClientFallsBackToDirectOnPlanError(t *testing.T) {
	original := newCopilotHTTPClientPlan
	defer func() { newCopilotHTTPClientPlan = original }()

	newCopilotHTTPClientPlan = func(app core.App, consumerKey string, timeout time.Duration, skipTLSVerify bool) (egress.HTTPClientPlan, error) {
		return egress.HTTPClientPlan{}, errors.New("boom")
	}

	factory := EinoModelFactory{App: pocketbase.New()}
	client := factory.providerHTTPClient(&ProviderConfig{Endpoint: "https://openrouter.ai/api/v1"})
	if client == nil {
		t.Fatal("expected direct fallback client")
	}
	if client.Timeout != 90*time.Second {
		t.Fatalf("expected 90s timeout, got %s", client.Timeout)
	}
	transport, ok := client.Transport.(*http.Transport)
	if !ok || transport == nil {
		t.Fatalf("expected direct transport fallback, got %#v", client.Transport)
	}
	if transport.Proxy != nil {
		t.Fatal("expected direct fallback transport to disable proxy resolution")
	}
}