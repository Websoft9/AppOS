package filesvc

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/websoft9/appos/backend/infra/fileutil"
)

var (
	// ErrInvalidPath reports paths that violate the service boundary, including
	// non-allowlisted roots, traversal escapes, symlink escapes, and absolute
	// path input.
	ErrInvalidPath = errors.New("invalid path")
	// ErrNotFound reports a missing filesystem target after path validation.
	ErrNotFound = errors.New("not found")
	// ErrConflict reports an existing destination when overwrite is not allowed.
	ErrConflict = errors.New("conflict")
	// ErrReadOnly reports attempted mutations through a read-only service.
	ErrReadOnly = errors.New("read only")
	// ErrDirectoryRequired reports operations that expected a directory target.
	ErrDirectoryRequired = errors.New("directory required")
	// ErrFileRequired reports operations that expected a file target.
	ErrFileRequired = errors.New("file required")
	// ErrLimitExceeded reports streaming writes that exceed their configured limit.
	ErrLimitExceeded = errors.New("limit exceeded")
)

// Config defines one local filesystem service boundary.
type Config struct {
	Name         string
	BasePath     string
	AllowedRoots []string
	ReadOnly     bool
}

// Entry is the normalized file or directory metadata returned by LocalService.
type Entry struct {
	Name       string
	Path       string
	Root       string
	Kind       string
	Size       int64
	ModifiedAt time.Time
}

// LocalService exposes path-scoped filesystem operations under one trusted base.
type LocalService struct {
	name         string
	basePath     string
	allowedRoots []string
	readOnly     bool
}

// NewLocal creates a filesystem service bound to a trusted base path and root allowlist.
func NewLocal(cfg Config) (*LocalService, error) {
	basePath := filepath.Clean(strings.TrimSpace(cfg.BasePath))
	if basePath == "." || basePath == "" {
		return nil, errors.New("base path is required")
	}
	allowedRoots := normalizeRoots(cfg.AllowedRoots)
	if len(allowedRoots) == 0 {
		return nil, errors.New("at least one allowed root is required")
	}

	return &LocalService{
		name:         strings.TrimSpace(cfg.Name),
		basePath:     basePath,
		allowedRoots: allowedRoots,
		readOnly:     cfg.ReadOnly,
	}, nil
}

func (s *LocalService) Name() string {
	return s.name
}

func (s *LocalService) BasePath() string {
	return s.basePath
}

func (s *LocalService) AllowedRoots() []string {
	return append([]string(nil), s.allowedRoots...)
}

func (s *LocalService) Resolve(path string) (string, error) {
	abs, err := fileutil.ResolveSafePath(s.basePath, strings.TrimSpace(path), s.allowedRoots)
	if errors.Is(err, fileutil.ErrForbiddenPath) {
		return "", ErrInvalidPath
	}
	return abs, err
}

func (s *LocalService) Stat(path string) (Entry, error) {
	abs, err := s.Resolve(path)
	if err != nil {
		return Entry{}, err
	}

	info, err := os.Stat(abs)
	if err != nil {
		return Entry{}, normalizePathError(err)
	}
	return buildEntry(path, info), nil
}

func (s *LocalService) List(path string) ([]Entry, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return s.listRoots()
	}

	abs, err := s.Resolve(path)
	if err != nil {
		return nil, err
	}

	info, err := os.Stat(abs)
	if err != nil {
		return nil, normalizePathError(err)
	}
	if !info.IsDir() {
		return nil, ErrDirectoryRequired
	}

	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}

	sort.Slice(entries, func(i, j int) bool {
		di, dj := entries[i].IsDir(), entries[j].IsDir()
		if di != dj {
			return di
		}
		return entries[i].Name() < entries[j].Name()
	})

	result := make([]Entry, 0, len(entries))
	for _, de := range entries {
		info, err := de.Info()
		if err != nil {
			continue
		}
		childPath := de.Name()
		if path != "" {
			childPath = path + "/" + de.Name()
		}
		result = append(result, buildEntry(childPath, info))
	}
	return result, nil
}

