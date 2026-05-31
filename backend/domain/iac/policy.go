package iac

import (
	"path/filepath"
	"strings"
)

const (
	WorkspaceBasePath = "/appos/data"
	LibraryBasePath   = "/appos/library"
	AllowedArchive    = ".zip"
)

var workspaceRoots = []string{"apps", "workflows", "templates"}
var libraryRoots = []string{"apps"}

// WorkspaceRoots returns the allowed top-level roots for the IaC workspace.
func WorkspaceRoots() []string {
	return append([]string(nil), workspaceRoots...)
}

// LibraryRoots returns the allowed top-level roots for the IaC library source.
func LibraryRoots() []string {
	return append([]string(nil), libraryRoots...)
}

// IsTextMIME reports whether the MIME type is safe for editor-oriented text reads.
func IsTextMIME(mime string) bool {
	textPrefixes := []string{
		"text/",
		"application/json",
		"application/xml",
		"application/javascript",
	}
	for _, prefix := range textPrefixes {
		if strings.HasPrefix(mime, prefix) {
			return true
		}
	}
	return false
}

// RootOf returns the first path segment of a slash-separated relative path.
func RootOf(rel string) string {
	clean := filepath.ToSlash(filepath.Clean(rel))
	parts := strings.SplitN(clean, "/", 2)
	return parts[0]
}
