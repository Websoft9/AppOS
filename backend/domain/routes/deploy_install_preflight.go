package routes

import (
	"context"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	installprobe "github.com/websoft9/appos/backend/domain/lifecycle/runtime/installprobe"
	lifecyclesvc "github.com/websoft9/appos/backend/domain/lifecycle/service"
	servers "github.com/websoft9/appos/backend/domain/resource/control/servers"
)

func newRouteInstallPreflightProbe(e *core.RequestEvent) lifecyclesvc.InstallPreflightProbe {
	targets := map[string]installprobe.Target{}
	resolveTarget := func(serverID string) (installprobe.Target, error) {
		if existing, ok := targets[serverID]; ok {
			return existing, nil
		}
		if serverID == "local" {
			target := installprobe.Target{Available: false, WarnReason: "Resource checks are limited for the local pseudo target until it is represented as a managed server record."}
			targets[serverID] = target
			return target, nil
		}
		cfg, err := servers.ResolveConfig(e.App, e.Auth, serverID)
		if err != nil {
			return installprobe.Target{}, err
		}
		target := installprobe.Target{Config: cfg, Available: true}
		targets[serverID] = target
		return target, nil
	}

	return installprobe.NewAdapter(installprobe.Dependencies{
		ResolveTarget: resolveTarget,
		DetectProtocolPorts: func(ctx context.Context, cfg servers.ConnectorConfig, ports []int, protocol string) (map[int]map[string]any, map[int]map[string]any, map[string]any, error) {
			return detectComposeProtocolPorts(ctx, cfg, ports, protocol)
		},
		ExecuteSSHCommand: executeSSHCommand,
		ShellQuote:        shellQuote,
	})
}

func detectComposeProtocolPorts(ctx context.Context, cfg servers.ConnectorConfig, ports []int, protocol string) (map[int]map[string]any, map[int]map[string]any, map[string]any, error) {
	if len(ports) == 0 {
		return map[int]map[string]any{}, map[int]map[string]any{}, map[string]any{"available": true, "status": "ok"}, nil
	}
	occupancyByPort, err := detectAllPortOccupancy(ctx, cfg, protocol)
	if err != nil {
		return nil, nil, nil, err
	}
	reservationByPort, containerProbe, err := detectAllPortReservations(ctx, cfg, protocol)
	if err != nil {
		return nil, nil, nil, err
	}
	occupancy := make(map[int]map[string]any, len(ports))
	reservations := make(map[int]map[string]any, len(ports))
	for _, port := range ports {
		if existing, ok := occupancyByPort[port]; ok {
			occupancy[port] = existing
		} else {
			occupancy[port] = map[string]any{"occupied": false, "listeners": []map[string]any{}}
		}
		sources := reservationByPort[port]
		reservations[port] = map[string]any{"reserved": len(sources) > 0, "sources": sources, "container_probe": containerProbe}
	}
	return occupancy, reservations, containerProbe, nil
}

func parseInstallMetadata(body map[string]any) map[string]any {
	return lifecyclesvc.NormalizeInstallMetadata(bodyMap(body, "metadata"), bodyInt64(body, "app_required_disk_bytes"), bodyFloat64(body, "app_required_disk_gib"))
}

func mergeMetadata(base map[string]any, extra map[string]any) map[string]any {
	return lifecyclesvc.MergeMetadata(base, extra)
}

func bodyInt64(body map[string]any, key string) int64 {
	raw, ok := body[key]
	if !ok || raw == nil {
		return 0
	}
	switch typed := raw.(type) {
	case int:
		return int64(typed)
	case int64:
		return typed
	case float64:
		return int64(typed)
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 0
		}
		parsed, err := strconv.ParseInt(trimmed, 10, 64)
		if err != nil {
			return 0
		}
		return parsed
	default:
		return 0
	}
}

func bodyFloat64(body map[string]any, key string) float64 {
	raw, ok := body[key]
	if !ok || raw == nil {
		return 0
	}
	switch typed := raw.(type) {
	case float64:
		return typed
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 0
		}
		parsed, err := strconv.ParseFloat(trimmed, 64)
		if err != nil {
			return 0
		}
		return parsed
	default:
		return 0
	}
}
