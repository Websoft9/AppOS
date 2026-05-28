package feeds

import (
	"testing"
	"time"

	"github.com/websoft9/appos/backend/domain/config/sysconfig"
)

func TestLoadPolicySettingsReadsStoredValues(t *testing.T) {
	app := newFeedsTestApp(t)
	if err := sysconfig.SetGroup(app, SettingsModule, PolicySettingsKey, map[string]any{
		"pollIntervalMinutes":   45,
		"failureBackoffOneHours": 3,
		"failureBackoffTwoHours": 9,
		"failureBackoffMaxHours": 36,
		"perSourceRetentionCap": 1500,
		"globalRetentionCap":    45000,
	}); err != nil {
		t.Fatalf("set feeds policy: %v", err)
	}

	settings := LoadPolicySettings(app)
	if settings.PollInterval != 45*time.Minute {
		t.Fatalf("expected poll interval 45m, got %v", settings.PollInterval)
	}
	if settings.FailureBackoffOne != 3*time.Hour || settings.FailureBackoffTwo != 9*time.Hour || settings.FailureBackoffMax != 36*time.Hour {
		t.Fatalf("unexpected failure backoff settings: %#v", settings)
	}
	if settings.PerSourceCap != 1500 || settings.GlobalCap != 45000 {
		t.Fatalf("unexpected retention settings: %#v", settings)
	}
}