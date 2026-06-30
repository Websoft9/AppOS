package migrations

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/infra/collections"
)

func TestResourceEnabledValueForMigrationPreservesLegacyAIProviderFlag(t *testing.T) {
	record := core.NewRecord(core.NewBaseCollection(collections.AIProviders))
	record.Set("config", map[string]any{"is_enabled": false})

	if got := resourceEnabledValueForMigration(collections.AIProviders, record); got {
		t.Fatal("expected legacy AI provider config.is_enabled=false to remain disabled")
	}
}

func TestResourceEnabledValueForMigrationDefaultsNonAIResourcesToEnabled(t *testing.T) {
	record := core.NewRecord(core.NewBaseCollection(collections.Connectors))
	record.Set("config", map[string]any{"is_enabled": false})

	if got := resourceEnabledValueForMigration(collections.Connectors, record); !got {
		t.Fatal("expected non-AI resources to default to enabled during migration")
	}
}
