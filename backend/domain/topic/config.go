package topic

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingscatalog "github.com/websoft9/appos/backend/domain/config/sysconfig/catalog"
)

// Settings identifiers for the topic domain.
const (
	SettingsModule = "topic"
	SettingsKey    = "share"
)

// defaultShareConfig is the code-level safety net when the DB row is missing.
// Canonical defaults also live in catalog.go under "topic/share".
var defaultShareConfig = settingscatalog.DefaultGroup(SettingsModule, SettingsKey)

// ShareConfig holds effective share policy values loaded from sysconfig.
type ShareConfig struct {
	MaxMinutes     int
	DefaultMinutes int
}

// GetShareConfig loads the effective topic share configuration.
// Falls back to hardcoded defaults if the setting row is absent.
func GetShareConfig(app core.App) ShareConfig {
	cfg, _ := sysconfig.GetGroup(app, SettingsModule, SettingsKey, defaultShareConfig)
	return ShareConfig{
		MaxMinutes:     sysconfig.Int(cfg, "shareMaxMinutes", 60),
		DefaultMinutes: sysconfig.Int(cfg, "shareDefaultMinutes", 30),
	}
}
