package secrets

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingscatalog "github.com/websoft9/appos/backend/domain/config/sysconfig/catalog"
)

const (
	SettingsModule    = "secrets"
	PolicySettingsKey = "policy"

	AccessModeUseOnly       = "use_only"
	AccessModeRevealOnce    = "reveal_once"
	AccessModeRevealAllowed = "reveal_allowed"
)

// Policy is a value object that governs secret reveal and access behaviour
// for the entire platform. It is stored in sysconfig and applied at runtime.
type Policy struct {
	RevealDisabled        bool   `json:"revealDisabled"`
	DefaultAccessMode     string `json:"defaultAccessMode"`
	ClipboardClearSeconds int    `json:"clipboardClearSeconds"`
	// MaxAgeDays is the maximum lifetime of a secret in days.
	// 0 means secrets never expire.
	MaxAgeDays int `json:"maxAgeDays"`
	// WarnBeforeExpiryDays controls how many days before expiry the UI shows a warning.
	// 0 means no warning is shown.
	WarnBeforeExpiryDays int `json:"warnBeforeExpiryDays"`
}

func DefaultPolicy() Policy {
	return Policy{
		RevealDisabled:        false,
		DefaultAccessMode:     AccessModeUseOnly,
		ClipboardClearSeconds: 0,
		MaxAgeDays:            0,
		WarnBeforeExpiryDays:  0,
	}
}

func (p Policy) ToMap() map[string]any {
	return map[string]any{
		"revealDisabled":        p.RevealDisabled,
		"defaultAccessMode":     p.DefaultAccessMode,
		"clipboardClearSeconds": p.ClipboardClearSeconds,
		"maxAgeDays":            p.MaxAgeDays,
		"warnBeforeExpiryDays":  p.WarnBeforeExpiryDays,
	}
}

func IsAllowedAccessMode(mode string) bool {
	switch strings.TrimSpace(mode) {
	case AccessModeUseOnly, AccessModeRevealOnce, AccessModeRevealAllowed:
		return true
	default:
		return false
	}
}

func NormalizeAccessMode(mode string) string {
	mode = strings.TrimSpace(mode)
	if !IsAllowedAccessMode(mode) {
		return AccessModeUseOnly
	}
	return mode
}

func NormalizePolicy(raw map[string]any) Policy {
	policy := DefaultPolicy()
	if raw == nil {
		return policy
	}

	if revealDisabled, ok := raw["revealDisabled"].(bool); ok {
		policy.RevealDisabled = revealDisabled
	}
	policy.DefaultAccessMode = NormalizeAccessMode(policyString(raw, "defaultAccessMode", AccessModeUseOnly))

	clipboardClearSeconds, err := parsePolicyIntWithDefault(raw["clipboardClearSeconds"], 0)
	if err != nil {
		clipboardClearSeconds = 0
	}
	if clipboardClearSeconds < 0 {
		clipboardClearSeconds = 0
	}
	policy.ClipboardClearSeconds = clipboardClearSeconds

	maxAgeDays, err := parsePolicyIntWithDefault(raw["maxAgeDays"], 0)
	if err != nil || maxAgeDays < 0 {
		maxAgeDays = 0
	}
	policy.MaxAgeDays = maxAgeDays

	warnBeforeExpiryDays, err := parsePolicyIntWithDefault(raw["warnBeforeExpiryDays"], 0)
	if err != nil || warnBeforeExpiryDays < 0 {
		warnBeforeExpiryDays = 0
	}
	policy.WarnBeforeExpiryDays = warnBeforeExpiryDays
	return policy
}

