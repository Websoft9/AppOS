package routes

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/secrets"
	settingscatalog "github.com/websoft9/appos/backend/internal/settings/catalog"
	"github.com/websoft9/appos/backend/internal/tunnel"
)

// sensitiveFields is the set of field names that are masked on GET and
// whose "***" placeholder is preserved on PATCH.
// Derived from catalog Sensitive flags; apiKey is added manually because
// it appears inside object-list items not modeled in the field schema.
var sensitiveFields = buildSensitiveFieldSet()

func buildSensitiveFieldSet() map[string]bool {
	m := map[string]bool{}
	for _, entry := range settingscatalog.Entries() {
		for _, f := range entry.Fields {
			if f.Sensitive {
				m[f.ID] = true
			}
		}
	}
	m["apiKey"] = true
	return m
}

const defaultTunnelSSHPort = 2222

var iacDefaultBlacklist = settingscatalog.DefaultGroup("files", "limits")["extensionBlacklist"]

// ─── Validation functions ──────────────────────────────────────────────────

func validateSpaceQuota(v map[string]any) map[string]string {
	errors := map[string]string{}

	maxSizeMB, err := parseIntWithDefault(v["maxSizeMB"], 10)
	if err != nil {
		errors["maxSizeMB"] = "must be an integer"
	} else if maxSizeMB < 1 {
		errors["maxSizeMB"] = "must be >= 1"
	} else {
		v["maxSizeMB"] = maxSizeMB
	}

	maxPerUser, err := parseIntWithDefault(v["maxPerUser"], 100)
	if err != nil {
		errors["maxPerUser"] = "must be an integer"
	} else if maxPerUser < 1 {
		errors["maxPerUser"] = "must be >= 1"
	} else {
		v["maxPerUser"] = maxPerUser
	}

	maxUploadFiles, err := parseIntWithDefault(v["maxUploadFiles"], 50)
	if err != nil {
		errors["maxUploadFiles"] = "must be an integer"
	} else if maxUploadFiles < 1 || maxUploadFiles > 200 {
		errors["maxUploadFiles"] = "must be between 1 and 200"
	} else {
		v["maxUploadFiles"] = maxUploadFiles
	}

	shareMaxMinutes, err := parseIntWithDefault(v["shareMaxMinutes"], 60)
	if err != nil {
		errors["shareMaxMinutes"] = "must be an integer"
	} else if shareMaxMinutes < 1 {
		errors["shareMaxMinutes"] = "must be >= 1"
	} else {
		v["shareMaxMinutes"] = shareMaxMinutes
	}

	shareDefaultMinutes, err := parseIntWithDefault(v["shareDefaultMinutes"], 30)
	if err != nil {
		errors["shareDefaultMinutes"] = "must be an integer"
	} else if shareDefaultMinutes < 1 {
		errors["shareDefaultMinutes"] = "must be >= 1"
	} else {
		v["shareDefaultMinutes"] = shareDefaultMinutes
	}

	if len(errors) == 0 && shareDefaultMinutes > shareMaxMinutes {
		errors["shareDefaultMinutes"] = "must be <= shareMaxMinutes"
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func parseIntWithDefault(raw any, defaultValue int) (int, error) {
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

func validateConnectTerminal(v map[string]any) map[string]string {
	errors := map[string]string{}

	idleTimeoutSeconds, err := parseIntWithDefault(v["idleTimeoutSeconds"], 1800)
	if err != nil {
		errors["idleTimeoutSeconds"] = "must be an integer"
	} else if idleTimeoutSeconds < 60 {
		errors["idleTimeoutSeconds"] = "must be >= 60"
	} else {
		v["idleTimeoutSeconds"] = idleTimeoutSeconds
	}

	maxConnections, err := parseIntWithDefault(v["maxConnections"], 0)
	if err != nil {
		errors["maxConnections"] = "must be an integer"
	} else if maxConnections < 0 {
		errors["maxConnections"] = "must be >= 0"
	} else {
		v["maxConnections"] = maxConnections
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateTunnelPortRange(v map[string]any) map[string]string {
	errors := map[string]string{}

	start, err := parseIntWithDefault(v["start"], tunnel.DefaultPortRangeStart)
	if err != nil {
		errors["start"] = "must be an integer"
	} else if start < 1 || start > 65535 {
		errors["start"] = "must be between 1 and 65535"
	} else {
		v["start"] = start
	}

	end, err := parseIntWithDefault(v["end"], tunnel.DefaultPortRangeEnd)
	if err != nil {
		errors["end"] = "must be an integer"
	} else if end < 1 || end > 65535 {
		errors["end"] = "must be between 1 and 65535"
	} else {
		v["end"] = end
	}

	if len(errors) == 0 {
		if start >= end {
			errors["end"] = "must be greater than start"
		}
		if start <= defaultTunnelSSHPort && defaultTunnelSSHPort <= end {
			errors["start"] = "range must not include tunnel SSH port 2222"
			errors["end"] = "range must not include tunnel SSH port 2222"
		}
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateDeployPreflight(v map[string]any) map[string]string {
	errors := map[string]string{}

	minFreeDiskBytes, err := parseIntWithDefault(v["minFreeDiskBytes"], 512*1024*1024)
	if err != nil {
		errors["minFreeDiskBytes"] = "must be an integer"
	} else if minFreeDiskBytes < 0 {
		errors["minFreeDiskBytes"] = "must be >= 0"
	} else if minFreeDiskBytes > 1_099_511_627_776 {
		errors["minFreeDiskBytes"] = "must be <= 1099511627776"
	} else {
		v["minFreeDiskBytes"] = minFreeDiskBytes
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateIacFiles(v map[string]any) map[string]string {
	errors := map[string]string{}

	maxSizeMB, err := parseIntWithDefault(v["maxSizeMB"], 10)
	if err != nil {
		errors["maxSizeMB"] = "must be an integer"
	} else if maxSizeMB < 1 {
		errors["maxSizeMB"] = "must be >= 1"
	} else {
		v["maxSizeMB"] = maxSizeMB
	}

	maxZipSizeMB, err := parseIntWithDefault(v["maxZipSizeMB"], 50)
	if err != nil {
		errors["maxZipSizeMB"] = "must be an integer"
	} else if maxZipSizeMB < 1 {
		errors["maxZipSizeMB"] = "must be >= 1"
	} else {
		v["maxZipSizeMB"] = maxZipSizeMB
	}

	if len(errors) == 0 && maxZipSizeMB < maxSizeMB {
		errors["maxZipSizeMB"] = "must be >= maxSizeMB"
	}

	if raw, ok := v["extensionBlacklist"]; !ok || raw == nil {
		v["extensionBlacklist"] = iacDefaultBlacklist
	} else if text, ok := raw.(string); ok {
		v["extensionBlacklist"] = strings.TrimSpace(text)
	} else {
		errors["extensionBlacklist"] = "must be a string"
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateConnectSftp(v map[string]any) map[string]string {
	errors := map[string]string{}

	maxUploadFiles, err := parseIntWithDefault(v["maxUploadFiles"], 10)
	if err != nil {
		errors["maxUploadFiles"] = "must be an integer"
	} else if maxUploadFiles < 1 {
		errors["maxUploadFiles"] = "must be >= 1"
	} else {
		v["maxUploadFiles"] = maxUploadFiles
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

// ─── Defaults ──────────────────────────────────────────────────────────────

// fallbackForKey returns the code-level fallback for a given (module, key) pair.
func fallbackForKey(module, key string) map[string]any {
	fallback := settingscatalog.DefaultGroup(module, key)
	if len(fallback) != 0 {
		return fallback
	}
	return map[string]any{}
}

// ─── Mask helpers ──────────────────────────────────────────────────────────

// maskValue masks sensitive string fields in a group value map.
// It also walks an "items" array (if present) and masks sensitive fields in each item.
// Exception: secretRef pointer values (prefixed "secretRef:") are returned as-is so
// the UI can distinguish a bound secret reference from a masked plaintext value.
func maskValue(v map[string]any) map[string]any {
	out := make(map[string]any, len(v))
	for k, val := range v {
		if k == "items" {
			out[k] = maskItems(val)
		} else if sensitiveFields[k] {
			if s, ok := val.(string); ok && s != "" {
				if secrets.IsSecretRef(s) {
					// Preserve secretRef pointer — not sensitive; needed by UI.
					out[k] = s
				} else {
					out[k] = "***"
				}
			} else {
				out[k] = val
			}
		} else {
			out[k] = val
		}
	}
	return out
}

// maskItems masks sensitive fields inside each element of an items array.
func maskItems(raw any) any {
	arr, ok := raw.([]any)
	if !ok {
		return raw
	}
	out := make([]any, len(arr))
	for i, item := range arr {
		if m, ok := item.(map[string]any); ok {
			out[i] = maskValue(m)
		} else {
			out[i] = item
		}
	}
	return out
}

// ─── Preserve-"***" helpers ────────────────────────────────────────────────

// preserveSensitive overwrites "***" placeholder values in incoming with the
// corresponding stored values from existing.
// Returns the merged map (modifies incoming in-place and returns it).
func preserveSensitive(incoming, existing map[string]any) map[string]any {
	if incoming == nil {
		return incoming
	}
	for k, v := range incoming {
		if k == "items" {
			incoming[k] = preserveItemsSensitive(v, existing["items"])
		} else if sensitiveFields[k] {
			if s, ok := v.(string); ok && s == "***" {
				// Keep existing value (may itself be "***" if never set — acceptable).
				if ev, ok := existing[k]; ok {
					incoming[k] = ev
				}
			}
		}
	}
	return incoming
}

// preserveItemsSensitive merges "***" sentinels in incoming items array with
// stored values from existing items array.
//
// Matching strategy: for each incoming item, first try to find an existing item
// whose non-sensitive fields all match (handles delete/reorder). Falls back to
// positional matching when no field-based match is found.
func preserveItemsSensitive(rawIncoming, rawExisting any) any {
	inArr, ok := rawIncoming.([]any)
	if !ok {
		return rawIncoming
	}
	exArr, _ := rawExisting.([]any)
	out := make([]any, len(inArr))
	for i, item := range inArr {
		inItem, ok := item.(map[string]any)
		if !ok {
			out[i] = item
			continue
		}
		exItem := findMatchingItem(inItem, exArr, i)
		out[i] = preserveSensitive(inItem, exItem)
	}
	return out
}

// findMatchingItem finds the best existing item to resolve "***" placeholders.
// Prefers a match by non-sensitive fields; falls back to positional index.
func findMatchingItem(incoming map[string]any, exArr []any, posHint int) map[string]any {
	for _, ex := range exArr {
		exItem, ok := ex.(map[string]any)
		if !ok {
			continue
		}
		if nonSensitiveFieldsMatch(incoming, exItem) {
			return exItem
		}
	}
	if posHint < len(exArr) {
		if exItem, ok := exArr[posHint].(map[string]any); ok {
			return exItem
		}
	}
	return map[string]any{}
}

// nonSensitiveFieldsMatch returns true when every non-sensitive field in
// incoming matches the corresponding field in existing.
func nonSensitiveFieldsMatch(incoming, existing map[string]any) bool {
	matched := 0
	for k, v := range incoming {
		if sensitiveFields[k] || k == "items" {
			continue
		}
		ev, ok := existing[k]
		if !ok || fmt.Sprint(v) != fmt.Sprint(ev) {
			return false
		}
		matched++
	}
	return matched > 0
}

// ─── Secret-ref validation ─────────────────────────────────────────────────

// validateLLMProvidersSecretRefs checks any provider item whose apiKey is a
// secretRef pointer. Returns an error if the referenced secret is missing,
// revoked, or the caller lacks access.
func validateLLMProvidersSecretRefs(e *core.RequestEvent, v map[string]any) error {
	userID := ""
	if e.Auth != nil {
		userID = e.Auth.Id
	}
	items, _ := v["items"].([]any)
	for i, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		apiKey, _ := m["apiKey"].(string)
		if id, ok := secrets.ExtractSecretID(apiKey); ok {
			if err := secrets.ValidateRef(e.App, id, userID); err != nil {
				return fmt.Errorf("provider[%d].apiKey secretRef invalid: %v", i, err)
			}
		}
	}
	return nil
}
