package inventory

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
)

func DetectVersion(app core.App, probe swcatalog.LocalInventoryProbe) (string, error) {
	if probe.Type == "sqlite_query" {
		return querySQLiteScalar(app, probe.Query)
	}
	switch probe.Type {
	case "static":
		if strings.TrimSpace(probe.Value) == "" {
			return "unknown", nil
		}
		return strings.TrimSpace(probe.Value), nil
	case "file":
		if strings.TrimSpace(probe.Path) == "" {
			return "unknown", errors.New("file version probe requires path")
		}
		data, err := os.ReadFile(filepath.Clean(probe.Path))
		if err != nil {
			return "unknown", err
		}
		return firstLine(string(data)), nil
	case "command":
		output, err := runCommandProbe(probe.Command)
		if err != nil {
			return "unknown", err
		}
		if output == "" {
			return "unknown", nil
		}
		return firstLine(output), nil
	default:
		return "unknown", fmt.Errorf("unsupported version probe type %q", probe.Type)
	}
}

func CheckAvailability(app core.App, probe swcatalog.LocalInventoryProbe) (bool, error) {
	if probe.Type == "sqlite_query" {
		value, err := querySQLiteScalar(app, probe.Query)
		if err != nil {
			return false, err
		}
		return strings.TrimSpace(value) != "", nil
	}
	switch probe.Type {
	case "static":
		return probe.Success, nil
	case "file_exists":
		if strings.TrimSpace(probe.Path) == "" {
			return false, errors.New("file_exists probe requires path")
		}
		_, err := os.Stat(filepath.Clean(probe.Path))
		if err != nil {
			if os.IsNotExist(err) {
				return false, nil
			}
			return false, err
		}
		return true, nil
	case "command":
		output, err := runCommandProbe(probe.Command)
		if err != nil {
			return false, nil
		}
		if probe.ExpectOutput != "" && !strings.Contains(output, probe.ExpectOutput) {
			return false, nil
		}
		return true, nil
	case "http":
		if strings.TrimSpace(probe.URL) == "" {
			return false, errors.New("http probe requires url")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, probe.URL, nil)
		if err != nil {
			return false, err
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return false, nil
		}
		defer resp.Body.Close()
		expected := probe.ExpectStatus
		if expected == 0 {
			expected = http.StatusOK
		}
		if resp.StatusCode != expected {
			return false, nil
		}
		if probe.ExpectOutput == "" {
			return true, nil
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
		if err != nil {
			return false, err
		}
		return strings.Contains(string(body), probe.ExpectOutput), nil
	default:
		return false, fmt.Errorf("unsupported availability probe type %q", probe.Type)
	}
}

func DetectUpdateTime(probe swcatalog.LocalInventoryProbe) string {
	if probe.Type != "file_mtime" {
		return ""
	}
	if strings.TrimSpace(probe.Path) == "" {
		return ""
	}
	info, err := os.Stat(filepath.Clean(probe.Path))
	if err != nil {
		return ""
	}
	return info.ModTime().UTC().Format(time.RFC3339)
}

func querySQLiteScalar(app core.App, query string) (string, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return "", errors.New("sqlite_query probe requires query")
	}

	var row struct {
		Version string `db:"version"`
	}
	if err := app.DB().NewQuery(query).One(&row); err != nil {
		return "", err
	}
	return strings.TrimSpace(fmt.Sprint(row.Version)), nil
}

func runCommandProbe(command []string) (string, error) {
	if len(command) == 0 || strings.TrimSpace(command[0]) == "" {
		return "", errors.New("command probe requires command")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, command[0], command[1:]...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

func firstLine(input string) string {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return "unknown"
	}
	parts := strings.Split(trimmed, "\n")
	return strings.TrimSpace(parts[0])
}