// ValidatePolicy checks the raw policy map for type/value errors.
// NOTE: This function mutates the input map — it normalises valid fields in-place
// (e.g. string integers → int, unknown access modes → default).
func ValidatePolicy(raw map[string]any) map[string]string {
	errors := map[string]string{}

	revealDisabled, ok := raw["revealDisabled"]
	if !ok || revealDisabled == nil {
		raw["revealDisabled"] = false
	} else if _, ok := revealDisabled.(bool); !ok {
		errors["revealDisabled"] = "must be a boolean"
	}

	defaultAccessModeRaw := policyString(raw, "defaultAccessMode", AccessModeUseOnly)
	defaultAccessMode := NormalizeAccessMode(defaultAccessModeRaw)
	if !IsAllowedAccessMode(defaultAccessModeRaw) {
		errors["defaultAccessMode"] = "must be one of use_only, reveal_once, reveal_allowed"
	}
	raw["defaultAccessMode"] = defaultAccessMode

	clipboardClearSeconds, err := parsePolicyIntWithDefault(raw["clipboardClearSeconds"], 0)
	if err != nil {
		errors["clipboardClearSeconds"] = "must be an integer"
	} else if clipboardClearSeconds < 0 {
		errors["clipboardClearSeconds"] = "must be >= 0"
	} else {
		raw["clipboardClearSeconds"] = clipboardClearSeconds
	}

	maxAgeDays, err := parsePolicyIntWithDefault(raw["maxAgeDays"], 0)
	if err != nil {
		errors["maxAgeDays"] = "must be an integer"
	} else if maxAgeDays < 0 {
		errors["maxAgeDays"] = "must be >= 0"
	} else {
		raw["maxAgeDays"] = maxAgeDays
	}

	warnBeforeExpiryDays, err := parsePolicyIntWithDefault(raw["warnBeforeExpiryDays"], 0)
	if err != nil {
		errors["warnBeforeExpiryDays"] = "must be an integer"
	} else if warnBeforeExpiryDays < 0 {
		errors["warnBeforeExpiryDays"] = "must be >= 0"
	} else {
		raw["warnBeforeExpiryDays"] = warnBeforeExpiryDays
	}

	if _, hasMaxErr := errors["maxAgeDays"]; !hasMaxErr {
		if _, hasWarnErr := errors["warnBeforeExpiryDays"]; !hasWarnErr {
			if maxAgeDays > 0 && warnBeforeExpiryDays >= maxAgeDays {
				errors["warnBeforeExpiryDays"] = "must be less than maxAgeDays"
			}
		}
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

// GetPolicy loads the current secret policy from sysconfig.
// Returns DefaultPolicy() when app is nil or when no policy has been configured.
func GetPolicy(app core.App) Policy {
	if app == nil {
		return DefaultPolicy()
	}
	policy, _ := sysconfig.GetGroup(app, SettingsModule, PolicySettingsKey, settingscatalog.DefaultGroup(SettingsModule, PolicySettingsKey))
	return NormalizePolicy(policy)
}

func policyString(raw map[string]any, key, defaultValue string) string {
	if raw == nil {
		return defaultValue
	}
	v, ok := raw[key]
	if !ok || v == nil {
		return defaultValue
	}
	s, ok := v.(string)
	if !ok {
		return defaultValue
	}
	return s
}

func parsePolicyIntWithDefault(raw any, defaultValue int) (int, error) {
	if raw == nil {
		return defaultValue, nil
	}

	switch n := raw.(type) {
	case float64:
		if math.Trunc(n) != n {
			return 0, fmt.Errorf("must be an integer")
		}
		return int(n), nil
	case int:
		return n, nil
	case int64:
		return int(n), nil
	case json.Number:
		i, err := n.Int64()
		if err != nil {
			return 0, fmt.Errorf("must be an integer")
		}
		return int(i), nil
	case string:
		s := strings.TrimSpace(n)
		if s == "" {
			return defaultValue, nil
		}
		i, err := strconv.Atoi(s)
		if err != nil {
			return 0, fmt.Errorf("must be an integer")
		}
		return i, nil
	default:
		return 0, fmt.Errorf("must be an integer")
	}
}
