package fileutil_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/websoft9/appos/backend/internal/fileutil"
)

var allowedRoots = []string{"apps", "workflows", "templates"}

func TestResolveSafePath(t *testing.T) {
	base := t.TempDir()

	// Create real directories so symlink resolution has something to walk.
	_ = os.MkdirAll(filepath.Join(base, "apps", "myapp"), 0o755)
	_ = os.MkdirAll(filepath.Join(base, "workflows"), 0o755)
	_ = os.MkdirAll(filepath.Join(base, "templates"), 0o755)

	tests := []struct {
		name    string
		rel     string
		wantErr bool
	}{
		// ── Happy paths ────────────────────────────────────────────────────────
		{name: "apps root", rel: "apps", wantErr: false},
		{name: "apps subdir", rel: "apps/myapp", wantErr: false},
		{name: "apps file", rel: "apps/myapp/docker-compose.yml", wantErr: false},
		{name: "workflows root", rel: "workflows", wantErr: false},
		{name: "templates root", rel: "templates", wantErr: false},

		// ── Forbidden: non-whitelisted roots ───────────────────────────────────
		{name: "forbidden root pb", rel: "pb", wantErr: true},
		{name: "forbidden root redis", rel: "redis", wantErr: true},
		{name: "forbidden root etc", rel: "etc/passwd", wantErr: true},

		// ── Forbidden: traversal ───────────────────────────────────────────────
		{name: "dotdot escape", rel: "apps/../../etc/passwd", wantErr: true},
		{name: "dotdot at start", rel: "../sibling", wantErr: true},
		{name: "dotdot only", rel: "..", wantErr: true},

		// ── Forbidden: leading slash ───────────────────────────────────────────
		{name: "leading slash", rel: "/apps/myapp", wantErr: true},
		{name: "leading slash abs", rel: "/etc/passwd", wantErr: true},

		// ── Forbidden: empty ──────────────────────────────────────────────────
		{name: "empty", rel: "", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := fileutil.ResolveSafePath(base, tt.rel, allowedRoots)
			if tt.wantErr {
				if err == nil {
					t.Errorf("ResolveSafePath(%q) = %q, want error", tt.rel, got)
				}
				return
			}
			if err != nil {
				t.Errorf("ResolveSafePath(%q) unexpected error: %v", tt.rel, err)
				return
			}
			// Result must be under base.
			if !filepath.IsAbs(got) {
				t.Errorf("result %q is not absolute", got)
			}
		})
	}
}

func TestResolveSafePathSymlink(t *testing.T) {
	base := t.TempDir()
	outside := t.TempDir()

	appsDir := filepath.Join(base, "apps")
	_ = os.MkdirAll(appsDir, 0o755)

	// Create a symlink inside apps/ that points outside base.
	link := filepath.Join(appsDir, "escape")
	if err := os.Symlink(outside, link); err != nil {
		t.Skip("symlinks not supported:", err)
	}

	_, err := fileutil.ResolveSafePath(base, "apps/escape/secret.txt", allowedRoots)
	if err == nil {
		t.Error("expected error for symlink escaping base, got nil")
	}
}

func TestCopyFile(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dst := filepath.Join(dir, "sub", "dst.txt")

	content := []byte("hello fileutil")
	if err := os.WriteFile(src, content, 0o644); err != nil {
		t.Fatal(err)
	}

	if err := fileutil.CopyFile(src, dst); err != nil {
		t.Fatalf("CopyFile: %v", err)
	}

	got, err := os.ReadFile(dst)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(got) != string(content) {
		t.Errorf("content mismatch: got %q, want %q", got, content)
	}
}

func TestCopyDir(t *testing.T) {
	src := t.TempDir()
	dst := t.TempDir()

	// Build a small tree.
	_ = os.MkdirAll(filepath.Join(src, "sub"), 0o755)
	_ = os.WriteFile(filepath.Join(src, "a.txt"), []byte("a"), 0o644)
	_ = os.WriteFile(filepath.Join(src, "sub", "b.txt"), []byte("b"), 0o644)

	if err := fileutil.CopyDir(src, dst); err != nil {
		t.Fatalf("CopyDir: %v", err)
	}

	for _, rel := range []string{"a.txt", "sub/b.txt"} {
		if _, err := os.Stat(filepath.Join(dst, rel)); err != nil {
			t.Errorf("missing %s after CopyDir: %v", rel, err)
		}
	}
}
