package service

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/deploy"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingscatalog "github.com/websoft9/appos/backend/domain/config/sysconfig/catalog"
	"gopkg.in/yaml.v3"
)

const defaultMinFreeDiskBytes int64 = 512 * 1024 * 1024

type InstallPreflightRequest struct {
	InstallResolutionRequest
}

type InstallNameAvailabilityResult struct {
	OK             bool   `json:"ok"`
	ProjectName    string `json:"project_name"`
	NormalizedName string `json:"normalized_name"`
	Message        string `json:"message"`
}

type InstallPreflightProbe interface {
	CheckPorts(ctx context.Context, serverID string, ports []InstallPreflightPublishedPort) (InstallPreflightPortsCheck, []string, error)
	CheckContainerNames(ctx context.Context, serverID string, containerNames []string) (InstallPreflightContainerNamesCheck, []string, error)
	CheckDockerAvailability(ctx context.Context, serverID string) (InstallPreflightDockerCheck, []string, error)
	CheckDiskSpace(ctx context.Context, serverID string, projectDir string, minFreeDiskBytes int64, appRequiredDiskBytes int64) (InstallPreflightDiskSpaceCheck, []string, error)
}

type InstallPreflightPublishedPort struct {
	Port     int    `json:"port"`
	Protocol string `json:"protocol"`
}

type InstallPreflightCheck struct {
	OK          bool   `json:"ok"`
	Conflict    bool   `json:"conflict,omitempty"`
	Status      string `json:"status,omitempty"`
	Message     string `json:"message,omitempty"`
	ProjectName string `json:"project_name,omitempty"`
}

type InstallPreflightPortItem struct {
	Port        int            `json:"port"`
	Protocol    string         `json:"protocol"`
	Occupied    bool           `json:"occupied,omitempty"`
	Reserved    bool           `json:"reserved,omitempty"`
	Conflict    bool           `json:"conflict,omitempty"`
	Occupancy   map[string]any `json:"occupancy,omitempty"`
	Reservation map[string]any `json:"reservation,omitempty"`
}

type InstallPreflightPortsCheck struct {
	InstallPreflightCheck
	Items []InstallPreflightPortItem `json:"items,omitempty"`
}

type InstallPreflightContainerNameItem struct {
	ContainerName string `json:"container_name"`
	Conflict      bool   `json:"conflict,omitempty"`
}

type InstallPreflightContainerNamesCheck struct {
	InstallPreflightCheck
	Items []InstallPreflightContainerNameItem `json:"items,omitempty"`
}

type InstallPreflightDockerCheck struct {
	InstallPreflightCheck
	ServerVersion string `json:"server_version,omitempty"`
}

type InstallPreflightDiskSpaceCheck struct {
	InstallPreflightCheck
	AvailableBytes   int64  `json:"available_bytes,omitempty"`
	MinFreeBytes     int64  `json:"min_free_bytes"`
	RequiredAppBytes int64  `json:"required_app_bytes"`
	MountPoint       string `json:"mount_point,omitempty"`
}

type InstallPreflightChecks struct {
	Compose            InstallPreflightCheck               `json:"compose"`
	AppName            InstallPreflightCheck               `json:"app_name"`
	Ports              InstallPreflightPortsCheck          `json:"ports"`
	ContainerNames     InstallPreflightContainerNamesCheck `json:"container_names"`
	DockerAvailability InstallPreflightDockerCheck         `json:"docker_availability"`
	DiskSpace          InstallPreflightDiskSpaceCheck      `json:"disk_space"`
}

type InstallPreflightResult struct {
	OK                 bool                   `json:"ok"`
	Message            string                 `json:"message"`
	ComposeProjectName string                 `json:"compose_project_name"`
	ProjectName        string                 `json:"project_name"`
	Spec               map[string]any         `json:"spec"`
	Warnings           []string               `json:"warnings,omitempty"`
	Checks             InstallPreflightChecks `json:"checks"`
}

