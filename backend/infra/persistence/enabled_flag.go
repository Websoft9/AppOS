package persistence

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

func recordEnabledValue(record *core.Record) bool {
	raw := record.Get("is_enabled")
	if raw == nil {
		return true
	}
	switch value := raw.(type) {
	case bool:
		return value
	case string:
		normalized := strings.TrimSpace(strings.ToLower(value))
		if normalized == "" {
			return true
		}
		return normalized != "false" && normalized != "0" && normalized != "no" && normalized != "off"
	case int:
		return value != 0
	case int64:
		return value != 0
	case float64:
		return value != 0
	default:
		return strings.TrimSpace(fmt.Sprint(value)) != ""
	}
}
