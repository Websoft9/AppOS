package space

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingscatalog "github.com/websoft9/appos/backend/domain/config/sysconfig/catalog"
)

const (
	SettingsModule = "space"
	SettingsKey    = "quota"
)

var defaultQuota = settingscatalog.DefaultGroup(SettingsModule, SettingsKey)

// Quota holds all effective quota values for the space domain.
type Quota struct {
	MaxSizeMB           int
	MaxPerUser          int
	MaxUploadFiles      int
	ShareMaxMinutes     int
	ShareDefaultMinutes int
	UploadAllowExts     []string
	UploadDenyExts      []string
	DisallowedFolderNames []string
}

// GetQuota loads the effective space quota configuration from sysconfig.
// Falls back to catalog defaults when the DB row is absent.
func GetQuota(app core.App) Quota {
	cfg, _ := sysconfig.GetGroup(app, SettingsModule, SettingsKey, defaultQuota)

	maxUploadFiles := sysconfig.Int(cfg, "maxUploadFiles", 50)
	if maxUploadFiles < 1 {
		maxUploadFiles = 50
	}
	if maxUploadFiles > 200 {
		maxUploadFiles = 200
	}

	disallowedFolders := sysconfig.StringSlice(cfg, "disallowedFolderNames")
	if disallowedFolders == nil {
		disallowedFolders = []string{}
	}

	return Quota{
		MaxSizeMB:             sysconfig.Int(cfg, "maxSizeMB", 10),
		MaxPerUser:            sysconfig.Int(cfg, "maxPerUser", 100),
		MaxUploadFiles:        maxUploadFiles,
		ShareMaxMinutes:       sysconfig.Int(cfg, "shareMaxMinutes", 60),
		ShareDefaultMinutes:   sysconfig.Int(cfg, "shareDefaultMinutes", 30),
		UploadAllowExts:       NormalizeExts(sysconfig.StringSlice(cfg, "uploadAllowExts")),
		UploadDenyExts:        NormalizeExts(sysconfig.StringSlice(cfg, "uploadDenyExts")),
		DisallowedFolderNames: disallowedFolders,
	}
}
