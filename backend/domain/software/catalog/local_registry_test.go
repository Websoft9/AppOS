package catalog

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/websoft9/appos/backend/domain/software"
)

func TestLocalRegistryValidate_Valid(t *testing.T) {
	reg := &LocalRegistry{
		Version: 1,
		Components: []LocalComponent{
			{ID: "appos", Name: "AppOS", Enabled: true, RuntimeKind: "service"},
		},
		Services: []LocalService{
			{Name: "appos", ComponentID: "appos", Enabled: true, Manager: "process", Lifecycle: "always_on", Visibility: "default"},
		},
	}
	if err := reg.Validate(); err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
}

func TestLocalRegistryValidate_DuplicateComponentID(t *testing.T) {
	reg := &LocalRegistry{
		Version:    1,
		Components: []LocalComponent{{ID: "appos", Name: "AppOS"}, {ID: "appos", Name: "Duplicate"}},
	}
	if err := reg.Validate(); err == nil {
		t.Fatal("expected error for duplicate component id")
	}
}

func TestLocalRegistryValidate_InvalidServiceVisibility(t *testing.T) {
	reg := &LocalRegistry{
		Version:    1,
		Components: []LocalComponent{{ID: "appos", Name: "AppOS"}},
		Services:   []LocalService{{Name: "appos", ComponentID: "appos", Enabled: true, Manager: "process", Lifecycle: "always_on", Visibility: "secondary"}},
	}
	if err := reg.Validate(); err == nil {
		t.Fatal("expected error for invalid service visibility")
	}
}

func TestLocalRegistryValidate_DuplicateEnabledProgram(t *testing.T) {
	reg := &LocalRegistry{
		Version: 1,
		Components: []LocalComponent{
			{ID: "appos", Name: "AppOS"},
			{ID: "worker", Name: "Worker"},
		},
		Services: []LocalService{
			{Name: "appos", ComponentID: "appos", Enabled: true, Manager: "process", Program: "appos", Lifecycle: "always_on", Visibility: "default"},
			{Name: "worker", ComponentID: "worker", Enabled: true, Manager: "process", Program: "appos", Lifecycle: "always_on", Visibility: "default"},
		},
	}
	if err := reg.Validate(); err == nil {
		t.Fatal("expected error for duplicate enabled service program")
	}
}

func TestLoadLocalRegistry_ValidEmbedded(t *testing.T) {
	reg, err := LoadLocalRegistry()
	if err != nil {
		t.Fatalf("embedded local registry should load without error: %v", err)
	}
	if reg.Version <= 0 {
		t.Fatalf("expected version >= 1, got %d", reg.Version)
	}
	if len(reg.Components) == 0 {
		t.Fatal("expected at least one component in embedded registry")
	}
}

func TestLoadLocalRegistry_EmbeddedTraefikRuntime(t *testing.T) {
	reg, err := LoadLocalRegistry()
	if err != nil {
		t.Fatalf("embedded local registry should load without error: %v", err)
	}

	var traefikComponent LocalComponent
	foundComponent := false
	for _, component := range reg.Components {
		if component.ID == "traefik" {
			traefikComponent = component
			foundComponent = true
			break
		}
	}
	if !foundComponent {
		t.Fatal("expected embedded registry to include traefik component")
	}
	if traefikComponent.RuntimeKind != "service" {
		t.Fatalf("expected traefik runtime_kind service, got %q", traefikComponent.RuntimeKind)
	}
	if traefikComponent.UpdateProbe.Path != "/usr/local/bin/traefik" {
		t.Fatalf("expected traefik update probe path /usr/local/bin/traefik, got %q", traefikComponent.UpdateProbe.Path)
	}

	service, ok := reg.FindService("traefik")
	if !ok {
		t.Fatal("expected embedded registry to include traefik service")
	}
	if service.Lifecycle != "on_demand" {
		t.Fatalf("expected traefik lifecycle on_demand, got %q", service.Lifecycle)
	}
	if service.Program != "traefik" {
		t.Fatalf("expected traefik service program traefik, got %q", service.Program)
	}
}

func TestLoadLocalRegistry_EmbeddedNginxRemoved(t *testing.T) {
	reg, err := LoadLocalRegistry()
	if err != nil {
		t.Fatalf("embedded local registry should load without error: %v", err)
	}

	for _, component := range reg.Components {
		if component.ID == "nginx" {
			t.Fatal("expected embedded registry to remove nginx component")
		}
	}
	if _, ok := reg.FindService("nginx"); ok {
		t.Fatal("expected embedded registry to remove nginx service")
	}
}

func TestLoadLocalRegistry_InvalidYAML(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "bad.yaml")
	if err := os.WriteFile(path, []byte(":::not valid yaml:::"), 0600); err != nil {
		t.Fatal(err)
	}
	restore := SetLocalRegistryPathForTesting(path)
	defer restore()
	if _, err := LoadLocalRegistry(); err == nil {
		t.Fatal("expected error for invalid YAML")
	}
}

func TestLoadLocalRegistry_MissingVersion(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "no-version.yaml")
	if err := os.WriteFile(path, []byte("components: []\nservices: []\n"), 0600); err != nil {
		t.Fatal(err)
	}
	restore := SetLocalRegistryPathForTesting(path)
	defer restore()
	if _, err := LoadLocalRegistry(); err == nil {
		t.Fatal("expected error when version is missing/zero")
	}
}

