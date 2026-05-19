package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/websoft9/appos/backend/domain/terminal"
)

type PortCommandRunner func(context.Context, string, time.Duration) (string, error)

type PortRuntimeService struct {
	Run                         PortCommandRunner
	SSUsersProcessPattern       string
	DockerPublishedPortPattern  string
	Pause                       func(time.Duration)
}

var (
	ErrPortNotOccupied      = errors.New("port is not occupied")
	ErrPortPIDNotResolvable = errors.New("unable to resolve process pid for occupied port")
)

type PortCommandExecutionError struct {
	Output string
	Err    error
}

func (e *PortCommandExecutionError) Error() string {
	if e == nil || e.Err == nil {
		return ""
	}
	return e.Err.Error()
}

func (e *PortCommandExecutionError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

type PortReleaseResult struct {
	Port           int            `json:"port"`
	Protocol       string         `json:"protocol"`
	Mode           string         `json:"mode"`
	OwnerType      string         `json:"owner_type"`
	ActionTaken    string         `json:"action_taken"`
	PIDTargets     []int          `json:"pid_targets"`
	ContainerOwner map[string]any `json:"container_owner"`
	ContainerProbe map[string]any `json:"container_probe"`
	Released       bool           `json:"released"`
	Before         map[string]any `json:"before"`
	After          map[string]any `json:"after"`
}

const (
	DefaultSSUsersProcessPattern      = `\("([^"]+)",pid=([0-9]+),fd=[0-9]+\)`
	DefaultDockerPublishedPortPattern = `:([0-9]+)->[^/]+/(tcp|udp)`
)

func (s PortRuntimeService) DetectPortOccupancy(ctx context.Context, port int, protocol string) (map[string]any, error) {
	all, err := s.DetectAllPortOccupancy(ctx, protocol)
	if err != nil {
		return nil, err
	}
	if existing, ok := all[port]; ok {
		return existing, nil
	}
	return map[string]any{"occupied": false, "listeners": []map[string]any{}}, nil
}

func (s PortRuntimeService) DetectAllPortOccupancy(ctx context.Context, protocol string) (map[int]map[string]any, error) {
	command := "ss -lntpH 2>/dev/null || true"
	if protocol == "udp" {
		command = "ss -lnupH 2>/dev/null || true"
	}

	raw, err := s.run(ctx, command, 20*time.Second)
	if err != nil {
		return nil, err
	}

	listeners := ParseSSPortListeners(raw, s.ssUsersProcessPattern())
	byPortListeners := make(map[int][]map[string]any)
	for _, listener := range listeners {
		localAddress := fmt.Sprintf("%v", listener["local_address"])
		port, ok := ExtractPortFromAddress(localAddress)
		if !ok {
			continue
		}
		byPortListeners[port] = append(byPortListeners[port], listener)
	}

	result := make(map[int]map[string]any)
	for port, portListeners := range byPortListeners {
		entry := map[string]any{
			"occupied":  len(portListeners) > 0,
			"listeners": portListeners,
			"pids":      ExtractPIDsFromListeners(portListeners),
		}
		if len(portListeners) > 0 {
			if process, ok := portListeners[0]["process"]; ok {
				entry["process"] = process
			}
		}
		result[port] = entry
	}

	return result, nil
}

func (s PortRuntimeService) DetectPortReservation(ctx context.Context, port int, protocol string) (map[string]any, error) {
	all, containerProbe, err := s.DetectAllPortReservations(ctx, protocol)
	if err != nil {
		return nil, err
	}
	sources := all[port]
	return map[string]any{
		"reserved":        len(sources) > 0,
		"sources":         sources,
		"container_probe": containerProbe,
	}, nil
}

func (s PortRuntimeService) DetectAllPortReservations(ctx context.Context, protocol string) (map[int][]map[string]any, map[string]any, error) {
	byPort := make(map[int][]map[string]any)

	systemdByPort, err := s.detectSystemdSocketReservationsAll(ctx)
	if err != nil {
		return nil, nil, err
	}
	for port, systemdMatches := range systemdByPort {
		byPort[port] = append(byPort[port], map[string]any{
			"type":       "systemd_socket",
			"confidence": "high",
			"matches":    systemdMatches,
		})
	}

	kernelPorts, kernelRanges, err := s.detectKernelReservedPorts(ctx)
	if err != nil {
		return nil, nil, err
	}
	for _, port := range kernelPorts {
		byPort[port] = append(byPort[port], map[string]any{
			"type":       "kernel_reserved",
			"confidence": "high",
			"matches": []map[string]any{{
				"ranges": kernelRanges,
			}},
		})
	}

	containerByPort, containerProbe, err := s.detectContainerDeclaredReservationsAll(ctx, protocol)
	if err != nil {
		return nil, nil, err
	}
	for port, containerMatches := range containerByPort {
		byPort[port] = append(byPort[port], map[string]any{
			"type":       "container_declared",
			"confidence": "medium",
			"matches":    containerMatches,
		})
	}

	return byPort, containerProbe, nil
}

func (s PortRuntimeService) DetectAllProtocolPortReservations(ctx context.Context) (map[PortProtocolKey][]map[string]any, map[string]any, error) {
	byKey := make(map[PortProtocolKey][]map[string]any)

	systemdByPort, err := s.detectSystemdSocketReservationsAll(ctx)
	if err != nil {
		return nil, nil, err
	}
	for port, systemdMatches := range systemdByPort {
		for _, proto := range []string{"tcp", "udp"} {
			key := PortProtocolKey{Port: port, Protocol: proto}
			byKey[key] = append(byKey[key], map[string]any{
				"type":       "systemd_socket",
				"confidence": "high",
				"matches":    systemdMatches,
			})
		}
	}

	kernelPorts, kernelRanges, err := s.detectKernelReservedPorts(ctx)
	if err != nil {
		return nil, nil, err
	}
	for _, port := range kernelPorts {
		for _, proto := range []string{"tcp", "udp"} {
			key := PortProtocolKey{Port: port, Protocol: proto}
			byKey[key] = append(byKey[key], map[string]any{
				"type":       "kernel_reserved",
				"confidence": "high",
				"matches": []map[string]any{{
					"ranges": kernelRanges,
				}},
			})
		}
	}

	containerByKey, containerProbe, err := s.detectContainerDeclaredReservationsAllProtocols(ctx)
	if err != nil {
		return nil, nil, err
	}
	for key, containerMatches := range containerByKey {
		byKey[key] = append(byKey[key], map[string]any{
			"type":       "container_declared",
			"confidence": "medium",
			"matches":    containerMatches,
		})
	}

	return byKey, containerProbe, nil
}

func (s PortRuntimeService) DetectRunningContainerByPort(ctx context.Context, port int, protocol string) (map[string]string, map[string]any, error) {
	raw, err := s.run(ctx, "if command -v docker >/dev/null 2>&1; then (docker ps --format '{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null || echo '__DOCKER_CLI_ERROR__'); else echo '__DOCKER_NOT_AVAILABLE__'; fi", 20*time.Second)
	if err != nil {
		return nil, nil, err
	}
	matches, probe := ParseContainerDeclaredReservations(raw, port, protocol, s.dockerPublishedPortPattern())
	for _, match := range matches {
		status := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", match["container_status"])))
		if status == "" || strings.HasPrefix(status, "up") {
			return map[string]string{
				"container_id":     fmt.Sprintf("%v", match["container_id"]),
				"container_name":   fmt.Sprintf("%v", match["container_name"]),
				"container_status": fmt.Sprintf("%v", match["container_status"]),
			}, probe, nil
		}
	}
	return map[string]string{}, probe, nil
}

func (s PortRuntimeService) ReleasePort(ctx context.Context, port int, protocol, mode string) (PortReleaseResult, error) {
	result := PortReleaseResult{
		Port:           port,
		Protocol:       protocol,
		Mode:           mode,
		OwnerType:      "host_process",
		PIDTargets:     []int{},
		ContainerOwner: map[string]any{},
		ContainerProbe: map[string]any{},
	}

	before, err := s.DetectPortOccupancy(ctx, port, protocol)
	if err != nil {
		return result, err
	}
	result.Before = before
	if occupied, _ := before["occupied"].(bool); !occupied {
		return result, ErrPortNotOccupied
	}

	runningContainer, probe, err := s.DetectRunningContainerByPort(ctx, port, protocol)
	if err != nil {
		return result, err
	}
	result.ContainerProbe = probe

	if len(runningContainer) > 0 {
		result.OwnerType = "container"
		result.ContainerOwner = map[string]any{
			"container_id":     runningContainer["container_id"],
			"container_name":   runningContainer["container_name"],
			"container_status": runningContainer["container_status"],
		}
		containerID := runningContainer["container_id"]
		command := fmt.Sprintf("(sudo -n docker stop %s || docker stop %s)", terminal.ShellQuote(containerID), terminal.ShellQuote(containerID))
		result.ActionTaken = "docker stop"
		if mode == "force" {
			result.ActionTaken = "docker kill"
			command = fmt.Sprintf("(sudo -n docker kill %s || docker kill %s)", terminal.ShellQuote(containerID), terminal.ShellQuote(containerID))
		}
		output, runErr := s.run(ctx, command, 30*time.Second)
		if runErr != nil {
			return result, &PortCommandExecutionError{Output: output, Err: runErr}
		}
	} else {
		result.PIDTargets = ExtractOccupancyPIDs(before)
		if len(result.PIDTargets) == 0 {
			return result, ErrPortPIDNotResolvable
		}
		pidParts := make([]string, 0, len(result.PIDTargets))
		for _, pid := range result.PIDTargets {
			pidParts = append(pidParts, fmt.Sprintf("%d", pid))
		}
		result.ActionTaken = "kill -TERM"
		termCmd := fmt.Sprintf("for p in %s; do (sudo -n kill -TERM \"$p\" || kill -TERM \"$p\") 2>/dev/null || true; done", strings.Join(pidParts, " "))
		if _, runErr := s.run(ctx, termCmd, 20*time.Second); runErr != nil {
			return result, runErr
		}
		if mode == "force" {
			result.ActionTaken = "kill -TERM then kill -KILL"
			killCmd := fmt.Sprintf("sleep 1; for p in %s; do (sudo -n kill -KILL \"$p\" || kill -KILL \"$p\") 2>/dev/null || true; done", strings.Join(pidParts, " "))
			if _, runErr := s.run(ctx, killCmd, 20*time.Second); runErr != nil {
				return result, runErr
			}
		}
	}

	s.pause(500 * time.Millisecond)
	after, err := s.DetectPortOccupancy(ctx, port, protocol)
	if err != nil {
		return result, err
	}
	result.After = after
	occupied, _ := after["occupied"].(bool)
	result.Released = !occupied
	return result, nil
}

func (s PortRuntimeService) DetectSystemdSocketReservationsAllForRoute(ctx context.Context) (map[int][]map[string]any, error) {
	return s.detectSystemdSocketReservationsAll(ctx)
}

func (s PortRuntimeService) DetectKernelReservedPortsForRoute(ctx context.Context) ([]int, string, error) {
	return s.detectKernelReservedPorts(ctx)
}

func (s PortRuntimeService) DetectContainerDeclaredReservationsAllForRoute(ctx context.Context, protocol string) (map[int][]map[string]any, map[string]any, error) {
	return s.detectContainerDeclaredReservationsAll(ctx, protocol)
}

func (s PortRuntimeService) DetectContainerDeclaredReservationsAllProtocolsForRoute(ctx context.Context) (map[PortProtocolKey][]map[string]any, map[string]any, error) {
	return s.detectContainerDeclaredReservationsAllProtocols(ctx)
}

func (s PortRuntimeService) detectSystemdSocketReservationsAll(ctx context.Context) (map[int][]map[string]any, error) {
	raw, err := s.run(ctx, "systemctl list-sockets --all --no-legend --no-pager 2>/dev/null || true", 20*time.Second)
	if err != nil {
		return nil, err
	}
	byPort := make(map[int][]map[string]any)
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		port, ok := ExtractPortFromAddress(fields[0])
		if !ok {
			continue
		}
		entry := map[string]any{"raw": line, "listen": fields[0]}
		if len(fields) > 1 {
			entry["unit"] = fields[1]
		}
		if len(fields) > 2 {
			entry["activates"] = fields[2]
		}
		byPort[port] = append(byPort[port], entry)
	}
	return byPort, nil
}

