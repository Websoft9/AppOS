package software

import (
	"net/url"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

func ApplyRuntimeBindings(app core.App, entry CatalogEntry) CatalogEntry {
	_ = app
	return entry
}

func NormalizeAppOSBaseURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	return strings.TrimRight(parsed.String(), "/")
}
