package components

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

	appconfig "github.com/websoft9/appos/backend/config"
	"gopkg.in/yaml.v3"
)

type Probe struct {
	Type         string   `yaml:"type"`
	Command      []string `yaml:"command"`
	URL          string   `yaml:"url"`
	Path         string   `yaml:"path"`
	Value        string   `yaml:"value"`
	ExpectStatus int      `yaml:"expect_status"`
	ExpectOutput string   `yaml:"expect_output"`
	Success      bool     `yaml:"success"`
}

type LogAccess struct {
	Type          string `yaml:"type"`
	Service       string `yaml:"service"`
	StdoutPath    string `yaml:"stdout_path"`
	StderrPath    string `yaml:"stderr_path"`
	DefaultStream string `yaml:"default_stream"`
}

type Operations struct {
	Start   bool `yaml:"start"`
	Stop    bool `yaml:"stop"`
	Restart bool `yaml:"restart"`
}

type Component struct {
	ID                string     `yaml:"id"`
	Name              string     `yaml:"name"`
	Enabled           bool       `yaml:"enabled"`
	Criticality       string     `yaml:"criticality"`
	VersionProbe      Probe      `yaml:"version_probe"`
	AvailabilityProbe Probe      `yaml:"availability_probe"`
	UpdateProbe       Probe      `yaml:"update_probe"`
	LogAccess         LogAccess  `yaml:"log_access"`
	Operations        Operations `yaml:"operations"`
	Notes             string     `yaml:"notes"`
}

type Service struct {
	Name       string     `yaml:"name"`
	ComponentID string    `yaml:"component_id"`
	Enabled    bool       `yaml:"enabled"`
	LogAccess  LogAccess  `yaml:"log_access"`
	Operations Operations `yaml:"operations"`
}

type Registry struct {
	Version    int         `yaml:"version"`
	Components []Component `yaml:"components"`
	Services   []Service   `yaml:"services"`
}

var registryPathOverride string

func SetRegistryPathForTesting(path string) func() {
	previous := registryPathOverride
	registryPathOverride = path
	return func() {
		registryPathOverride = previous
	}
}

func LoadRegistry() (*Registry, error) {
	data, err := loadRegistryBytes()
	if err != nil {
		return nil, err
	}
	var reg Registry
	if err := yaml.Unmarshal(data, &reg); err != nil {
		return nil, fmt.Errorf("parse components registry: %w", err)
	}
	if err := reg.Validate(); err != nil {
		return nil, err
	}
	return &reg, nil
}

func (r *Registry) Validate() error {
	if r.Version <= 0 {
		return errors.New("components registry version must be >= 1")
	}
	seenComponents := map[string]struct{}{}
	for _, component := range r.Components {
		if strings.TrimSpace(component.ID) == "" {
			return errors.New("component id is required")
		}
		if strings.TrimSpace(component.Name) == "" {
			return fmt.Errorf("component %q missing name", component.ID)
		}
		if _, exists := seenComponents[component.ID]; exists {
			return fmt.Errorf("duplicate component id %q", component.ID)
		}
		seenComponents[component.ID] = struct{}{}
	}
	seenServices := map[string]struct{}{}
	for _, service := range r.Services {
		if strings.TrimSpace(service.Name) == "" {
			return errors.New("service name is required")
		}
		if _, exists := seenServices[service.Name]; exists {
			return fmt.Errorf("duplicate service name %q", service.Name)
		}
		seenServices[service.Name] = struct{}{}
	}
	return nil
}

func (r *Registry) EnabledComponents() []Component {
	items := make([]Component, 0, len(r.Components))
	for _, component := range r.Components {
		if component.Enabled {
			items = append(items, component)
		}
	}
	return items
}

func (r *Registry) EnabledServices() []Service {
	items := make([]Service, 0, len(r.Services))
	for _, service := range r.Services {
		if service.Enabled {
			items = append(items, service)
		}
	}
	return items
}

func (r *Registry) FindService(name string) (Service, bool) {
	for _, service := range r.Services {
		if service.Name == name && service.Enabled {
			return service, true
		}
	}
	return Service{}, false
}

func DetectVersion(probe Probe) (string, error) {
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

func CheckAvailability(probe Probe) (bool, error) {
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

func loadRegistryBytes() ([]byte, error) {
	if strings.TrimSpace(registryPathOverride) != "" {
		data, err := os.ReadFile(registryPathOverride)
		if err != nil {
			return nil, fmt.Errorf("read components registry: %w", err)
		}
		return data, nil
	}
	if len(appconfig.EmbeddedComponentsRegistry) == 0 {
		return nil, errors.New("embedded components registry is empty")
	}
	return appconfig.EmbeddedComponentsRegistry, nil
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

// DetectUpdateTime returns the last-modified time of a component file as RFC3339.
// Only supports probe type "file_mtime". Returns empty string if unsupported or detection fails.
func DetectUpdateTime(probe Probe) string {
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