package filesvc_test

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/websoft9/appos/backend/infra/filesvc"
)

func TestNewLocalRequiresBasePathAndRoots(t *testing.T) {
	if _, err := filesvc.NewLocal(filesvc.Config{}); err == nil {
		t.Fatal("expected missing config error")
	}

	_, err := filesvc.NewLocal(filesvc.Config{
		BasePath:     t.TempDir(),
		AllowedRoots: []string{"apps", "apps", "", "nested/root"},
	})
	if err != nil {
		t.Fatalf("expected normalized roots to succeed: %v", err)
	}
}

func TestLocalServiceListRootAndLifecycle(t *testing.T) {
	base := t.TempDir()
	mustMkdirAll(t, filepath.Join(base, "apps", "demo"))
	mustMkdirAll(t, filepath.Join(base, "templates"))
	mustWriteFile(t, filepath.Join(base, "apps", "demo", "docker-compose.yml"), []byte("services:\n"))

	svc := newService(t, base, false)

	rootEntries, err := svc.List("")
	if err != nil {
		t.Fatalf("List root: %v", err)
	}
	if len(rootEntries) != 2 {
		t.Fatalf("expected 2 visible roots, got %d", len(rootEntries))
	}
	if rootEntries[0].Path != "apps" || rootEntries[1].Path != "templates" {
		t.Fatalf("unexpected root entries: %#v", rootEntries)
	}

	entries, err := svc.List("apps/demo")
	if err != nil {
		t.Fatalf("List apps/demo: %v", err)
	}
	if len(entries) != 1 || entries[0].Path != "apps/demo/docker-compose.yml" {
		t.Fatalf("unexpected child entries: %#v", entries)
	}

	written, err := svc.WriteFile("apps/demo/.env", []byte("HELLO=world\n"), false)
	if err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	if written.Kind != "file" || written.Root != "apps" {
		t.Fatalf("unexpected written entry: %#v", written)
	}

	data, entry, err := svc.ReadFile("apps/demo/.env")
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(data) != "HELLO=world\n" || entry.Path != "apps/demo/.env" {
		t.Fatalf("unexpected read result: %q %#v", string(data), entry)
	}

	if _, err := svc.Move("apps/demo/.env", "templates/.env.example", false); err != nil {
		t.Fatalf("Move: %v", err)
	}
	if _, err := svc.Stat("templates/.env.example"); err != nil {
		t.Fatalf("Stat moved file: %v", err)
	}

	if _, err := svc.Copy("templates/.env.example", "apps/demo/.env", false); err != nil {
		t.Fatalf("Copy file: %v", err)
	}
	if _, err := svc.Stat("apps/demo/.env"); err != nil {
		t.Fatalf("Stat copied file: %v", err)
	}

	if _, err := svc.Mkdir("workflows/build"); !errors.Is(err, filesvc.ErrInvalidPath) {
		t.Fatalf("expected forbidden root error, got %v", err)
	}

	if err := svc.Delete("apps/demo/.env", false); err != nil {
		t.Fatalf("Delete file: %v", err)
	}
	if err := svc.Delete("apps/demo", true); err != nil {
		t.Fatalf("Delete dir recursively: %v", err)
	}
	if _, err := svc.Stat("apps/demo"); !errors.Is(err, filesvc.ErrNotFound) {
		t.Fatalf("expected not found after delete, got %v", err)
	}
}

func TestLocalServiceCopyDirectory(t *testing.T) {
	base := t.TempDir()
	mustWriteFile(t, filepath.Join(base, "apps", "demo", "sub", "a.txt"), []byte("a"))
	svc := newService(t, base, false)

	if _, err := svc.Copy("apps/demo", "templates/demo-copy", false); err != nil {
		t.Fatalf("Copy directory: %v", err)
	}

	data, _, err := svc.ReadFile("templates/demo-copy/sub/a.txt")
	if err != nil {
		t.Fatalf("Read copied file: %v", err)
	}
	if string(data) != "a" {
		t.Fatalf("unexpected copied content: %q", string(data))
	}
}

