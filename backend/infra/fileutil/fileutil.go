// Package fileutil provides filesystem helpers shared by the File API routes
// and the deploy flow. It has no HTTP dependencies.
package fileutil

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// ErrForbiddenPath is returned when a relative path escapes the base or
// references a non-whitelisted root.
var ErrForbiddenPath = errors.New("forbidden path")

// ResolveSafePath resolves rel (a slash-separated relative path) against base
// and returns the absolute path. It rejects:
//   - empty rel
//   - paths whose first segment is not in allowedRoots
//   - paths that escape base via ".." traversal or symlink
//
// rel must not have a leading slash.
func ResolveSafePath(base, rel string, allowedRoots []string) (string, error) {
	if rel == "" {
		return "", ErrForbiddenPath
	}
	if strings.HasPrefix(rel, "/") {
		return "", ErrForbiddenPath
	}

	// Check first path segment against whitelist.
	firstSeg := strings.SplitN(rel, "/", 2)[0]
	allowed := false
	for _, r := range allowedRoots {
		if firstSeg == r {
			allowed = true
			break
		}
	}
	if !allowed {
		return "", ErrForbiddenPath
	}

	// Build candidate absolute path using filepath.Join, which cleans ".." etc.
	abs := filepath.Join(base, filepath.FromSlash(rel))

	// Ensure the result still sits inside base.
	cleanBase := filepath.Clean(base)
	if !strings.HasPrefix(abs, cleanBase+string(os.PathSeparator)) && abs != cleanBase {
		return "", ErrForbiddenPath
	}

	// Resolve symlinks to defeat symlink-escape attacks.
	// If abs does not yet exist, walk up until we find an existing ancestor.
	resolved, err := resolveExisting(abs, cleanBase)
	if err != nil {
		return "", ErrForbiddenPath
	}
	if !strings.HasPrefix(resolved, cleanBase+string(os.PathSeparator)) && resolved != cleanBase {
		return "", ErrForbiddenPath
	}

	return abs, nil
}

// resolveExisting walks up the path until it finds an existing ancestor, then
// evaluates symlinks on that ancestor. Returns the real path of the deepest
// existing component.
func resolveExisting(abs, base string) (string, error) {
	cur := abs
	for {
		_, err := os.Lstat(cur)
		if err == nil {
			// Path exists — resolve symlinks.
			resolved, err := filepath.EvalSymlinks(cur)
			if err != nil {
				return "", err
			}
			return resolved, nil
		}
		parent := filepath.Dir(cur)
		if parent == cur || !strings.HasPrefix(parent, base) {
			// Reached fs root or left base — just return base as safe anchor.
			return base, nil
		}
		cur = parent
	}
}

// CopyFile copies src to dst, creating dst if it does not exist and
// overwriting it if it does. Intermediate directories are created as needed.
func CopyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}

	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

// CopyDir recursively copies the directory tree rooted at src into dst.
// dst is created if it does not exist.
func CopyDir(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)

		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		return CopyFile(path, target)
	})
}