func (s *LocalService) ReadFile(path string) ([]byte, Entry, error) {
	abs, err := s.Resolve(path)
	if err != nil {
		return nil, Entry{}, err
	}

	info, err := os.Stat(abs)
	if err != nil {
		return nil, Entry{}, normalizePathError(err)
	}
	if info.IsDir() {
		return nil, Entry{}, ErrFileRequired
	}

	data, err := os.ReadFile(abs)
	if err != nil {
		return nil, Entry{}, err
	}
	return data, buildEntry(path, info), nil
}

func (s *LocalService) WriteFile(path string, data []byte, overwrite bool) (Entry, error) {
	if s.readOnly {
		return Entry{}, ErrReadOnly
	}

	abs, err := s.Resolve(path)
	if err != nil {
		return Entry{}, err
	}
	if err := prepareDestination(abs, overwrite, false); err != nil {
		return Entry{}, err
	}

	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return Entry{}, err
	}
	if err := os.WriteFile(abs, data, 0o600); err != nil {
		return Entry{}, err
	}
	return s.Stat(path)
}

func (s *LocalService) WriteReader(path string, reader io.Reader, overwrite bool, maxBytes int64) (Entry, error) {
	// WriteReader is the streaming variant of WriteFile. It preserves the same
	// path safety and overwrite rules, and removes the target file if the copy
	// exceeds maxBytes or the final sync fails.
	if s.readOnly {
		return Entry{}, ErrReadOnly
	}

	abs, err := s.Resolve(path)
	if err != nil {
		return Entry{}, err
	}
	if err := prepareDestination(abs, overwrite, false); err != nil {
		return Entry{}, err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return Entry{}, err
	}

	out, err := os.OpenFile(abs, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return Entry{}, err
	}
	defer out.Close()

	source := reader
	limited := maxBytes >= 0
	if limited {
		source = io.LimitReader(reader, maxBytes+1)
	}

	written, err := io.Copy(out, source)
	if err != nil {
		os.Remove(abs) //nolint:errcheck
		return Entry{}, err
	}
	if limited && written > maxBytes {
		out.Close()
		os.Remove(abs) //nolint:errcheck
		return Entry{}, ErrLimitExceeded
	}
	if err := out.Sync(); err != nil {
		out.Close()
		os.Remove(abs) //nolint:errcheck
		return Entry{}, err
	}
	return s.Stat(path)
}

func (s *LocalService) Mkdir(path string) (Entry, error) {
	if s.readOnly {
		return Entry{}, ErrReadOnly
	}

	abs, err := s.Resolve(path)
	if err != nil {
		return Entry{}, err
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return Entry{}, err
	}
	return s.Stat(path)
}

func (s *LocalService) Delete(path string, recursive bool) error {
	if s.readOnly {
		return ErrReadOnly
	}

	abs, err := s.Resolve(path)
	if err != nil {
		return err
	}

	info, err := os.Stat(abs)
	if err != nil {
		return normalizePathError(err)
	}
	if info.IsDir() && recursive {
		return os.RemoveAll(abs)
	}
	if err := os.Remove(abs); err != nil {
		return normalizePathError(err)
	}
	return nil
}

func (s *LocalService) Move(fromPath, toPath string, overwrite bool) (Entry, error) {
	if s.readOnly {
		return Entry{}, ErrReadOnly
	}

	fromAbs, toAbs, err := s.resolvePair(fromPath, toPath)
	if err != nil {
		return Entry{}, err
	}
	info, err := os.Stat(fromAbs)
	if err != nil {
		return Entry{}, normalizePathError(err)
	}
	if err := prepareDestination(toAbs, overwrite, info.IsDir()); err != nil {
		return Entry{}, err
	}
	if err := os.MkdirAll(filepath.Dir(toAbs), 0o755); err != nil {
		return Entry{}, err
	}
	if err := os.Rename(fromAbs, toAbs); err != nil {
		return Entry{}, err
	}
	return s.Stat(toPath)
}

