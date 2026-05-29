package topics

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingsschema "github.com/websoft9/appos/backend/domain/config/sysconfig/schema"
)

func boolValue(cfg map[string]any, key string, fallback bool) bool {
	raw, ok := cfg[key]
	if !ok || raw == nil {
		return fallback
	}
	if value, ok := raw.(bool); ok {
		return value
	}
	if value, ok := raw.(string); ok {
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "true", "1", "yes", "on":
			return true
		case "false", "0", "no", "off":
			return false
		}
	}
	return fallback
}

// Settings identifiers for the topic domain.
const (
	SettingsModule           = "topic"
	SettingsKey              = "share"
	CommentPolicySettingsKey = "comment-policy"
	ImportPolicySettingsKey  = "import-policy"

	DefaultDescriptionImportKB = 2
	MinDescriptionImportKB     = 1
)

// defaultShareConfig is the code-level safety net when the DB row is missing.
// Canonical defaults also live in catalog.go under "topic/share".
var defaultShareConfig = settingsschema.DefaultGroup(SettingsModule, SettingsKey)

// ShareConfig holds effective share policy values loaded from sysconfig.
type ShareConfig struct {
	MaxMinutes     int
	DefaultMinutes int
}

// CommentPolicy holds effective guest-comment policy values loaded from sysconfig.
type CommentPolicy struct {
	AllowGuestComments bool
	DefaultGuestName   string
	MaxGuestNameLength int
	MaxCommentBodyLen  int
}

// ImportPolicy holds effective topic description import policy values loaded from sysconfig.
type ImportPolicy struct {
	MaxDescriptionImportKB int
	TextOnly               bool
}

func (p ImportPolicy) MaxDescriptionImportBytes() int {
	return p.MaxDescriptionImportKB * 1024
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

// GetCommentPolicy loads the effective guest comment policy configuration.
// Falls back to code-level defaults when the setting row is absent.
func GetCommentPolicy(app core.App) CommentPolicy {
	defaultCommentPolicy := settingsschema.DefaultGroup(SettingsModule, CommentPolicySettingsKey)
	cfg, _ := sysconfig.GetGroup(app, SettingsModule, CommentPolicySettingsKey, defaultCommentPolicy)
	defaultGuestName := sysconfig.String(cfg, "defaultGuestName", DefaultGuestName)
	if defaultGuestName == "" {
		defaultGuestName = DefaultGuestName
	}

	return CommentPolicy{
		AllowGuestComments: boolValue(cfg, "allowGuestComments", true),
		DefaultGuestName:   defaultGuestName,
		MaxGuestNameLength: sysconfig.Int(cfg, "maxGuestNameLength", MaxGuestNameLen),
		MaxCommentBodyLen:  sysconfig.Int(cfg, "maxCommentBodyLength", MaxCommentBodyLen),
	}
}

// GetImportPolicy loads the effective topic description import policy configuration.
// Falls back to code-level defaults when the setting row is absent.
func GetImportPolicy(app core.App) ImportPolicy {
	defaultImportPolicy := settingsschema.DefaultGroup(SettingsModule, ImportPolicySettingsKey)
	cfg, _ := sysconfig.GetGroup(app, SettingsModule, ImportPolicySettingsKey, defaultImportPolicy)
	maxDescriptionImportKB := sysconfig.Int(cfg, "maxDescriptionImportKB", 0)
	if maxDescriptionImportKB < MinDescriptionImportKB {
		legacyBytes := sysconfig.Int(cfg, "maxDescriptionImportBytes", 0)
		if legacyBytes >= 1024 {
			maxDescriptionImportKB = legacyBytes / 1024
			if legacyBytes%1024 != 0 {
				maxDescriptionImportKB++
			}
		}
	}
	if maxDescriptionImportKB < MinDescriptionImportKB {
		maxDescriptionImportKB = DefaultDescriptionImportKB
	}

	return ImportPolicy{
		MaxDescriptionImportKB: maxDescriptionImportKB,
		TextOnly:               boolValue(cfg, "textOnly", true),
	}
}