func TestCopyBetweenServices(t *testing.T) {
	srcBase := t.TempDir()
	dstBase := t.TempDir()
	mustWriteFile(t, filepath.Join(srcBase, "apps", "wordpress", "docker-compose.yml"), []byte("services:\n"))
	mustWriteFile(t, filepath.Join(srcBase, "apps", "wordpress", ".env"), []byte("APP=wordpress\n"))

	src, err := filesvc.NewLocal(filesvc.Config{
		Name:         "library",
		BasePath:     srcBase,
		AllowedRoots: []string{"apps"},
		ReadOnly:     true,
	})
	if err != nil {
		t.Fatalf("NewLocal source: %v", err)
	}
	dst, err := filesvc.NewLocal(filesvc.Config{
		Name:         "iac",
		BasePath:     dstBase,
		AllowedRoots: []string{"templates"},
		ReadOnly:     false,
	})
	if err != nil {
		t.Fatalf("NewLocal destination: %v", err)
	}

	entry, err := filesvc.CopyBetween(src, "apps/wordpress", dst, "templates/apps/wordpress", false)
	if err != nil {
		t.Fatalf("CopyBetween: %v", err)
	}
	if entry.Path != "templates/apps/wordpress" || entry.Kind != "directory" {
		t.Fatalf("unexpected copied entry: %#v", entry)
	}

	data, _, err := dst.ReadFile("templates/apps/wordpress/.env")
	if err != nil {
		t.Fatalf("Read copied file: %v", err)
	}
	if string(data) != "APP=wordpress\n" {
		t.Fatalf("unexpected copied content: %q", string(data))
	}

	if _, err := filesvc.CopyBetween(src, "apps/wordpress", dst, "templates/apps/wordpress", false); !errors.Is(err, filesvc.ErrConflict) {
		t.Fatalf("expected destination conflict, got %v", err)
	}

	readOnlyDst := newService(t, t.TempDir(), true)
	if _, err := filesvc.CopyBetween(src, "apps/wordpress", readOnlyDst, "apps/wordpress", false); !errors.Is(err, filesvc.ErrReadOnly) {
		t.Fatalf("expected read-only destination error, got %v", err)
	}
}

func TestLocalServiceRejectsForbiddenAndConflictingPaths(t *testing.T) {
	base := t.TempDir()
	mustWriteFile(t, filepath.Join(base, "apps", "demo", "a.txt"), []byte("a"))
	svc := newService(t, base, false)

	if _, _, err := svc.ReadFile("../etc/passwd"); !errors.Is(err, filesvc.ErrInvalidPath) {
		t.Fatalf("expected forbidden path error, got %v", err)
	}

	if _, err := svc.WriteFile("apps/demo/a.txt", []byte("b"), false); !errors.Is(err, filesvc.ErrConflict) {
		t.Fatalf("expected conflict, got %v", err)
	}

	if _, err := svc.List("apps/demo/a.txt"); !errors.Is(err, filesvc.ErrDirectoryRequired) {
		t.Fatalf("expected directory required, got %v", err)
	}

	if _, _, err := svc.ReadFile("apps/demo"); !errors.Is(err, filesvc.ErrFileRequired) {
		t.Fatalf("expected file required, got %v", err)
	}
}

func TestLocalServiceReadOnlyRejectsMutations(t *testing.T) {
	base := t.TempDir()
	mustWriteFile(t, filepath.Join(base, "apps", "demo", "a.txt"), []byte("a"))
	svc := newService(t, base, true)

	mutations := []func() error{
		func() error {
			_, err := svc.WriteFile("apps/demo/b.txt", []byte("b"), false)
			return err
		},
		func() error {
			_, err := svc.Mkdir("apps/demo/sub")
			return err
		},
		func() error {
			_, err := svc.Move("apps/demo/a.txt", "templates/a.txt", false)
			return err
		},
		func() error {
			_, err := svc.Copy("apps/demo/a.txt", "templates/a.txt", false)
			return err
		},
		func() error {
			return svc.Delete("apps/demo/a.txt", false)
		},
	}

	for i, mutate := range mutations {
		if err := mutate(); !errors.Is(err, filesvc.ErrReadOnly) {
			t.Fatalf("mutation %d expected read only, got %v", i, err)
		}
	}

	if _, _, err := svc.ReadFile("apps/demo/a.txt"); err != nil {
		t.Fatalf("read-only service should still read: %v", err)
	}
}

