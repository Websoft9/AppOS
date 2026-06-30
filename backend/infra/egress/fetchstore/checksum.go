package fetchstore

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"hash"
	"io"
	"os"
)

func newSHA256Hasher() hash.Hash {
	return sha256.New()
}

func hashFileInto(path string, hasher hash.Hash) error {
	if hasher == nil {
		return fmt.Errorf("hasher is required")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = io.Copy(hasher, file)
	return err
}

func finalizeSHA256(hasher hash.Hash) string {
	if hasher == nil {
		return ""
	}
	return hex.EncodeToString(hasher.Sum(nil))
}
