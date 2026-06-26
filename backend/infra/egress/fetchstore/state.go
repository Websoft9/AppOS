package fetchstore

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

const stateVersion = 1

type downloadState struct {
	Version            int       `json:"version"`
	SourceURL          string    `json:"source_url"`
	SourceETag         string    `json:"source_etag,omitempty"`
	SourceLastModified string    `json:"source_last_modified,omitempty"`
	BytesCompleted     int64     `json:"bytes_completed"`
	BytesTotal         int64     `json:"bytes_total"`
	ExpectedSHA256     string    `json:"expected_sha256,omitempty"`
	ChunkSize          int64     `json:"chunk_size"`
	UpdatedAt          time.Time `json:"updated_at"`
}

func loadState(path string) (downloadState, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return downloadState{}, err
	}
	var state downloadState
	if err := json.Unmarshal(data, &state); err != nil {
		return downloadState{}, err
	}
	return state, nil
}

func saveState(path string, state downloadState) error {
	state.Version = stateVersion
	state.UpdatedAt = time.Now().UTC()
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	tempPath := path + ".tmp"
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(tempPath, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tempPath, path)
}