func CheckInstallFromCompose(app core.App, request InstallPreflightRequest, probe InstallPreflightProbe) (InstallPreflightResult, error) {
	normalizedSpec, err := ResolveInstallFromCompose(app, request.InstallResolutionRequest)
	if err != nil {
		return InstallPreflightResult{}, err
	}

	checks, warnings, err := buildInstallResourceChecks(context.Background(), app, probe, normalizedSpec.ServerID, normalizedSpec.ProjectDir, normalizedSpec.RenderedCompose, normalizedSpec.Metadata)
	if err != nil {
		return InstallPreflightResult{}, err
	}

	appNameCheck, err := buildInstallAppNameCheck(app, normalizedSpec.ComposeProjectName)
	if err != nil {
		return InstallPreflightResult{}, err
	}
	checks.AppName = appNameCheck

	blocking := resourceChecksBlocking(checks)
	message := "Preflight passed"
	if blocking {
		message = "Preflight found blocking issues"
	} else if len(warnings) > 0 {
		message = "Preflight completed with warnings"
	}

	return InstallPreflightResult{
		OK:                 !blocking,
		Message:            message,
		ComposeProjectName: normalizedSpec.ComposeProjectName,
		ProjectName:        normalizedSpec.ProjectName,
		Spec:               normalizedSpec.OperationSpec(),
		Warnings:           warnings,
		Checks:             checks,
	}, nil
}

func CheckInstallNameAvailability(app core.App, rawName string) (InstallNameAvailabilityResult, error) {
	normalizedName := normalizeProjectName(rawName)
	if normalizedName == "" {
		return InstallNameAvailabilityResult{}, fmt.Errorf("project_name is required")
	}
	check, err := buildInstallAppNameCheck(app, normalizedName)
	if err != nil {
		return InstallNameAvailabilityResult{}, err
	}
	return InstallNameAvailabilityResult{
		OK:             check.OK,
		ProjectName:    normalizedName,
		NormalizedName: normalizedName,
		Message:        check.Message,
	}, nil
}

func buildInstallAppNameCheck(app core.App, composeProjectName string) (InstallPreflightCheck, error) {
	conflict, err := hasActiveAppName(app, composeProjectName)
	if err != nil {
		return InstallPreflightCheck{}, err
	}

	message := "application name is available"
	status := "ok"
	if conflict {
		message = fmt.Sprintf("application name %q already exists", composeProjectName)
		status = "conflict"
	}

	return InstallPreflightCheck{
		OK:          !conflict,
		Conflict:    conflict,
		Status:      status,
		ProjectName: composeProjectName,
		Message:     message,
	}, nil
}

func resourceChecksBlocking(checks InstallPreflightChecks) bool {
	baseChecks := []InstallPreflightCheck{
		checks.Compose,
		checks.AppName,
		checks.Ports.InstallPreflightCheck,
		checks.ContainerNames.InstallPreflightCheck,
		checks.DockerAvailability.InstallPreflightCheck,
		checks.DiskSpace.InstallPreflightCheck,
	}
	for _, check := range baseChecks {
		if check.Conflict {
			return true
		}
		if !check.OK && check.Status != "unavailable" && check.Status != "warning" && check.Status != "not_applicable" {
			return true
		}
	}
	return false
}

func hasActiveAppName(app core.App, composeProjectName string) (bool, error) {
	appInstancesCol, err := app.FindCollectionByNameOrId("app_instances")
	if err != nil {
		return false, err
	}
	existing, err := app.FindRecordsByFilter(
		appInstancesCol,
		fmt.Sprintf("name = '%s' && lifecycle_state != '%s'", escapeServiceFilterValue(composeProjectName), escapeServiceFilterValue(string(model.AppStateRetired))),
		"",
		1,
		0,
	)
	if err != nil {
		return false, err
	}
	return len(existing) > 0, nil
}

