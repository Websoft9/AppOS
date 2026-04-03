package space

import (
	"fmt"
	"slices"
	"strings"
)

// NormalizeExt normalises a file extension token to lowercase without leading dot.
// Handles the "python" alias for "py".
func NormalizeExt(v string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	v = strings.TrimPrefix(v, ".")
	if v == "python" {
		return "py"
	}
	return v
}

// NormalizeExts normalises a slice of extensions, deduplicating and dropping empties.
func NormalizeExts(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, v := range values {
		token := NormalizeExt(v)
		if token == "" || seen[token] {
			continue
		}
		seen[token] = true
		out = append(out, token)
	}
	return out
}

// ValidateExt checks whether ext is permitted by the quota allowlist/denylist.
// Returns a non-nil error with a user-facing message when the extension is blocked.
func ValidateExt(quota Quota, ext string) error {
	if len(quota.UploadAllowExts) > 0 {
		if !slices.Contains(quota.UploadAllowExts, ext) {
			return fmt.Errorf("file extension %q is not in upload allowlist", ext)
		}
	} else if slices.Contains(quota.UploadDenyExts, ext) {
		return fmt.Errorf("file extension %q is blocked by upload denylist", ext)
	}
	return nil
}

// ValidateItemCount returns an error when current >= max (and max > 0).
func ValidateItemCount(current, max int) error {
	if max > 0 && current >= max {
		return fmt.Errorf(
			"item limit reached (%d); delete some files or folders first", max,
		)
	}
	return nil
}

// IsReservedRootFolderName reports whether name is a system-reserved or
// dynamically disallowed root folder name.
func IsReservedRootFolderName(name string, extraDisallowed []string) bool {
	name = strings.ToLower(strings.TrimSpace(name))
	for _, reserved := range strings.Split(ReservedFolderNames, ",") {
		if name == strings.TrimSpace(reserved) {
			return true
		}
	}
	for _, d := range extraDisallowed {
		if strings.ToLower(strings.TrimSpace(d)) == name {
			return true
		}
	}
	return false
}
