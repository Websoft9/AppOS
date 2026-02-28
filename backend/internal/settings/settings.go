// Package settings provides a centralized helper for reading and writing
// grouped configuration values stored in the app_settings PocketBase collection.
//
// Each row in app_settings represents one "group" identified by (module, key),
// e.g. ("files", "quota") or ("proxy", "network").  The value column holds a
// JSON blob containing all fields for that group.
//
// Design rules:
//   - GetGroup ALWAYS returns a non-nil map.  On any error (row missing, DB
//     failure, unmarshal error) it returns (fallback, err).  Callers that use
//       v, _ := GetGroup(...)
//     are therefore safe; they get the fallback map and can immediately read
//     typed values from it.
//   - SetGroup upserts a row: find-then-update or create-then-save.
//   - Int / String are typed field readers that operate on an already-loaded
//     group map and never panic.
package settings

import (
	"encoding/json"
	"fmt"
	"strings"
	"strconv"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// GetGroup loads the settings group identified by (module, key) from app_settings.
//
// On success it returns (parsed value map, nil).
// On any error — row not found, DB failure, JSON parse error — it returns
// (fallback, err).  The returned map is always non-nil so callers can safely
// use  v, _ := GetGroup(...)  without a nil check.
func GetGroup(app core.App, module, key string, fallback map[string]any) (map[string]any, error) {
	record, err := app.FindFirstRecordByFilter(
		"app_settings",
		"module = {:module} && key = {:key}",
		dbx.Params{"module": module, "key": key},
	)
	if err != nil {
		// Row not found or DB error — return fallback so caller always has a valid map.
		return fallback, fmt.Errorf("settings.GetGroup(%s/%s): %w", module, key, err)
	}

	rawValue := record.Get("value")
	if rawValue == nil {
		return fallback, fmt.Errorf("settings.GetGroup(%s/%s): value is nil", module, key)
	}

	// PocketBase stores JSON fields as json.RawMessage or map — normalise to string then unmarshal.
	var jsonBytes []byte
	switch v := rawValue.(type) {
	case []byte:
		jsonBytes = v
	case string:
		jsonBytes = []byte(v)
	case json.RawMessage:
		jsonBytes = []byte(v)
	default:
		// Attempt re-marshal for other types (e.g. map[string]any from PB internal parsing).
		jsonBytes, err = json.Marshal(v)
		if err != nil {
			return fallback, fmt.Errorf("settings.GetGroup(%s/%s): marshal raw value: %w", module, key, err)
		}
	}

	var result map[string]any
	if err := json.Unmarshal(jsonBytes, &result); err != nil {
		return fallback, fmt.Errorf("settings.GetGroup(%s/%s): unmarshal: %w", module, key, err)
	}
	if result == nil {
		return fallback, nil
	}
	return result, nil
}

// SetGroup upserts the settings group identified by (module, key).
//
// If a row with the given (module, key) already exists it is updated;
// otherwise a new row is created.  The value map is stored as JSON.
func SetGroup(app core.App, module, key string, value map[string]any) error {
	// Try to find existing record first.
	record, err := app.FindFirstRecordByFilter(
		"app_settings",
		"module = {:module} && key = {:key}",
		dbx.Params{"module": module, "key": key},
	)
	if err != nil {
		// Not found — create a new record.
		collection, colErr := app.FindCollectionByNameOrId("app_settings")
		if colErr != nil {
			return fmt.Errorf("settings.SetGroup(%s/%s): find collection: %w", module, key, colErr)
		}
		record = core.NewRecord(collection)
		record.Set("module", module)
		record.Set("key", key)
	}

	record.Set("value", value)
	if err := app.Save(record); err != nil {
		return fmt.Errorf("settings.SetGroup(%s/%s): save: %w", module, key, err)
	}
	return nil
}

// Int reads an integer field from an already-loaded group map.
//
// It handles float64 (JSON number default), int, int64, json.Number, and
// string numeric representations.  Returns fallback when the field is absent
// or unreadable.
func Int(group map[string]any, field string, fallback int) int {
	v, ok := group[field]
	if !ok || v == nil {
		return fallback
	}
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	case json.Number:
		i, err := n.Int64()
		if err != nil {
			return fallback
		}
		return int(i)
	case string:
		i, err := strconv.Atoi(n)
		if err != nil {
			return fallback
		}
		return i
	}
	return fallback
}

// String reads a string field from an already-loaded group map.
// Returns fallback when the field is absent or not a string.
func String(group map[string]any, field string, fallback string) string {
	v, ok := group[field]
	if !ok || v == nil {
		return fallback
	}
	s, ok := v.(string)
	if !ok {
		return fallback
	}
	return s
}

// StringSlice reads a string-array field from a loaded group map.
//
// Supported underlying shapes:
//   - []string
//   - []any (JSON-decoded arrays)
//   - comma-separated string (legacy/manual edits)
//
// Values are trimmed and empty entries are removed.
func StringSlice(group map[string]any, field string) []string {
	v, ok := group[field]
	if !ok || v == nil {
		return []string{}
	}
	switch raw := v.(type) {
	case []string:
		out := make([]string, 0, len(raw))
		for _, item := range raw {
			item = strings.TrimSpace(item)
			if item != "" {
				out = append(out, item)
			}
		}
		return out
	case []any:
		out := make([]string, 0, len(raw))
		for _, item := range raw {
			s, ok := item.(string)
			if !ok {
				continue
			}
			s = strings.TrimSpace(s)
			if s != "" {
				out = append(out, s)
			}
		}
		return out
	case string:
		parts := strings.Split(raw, ",")
		out := make([]string, 0, len(parts))
		for _, item := range parts {
			item = strings.TrimSpace(item)
			if item != "" {
				out = append(out, item)
			}
		}
		return out
	default:
		return []string{}
	}
}
