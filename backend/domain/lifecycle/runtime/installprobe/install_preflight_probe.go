package installprobe

import (
	"context"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	lifecyclesvc "github.com/websoft9/appos/backend/domain/lifecycle/service"
	servers "github.com/websoft9/appos/backend/domain/resource/control/servers"
)

type Target struct {
	Config     servers.ConnectorConfig
	Available  bool
	WarnReason string
}

type Dependencies struct {
	ResolveTarget        func(serverID string) (Target, error)
	DetectProtocolPorts  func(ctx context.Context, cfg servers.ConnectorConfig, ports []int, protocol string) (map[int]map[string]any, map[int]map[string]any, map[string]any, error)
	ExecuteSSHCommand    func(ctx context.Context, cfg servers.ConnectorConfig, command string, timeout time.Duration) (string, error)
	ShellQuote           func(value string) string
}

type Adapter struct {
	deps Dependencies
}

func NewAdapter(deps Dependencies) lifecyclesvc.InstallPreflightProbe {
	return &Adapter{deps: deps}
}

func (p *Adapter) CheckPorts(ctx context.Context, serverID string, ports []lifecyclesvc.InstallPreflightPublishedPort) (lifecyclesvc.InstallPreflightPortsCheck, []string, error) {
	if len(ports) == 0 {
		return lifecyclesvc.InstallPreflightPortsCheck{
			InstallPreflightCheck: lifecyclesvc.InstallPreflightCheck{OK: true, Status: "not_applicable", Message: "compose does not declare fixed published host ports"},
			Items:                 []lifecyclesvc.InstallPreflightPortItem{},
		}, nil, nil
	}

	target, err := p.deps.ResolveTarget(serverID)
	if err != nil {
		return lifecyclesvc.InstallPreflightPortsCheck{}, nil, err
	}
	if !target.Available {
		warning := "Port occupancy checks are unavailable for the current target."
		if strings.TrimSpace(target.WarnReason) != "" {
			warning = target.WarnReason
		}
		return lifecyclesvc.InstallPreflightPortsCheck{
			InstallPreflightCheck: lifecyclesvc.InstallPreflightCheck{OK: true, Status: "unavailable", Message: warning},
			Items:                 []lifecyclesvc.InstallPreflightPortItem{},
		}, []string{warning}, nil
	}

	tcpPorts := make([]int, 0)
	udpPorts := make([]int, 0)
	for _, port := range ports {
		if port.Protocol == "udp" {
			udpPorts = append(udpPorts, port.Port)
		} else {
			tcpPorts = append(tcpPorts, port.Port)
		}
	}

	tcpOccupancy, tcpReservations, tcpProbe, err := p.deps.DetectProtocolPorts(ctx, target.Config, tcpPorts, "tcp")
	if err != nil {
		return lifecyclesvc.InstallPreflightPortsCheck{}, nil, err
	}
	udpOccupancy, udpReservations, udpProbe, err := p.deps.DetectProtocolPorts(ctx, target.Config, udpPorts, "udp")
	if err != nil {
		return lifecyclesvc.InstallPreflightPortsCheck{}, nil, err
	}

	items := make([]lifecyclesvc.InstallPreflightPortItem, 0, len(ports))
	hasConflict := false
	for _, port := range ports {
		occupancy := tcpOccupancy[port.Port]
		reservation := tcpReservations[port.Port]
		containerProbe := tcpProbe
		if port.Protocol == "udp" {
			occupancy = udpOccupancy[port.Port]
			reservation = udpReservations[port.Port]
			containerProbe = udpProbe
		}
		occupied := false
		if occupancy != nil {
			occupied, _ = occupancy["occupied"].(bool)
		}
		reserved := false
		if reservation != nil {
			reserved, _ = reservation["reserved"].(bool)
		}
		conflict := occupied || reserved
		if conflict {
			hasConflict = true
		}
		item := lifecyclesvc.InstallPreflightPortItem{
			Port:      port.Port,
			Protocol:  port.Protocol,
			Occupied:  occupied,
			Reserved:  reserved,
			Conflict:  conflict,
			Occupancy: occupancy,
			Reservation: func() map[string]any {
				if reservation != nil {
					return reservation
				}
				return map[string]any{
					"reserved":        false,
					"sources":         []map[string]any{},
					"container_probe": containerProbe,
				}
			}(),
		}
		items = append(items, item)
	}

	message := "No host-port conflicts detected"
	status := "ok"
	if hasConflict {
		message = "One or more declared host ports are already occupied or reserved"
		status = "conflict"
	}
	return lifecyclesvc.InstallPreflightPortsCheck{
		InstallPreflightCheck: lifecyclesvc.InstallPreflightCheck{OK: !hasConflict, Conflict: hasConflict, Status: status, Message: message},
		Items:                 items,
	}, nil, nil
}

