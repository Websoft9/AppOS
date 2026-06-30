package persistence

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

func recordDateTimeString(record *core.Record, key string) string {
	if record == nil {
		return ""
	}
	return strings.TrimSpace(record.GetDateTime(key).String())
}