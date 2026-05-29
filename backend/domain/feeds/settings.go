package feeds

import (
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingsschema "github.com/websoft9/appos/backend/domain/config/sysconfig/schema"
)

const (
	SettingsModule     = "feeds"
	PolicySettingsKey = "policy"
)

type PolicySettings struct {
	PollInterval      time.Duration
	FailureBackoffOne time.Duration
	FailureBackoffTwo time.Duration
	FailureBackoffMax time.Duration
	PerSourceCap      int
	GlobalCap         int
}

func DefaultPolicySettings() PolicySettings {
	maxBackoff := 24 * time.Hour
	return PolicySettings{
		PollInterval:      3 * time.Hour,
		FailureBackoffMax: maxBackoff,
		FailureBackoffOne: maxBackoff / 12,
		FailureBackoffTwo: maxBackoff / 4,
		PerSourceCap:      100,
		GlobalCap:         10000,
	}
}

func LoadPolicySettings(app core.App) PolicySettings {
	defaults := DefaultPolicySettings()
	group, _ := sysconfig.GetGroup(app, SettingsModule, PolicySettingsKey, settingsschema.DefaultGroup(SettingsModule, PolicySettingsKey))
	maxBackoff := time.Duration(clampRange(sysconfig.Int(group, "failureBackoffMaxHours", int(defaults.FailureBackoffMax/time.Hour)), 4, 336, int(defaults.FailureBackoffMax/time.Hour))) * time.Hour
	settings := PolicySettings{
		PollInterval:      time.Duration(clampRange(sysconfig.Int(group, "pollIntervalHours", int(defaults.PollInterval/time.Hour)), 1, 240, int(defaults.PollInterval/time.Hour))) * time.Hour,
		FailureBackoffMax: maxBackoff,
		FailureBackoffOne: maxBackoff / 12,
		FailureBackoffTwo: maxBackoff / 4,
		PerSourceCap:      clampRange(sysconfig.Int(group, "perSourceRetentionCap", defaults.PerSourceCap), 20, 1000, defaults.PerSourceCap),
		GlobalCap:         clampRange(sysconfig.Int(group, "globalRetentionCap", defaults.GlobalCap), 5000, 50000, defaults.GlobalCap),
	}
	if settings.GlobalCap < settings.PerSourceCap {
		settings.GlobalCap = defaults.GlobalCap
	}
	return settings
}

func clampMinimum(value, minimum, fallback int) int {
	if value < minimum {
		return fallback
	}
	return value
}

func clampRange(value, minimum, maximum, fallback int) int {
	if value < minimum || value > maximum {
		return fallback
	}
	return value
}