func (p *Adapter) CheckContainerNames(ctx context.Context, serverID string, containerNames []string) (lifecyclesvc.InstallPreflightContainerNamesCheck, []string, error) {
	if len(containerNames) == 0 {
		return lifecyclesvc.InstallPreflightContainerNamesCheck{
			InstallPreflightCheck: lifecyclesvc.InstallPreflightCheck{OK: true, Status: "not_applicable", Message: "compose does not declare explicit container_name values"},
			Items:                 []lifecyclesvc.InstallPreflightContainerNameItem{},
		}, nil, nil
	}

	target, err := p.deps.ResolveTarget(serverID)
	if err != nil {
		return lifecyclesvc.InstallPreflightContainerNamesCheck{}, nil, err
	}
	if !target.Available {
		warning := "Container-name checks are unavailable for the current target."
		if strings.TrimSpace(target.WarnReason) != "" {
			warning = target.WarnReason
		}
		return lifecyclesvc.InstallPreflightContainerNamesCheck{
			InstallPreflightCheck: lifecyclesvc.InstallPreflightCheck{OK: true, Status: "unavailable", Message: warning},
			Items:                 []lifecyclesvc.InstallPreflightContainerNameItem{},
		}, []string{warning}, nil
	}

	raw, err := p.deps.ExecuteSSHCommand(ctx, target.Config, "if command -v docker >/dev/null 2>&1; then (docker ps -a --format '{{.Names}}' 2>/dev/null || echo '__DOCKER_CLI_ERROR__'); else echo '__DOCKER_NOT_AVAILABLE__'; fi", 20*time.Second)
	if err != nil {
		return lifecyclesvc.InstallPreflightContainerNamesCheck{}, nil, err
	}
	existing := make(map[string]struct{})
	trimmed := strings.TrimSpace(raw)
	if trimmed != "__DOCKER_NOT_AVAILABLE__" && !strings.Contains(trimmed, "__DOCKER_CLI_ERROR__") {
		for _, line := range strings.Split(raw, "\n") {
			name := strings.TrimSpace(line)
			if name != "" {
				existing[name] = struct{}{}
			}
		}
	}

	items := make([]lifecyclesvc.InstallPreflightContainerNameItem, 0, len(containerNames))
	hasConflict := false
	for _, name := range containerNames {
		_, exists := existing[name]
		if exists {
			hasConflict = true
		}
		items = append(items, lifecyclesvc.InstallPreflightContainerNameItem{ContainerName: name, Conflict: exists})
	}

	message := "No explicit container_name conflicts detected"
	status := "ok"
	if hasConflict {
		message = "One or more explicit container_name values already exist on the target"
		status = "conflict"
	}
	return lifecyclesvc.InstallPreflightContainerNamesCheck{
		InstallPreflightCheck: lifecyclesvc.InstallPreflightCheck{OK: !hasConflict, Conflict: hasConflict, Status: status, Message: message},
		Items:                 items,
	}, nil, nil
}

func (p *Adapter) CheckDockerAvailability(ctx context.Context, serverID string) (lifecyclesvc.InstallPreflightDockerCheck, []string, error) {
	target, err := p.deps.ResolveTarget(serverID)
	if err != nil {
		return lifecyclesvc.InstallPreflightDockerCheck{}, nil, err
	}
	if !target.Available {
		warning := "Docker availability checks are unavailable for the current target."
		if strings.TrimSpace(target.WarnReason) != "" {
			warning = target.WarnReason
		}
		return lifecyclesvc.InstallPreflightDockerCheck{InstallPreflightCheck: lifecyclesvc.InstallPreflightCheck{OK: true, Status: "unavailable", Message: warning}}, []string{warning}, nil
	}

	raw, err := p.deps.ExecuteSSHCommand(ctx, target.Config, "if command -v docker >/dev/null 2>&1; then (docker info --format '{{.ServerVersion}}' 2>/dev/null || echo '__DOCKER_INFO_ERROR__'); else echo '__DOCKER_NOT_AVAILABLE__'; fi", 20*time.Second)
	if err != nil {
		return lifecyclesvc.InstallPreflightDockerCheck{}, nil, err
	}
	trimmed := strings.TrimSpace(raw)
	if trimmed == "__DOCKER_NOT_AVAILABLE__" || strings.Contains(trimmed, "__DOCKER_INFO_ERROR__") || trimmed == "" {
		return lifecyclesvc.InstallPreflightDockerCheck{InstallPreflightCheck: lifecyclesvc.InstallPreflightCheck{OK: false, Conflict: true, Status: "conflict", Message: "Docker daemon is unavailable on the target server"}}, nil, nil
	}
	return lifecyclesvc.InstallPreflightDockerCheck{
		InstallPreflightCheck: lifecyclesvc.InstallPreflightCheck{OK: true, Status: "ok", Message: "Docker daemon is available"},
		ServerVersion:         trimmed,
	}, nil, nil
}