func buildInstallResourceChecks(ctx context.Context, app core.App, probe InstallPreflightProbe, serverID string, projectDir string, compose string, metadata map[string]any) (InstallPreflightChecks, []string, error) {
	publishedPorts, err := extractComposePublishedPorts(compose)
	if err != nil {
		return InstallPreflightChecks{}, nil, err
	}
	containerNames, err := extractComposeContainerNames(compose)
	if err != nil {
		return InstallPreflightChecks{}, nil, err
	}

	warnings := make([]string, 0)
	portsCheck, portWarnings, err := probe.CheckPorts(ctx, serverID, publishedPorts)
	if err != nil {
		return InstallPreflightChecks{}, nil, err
	}
	warnings = append(warnings, portWarnings...)

	containerCheck, containerWarnings, err := probe.CheckContainerNames(ctx, serverID, containerNames)
	if err != nil {
		return InstallPreflightChecks{}, nil, err
	}
	warnings = append(warnings, containerWarnings...)

	dockerCheck, dockerWarnings, err := probe.CheckDockerAvailability(ctx, serverID)
	if err != nil {
		return InstallPreflightChecks{}, nil, err
	}
	warnings = append(warnings, dockerWarnings...)

	minFreeDiskBytes := loadDeployMinFreeDiskBytes(app)
	appRequiredDiskBytes := parseAppRequiredDiskBytes(metadata)
	diskCheck, diskWarnings, err := probe.CheckDiskSpace(ctx, serverID, projectDir, minFreeDiskBytes, appRequiredDiskBytes)
	if err != nil {
		return InstallPreflightChecks{}, nil, err
	}
	warnings = append(warnings, diskWarnings...)

	return InstallPreflightChecks{
		Compose:            InstallPreflightCheck{OK: true, Status: "ok", Message: "compose config is valid"},
		Ports:              portsCheck,
		ContainerNames:     containerCheck,
		DockerAvailability: dockerCheck,
		DiskSpace:          diskCheck,
	}, warnings, nil
}

func loadDeployMinFreeDiskBytes(app core.App) int64 {
	fallback := settingscatalog.DefaultGroup("deploy", "preflight")
	group, _ := sysconfig.GetGroup(app, "deploy", "preflight", fallback)
	configured := sysconfig.Int(group, "minFreeDiskBytes", int(defaultMinFreeDiskBytes))
	if configured < 0 {
		return 0
	}
	return int64(configured)
}

func parseAppRequiredDiskBytes(metadata map[string]any) int64 {
	if len(metadata) == 0 {
		return 0
	}
	raw, ok := metadata["app_required_disk_bytes"]
	if !ok || raw == nil {
		return 0
	}
	switch typed := raw.(type) {
	case int:
		if typed > 0 {
			return int64(typed)
		}
	case int64:
		if typed > 0 {
			return typed
		}
	case float64:
		if typed > 0 {
			return int64(typed)
		}
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 0
		}
		parsed, err := strconv.ParseInt(trimmed, 10, 64)
		if err == nil && parsed > 0 {
			return parsed
		}
	}
	return 0
}

func extractComposeContainerNames(raw string) ([]string, error) {
	var doc map[string]any
	if err := yaml.Unmarshal([]byte(raw), &doc); err != nil {
		return nil, fmt.Errorf("invalid compose yaml: %w", err)
	}
	services, _ := doc["services"].(map[string]any)
	result := make([]string, 0)
	seen := make(map[string]struct{})
	for _, rawService := range services {
		service, ok := rawService.(map[string]any)
		if !ok {
			continue
		}
		name := strings.TrimSpace(fmt.Sprintf("%v", service["container_name"]))
		if name == "" {
			continue
		}
		if _, exists := seen[name]; exists {
			continue
		}
		seen[name] = struct{}{}
		result = append(result, name)
	}
	sort.Strings(result)
	return result, nil
}

