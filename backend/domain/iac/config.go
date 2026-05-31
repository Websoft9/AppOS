package iac

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingsschema "github.com/websoft9/appos/backend/domain/config/sysconfig/schema"
)

const (
	SettingsModule            = "files"
	SettingsKey               = "limits"
	DefaultMaxSizeMB          = 10
	DefaultMaxZipSizeMB       = 50
	DefaultExtensionBlacklist = ".exe,.dll,.so,.bin,.deb,.rpm,.apk,.msi,.dmg,.pkg"
)

var defaultLimits = settingsschema.DefaultGroup(SettingsModule, SettingsKey)

// Limits holds the effective upload and read constraints for the IaC workspace.
type Limits struct {
	MaxSizeMB          int64
	MaxZipSizeMB       int64
	ExtensionBlacklist string
}

// GetLimits loads the effective IaC file limits from settings with catalog fallbacks.
func GetLimits(app core.App) Limits {
	cfg, _ := sysconfig.GetGroup(app, SettingsModule, SettingsKey, defaultLimits)
	return Limits{
		MaxSizeMB:          int64(sysconfig.Int(cfg, "maxSizeMB", DefaultMaxSizeMB)),
		MaxZipSizeMB:       int64(sysconfig.Int(cfg, "maxZipSizeMB", DefaultMaxZipSizeMB)),
		ExtensionBlacklist: sysconfig.String(cfg, "extensionBlacklist", DefaultExtensionBlacklist),
	}
}
