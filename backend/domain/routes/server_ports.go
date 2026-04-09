package routes

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/terminal"
)

// ════════════════════════════════════════════════════════════
// Port inspection & release handlers (Story 20.4)
// ════════════════════════════════════════════════════════════

func handleServerPortsList(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}

	protocol, view, paramErr := normalizePortInspectParams(e)
	if paramErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": paramErr.Error()})
	}

	cfg, err := resolveTerminalConfig(e.App, e.Auth, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	occupancyByPort := map[int]map[string]any{}
	if view == "occupancy" || view == "all" {
		occupancyByPort, err = detectAllPortOccupancy(e.Request.Context(), cfg, protocol)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
		}
	}

	reservationByPort := map[int][]map[string]any{}
	containerProbe := map[string]any{"available": true, "status": "ok"}
	if view == "reservation" || view == "all" {
		reservationByPort, containerProbe, err = detectAllPortReservations(e.Request.Context(), cfg, protocol)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
		}
	}

	portSet := make(map[int]struct{})
	for port := range occupancyByPort {
		portSet[port] = struct{}{}
	}
	for port := range reservationByPort {
		portSet[port] = struct{}{}
	}

	ports := make([]int, 0, len(portSet))
	for port := range portSet {
		ports = append(ports, port)
	}
	slices.Sort(ports)

	items := make([]map[string]any, 0, len(ports))
	for _, port := range ports {
		item := map[string]any{"port": port}
		if view == "occupancy" || view == "all" {
			if occupancy, ok := occupancyByPort[port]; ok {
				item["occupancy"] = occupancy
			} else {
				item["occupancy"] = map[string]any{"occupied": false, "listeners": []map[string]any{}}
			}
		}
		if view == "reservation" || view == "all" {
			sources := reservationByPort[port]
			item["reservation"] = map[string]any{
				"reserved":        len(sources) > 0,
				"sources":         sources,
				"container_probe": containerProbe,
			}
		}
		items = append(items, item)
	}

	result := map[string]any{
		"server_id":   serverID,
		"protocol":    protocol,
		"view":        view,
		"detected_at": time.Now().UTC().Format(time.RFC3339),
		"ports":       items,
		"total":       len(items),
	}
	if view == "reservation" || view == "all" {
		result["reservation_meta"] = map[string]any{
			"container_probe": containerProbe,
		}
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "server.ops.ports.list",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail: map[string]any{
			"protocol": protocol,
			"view":     view,
			"total":    len(items),
		},
	})

	return e.JSON(http.StatusOK, result)
}

func handleServerPortInspect(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}

	portRaw := strings.TrimSpace(e.Request.PathValue("port"))
	port, convErr := strconv.Atoi(portRaw)
	if convErr != nil || port < 1 || port > 65535 {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "port must be between 1 and 65535"})
	}

	protocol, view, paramErr := normalizePortInspectParams(e)
	if paramErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": paramErr.Error()})
	}

	cfg, err := resolveTerminalConfig(e.App, e.Auth, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	result := map[string]any{
		"server_id":   serverID,
		"port":        port,
		"protocol":    protocol,
		"view":        view,
		"detected_at": time.Now().UTC().Format(time.RFC3339),
	}

	if view == "occupancy" || view == "all" {
		occupancy, occupancyErr := detectPortOccupancy(e.Request.Context(), cfg, port, protocol)
		if occupancyErr != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"message": occupancyErr.Error()})
		}
		result["occupancy"] = occupancy
	}

	if view == "reservation" || view == "all" {
		reservation, reservationErr := detectPortReservation(e.Request.Context(), cfg, port, protocol)
		if reservationErr != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"message": reservationErr.Error()})
		}
		result["reservation"] = reservation
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "server.ops.port.inspect",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail: map[string]any{
			"port":     port,
			"protocol": protocol,
			"view":     view,
		},
	})

	return e.JSON(http.StatusOK, result)
}