func TestLocalServiceWriteReader(t *testing.T) {
	base := t.TempDir()
	svc := newService(t, base, false)

	entry, err := svc.WriteReader("apps/demo/upload.txt", strings.NewReader("hello upload"), true, 64)
	if err != nil {
		t.Fatalf("WriteReader: %v", err)
	}
	if entry.Path != "apps/demo/upload.txt" || entry.Kind != "file" {
		t.Fatalf("unexpected entry: %#v", entry)
	}

	data, _, err := svc.ReadFile("apps/demo/upload.txt")
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(data) != "hello upload" {
		t.Fatalf("unexpected file content: %q", string(data))
	}
}

func TestLocalServiceWriteReaderRejectsOversize(t *testing.T) {
	base := t.TempDir()
	svc := newService(t, base, false)

	_, err := svc.WriteReader("apps/demo/too-large.txt", strings.NewReader("123456"), true, 5)
	if !errors.Is(err, filesvc.ErrLimitExceeded) {
		t.Fatalf("expected limit exceeded, got %v", err)
	}
	if _, err := svc.Stat("apps/demo/too-large.txt"); !errors.Is(err, filesvc.ErrNotFound) {
		t.Fatalf("expected uploaded file cleanup, got %v", err)
	}
}

func TestLocalServiceWriteReaderDoesNotDeleteDirectoryTarget(t *testing.T) {
	base := t.TempDir()
	mustMkdirAll(t, filepath.Join(base, "apps", "demo", "target-dir"))
	mustWriteFile(t, filepath.Join(base, "apps", "demo", "target-dir", "keep.txt"), []byte("keep"))
	svc := newService(t, base, false)

	_, err := svc.WriteReader("apps/demo/target-dir", strings.NewReader("hello"), true, 16)
	if !errors.Is(err, filesvc.ErrFileRequired) {
		t.Fatalf("expected file required, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(base, "apps", "demo", "target-dir", "keep.txt")); err != nil {
		t.Fatalf("expected existing directory to survive overwrite attempt: %v", err)
	}
}

func TestLocalServiceDeleteNonEmptyDirectoryRequiresRecursive(t *testing.T) {
	base := t.TempDir()
	mustWriteFile(t, filepath.Join(base, "apps", "demo", "keep.txt"), []byte("keep"))
	svc := newService(t, base, false)

	err := svc.Delete("apps/demo", false)
	if !errors.Is(err, filesvc.ErrDirectoryRequired) {
		t.Fatalf("expected directory required, got %v", err)
	}
	if _, statErr := svc.Stat("apps/demo/keep.txt"); statErr != nil {
		t.Fatalf("expected directory contents to remain after failed delete: %v", statErr)
	}
}

func TestLocalServiceCopyDoesNotDeleteFileWhenDirectoryExpected(t *testing.T) {
	base := t.TempDir()
	mustWriteFile(t, filepath.Join(base, "apps", "srcdir", "nested.txt"), []byte("nested"))
	mustWriteFile(t, filepath.Join(base, "templates", "dest.txt"), []byte("dest"))
	svc := newService(t, base, false)

	_, err := svc.Copy("apps/srcdir", "templates/dest.txt", true)
	if !errors.Is(err, filesvc.ErrDirectoryRequired) {
		t.Fatalf("expected directory required, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(base, "templates", "dest.txt")); err != nil {
		t.Fatalf("expected destination file to survive mismatch overwrite: %v", err)
	}
}

func newService(t *testing.T, base string, readOnly bool) *filesvc.LocalService {
	t.Helper()
	svc, err := filesvc.NewLocal(filesvc.Config{
		Name:         "test",
		BasePath:     base,
		AllowedRoots: []string{"apps", "templates"},
		ReadOnly:     readOnly,
	})
	if err != nil {
		t.Fatalf("NewLocal: %v", err)
	}
	return svc
}

func mustMkdirAll(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatalf("MkdirAll(%s): %v", path, err)
	}
}

func mustWriteFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll(%s): %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("WriteFile(%s): %v", path, err)
	}
}
