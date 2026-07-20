package assets

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type FileContent struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

func ensureRelativePath(rel string) (string, error) {
	rel = filepath.ToSlash(strings.TrimSpace(rel))
	if rel == "" {
		return "", fmt.Errorf("path is required")
	}
	if strings.HasPrefix(rel, "/") {
		return "", fmt.Errorf("path must be relative")
	}
	clean := filepath.Clean(filepath.FromSlash(rel))
	if clean == "." || clean == string(filepath.Separator) {
		return "", fmt.Errorf("path is required")
	}
	if strings.HasPrefix(clean, "..") || clean == ".." {
		return "", fmt.Errorf("path escapes asset storage")
	}
	return clean, nil
}

func resolveLocalPath(basePath, rel string) (string, error) {
	clean, err := ensureRelativePath(rel)
	if err != nil {
		return "", err
	}
	abs := filepath.Join(basePath, clean)
	if !strings.HasPrefix(abs, basePath+string(filepath.Separator)) && abs != basePath {
		return "", fmt.Errorf("path escapes asset storage")
	}
	return abs, nil
}

func WriteLocalFile(basePath, rel, content string) error {
	abs, err := resolveLocalPath(basePath, rel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	return os.WriteFile(abs, []byte(content), 0o600)
}

func WriteLocalFolder(basePath string, files map[string]string) error {
	if err := os.RemoveAll(basePath); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(basePath, 0o755); err != nil {
		return err
	}
	for rel, content := range files {
		if err := WriteLocalFile(basePath, rel, content); err != nil {
			return err
		}
	}
	return nil
}

func ReadLocalFile(basePath, rel string) (string, error) {
	abs, err := resolveLocalPath(basePath, rel)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func ReadLocalFolder(basePath string) ([]FileContent, error) {
	items := []FileContent{}
	if _, err := os.Stat(basePath); err != nil {
		return nil, err
	}
	err := filepath.WalkDir(basePath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(basePath, path)
		if err != nil {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		items = append(items, FileContent{Path: filepath.ToSlash(rel), Content: string(data)})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].Path < items[j].Path
	})
	return items, nil
}

func RemoveLocalStorage(basePath string) error {
	if err := os.RemoveAll(basePath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
