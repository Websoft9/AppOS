package iac_test

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/websoft9/appos/backend/domain/iac"
	"github.com/websoft9/appos/backend/infra/filesvc"
)

func TestServiceCreateUpdateDeleteLifecycle(t *testing.T) {
	svc, workspace := newTestService(t)

	if err := svc.CreateDir("apps/demo"); err != nil {
		t.Fatalf("CreateDir: %v", err)
	}

	if err := svc.CreateFile("apps/demo/docker-compose.yml", "services:\n"); err != nil {
		t.Fatalf("CreateFile: %v", err)
	}

	data, _, err := workspace.ReadFile("apps/demo/docker-compose.yml")
	if err != nil {
		t.Fatalf("ReadFile after create: %v", err)
	}
	if string(data) != "services:\n" {
		t.Fatalf("unexpected created content: %q", string(data))
	}

	if err := svc.UpdateFile("apps/demo/docker-compose.yml", "services:\n  app:\n"); err != nil {
		t.Fatalf("UpdateFile: %v", err)
	}

	data, _, err = workspace.ReadFile("apps/demo/docker-compose.yml")
	if err != nil {
		t.Fatalf("ReadFile after update: %v", err)
	}
	if string(data) != "services:\n  app:\n" {
		t.Fatalf("unexpected updated content: %q", string(data))
	}

	if err := svc.Delete("apps/demo/docker-compose.yml", false); err != nil {
		t.Fatalf("Delete file: %v", err)
	}
	if _, _, err := workspace.ReadFile("apps/demo/docker-compose.yml"); !errors.Is(err, filesvc.ErrNotFound) {
		t.Fatalf("expected file removal, got %v", err)
	}

	if err := svc.Delete("apps/demo", true); err != nil {
		t.Fatalf("Delete directory: %v", err)
	}
	if _, err := workspace.Stat("apps/demo"); !errors.Is(err, filesvc.ErrNotFound) {
		t.Fatalf("expected directory removal, got %v", err)
	}
}

func TestServiceCreateAndDeleteErrorMapping(t *testing.T) {
	svc, workspace := newTestService(t)

	if err := svc.CreateDir("apps/demo"); err != nil {
		t.Fatalf("CreateDir: %v", err)
	}
	if err := svc.CreateFile("apps/demo/.env", "A=1\n"); err != nil {
		t.Fatalf("CreateFile: %v", err)
	}

	if err := svc.CreateFile("apps/demo/.env", "A=2\n"); !errors.Is(err, iac.ErrConflict) {
		t.Fatalf("expected ErrConflict, got %v", err)
	}

	if err := svc.Delete("apps/demo", false); !errors.Is(err, iac.ErrDirectoryRequired) {
		t.Fatalf("expected ErrDirectoryRequired, got %v", err)
	}

	if err := svc.Delete("apps", true); !errors.Is(err, iac.ErrRootDeleteDenied) {
		t.Fatalf("expected ErrRootDeleteDenied, got %v", err)
	}

	if _, err := workspace.Stat("apps/demo/.env"); err != nil {
		t.Fatalf("expected file to remain after failed delete: %v", err)
	}
}

func TestServiceMoveWithinRootAndRejectCrossRoot(t *testing.T) {
	svc, workspace := newTestService(t)

	if err := svc.CreateDir("apps/demo"); err != nil {
		t.Fatalf("CreateDir source: %v", err)
	}
	if err := svc.CreateDir("apps/dest"); err != nil {
		t.Fatalf("CreateDir destination: %v", err)
	}
	if err := svc.CreateFile("apps/demo/docker-compose.yml", "services:\n"); err != nil {
		t.Fatalf("CreateFile: %v", err)
	}

	if err := svc.Move("apps/demo/docker-compose.yml", "apps/dest/docker-compose.yml"); err != nil {
		t.Fatalf("Move within root: %v", err)
	}

	if _, _, err := workspace.ReadFile("apps/demo/docker-compose.yml"); !errors.Is(err, filesvc.ErrNotFound) {
		t.Fatalf("expected source removal after move, got %v", err)
	}
	data, _, err := workspace.ReadFile("apps/dest/docker-compose.yml")
	if err != nil {
		t.Fatalf("expected moved file at destination: %v", err)
	}
	if string(data) != "services:\n" {
		t.Fatalf("unexpected moved content: %q", string(data))
	}

	if err := svc.Move("apps/dest/docker-compose.yml", "templates/docker-compose.yml"); !errors.Is(err, iac.ErrCrossRootMoveDenied) {
		t.Fatalf("expected ErrCrossRootMoveDenied, got %v", err)
	}
	if _, _, err := workspace.ReadFile("apps/dest/docker-compose.yml"); err != nil {
		t.Fatalf("expected destination file to remain after rejected cross-root move: %v", err)
	}
}

func TestServiceImportLibraryApp(t *testing.T) {
	svc, workspace := newTestService(t)

	srcRel, dstRel, err := svc.ImportLibraryApp("wordpress", "my-wordpress")
	if err != nil {
		t.Fatalf("ImportLibraryApp: %v", err)
	}
	if srcRel != "apps/wordpress" || dstRel != "templates/apps/my-wordpress" {
		t.Fatalf("unexpected import paths: %q %q", srcRel, dstRel)
	}

	data, _, err := workspace.ReadFile("templates/apps/my-wordpress/docker-compose.yml")
	if err != nil {
		t.Fatalf("expected imported file: %v", err)
	}
	if string(data) != "services:\n" {
		t.Fatalf("unexpected imported content: %q", string(data))
	}
}