func handleServerPortRelease(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}

	portRaw := strings.TrimSpace(e.Request.PathValue("port"))
	port, convErr := strconv.Atoi(portRaw)
	if convErr != nil || port < 1 || port > 65535 {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "port must be between 1 and 65535"})
	}

	protocol := strings.ToLower(strings.TrimSpace(e.Request.URL.Query().Get("protocol")))
	if protocol == "" {
		protocol = "tcp"
	}
	if protocol != "tcp" && protocol != "udp" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "protocol must be tcp or udp"})
	}

	var body struct {
		Mode string `json:"mode"`
	}
	if e.Request.Body != nil {
		if err := e.BindBody(&body); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"message": "invalid request body"})
		}
	}
	mode, modeErr := normalizePortReleaseMode(body.Mode)
	if modeErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": modeErr.Error()})
	}

	cfg, err := resolveTerminalConfig(e.App, e.Auth, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	before, occupancyErr := detectPortOccupancy(e.Request.Context(), cfg, port, protocol)
	if occupancyErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": occupancyErr.Error()})
	}
	if occupied, _ := before["occupied"].(bool); !occupied {
		return e.JSON(http.StatusConflict, map[string]any{"message": "port is not occupied", "port": port, "protocol": protocol})
	}

	actionTaken := ""
	ownerType := "host_process"
	pidTargets := []int{}
	containerProbe := map[string]any{"available": true, "status": "ok"}
	containerOwner := map[string]any{}

	runningContainer, probe, containerErr := detectRunningContainerByPort(e.Request.Context(), cfg, port, protocol)
	if containerErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": containerErr.Error()})
	}
	containerProbe = probe

	if len(runningContainer) > 0 {
		ownerType = "container"
		containerOwner = map[string]any{
			"container_id":     runningContainer["container_id"],
			"container_name":   runningContainer["container_name"],
			"container_status": runningContainer["container_status"],
		}
		containerID := runningContainer["container_id"]
		var releaseCmd string
		if mode == "force" {
			actionTaken = "docker kill"
			releaseCmd = fmt.Sprintf("(sudo -n docker kill %s || docker kill %s)", terminal.ShellQuote(containerID), terminal.ShellQuote(containerID))
		} else {
			actionTaken = "docker stop"
			releaseCmd = fmt.Sprintf("(sudo -n docker stop %s || docker stop %s)", terminal.ShellQuote(containerID), terminal.ShellQuote(containerID))
		}
		output, runErr := terminal.ExecuteSSHCommand(e.Request.Context(), cfg, releaseCmd, 30*time.Second)
		if runErr != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error(), "output": output})
		}
	} else {
		pidTargets = extractOccupancyPIDs(before)
		if len(pidTargets) == 0 {
			return e.JSON(http.StatusConflict, map[string]any{
				"message":         "unable to resolve process pid for occupied port",
				"port":            port,
				"protocol":        protocol,
				"container_probe": containerProbe,
			})
		}
		actionTaken = "kill -TERM"
		pidParts := make([]string, 0, len(pidTargets))
		for _, pid := range pidTargets {
			pidParts = append(pidParts, strconv.Itoa(pid))
		}
		termCmd := fmt.Sprintf("for p in %s; do (sudo -n kill -TERM \"$p\" || kill -TERM \"$p\") 2>/dev/null || true; done", strings.Join(pidParts, " "))
		if _, runErr := terminal.ExecuteSSHCommand(e.Request.Context(), cfg, termCmd, 20*time.Second); runErr != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
		}
		if mode == "force" {
			actionTaken = "kill -TERM then kill -KILL"
			killCmd := fmt.Sprintf("sleep 1; for p in %s; do (sudo -n kill -KILL \"$p\" || kill -KILL \"$p\") 2>/dev/null || true; done", strings.Join(pidParts, " "))
			if _, runErr := terminal.ExecuteSSHCommand(e.Request.Context(), cfg, killCmd, 20*time.Second); runErr != nil {
				return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
			}
		}
	}

	time.Sleep(500 * time.Millisecond)

	after, afterErr := detectPortOccupancy(e.Request.Context(), cfg, port, protocol)
	if afterErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": afterErr.Error()})
	}
	released, _ := after["occupied"].(bool)
	released = !released

	userID, _, ip, _ := clientInfo(e)
	status := audit.StatusSuccess
	if !released {
		status = audit.StatusFailed
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "server.ops.port.release",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       status,
		IP:           ip,
		Detail: map[string]any{
			"port":         port,
			"protocol":     protocol,
			"mode":         mode,
			"owner_type":   ownerType,
			"action_taken": actionTaken,
			"released":     released,
			"pid_targets":  pidTargets,
		},
	})

	statusCode := http.StatusOK
	if !released {
		statusCode = http.StatusConflict
	}

	return e.JSON(statusCode, map[string]any{
		"server_id":       serverID,
		"port":            port,
		"protocol":        protocol,
		"mode":            mode,
		"owner_type":      ownerType,
		"action_taken":    actionTaken,
		"pid_targets":     pidTargets,
		"container_owner": containerOwner,
		"container_probe": containerProbe,
		"released":        released,
		"before":          before,
		"after":           after,
	})
}

