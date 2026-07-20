package iac

import (
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/websoft9/appos/backend/infra/filesvc"
)

// Service orchestrates IaC read-side use cases across the workspace and library boundaries.
type Service struct {
	workspace WorkspacePort
	library   LibraryPort
	crossCopy CrossCopyPort
}

// NewService creates the IaC read-side service.
func NewService(workspace WorkspacePort, library LibraryPort, crossCopy CrossCopyPort) *Service {
	return &Service{workspace: workspace, library: library, crossCopy: crossCopy}
}

// List returns a directory listing from the IaC workspace.
func (s *Service) List(path string) ([]Entry, error) {
	entries, err := s.workspace.List(path)
	if err != nil {
		return nil, translateFilesError(err)
	}
	return mapEntries(entries), nil
}

// ReadText returns text content from the IaC workspace under the given limits.
func (s *Service) ReadText(path string, limits Limits) (FileContent, error) {
	return readTextFromPort(s.workspace, path, limits)
}

// ListLibrary returns a directory listing from the IaC library source.
func (s *Service) ListLibrary(path string) ([]Entry, error) {
	entries, err := s.library.List(path)
	if err != nil {
		return nil, translateFilesError(err)
	}
	return mapEntries(entries), nil
}

// ReadLibraryText returns text content from the read-only IaC library under the given limits.
func (s *Service) ReadLibraryText(path string, limits Limits) (FileContent, error) {
	return readTextFromPort(s.library, path, limits)
}

// CreateDir creates an empty directory in the IaC workspace.
func (s *Service) CreateDir(path string) error {
	_, err := s.workspace.Mkdir(path)
	if err != nil {
		return translateFilesError(err)
	}
	return nil
}

// CreateFile creates a new file in the IaC workspace.
func (s *Service) CreateFile(path string, content string) error {
	_, err := s.workspace.WriteFile(path, []byte(content), false)
	if err != nil {
		return translateFilesError(err)
	}
	return nil
}

// UpdateFile overwrites an existing IaC workspace file.
func (s *Service) UpdateFile(path string, content string) error {
	_, err := s.workspace.WriteFile(path, []byte(content), true)
	if err != nil {
		return translateFilesError(err)
	}
	return nil
}

// Delete removes a file or directory from the IaC workspace.
func (s *Service) Delete(path string, recursive bool) error {
	if RootOf(path) == path {
		return ErrRootDeleteDenied
	}
	if err := s.workspace.Delete(path, recursive); err != nil {
		return translateFilesError(err)
	}
	return nil
}

// Move renames or relocates a workspace path within the same IaC root.
func (s *Service) Move(fromPath string, toPath string) error {
	if RootOf(fromPath) != RootOf(toPath) {
		return ErrCrossRootMoveDenied
	}
	_, err := s.workspace.Move(fromPath, toPath, false)
	if err != nil {
		return translateFilesError(err)
	}
	return nil
}

// Download resolves one workspace file for transport-layer attachment streaming.
func (s *Service) Download(path string) (DownloadFile, error) {
	entry, err := s.workspace.Stat(path)
	if err != nil {
		return DownloadFile{}, translateFilesError(err)
	}
	if entry.Kind == "directory" {
		return DownloadFile{}, ErrFileRequired
	}
	absPath, err := s.workspace.Resolve(path)
	if err != nil {
		return DownloadFile{}, translateFilesError(err)
	}
	return DownloadFile{
		Path:     path,
		AbsPath:  absPath,
		Filename: filepath.Base(absPath),
	}, nil
}

// Upload writes one uploaded file into the IaC workspace after applying IaC upload policy.
func (s *Service) Upload(dirPath string, filename string, reader io.Reader, sizeHint int64, limits Limits) (string, error) {
	if _, err := s.workspace.Resolve(dirPath); err != nil {
		return "", translateFilesError(err)
	}

	baseName := filepath.Base(filename)
	if baseName == "" || baseName == "." || baseName == ".." {
		return "", ErrInvalidFilename
	}

	ext := strings.ToLower(filepath.Ext(baseName))
	isZip := ext == AllowedArchive
	limitBytes := limits.MaxSizeMB * 1024 * 1024
	if isZip {
		limitBytes = limits.MaxZipSizeMB * 1024 * 1024
	}
	if sizeHint > 0 && sizeHint > limitBytes {
		return "", ErrLimitExceeded
	}
	if !isZip && extensionBlocked(ext, limits.ExtensionBlacklist) {
		return "", ErrExtensionBlocked
	}

	if _, err := s.workspace.Mkdir(dirPath); err != nil {
		return "", translateFilesError(err)
	}
	destPath := filepath.ToSlash(filepath.Join(dirPath, baseName))
	if _, err := s.workspace.WriteReader(destPath, reader, true, limitBytes); err != nil {
		return "", translateFilesError(err)
	}
	return destPath, nil
}

// ImportLibraryApp copies one library app template into the workspace templates root.
func (s *Service) ImportLibraryApp(sourceKey string, destKey string) (string, string, error) {
	srcRel := "apps/" + sourceKey
	srcEntry, err := s.library.Stat(srcRel)
	if err != nil {
		return "", "", translateFilesError(err)
	}
	if srcEntry.Kind != "directory" {
		return "", "", ErrNotFound
	}

	dstRel := "templates/apps/" + destKey
	if err := s.crossCopy.CopyLibraryToWorkspace(srcRel, dstRel, false); err != nil {
		return "", "", translateFilesError(err)
	}
	return srcRel, dstRel, nil
}

func readTextFromPort(port ReadPort, path string, limits Limits) (FileContent, error) {
	data, entry, err := port.ReadFile(path)
	if err != nil {
		return FileContent{}, translateFilesError(err)
	}

	maxRead := limits.MaxSizeMB * 1024 * 1024
	if entry.Size > maxRead {
		return FileContent{}, ErrLimitExceeded
	}

	mimeType := http.DetectContentType(data)
	if !IsTextMIME(mimeType) {
		return FileContent{}, ErrBinaryContent
	}

	return FileContent{
		Path:       path,
		Content:    string(data),
		Size:       entry.Size,
		ModifiedAt: entry.ModifiedAt,
	}, nil
}

func mapEntries(entries []filesvc.Entry) []Entry {
	result := make([]Entry, 0, len(entries))
	for _, entry := range entries {
		typ := "file"
		if entry.Kind == "directory" {
			typ = "dir"
		}
		result = append(result, Entry{
			Name:       entry.Name,
			Type:       typ,
			Size:       entry.Size,
			ModifiedAt: entry.ModifiedAt,
		})
	}
	return result
}

func translateFilesError(err error) error {
	switch {
	case errors.Is(err, filesvc.ErrInvalidPath):
		return ErrInvalidPath
	case errors.Is(err, filesvc.ErrNotFound):
		return ErrNotFound
	case errors.Is(err, filesvc.ErrDirectoryRequired):
		return ErrDirectoryRequired
	case errors.Is(err, filesvc.ErrFileRequired):
		return ErrFileRequired
	case errors.Is(err, filesvc.ErrConflict):
		return ErrConflict
	default:
		return err
	}
}

func extensionBlocked(ext string, blacklist string) bool {
	if ext == "" || blacklist == "" {
		return false
	}
	for _, blocked := range strings.Split(blacklist, ",") {
		if strings.TrimSpace(blocked) == ext {
			return true
		}
	}
	return false
}