func TestServiceImportLibraryAppErrorMapping(t *testing.T) {
	svc, _ := newTestService(t)

	if _, _, err := svc.ImportLibraryApp("missing", "missing"); !errors.Is(err, iac.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for missing library app, got %v", err)
	}

	if _, _, err := svc.ImportLibraryApp("wordpress", "wordpress"); err != nil {
		t.Fatalf("initial import: %v", err)
	}
	if _, _, err := svc.ImportLibraryApp("wordpress", "wordpress"); !errors.Is(err, iac.ErrConflict) {
		t.Fatalf("expected ErrConflict for duplicate destination, got %v", err)
	}
}

func TestServiceDownloadResolvesFileAndRejectsDirectory(t *testing.T) {
	svc, workspace := newTestService(t)

	if err := svc.CreateDir("apps/demo"); err != nil {
		t.Fatalf("CreateDir: %v", err)
	}
	if err := svc.CreateFile("apps/demo/docker-compose.yml", "services:\n"); err != nil {
		t.Fatalf("CreateFile: %v", err)
	}

	file, err := svc.Download("apps/demo/docker-compose.yml")
	if err != nil {
		t.Fatalf("Download: %v", err)
	}
	if file.Path != "apps/demo/docker-compose.yml" {
		t.Fatalf("unexpected download path: %q", file.Path)
	}
	if file.Filename != "docker-compose.yml" {
		t.Fatalf("unexpected filename: %q", file.Filename)
	}
	resolved, resolveErr := workspace.Resolve("apps/demo/docker-compose.yml")
	if resolveErr != nil {
		t.Fatalf("Resolve expected file: %v", resolveErr)
	}
	if file.AbsPath != resolved {
		t.Fatalf("unexpected resolved path: %q", file.AbsPath)
	}

	if _, err := svc.Download("apps/demo"); !errors.Is(err, iac.ErrFileRequired) {
		t.Fatalf("expected ErrFileRequired for directory download, got %v", err)
	}
}

func TestServiceUploadAppliesPolicyAndWritesFile(t *testing.T) {
	svc, workspace := newTestService(t)

	destPath, err := svc.Upload("apps/demo", "compose.yml", strings.NewReader("services:\n"), int64(len("services:\n")), iac.Limits{
		MaxSizeMB:          1,
		MaxZipSizeMB:       2,
		ExtensionBlacklist: ".exe,.dll",
	})
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if destPath != "apps/demo/compose.yml" {
		t.Fatalf("unexpected destination path: %q", destPath)
	}

	data, _, readErr := workspace.ReadFile(destPath)
	if readErr != nil {
		t.Fatalf("ReadFile uploaded file: %v", readErr)
	}
	if string(data) != "services:\n" {
		t.Fatalf("unexpected uploaded content: %q", string(data))
	}
}

func TestServiceUploadRejectsBlockedExtensionAndOversize(t *testing.T) {
	svc, _ := newTestService(t)
	limits := iac.Limits{
		MaxSizeMB:          1,
		MaxZipSizeMB:       1,
		ExtensionBlacklist: ".exe,.dll",
	}

	if _, err := svc.Upload("apps/demo", "malware.exe", strings.NewReader("bin"), 3, limits); !errors.Is(err, iac.ErrExtensionBlocked) {
		t.Fatalf("expected ErrExtensionBlocked, got %v", err)
	}

	oversize := strings.Repeat("a", int((2*1024*1024)))
	if _, err := svc.Upload("apps/demo", "big.yml", strings.NewReader(oversize), int64(len(oversize)), limits); !errors.Is(err, iac.ErrLimitExceeded) {
		t.Fatalf("expected ErrLimitExceeded, got %v", err)
	}
}

func newTestService(t *testing.T) (*iac.Service, *filesvc.LocalService) {
	t.Helper()

	workspaceBase := t.TempDir()
	libraryBase := t.TempDir()
	mustWriteFile(t, filepath.Join(libraryBase, "apps", "wordpress", "docker-compose.yml"), []byte("services:\n"))

	workspace, err := filesvc.NewLocal(filesvc.Config{
		Name:         "iac-workspace",
		BasePath:     workspaceBase,
		AllowedRoots: iac.WorkspaceRoots(),
	})
	if err != nil {
		t.Fatalf("NewLocal workspace: %v", err)
	}

	library, err := filesvc.NewLocal(filesvc.Config{
		Name:         "iac-library",
		BasePath:     libraryBase,
		AllowedRoots: iac.LibraryRoots(),
		ReadOnly:     true,
	})
	if err != nil {
		t.Fatalf("NewLocal library: %v", err)
	}

	return iac.NewService(workspace, library, testCrossCopier{src: library, dst: workspace}), workspace
}

type testCrossCopier struct {
	src *filesvc.LocalService
	dst *filesvc.LocalService
}

func (c testCrossCopier) CopyLibraryToWorkspace(fromPath string, toPath string, overwrite bool) error {
	_, err := filesvc.CopyBetween(c.src, fromPath, c.dst, toPath, overwrite)
	return err
}

func mustWriteFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll %s: %v", path, err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("WriteFile %s: %v", path, err)
	}
}