// ════════════════════════════════════════════════════════════
// Port detection helpers
// ════════════════════════════════════════════════════════════

func detectPortOccupancy(ctx context.Context, cfg terminal.ConnectorConfig, port int, protocol string) (map[string]any, error) {
	all, err := detectAllPortOccupancy(ctx, cfg, protocol)
	if err != nil {
		return nil, err
	}
	if existing, ok := all[port]; ok {
		return existing, nil
	}
	return map[string]any{
		"occupied":  false,
		"listeners": []map[string]any{},
	}, nil
}

func detectAllPortOccupancy(ctx context.Context, cfg terminal.ConnectorConfig, protocol string) (map[int]map[string]any, error) {
	command := "ss -lntpH 2>/dev/null || true"
	if protocol == "udp" {
		command = "ss -lnupH 2>/dev/null || true"
	}

	raw, err := terminal.ExecuteSSHCommand(ctx, cfg, command, 20*time.Second)
	if err != nil {
		return nil, err
	}

	listeners := parseSSPortListeners(raw)
	byPortListeners := make(map[int][]map[string]any)
	for _, listener := range listeners {
		localAddress := fmt.Sprintf("%v", listener["local_address"])
		port, ok := extractPortFromAddress(localAddress)
		if !ok {
			continue
		}
		byPortListeners[port] = append(byPortListeners[port], listener)
	}

	result := make(map[int]map[string]any)
	for port, portListeners := range byPortListeners {
		pids := extractPIDsFromListeners(portListeners)
		entry := map[string]any{
			"occupied":  len(portListeners) > 0,
			"listeners": portListeners,
			"pids":      pids,
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

func extractPortFromAddress(address string) (int, bool) {
	address = strings.TrimSpace(address)
	if address == "" {
		return 0, false
	}
	idx := strings.LastIndex(address, ":")
	if idx < 0 || idx == len(address)-1 {
		return 0, false
	}
	value, err := strconv.Atoi(address[idx+1:])
	if err != nil || value < 1 || value > 65535 {
		return 0, false
	}
	return value, true
}

func parseSSPortListeners(raw string) []map[string]any {
	listeners := make([]map[string]any, 0)
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		baseLine := line
		if idx := strings.Index(baseLine, " users:("); idx >= 0 {
			baseLine = baseLine[:idx]
		}
		fields := strings.Fields(baseLine)
		if len(fields) < 2 {
			continue
		}

		localAddress := ""
		peerAddress := ""
		if len(fields) >= 2 {
			localAddress = fields[len(fields)-2]
			peerAddress = fields[len(fields)-1]
		}

		entry := map[string]any{
			"state":         fields[0],
			"local_address": localAddress,
			"peer_address":  peerAddress,
			"raw":           line,
		}

		processes := make([]map[string]any, 0)
		pidSet := make(map[int]struct{})
		for _, matches := range ssUsersProcessPattern.FindAllStringSubmatch(line, -1) {
			if len(matches) != 3 {
				continue
			}
			pid, _ := strconv.Atoi(matches[2])
			process := map[string]any{"name": matches[1]}
			if pid > 0 {
				process["pid"] = pid
				pidSet[pid] = struct{}{}
			}
			processes = append(processes, process)
		}
		if len(processes) > 0 {
			entry["process"] = processes[0]
			entry["processes"] = processes
			pids := make([]int, 0, len(pidSet))
			for pid := range pidSet {
				pids = append(pids, pid)
			}
			slices.Sort(pids)
			entry["pids"] = pids
		}

		listeners = append(listeners, entry)
	}
	return listeners
}

func detectPortReservation(ctx context.Context, cfg terminal.ConnectorConfig, port int, protocol string) (map[string]any, error) {
	all, containerProbe, err := detectAllPortReservations(ctx, cfg, protocol)
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

func detectAllPortReservations(ctx context.Context, cfg terminal.ConnectorConfig, protocol string) (map[int][]map[string]any, map[string]any, error) {
	byPort := make(map[int][]map[string]any)

	systemdByPort, err := detectSystemdSocketReservationsAll(ctx, cfg)
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

	kernelPorts, kernelRanges, err := detectKernelReservedPorts(ctx, cfg)
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

	containerByPort, containerProbe, err := detectContainerDeclaredReservationsAll(ctx, cfg, protocol)
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

func detectSystemdSocketReservationsAll(ctx context.Context, cfg terminal.ConnectorConfig) (map[int][]map[string]any, error) {
	raw, err := terminal.ExecuteSSHCommand(ctx, cfg, "systemctl list-sockets --all --no-legend --no-pager 2>/dev/null || true", 20*time.Second)
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
		port, ok := extractPortFromAddress(fields[0])
		if !ok {
			continue
		}
		entry := map[string]any{"raw": line}
		entry["listen"] = fields[0]
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

func detectKernelReservedPorts(ctx context.Context, cfg terminal.ConnectorConfig) ([]int, string, error) {
	raw, err := terminal.ExecuteSSHCommand(ctx, cfg, "cat /proc/sys/net/ipv4/ip_local_reserved_ports 2>/dev/null || true", 20*time.Second)
	if err != nil {
		return nil, "", err
	}
	ranges := strings.TrimSpace(raw)
	if ranges == "" {
		return []int{}, ranges, nil
	}
	ports := parseRangePorts(ranges)
	return ports, ranges, nil
}

func parseRangePorts(ranges string) []int {
	portSet := make(map[int]struct{})
	for _, token := range strings.Split(ranges, ",") {
		token = strings.TrimSpace(token)
		if token == "" {
			continue
		}
		if strings.Contains(token, "-") {
			parts := strings.SplitN(token, "-", 2)
			if len(parts) != 2 {
				continue
			}
			start, startErr := strconv.Atoi(strings.TrimSpace(parts[0]))
			end, endErr := strconv.Atoi(strings.TrimSpace(parts[1]))
			if startErr != nil || endErr != nil {
				continue
			}
			if start > end {
				start, end = end, start
			}
			if start < 1 {
				start = 1
			}
			if end > 65535 {
				end = 65535
			}
			if end-start > 1024 {
				continue
			}
			for value := start; value <= end; value++ {
				portSet[value] = struct{}{}
			}
			continue
		}
		value, convErr := strconv.Atoi(token)
		if convErr == nil && value >= 1 && value <= 65535 {
			portSet[value] = struct{}{}
		}
	}
	ports := make([]int, 0, len(portSet))
	for value := range portSet {
		ports = append(ports, value)
	}
	slices.Sort(ports)
	return ports
}

func detectContainerDeclaredReservationsAll(ctx context.Context, cfg terminal.ConnectorConfig, protocol string) (map[int][]map[string]any, map[string]any, error) {
	command := "if command -v docker >/dev/null 2>&1; then (docker ps -a --format '{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null || echo '__DOCKER_CLI_ERROR__'); else echo '__DOCKER_NOT_AVAILABLE__'; fi"
	raw, err := terminal.ExecuteSSHCommand(ctx, cfg, command, 20*time.Second)
	if err != nil {
		return nil, nil, err
	}
	matchesByPort, probe := parseContainerDeclaredReservationsAll(raw, protocol)
	return matchesByPort, probe, nil
}

func detectRunningContainerByPort(ctx context.Context, cfg terminal.ConnectorConfig, port int, protocol string) (map[string]string, map[string]any, error) {
	command := "if command -v docker >/dev/null 2>&1; then (docker ps --format '{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null || echo '__DOCKER_CLI_ERROR__'); else echo '__DOCKER_NOT_AVAILABLE__'; fi"
	raw, err := terminal.ExecuteSSHCommand(ctx, cfg, command, 20*time.Second)
	if err != nil {
		return nil, nil, err
	}
	matches, probe := parseContainerDeclaredReservations(raw, port, protocol)
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

func parseContainerDeclaredReservationsAll(raw string, protocol string) (map[int][]map[string]any, map[string]any) {
	probe := map[string]any{"available": true, "status": "ok"}
	trimmed := strings.TrimSpace(raw)
	if trimmed == "__DOCKER_NOT_AVAILABLE__" {
		probe["available"] = false
		probe["status"] = "not_available"
		return map[int][]map[string]any{}, probe
	}
	if strings.Contains(trimmed, "__DOCKER_CLI_ERROR__") {
		probe["available"] = false
		probe["status"] = "error"
		return map[int][]map[string]any{}, probe
	}

	byPort := make(map[int][]map[string]any)
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 4)
		if len(parts) < 4 {
			continue
		}
		portsField := strings.TrimSpace(parts[3])
		if portsField == "" {
			continue
		}
		ports := parseDockerPublishedPorts(portsField, protocol)
		for _, port := range ports {
			byPort[port] = append(byPort[port], map[string]any{
				"container_id":     parts[0],
				"container_name":   parts[1],
				"container_status": parts[2],
				"ports":            portsField,
			})
		}
	}

	return byPort, probe
}

func parseContainerDeclaredReservations(raw string, port int, protocol string) ([]map[string]any, map[string]any) {
	all, probe := parseContainerDeclaredReservationsAll(raw, protocol)
	return all[port], probe
}

func extractPIDsFromListeners(listeners []map[string]any) []int {
	pidSet := make(map[int]struct{})
	for _, listener := range listeners {
		rawPIDs, ok := listener["pids"].([]int)
		if ok {
			for _, pid := range rawPIDs {
				if pid > 0 {
					pidSet[pid] = struct{}{}
				}
			}
			continue
		}
		if genericPIDs, ok := listener["pids"].([]any); ok {
			for _, item := range genericPIDs {
				switch value := item.(type) {
				case int:
					if value > 0 {
						pidSet[value] = struct{}{}
					}
				case float64:
					if int(value) > 0 {
						pidSet[int(value)] = struct{}{}
					}
				}
			}
		}
	}
	pids := make([]int, 0, len(pidSet))
	for pid := range pidSet {
		pids = append(pids, pid)
	}
	slices.Sort(pids)
	return pids
}

func extractOccupancyPIDs(occupancy map[string]any) []int {
	if typed, ok := occupancy["pids"].([]int); ok {
		pids := make([]int, 0, len(typed))
		for _, pid := range typed {
			if pid > 0 {
				pids = append(pids, pid)
			}
		}
		slices.Sort(pids)
		return pids
	}
	if generic, ok := occupancy["pids"].([]any); ok {
		pidSet := make(map[int]struct{})
		for _, item := range generic {
			switch value := item.(type) {
			case int:
				if value > 0 {
					pidSet[value] = struct{}{}
				}
			case float64:
				if int(value) > 0 {
					pidSet[int(value)] = struct{}{}
				}
			}
		}
		pids := make([]int, 0, len(pidSet))
		for pid := range pidSet {
			pids = append(pids, pid)
		}
		slices.Sort(pids)
		return pids
	}
	if process, ok := occupancy["process"].(map[string]any); ok {
		if pidAny, ok := process["pid"]; ok {
			switch value := pidAny.(type) {
			case int:
				if value > 0 {
					return []int{value}
				}
			case float64:
				if int(value) > 0 {
					return []int{int(value)}
				}
			}
		}
	}
	return []int{}
}

func parseDockerPublishedPorts(portsField string, protocol string) []int {
	proto := strings.ToLower(strings.TrimSpace(protocol))
	portSet := make(map[int]struct{})
	for _, match := range dockerPublishedPortPattern.FindAllStringSubmatch(strings.ToLower(portsField), -1) {
		if len(match) != 3 {
			continue
		}
		if match[2] != proto {
			continue
		}
		port, err := strconv.Atoi(match[1])
		if err != nil || port < 1 || port > 65535 {
			continue
		}
		portSet[port] = struct{}{}
	}
	ports := make([]int, 0, len(portSet))
	for port := range portSet {
		ports = append(ports, port)
	}
	slices.Sort(ports)
	return ports
}