func extractComposePublishedPorts(raw string) ([]InstallPreflightPublishedPort, error) {
	var doc map[string]any
	if err := yaml.Unmarshal([]byte(raw), &doc); err != nil {
		return nil, fmt.Errorf("invalid compose yaml: %w", err)
	}

	services, _ := doc["services"].(map[string]any)
	portSet := make(map[string]InstallPreflightPublishedPort)
	for _, rawService := range services {
		service, ok := rawService.(map[string]any)
		if !ok {
			continue
		}
		rawPorts, ok := service["ports"].([]any)
		if !ok {
			continue
		}
		for _, entry := range rawPorts {
			for _, port := range extractComposePortEntries(entry) {
				key := fmt.Sprintf("%s:%d", port.Protocol, port.Port)
				portSet[key] = port
			}
		}
	}

	result := make([]InstallPreflightPublishedPort, 0, len(portSet))
	for _, port := range portSet {
		result = append(result, port)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Protocol == result[j].Protocol {
			return result[i].Port < result[j].Port
		}
		return result[i].Protocol < result[j].Protocol
	})
	return result, nil
}

func ExtractComposePublishedPortsForTest(raw string) ([]InstallPreflightPublishedPort, error) {
	return extractComposePublishedPorts(raw)
}

func extractComposePortEntries(entry any) []InstallPreflightPublishedPort {
	switch typed := entry.(type) {
	case string:
		return parseComposeShortPortSyntax(typed)
	case map[string]any:
		protocol := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", typed["protocol"])))
		if protocol == "" {
			protocol = "tcp"
		}
		if protocol != "tcp" && protocol != "udp" {
			return nil
		}
		published := parseComposePublishedPortNumber(typed["published"])
		if published <= 0 {
			return nil
		}
		return []InstallPreflightPublishedPort{{Port: published, Protocol: protocol}}
	default:
		return nil
	}
}

func parseComposeShortPortSyntax(value string) []InstallPreflightPublishedPort {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	protocol := "tcp"
	if slash := strings.LastIndex(trimmed, "/"); slash >= 0 {
		protocol = strings.ToLower(strings.TrimSpace(trimmed[slash+1:]))
		trimmed = strings.TrimSpace(trimmed[:slash])
	}
	if protocol != "tcp" && protocol != "udp" {
		return nil
	}
	parts := strings.Split(trimmed, ":")
	if len(parts) < 2 {
		return nil
	}
	hostPart := strings.TrimSpace(parts[len(parts)-2])
	if hostPart == "" {
		return nil
	}
	ports := parseRangePorts(hostPart)
	result := make([]InstallPreflightPublishedPort, 0, len(ports))
	for _, port := range ports {
		result = append(result, InstallPreflightPublishedPort{Port: port, Protocol: protocol})
	}
	return result
}

func parseRangePorts(ranges string) []int {
	values := make([]int, 0)
	seen := make(map[int]struct{})
	for _, segment := range strings.Split(ranges, ",") {
		segment = strings.TrimSpace(segment)
		if segment == "" {
			continue
		}
		if strings.Contains(segment, "-") {
			parts := strings.SplitN(segment, "-", 2)
			if len(parts) != 2 {
				continue
			}
			start, errStart := strconv.Atoi(strings.TrimSpace(parts[0]))
			end, errEnd := strconv.Atoi(strings.TrimSpace(parts[1]))
			if errStart != nil || errEnd != nil || start < 1 || end < 1 || start > 65535 || end > 65535 || start > end {
				continue
			}
			for port := start; port <= end; port++ {
				if _, exists := seen[port]; exists {
					continue
				}
				seen[port] = struct{}{}
				values = append(values, port)
			}
			continue
		}
		port, err := strconv.Atoi(segment)
		if err != nil || port < 1 || port > 65535 {
			continue
		}
		if _, exists := seen[port]; exists {
			continue
		}
		seen[port] = struct{}{}
		values = append(values, port)
	}
	sort.Ints(values)
	return values
}

func normalizeProjectName(value string) string {
	return deploy.NormalizeProjectName(value)
}

func parseComposePublishedPortNumber(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		number, err := strconv.Atoi(strings.TrimSpace(typed))
		if err == nil {
			return number
		}
	}
	return 0
}
