package media

import (
	"os"
	"path/filepath"

	"github.com/websoft9/appos/backend/infra/fileutil"
)

func ResolveStoragePath(rel string) (string, error) {
	return fileutil.ResolveSafePath(BaseContentPath, rel, []string{ScopePublic, ScopePrivate})
}

func WriteFile(rel string, data []byte) (string, error) {
	abs, err := ResolveStoragePath(rel)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(abs, data, 0o600); err != nil {
		return "", err
	}
	return abs, nil
}

func ReadFile(rel string) ([]byte, error) {
	abs, err := ResolveStoragePath(rel)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(abs)
}

func RemoveFile(rel string) error {
	abs, err := ResolveStoragePath(rel)
	if err != nil {
		return err
	}
	if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
