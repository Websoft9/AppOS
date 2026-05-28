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
	return PolicySettings{
		PollInterval:      time.Hour,
		FailureBackoffOne: 2 * time.Hour,
		FailureBackoffTwo: 6 * time.Hour,
		FailureBackoffMax: 24 * time.Hour,
		PerSourceCap:      1000,
		GlobalCap:         30000,
	}
}

func LoadPolicySettings(app core.App) PolicySettings {
	defaults := DefaultPolicySettings()
	group, _ := sysconfig.GetGroup(app, SettingsModule, PolicySettingsKey, settingsschema.DefaultGroup(SettingsModule, PolicySettingsKey))
	settings := PolicySettings{
		PollInterval:      time.Duration(clampRange(sysconfig.Int(group, "pollIntervalMinutes", int(defaults.PollInterval/time.Minute)), 5, 1440, int(defaults.PollInterval/time.Minute))) * time.Minute,
		FailureBackoffOne: time.Duration(clampRange(sysconfig.Int(group, "failureBackoffOneHours", int(defaults.FailureBackoffOne/time.Hour)), 1, 168, int(defaults.FailureBackoffOne/time.Hour))) * time.Hour,
		FailureBackoffTwo: time.Duration(clampRange(sysconfig.Int(group, "failureBackoffTwoHours", int(defaults.FailureBackoffTwo/time.Hour)), 1, 168, int(defaults.FailureBackoffTwo/time.Hour))) * time.Hour,
		FailureBackoffMax: time.Duration(clampRange(sysconfig.Int(group, "failureBackoffMaxHours", int(defaults.FailureBackoffMax/time.Hour)), 1, 336, int(defaults.FailureBackoffMax/time.Hour))) * time.Hour,
		PerSourceCap:      clampRange(sysconfig.Int(group, "perSourceRetentionCap", defaults.PerSourceCap), 1, 100000, defaults.PerSourceCap),
		GlobalCap:         clampRange(sysconfig.Int(group, "globalRetentionCap", defaults.GlobalCap), 1, 500000, defaults.GlobalCap),
	}
	if settings.FailureBackoffTwo < settings.FailureBackoffOne {
		settings.FailureBackoffTwo = defaults.FailureBackoffTwo
	}
	if settings.FailureBackoffMax < settings.FailureBackoffTwo {
		settings.FailureBackoffMax = defaults.FailureBackoffMax
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