func TestLoadLocalRegistry_FileNotFound(t *testing.T) {
	restore := SetLocalRegistryPathForTesting("/nonexistent/path/components.yaml")
	defer restore()
	if _, err := LoadLocalRegistry(); err == nil {
		t.Fatal("expected error for non-existent registry file")
	}
}

func TestLocalRegistryEnabledComponents(t *testing.T) {
	reg := &LocalRegistry{
		Version:    1,
		Components: []LocalComponent{{ID: "a", Name: "A", Enabled: true}, {ID: "b", Name: "B", Enabled: false}, {ID: "c", Name: "C", Enabled: true}},
	}
	enabled := reg.EnabledComponents()
	if len(enabled) != 2 {
		t.Fatalf("expected 2 enabled components, got %d", len(enabled))
	}
	if enabled[0].ID != "a" || enabled[1].ID != "c" {
		t.Fatalf("unexpected enabled component order: %+v", enabled)
	}
}

func TestLocalRegistryEnabledServices(t *testing.T) {
	reg := &LocalRegistry{
		Version:  1,
		Services: []LocalService{{Name: "svc1", ComponentID: "c1", Enabled: true, Manager: "process", Lifecycle: "always_on", Visibility: "default"}, {Name: "svc2", ComponentID: "c2", Enabled: false, Manager: "process", Lifecycle: "on_demand", Visibility: "hidden"}},
	}
	enabled := reg.EnabledServices()
	if len(enabled) != 1 {
		t.Fatalf("expected 1 enabled service, got %d", len(enabled))
	}
	if enabled[0].Name != "svc1" {
		t.Fatalf("expected svc1, got %q", enabled[0].Name)
	}
}

func TestLocalRegistryFindService(t *testing.T) {
	reg := &LocalRegistry{
		Version:  1,
		Services: []LocalService{{Name: "appos", ComponentID: "appos", Enabled: true, Manager: "process", Lifecycle: "always_on", Visibility: "default"}},
	}
	svc, ok := reg.FindService("appos")
	if !ok {
		t.Fatal("expected to find appos service")
	}
	if svc.Name != "appos" {
		t.Fatalf("expected appos, got %q", svc.Name)
	}
}

func TestProjectLocalCatalog_UsesProjectionMetadataAndDerivedService(t *testing.T) {
	reg := &LocalRegistry{
		Version: 1,
		Components: []LocalComponent{
			{
				ID:          "nginx",
				Name:        "Nginx",
				Enabled:     true,
				UpdateProbe: LocalInventoryProbe{Path: "/usr/sbin/nginx"},
				Notes:       "Bundled reverse proxy service.",
				SoftwareCatalog: &LocalSoftwareCatalogProjection{
					ComponentKey:          software.ComponentKey("reverse-proxy"),
					ReadinessRequirements: []string{"bundled_with_appos", "local_process"},
				},
			},
			{
				ID:           "git",
				Name:         "Git",
				Enabled:      true,
				VersionProbe: LocalInventoryProbe{Type: "command", Command: []string{"git", "--version"}},
				Notes:        "Bundled source control client.",
				SoftwareCatalog: &LocalSoftwareCatalogProjection{
					ComponentKey:          software.ComponentKey("git"),
					ReadinessRequirements: []string{"bundled_with_appos", "binary_available"},
				},
			},
		},
		Services: []LocalService{
			{Name: "nginx", ComponentID: "nginx", Enabled: true, Manager: "process", Lifecycle: "always_on", Visibility: "default"},
		},
	}

	cat, err := ProjectLocalCatalog(reg)
	if err != nil {
		t.Fatalf("ProjectLocalCatalog: %v", err)
	}
	if len(cat.Components) != 2 {
		t.Fatalf("expected 2 projected catalog entries, got %d", len(cat.Components))
	}
	if cat.Components[0].ComponentKey != software.ComponentKey("reverse-proxy") {
		t.Fatalf("expected reverse-proxy key, got %q", cat.Components[0].ComponentKey)
	}
	if cat.Components[0].TemplateRef != "binary-service" {
		t.Fatalf("expected binary-service, got %q", cat.Components[0].TemplateRef)
	}
	if cat.Components[0].ServiceName != "nginx" {
		t.Fatalf("expected derived service name nginx, got %q", cat.Components[0].ServiceName)
	}
	if cat.Components[0].Binary != "nginx" {
		t.Fatalf("expected derived binary nginx, got %q", cat.Components[0].Binary)
	}
	if cat.Components[0].Description != "Bundled reverse proxy service." {
		t.Fatalf("expected description to fall back to notes, got %q", cat.Components[0].Description)
	}
	if cat.Components[1].TemplateRef != "binary-detect" {
		t.Fatalf("expected binary-detect, got %q", cat.Components[1].TemplateRef)
	}
	if cat.Components[1].Binary != "git" {
		t.Fatalf("expected binary git, got %q", cat.Components[1].Binary)
	}
	if len(cat.Components[1].SupportedActions) != 1 || cat.Components[1].SupportedActions[0] != software.ActionVerify {
		t.Fatalf("expected verify-only supported actions, got %#v", cat.Components[1].SupportedActions)
	}
	if len(cat.Components[1].Visibility) != 1 || cat.Components[1].Visibility[0] != software.CatalogVisibilityLocalInventory {
		t.Fatalf("expected local_inventory visibility, got %#v", cat.Components[1].Visibility)
	}
}