func (s *LocalService) Copy(fromPath, toPath string, overwrite bool) (Entry, error) {
	if s.readOnly {
		return Entry{}, ErrReadOnly
	}

	fromAbs, toAbs, err := s.resolvePair(fromPath, toPath)
	if err != nil {
		return Entry{}, err
	}

	info, err := os.Stat(fromAbs)
	if err != nil {
		return Entry{}, normalizePathError(err)
	}
	if err := prepareDestination(toAbs, overwrite, info.IsDir()); err != nil {
		return Entry{}, err
	}

	if info.IsDir() {
		err = fileutil.CopyDir(fromAbs, toAbs)
	} else {
		err = fileutil.CopyFile(fromAbs, toAbs)
	}
	if err != nil {
		return Entry{}, err
	}
	return s.Stat(toPath)
}

func CopyBetween(src *LocalService, fromPath string, dst *LocalService, toPath string, overwrite bool) (Entry, error) {
	// CopyBetween performs an explicit cross-service copy. Source and destination
	// each validate their own path boundary; the destination service owns
	// overwrite policy and type-safety checks.
	if src == nil || dst == nil {
		return Entry{}, errors.New("source and destination services are required")
	}
	if dst.readOnly {
		return Entry{}, ErrReadOnly
	}

	fromAbs, err := src.Resolve(fromPath)
	if err != nil {
		return Entry{}, err
	}
	toAbs, err := dst.Resolve(toPath)
	if err != nil {
		return Entry{}, err
	}

	info, err := os.Stat(fromAbs)
	if err != nil {
		return Entry{}, normalizePathError(err)
	}
	if err := prepareDestination(toAbs, overwrite, info.IsDir()); err != nil {
		return Entry{}, err
	}

	if info.IsDir() {
		err = fileutil.CopyDir(fromAbs, toAbs)
	} else {
		err = fileutil.CopyFile(fromAbs, toAbs)
	}
	if err != nil {
		return Entry{}, err
	}
	return dst.Stat(toPath)
}

func (s *LocalService) listRoots() ([]Entry, error) {
	result := make([]Entry, 0, len(s.allowedRoots))
	for _, root := range s.allowedRoots {
		abs := filepath.Join(s.basePath, filepath.FromSlash(root))
		info, err := os.Stat(abs)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		result = append(result, buildEntry(root, info))
	}
	return result, nil
}

func (s *LocalService) resolvePair(fromPath, toPath string) (string, string, error) {
	fromAbs, err := s.Resolve(fromPath)
	if err != nil {
		return "", "", err
	}
	toAbs, err := s.Resolve(toPath)
	if err != nil {
		return "", "", err
	}
	return fromAbs, toAbs, nil
}

func normalizeRoots(roots []string) []string {
	result := make([]string, 0, len(roots))
	seen := make(map[string]bool, len(roots))
	for _, root := range roots {
		token := strings.Trim(strings.TrimSpace(root), "/")
		if token == "" || strings.Contains(token, "\\") || strings.Contains(token, "/") {
			continue
		}
		if seen[token] {
			continue
		}
		seen[token] = true
		result = append(result, token)
	}
	sort.Strings(result)
	return result
}

func buildEntry(path string, info os.FileInfo) Entry {
	path = strings.Trim(strings.TrimSpace(path), "/")
	kind := "file"
	if info.IsDir() {
		kind = "directory"
	}
	root := path
	if idx := strings.Index(path, "/"); idx >= 0 {
		root = path[:idx]
	}
	return Entry{
		Name:       filepath.Base(path),
		Path:       path,
		Root:       root,
		Kind:       kind,
		Size:       info.Size(),
		ModifiedAt: info.ModTime().UTC(),
	}
}

func normalizePathError(err error) error {
	if err == nil {
		return nil
	}
	if os.IsNotExist(err) {
		return ErrNotFound
	}
	if errors.Is(err, syscall.ENOTEMPTY) {
		return ErrDirectoryRequired
	}
	return err
}

func prepareDestination(path string, overwrite bool, wantDir bool) error {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.IsDir() != wantDir {
		if wantDir {
			return ErrDirectoryRequired
		}
		return ErrFileRequired
	}
	if !overwrite {
		return ErrConflict
	}
	if info.IsDir() {
		return os.RemoveAll(path)
	}
	return os.Remove(path)
}
