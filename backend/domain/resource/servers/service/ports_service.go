package service

import (
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

type PortProtocolKey struct {
	Port     int
	Protocol string
}

func BuildPortListResult(serverID, protocol, view string, occupancyByPort map[int]map[string]any, reservationByPort map[int][]map[string]any, containerProbe map[string]any, detectedAt time.Time) map[string]any {
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
		"detected_at": detectedAt.UTC().Format(time.RFC3339),
		"ports":       items,
		"total":       len(items),
	}
	if view == "reservation" || view == "all" {
		result["reservation_meta"] = map[string]any{"container_probe": containerProbe}
	}
	return result
}

func BuildAllProtocolPortListResult(serverID, view string, occupancyByKey map[PortProtocolKey]map[string]any, reservationByKey map[PortProtocolKey][]map[string]any, containerProbe map[string]any, detectedAt time.Time) (map[string]any, int) {
	keySet := make(map[PortProtocolKey]struct{})
	for key := range occupancyByKey {
		keySet[key] = struct{}{}
	}
	for key := range reservationByKey {
		keySet[key] = struct{}{}
	}

	keys := make([]PortProtocolKey, 0, len(keySet))
	for key := range keySet {
		keys = append(keys, key)
	}
	slices.SortFunc(keys, func(left, right PortProtocolKey) int {
		if left.Port != right.Port {
			return left.Port - right.Port
		}
		return strings.Compare(left.Protocol, right.Protocol)
	})

	items := make([]map[string]any, 0, len(keys))
	for _, key := range keys {
		item := map[string]any{"port": key.Port, "protocol": key.Protocol}
		if view == "occupancy" || view == "all" {
			if occupancy, ok := occupancyByKey[key]; ok {
				item["occupancy"] = occupancy
			} else {
				item["occupancy"] = map[string]any{"occupied": false, "listeners": []map[string]any{}}
			}
		}
		if view == "reservation" || view == "all" {
			sources := reservationByKey[key]
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
		"protocol":    "all",
		"view":        view,
		"detected_at": detectedAt.UTC().Format(time.RFC3339),
		"ports":       items,
		"total":       len(items),
	}
	if view == "reservation" || view == "all" {
		result["reservation_meta"] = map[string]any{"container_probe": containerProbe}
	}
	return result, len(items)
}

func ExtractPortFromAddress(address string) (int, bool) {
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

func ParseSSPortListeners(raw string, usersProcessPattern string) []map[string]any {
	listeners := make([]map[string]any, 0)
	processPattern := regexp.MustCompile(usersProcessPattern)
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

		localAddress := fields[len(fields)-2]
		peerAddress := fields[len(fields)-1]
		entry := map[string]any{
			"state":         fields[0],
			"local_address": localAddress,
			"peer_address":  peerAddress,
			"raw":           line,
		}

		processes := make([]map[string]any, 0)
		pidSet := make(map[int]struct{})
		for _, matches := range processPattern.FindAllStringSubmatch(line, -1) {
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

func ExtractPIDsFromListeners(listeners []map[string]any) []int {
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

func ExtractOccupancyPIDs(occupancy map[string]any) []int {
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

func ParseRangePorts(ranges string) []int {
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

func ParseContainerDeclaredReservationsAll(raw string, protocol string, dockerPublishedPortPattern string) (map[int][]map[string]any, map[string]any) {
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
		ports := ParseDockerPublishedPorts(portsField, protocol, dockerPublishedPortPattern)
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

func ParseContainerDeclaredReservationsAllProtocols(raw string, dockerPublishedPortPattern string) (map[PortProtocolKey][]map[string]any, map[string]any) {
	probe := map[string]any{"available": true, "status": "ok"}
	trimmed := strings.TrimSpace(raw)
	if trimmed == "__DOCKER_NOT_AVAILABLE__" {
		probe["available"] = false
		probe["status"] = "not_available"
		return map[PortProtocolKey][]map[string]any{}, probe
	}
	if strings.Contains(trimmed, "__DOCKER_CLI_ERROR__") {
		probe["available"] = false
		probe["status"] = "error"
		return map[PortProtocolKey][]map[string]any{}, probe
	}

	byKey := make(map[PortProtocolKey][]map[string]any)
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
		for _, key := range ParseDockerPublishedPortKeys(portsField, dockerPublishedPortPattern) {
			byKey[key] = append(byKey[key], map[string]any{
				"container_id":     parts[0],
				"container_name":   parts[1],
				"container_status": parts[2],
				"ports":            portsField,
			})
		}
	}

	return byKey, probe
}

func ParseContainerDeclaredReservations(raw string, port int, protocol string, dockerPublishedPortPattern string) ([]map[string]any, map[string]any) {
	all, probe := ParseContainerDeclaredReservationsAll(raw, protocol, dockerPublishedPortPattern)
	return all[port], probe
}

func ParseDockerPublishedPorts(portsField string, protocol string, dockerPublishedPortPattern string) []int {
	proto := strings.ToLower(strings.TrimSpace(protocol))
	portSet := make(map[int]struct{})
	pattern := regexp.MustCompile(dockerPublishedPortPattern)
	for _, match := range pattern.FindAllStringSubmatch(strings.ToLower(portsField), -1) {
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

func ParseDockerPublishedPortKeys(portsField string, dockerPublishedPortPattern string) []PortProtocolKey {
	keySet := make(map[PortProtocolKey]struct{})
	pattern := regexp.MustCompile(dockerPublishedPortPattern)
	for _, match := range pattern.FindAllStringSubmatch(strings.ToLower(portsField), -1) {
		if len(match) != 3 {
			continue
		}
		port, err := strconv.Atoi(match[1])
		if err != nil || port < 1 || port > 65535 {
			continue
		}
		protocol := strings.TrimSpace(match[2])
		if protocol != "tcp" && protocol != "udp" {
			continue
		}
		keySet[PortProtocolKey{Port: port, Protocol: protocol}] = struct{}{}
	}
	keys := make([]PortProtocolKey, 0, len(keySet))
	for key := range keySet {
		keys = append(keys, key)
	}
	slices.SortFunc(keys, func(left, right PortProtocolKey) int {
		if left.Port != right.Port {
			return left.Port - right.Port
		}
		return strings.Compare(left.Protocol, right.Protocol)
	})
	return keys
}