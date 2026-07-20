package feeds

import (
	"testing"
	"time"

	"github.com/websoft9/appos/backend/domain/config/sysconfig"
)

func TestLoadPolicySettingsReadsStoredValues(t *testing.T) {
	app := newFeedsTestApp(t)
	if err := sysconfig.SetGroup(app, SettingsModule, PolicySettingsKey, map[string]any{
		"pollIntervalHours":      3,
		"failureBackoffMaxHours": 36,
		"perSourceRetentionCap":  800,
		"globalRetentionCap":     45000,
	}); err != nil {
		t.Fatalf("set feeds policy: %v", err)
	}

	settings := LoadPolicySettings(app)
	if settings.PollInterval != 3*time.Hour {
		t.Fatalf("expected poll interval 3h, got %v", settings.PollInterval)
	}
	if settings.PerSourceCap != 800 {
		t.Fatalf("expected per-source cap 800, got %d", settings.PerSourceCap)
	}
	if settings.GlobalCap != 45000 {
		t.Fatalf("expected global cap 45000, got %d", settings.GlobalCap)
	}
	// tier1 = 36h/12 = 3h, tier2 = 36h/4 = 9h, max = 36h
	if settings.FailureBackoffOne != 3*time.Hour || settings.FailureBackoffTwo != 9*time.Hour || settings.FailureBackoffMax != 36*time.Hour {
		t.Fatalf("unexpected failure backoff settings: %#v", settings)
	}
}
