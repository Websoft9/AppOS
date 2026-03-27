package secrets

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/settings"
	settingscatalog "github.com/websoft9/appos/backend/internal/settings/catalog"
)

const (
	EnvSecretKey            = "APPOS_SECRET_KEY"
	SettingsModule          = "secrets"
	PolicySettingsKey       = "policy"
	AccessModeUseOnly       = "use_only"
	AccessModeRevealOnce    = "reveal_once"
	AccessModeRevealAllowed = "reveal_allowed"
)

var (
	keyMu  sync.RWMutex
	keyRaw []byte
)

type Policy struct {
	RevealDisabled        bool   `json:"revealDisabled"`
	DefaultAccessMode     string `json:"defaultAccessMode"`
	ClipboardClearSeconds int    `json:"clipboardClearSeconds"`
}

func DefaultPolicy() Policy {
	return Policy{
		RevealDisabled:        false,
		DefaultAccessMode:     AccessModeUseOnly,
		ClipboardClearSeconds: 0,
	}
}

func (p Policy) ToMap() map[string]any {
	return map[string]any{
		"revealDisabled":        p.RevealDisabled,
		"defaultAccessMode":     p.DefaultAccessMode,
		"clipboardClearSeconds": p.ClipboardClearSeconds,
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

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func GetPolicy(app core.App) Policy {
	if app == nil {
		return DefaultPolicy()
	}
	policy, _ := settings.GetGroup(app, SettingsModule, PolicySettingsKey, settingscatalog.DefaultGroup(SettingsModule, PolicySettingsKey))
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

func LoadKeyFromEnv() error {
	raw := os.Getenv(EnvSecretKey)
	if raw == "" {
		return fmt.Errorf("%s is required", EnvSecretKey)
	}
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return fmt.Errorf("%s must be valid base64: %w", EnvSecretKey, err)
	}
	if len(decoded) != 32 {
		return fmt.Errorf("%s must decode to 32 bytes, got %d", EnvSecretKey, len(decoded))
	}

	keyMu.Lock()
	defer keyMu.Unlock()
	keyRaw = decoded
	return nil
}

func currentKey() ([]byte, error) {
	keyMu.RLock()
	defer keyMu.RUnlock()
	if len(keyRaw) != 32 {
		return nil, fmt.Errorf("secret key is not initialized")
	}
	out := make([]byte, len(keyRaw))
	copy(out, keyRaw)
	return out, nil
}

func resetKeyForTest() {
	keyMu.Lock()
	defer keyMu.Unlock()
	keyRaw = nil
}
