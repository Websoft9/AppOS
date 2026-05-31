package catalog

import (
	_ "embed"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/websoft9/appos/backend/domain/software"
	"gopkg.in/yaml.v3"
)

//go:embed components_local.yaml
var embeddedLocalRegistry []byte

type LocalInventoryProbe struct {
	Type         string   `yaml:"type"`
	Command      []string `yaml:"command"`
	Query        string   `yaml:"query"`
	URL          string   `yaml:"url"`
	Path         string   `yaml:"path"`
	Value        string   `yaml:"value"`
	ExpectStatus int      `yaml:"expect_status"`
	ExpectOutput string   `yaml:"expect_output"`
	Success      bool     `yaml:"success"`
}

type ServiceLogAccess struct {
	Type          string `yaml:"type"`
	Service       string `yaml:"service"`
	StdoutPath    string `yaml:"stdout_path"`
	StderrPath    string `yaml:"stderr_path"`
	DefaultStream string `yaml:"default_stream"`
}

type ServiceOperations struct {
	Start   bool `yaml:"start"`
	Stop    bool `yaml:"stop"`
	Restart bool `yaml:"restart"`
}

type LocalComponent struct {
	ID                string                          `yaml:"id"`
	Name              string                          `yaml:"name"`
	Enabled           bool                            `yaml:"enabled"`
	Criticality       string                          `yaml:"criticality"`
	RuntimeKind       string                          `yaml:"runtime_kind"`
	Role              string                          `yaml:"role"`
	OwnedCapability   string                          `yaml:"owned_capability"`
	SoftwareCatalog   *LocalSoftwareCatalogProjection `yaml:"software_catalog"`
	VersionProbe      LocalInventoryProbe             `yaml:"version_probe"`
	AvailabilityProbe LocalInventoryProbe             `yaml:"availability_probe"`
	UpdateProbe       LocalInventoryProbe             `yaml:"update_probe"`
	LogAccess         ServiceLogAccess                `yaml:"log_access"`
	Operations        ServiceOperations               `yaml:"operations"`
	Notes             string                          `yaml:"notes"`
}

type LocalSoftwareCatalogProjection struct {
	ComponentKey          software.ComponentKey `yaml:"component_key"`
	Label                 string                `yaml:"label"`
	Capability            software.Capability   `yaml:"capability"`
	ArtifactKind          software.ArtifactKind `yaml:"artifact_kind"`
	Binary                string                `yaml:"binary"`
	Description           string                `yaml:"description"`
	ReadinessRequirements []string              `yaml:"readiness_requirements"`
}

type LocalService struct {
	Name        string            `yaml:"name"`
	ComponentID string            `yaml:"component_id"`
	Enabled     bool              `yaml:"enabled"`
	Manager     string            `yaml:"manager"`
	Program     string            `yaml:"program"`
	DeclaredIn  string            `yaml:"declared_in"`
	Role        string            `yaml:"role"`
	Lifecycle   string            `yaml:"lifecycle"`
	Visibility  string            `yaml:"visibility"`
	LogAccess   ServiceLogAccess  `yaml:"log_access"`
	Operations  ServiceOperations `yaml:"operations"`
}

type LocalRegistry struct {
	Version    int              `yaml:"version"`
	Components []LocalComponent `yaml:"components"`
	Services   []LocalService   `yaml:"services"`
}

var localRegistryPathOverride string

func SetLocalRegistryPathForTesting(path string) func() {
	previous := localRegistryPathOverride
	localRegistryPathOverride = path
	return func() {
		localRegistryPathOverride = previous
	}
}

func LoadLocalRegistry() (*LocalRegistry, error) {
	data, err := loadLocalRegistryBytes()
	if err != nil {
		return nil, err
	}
	var reg LocalRegistry
	if err := yaml.Unmarshal(data, &reg); err != nil {
		return nil, fmt.Errorf("parse local software registry: %w", err)
	}
	if err := reg.Validate(); err != nil {
		return nil, err
	}
	return &reg, nil
}

func (r *LocalRegistry) Validate() error {
	if r.Version <= 0 {
		return errors.New("local software registry version must be >= 1")
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
		if strings.TrimSpace(service.ComponentID) == "" {
			return fmt.Errorf("service %q missing component_id", service.Name)
		}
		if _, exists := seenComponents[service.ComponentID]; !exists {
			return fmt.Errorf("service %q references unknown component %q", service.Name, service.ComponentID)
		}
		if service.Enabled && strings.TrimSpace(service.Manager) == "" {
			return fmt.Errorf("service %q missing manager", service.Name)
		}
		if service.Enabled && strings.TrimSpace(service.Lifecycle) == "" {
			return fmt.Errorf("service %q missing lifecycle", service.Name)
		}
		if service.Enabled && strings.TrimSpace(service.Visibility) == "" {
			return fmt.Errorf("service %q missing visibility", service.Name)
		}
		if lifecycle := strings.TrimSpace(service.Lifecycle); lifecycle != "" {
			switch lifecycle {
			case "always_on", "on_demand", "ephemeral":
			default:
				return fmt.Errorf("service %q has unsupported lifecycle %q", service.Name, service.Lifecycle)
			}
		}
		if visibility := strings.TrimSpace(service.Visibility); visibility != "" {
			switch visibility {
			case "default", "diagnostic", "hidden":
			default:
				return fmt.Errorf("service %q has unsupported visibility %q", service.Name, service.Visibility)
			}
		}
		if _, exists := seenServices[service.Name]; exists {
			return fmt.Errorf("duplicate service name %q", service.Name)
		}
		seenServices[service.Name] = struct{}{}
	}
	return nil
}

func (r *LocalRegistry) EnabledComponents() []LocalComponent {
	items := make([]LocalComponent, 0, len(r.Components))
	for _, component := range r.Components {
		if component.Enabled {
			items = append(items, component)
		}
	}
	return items
}

func (r *LocalRegistry) EnabledServices() []LocalService {
	items := make([]LocalService, 0, len(r.Services))
	for _, service := range r.Services {
		if service.Enabled {
			items = append(items, service)
		}
	}
	return items
}

func (r *LocalRegistry) FindService(name string) (LocalService, bool) {
	for _, service := range r.Services {
		if service.Name == name && service.Enabled {
			return service, true
		}
	}
	return LocalService{}, false
}

func (r *LocalRegistry) FindComponentBySoftwareKey(key software.ComponentKey) (LocalComponent, bool) {
	for _, component := range r.Components {
		if !component.Enabled || component.SoftwareCatalog == nil {
			continue
		}
		if component.SoftwareCatalog.ComponentKey == key {
			return component, true
		}
	}
	return LocalComponent{}, false
}

func loadLocalRegistryBytes() ([]byte, error) {
	if strings.TrimSpace(localRegistryPathOverride) != "" {
		data, err := os.ReadFile(localRegistryPathOverride)
		if err != nil {
			return nil, fmt.Errorf("read local software registry: %w", err)
		}
		return data, nil
	}
	if len(embeddedLocalRegistry) == 0 {
		return nil, errors.New("embedded local software registry is empty")
	}
	return embeddedLocalRegistry, nil
}