func (s PortRuntimeService) detectKernelReservedPorts(ctx context.Context) ([]int, string, error) {
	raw, err := s.run(ctx, "cat /proc/sys/net/ipv4/ip_local_reserved_ports 2>/dev/null || true", 20*time.Second)
	if err != nil {
		return nil, "", err
	}
	ranges := strings.TrimSpace(raw)
	if ranges == "" {
		return []int{}, ranges, nil
	}
	return ParseRangePorts(ranges), ranges, nil
}

func (s PortRuntimeService) detectContainerDeclaredReservationsAll(ctx context.Context, protocol string) (map[int][]map[string]any, map[string]any, error) {
	raw, err := s.run(ctx, "if command -v docker >/dev/null 2>&1; then (docker ps -a --format '{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null || echo '__DOCKER_CLI_ERROR__'); else echo '__DOCKER_NOT_AVAILABLE__'; fi", 20*time.Second)
	if err != nil {
		return nil, nil, err
	}
	byPort, probe := ParseContainerDeclaredReservationsAll(raw, protocol, s.dockerPublishedPortPattern())
	return byPort, probe, nil
}

func (s PortRuntimeService) detectContainerDeclaredReservationsAllProtocols(ctx context.Context) (map[PortProtocolKey][]map[string]any, map[string]any, error) {
	raw, err := s.run(ctx, "if command -v docker >/dev/null 2>&1; then (docker ps -a --format '{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null || echo '__DOCKER_CLI_ERROR__'); else echo '__DOCKER_NOT_AVAILABLE__'; fi", 20*time.Second)
	if err != nil {
		return nil, nil, err
	}
	byKey, probe := ParseContainerDeclaredReservationsAllProtocols(raw, s.dockerPublishedPortPattern())
	return byKey, probe, nil
}

func (s PortRuntimeService) run(ctx context.Context, command string, timeout time.Duration) (string, error) {
	if s.Run == nil {
		return "", fmt.Errorf("port command runner is required")
	}
	return s.Run(ctx, command, timeout)
}

func (s PortRuntimeService) ssUsersProcessPattern() string {
	if strings.TrimSpace(s.SSUsersProcessPattern) != "" {
		return s.SSUsersProcessPattern
	}
	return DefaultSSUsersProcessPattern
}

func (s PortRuntimeService) dockerPublishedPortPattern() string {
	if strings.TrimSpace(s.DockerPublishedPortPattern) != "" {
		return s.DockerPublishedPortPattern
	}
	return DefaultDockerPublishedPortPattern
}

func (s PortRuntimeService) pause(duration time.Duration) {
	if s.Pause != nil {
		s.Pause(duration)
		return
	}
	time.Sleep(duration)
}