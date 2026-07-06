package checks

import (
	"sync"
	"testing"
	"time"

	"github.com/websoft9/appos/backend/domain/resource/connectors"
)

func TestProbeConnectorBatchRunsConcurrentlyAndPreservesOrder(t *testing.T) {
	items := []*connectors.Connector{
		connectors.RestoreConnector(connectors.Snapshot{ID: "one", Name: "One", Kind: connectors.KindRESTAPI, TemplateID: "generic-rest", Endpoint: "https://one.example.com"}),
		connectors.RestoreConnector(connectors.Snapshot{ID: "two", Name: "Two", Kind: connectors.KindRESTAPI, TemplateID: "generic-rest", Endpoint: "https://two.example.com"}),
		connectors.RestoreConnector(connectors.Snapshot{ID: "three", Name: "Three", Kind: connectors.KindRESTAPI, TemplateID: "generic-rest", Endpoint: "https://three.example.com"}),
	}

	var mu sync.Mutex
	active := 0
	maxActive := 0
	worker := func(item *connectors.Connector) ReachabilityResult {
		mu.Lock()
		active++
		if active > maxActive {
			maxActive = active
		}
		mu.Unlock()

		time.Sleep(60 * time.Millisecond)

		mu.Lock()
		active--
		mu.Unlock()

		return ReachabilityResult{Status: item.ID()}
	}

	start := time.Now()
	results := probeConnectorBatch(items, worker)
	elapsed := time.Since(start)

	if len(results) != len(items) {
		t.Fatalf("expected %d results, got %d", len(items), len(results))
	}
	if maxActive < 2 {
		t.Fatalf("expected concurrent execution, maxActive=%d", maxActive)
	}
	if elapsed >= 150*time.Millisecond {
		t.Fatalf("expected concurrent batch to complete faster than serial execution, elapsed=%s", elapsed)
	}
	for index, result := range results {
		if result.Item.ID() != items[index].ID() {
			t.Fatalf("expected result order to match input at %d, got %q want %q", index, result.Item.ID(), items[index].ID())
		}
		if result.Result.Status != items[index].ID() {
			t.Fatalf("expected result payload to align with input at %d, got %q want %q", index, result.Result.Status, items[index].ID())
		}
	}
}