func (p *Adapter) CheckDiskSpace(ctx context.Context, serverID string, projectDir string, minFreeDiskBytes int64, appRequiredDiskBytes int64) (lifecyclesvc.InstallPreflightDiskSpaceCheck, []string, error) {
	target, err := p.deps.ResolveTarget(serverID)
	if err != nil {
		return lifecyclesvc.InstallPreflightDiskSpaceCheck{}, nil, err
	}
	if !target.Available {
		warning := "Disk-space checks are unavailable for the current target." + diskCheckContextSuffix(minFreeDiskBytes, appRequiredDiskBytes)
		if strings.TrimSpace(target.WarnReason) != "" {
			warning = target.WarnReason + diskCheckContextSuffix(minFreeDiskBytes, appRequiredDiskBytes)
		}
		return lifecyclesvc.InstallPreflightDiskSpaceCheck{
			InstallPreflightCheck: lifecyclesvc.InstallPreflightCheck{OK: true, Status: "unavailable", Message: warning},
			MinFreeBytes:          minFreeDiskBytes,
			RequiredAppBytes:      appRequiredDiskBytes,
		}, []string{warning}, nil
	}

	path := strings.TrimSpace(projectDir)
	if path == "" {
		path = "/appos/data/apps/operations"
	}
	raw, err := p.deps.ExecuteSSHCommand(ctx, target.Config, fmt.Sprintf("df -Pk %s 2>/dev/null | tail -n 1", p.deps.ShellQuote(filepath.Dir(path))), 20*time.Second)
	if err != nil {
		return lifecyclesvc.InstallPreflightDiskSpaceCheck{}, nil, err
	}
	fields := strings.Fields(strings.TrimSpace(raw))
	if len(fields) < 6 {
		warning := "Disk-space check returned an unexpected response." + diskCheckContextSuffix(minFreeDiskBytes, appRequiredDiskBytes)
		return lifecyclesvc.InstallPreflightDiskSpaceCheck{
			InstallPreflightCheck: lifecyclesvc.InstallPreflightCheck{OK: true, Status: "warning", Message: warning},
			MinFreeBytes:          minFreeDiskBytes,
			RequiredAppBytes:      appRequiredDiskBytes,
		}, []string{warning}, nil
	}
	availableKB, convErr := strconv.ParseInt(fields[3], 10, 64)
	if convErr != nil {
		warning := "Disk-space check could not parse available capacity." + diskCheckContextSuffix(minFreeDiskBytes, appRequiredDiskBytes)
		return lifecyclesvc.InstallPreflightDiskSpaceCheck{
			InstallPreflightCheck: lifecyclesvc.InstallPreflightCheck{OK: true, Status: "warning", Message: warning},
			MinFreeBytes:          minFreeDiskBytes,
			RequiredAppBytes:      appRequiredDiskBytes,
		}, []string{warning}, nil
	}
	availableBytes := availableKB * 1024

	status := "ok"
	message := "Sufficient disk space detected"
	okValue := true
	conflict := false
	if availableBytes < minFreeDiskBytes {
		status = "conflict"
		conflict = true
		okValue = false
		message = fmt.Sprintf("Available disk space (%d bytes) is below the minimum free-disk threshold (%d bytes)", availableBytes, minFreeDiskBytes)
	} else if appRequiredDiskBytes > 0 && appRequiredDiskBytes > availableBytes {
		status = "conflict"
		conflict = true
		okValue = false
		message = fmt.Sprintf("Application estimated disk requirement (%d bytes) exceeds available disk space (%d bytes)", appRequiredDiskBytes, availableBytes)
	}
	return lifecyclesvc.InstallPreflightDiskSpaceCheck{
		InstallPreflightCheck: lifecyclesvc.InstallPreflightCheck{OK: okValue, Conflict: conflict, Status: status, Message: message},
		AvailableBytes:        availableBytes,
		MinFreeBytes:          minFreeDiskBytes,
		RequiredAppBytes:      appRequiredDiskBytes,
		MountPoint:            fields[5],
	}, nil, nil
}

func diskCheckContextSuffix(minFreeDiskBytes int64, appRequiredDiskBytes int64) string {
	if appRequiredDiskBytes > 0 {
		return fmt.Sprintf(" (min free threshold: %d bytes, app estimated: %d bytes)", minFreeDiskBytes, appRequiredDiskBytes)
	}
	return fmt.Sprintf(" (min free threshold: %d bytes)", minFreeDiskBytes)
}
