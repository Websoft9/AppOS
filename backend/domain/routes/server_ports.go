package routes

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/websoft9/appos/backend/domain/audit"
	serversvc "github.com/websoft9/appos/backend/domain/resource/servers/service"
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

	protocol, view, paramErr := normalizePortListParams(e)
	if paramErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": paramErr.Error()})
	}

	cfg, err := resolveTerminalConfig(e.App, e.Auth, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}
	release, gateErr := acquireServerRealtimeSSHRead(e.Request.Context(), serverID)
	if gateErr != nil {
		return e.JSON(http.StatusServiceUnavailable, map[string]any{"message": gateErr.Error()})
	}
	defer release()
	run, cleanup, runnerErr := reusableRouteSSHCommandRunner(e.Request.Context(), cfg)
	if runnerErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runnerErr.Error()})
	}
	defer cleanup()
	runtime := newPortRuntimeService(run)

	if protocol == "all" {
		result, total, buildErr := buildAllProtocolPortsList(e.Request.Context(), runtime, serverID, view)
		if buildErr != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"message": buildErr.Error()})
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
				"total":    total,
			},
		})
		return e.JSON(http.StatusOK, result)
	}

	occupancyByPort := map[int]map[string]any{}
	if view == "occupancy" || view == "all" {
		occupancyByPort, err = runtime.DetectAllPortOccupancy(e.Request.Context(), protocol)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
		}
	}

	reservationByPort := map[int][]map[string]any{}
	containerProbe := map[string]any{"available": true, "status": "ok"}
	if view == "reservation" || view == "all" {
		reservationByPort, containerProbe, err = runtime.DetectAllPortReservations(e.Request.Context(), protocol)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
		}
	}

	result := serversvc.BuildPortListResult(serverID, protocol, view, occupancyByPort, reservationByPort, containerProbe, time.Now().UTC())

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
			"total":    result["total"],
		},
	})

	return e.JSON(http.StatusOK, result)
}

func buildAllProtocolPortsList(ctx context.Context, runtime serversvc.PortRuntimeService, serverID string, view string) (map[string]any, int, error) {
	occupancyByKey := map[serversvc.PortProtocolKey]map[string]any{}
	if view == "occupancy" || view == "all" {
		for _, proto := range []string{"tcp", "udp"} {
			byPort, err := runtime.DetectAllPortOccupancy(ctx, proto)
			if err != nil {
				return nil, 0, err
			}
			for port, occupancy := range byPort {
				occupancyByKey[serversvc.PortProtocolKey{Port: port, Protocol: proto}] = occupancy
			}
		}
	}

	reservationByKey := map[serversvc.PortProtocolKey][]map[string]any{}
	containerProbe := map[string]any{"available": true, "status": "ok"}
	if view == "reservation" || view == "all" {
		var err error
		reservationByKey, containerProbe, err = runtime.DetectAllProtocolPortReservations(ctx)
		if err != nil {
			return nil, 0, err
		}
	}

	result, total := serversvc.BuildAllProtocolPortListResult(
		serverID,
		view,
		occupancyByKey,
		reservationByKey,
		containerProbe,
		time.Now().UTC(),
	)

	return result, total, nil
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
	runtime := newDirectPortRuntimeService(cfg)

	result := map[string]any{
		"server_id":   serverID,
		"port":        port,
		"protocol":    protocol,
		"view":        view,
		"detected_at": time.Now().UTC().Format(time.RFC3339),
	}

	if view == "occupancy" || view == "all" {
		occupancy, occupancyErr := runtime.DetectPortOccupancy(e.Request.Context(), port, protocol)
		if occupancyErr != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"message": occupancyErr.Error()})
		}
		result["occupancy"] = occupancy
	}

	if view == "reservation" || view == "all" {
		reservation, reservationErr := runtime.DetectPortReservation(e.Request.Context(), port, protocol)
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

	result, releaseErr := newDirectPortRuntimeService(cfg).ReleasePort(e.Request.Context(), port, protocol, mode)
	if releaseErr != nil {
		if errors.Is(releaseErr, serversvc.ErrPortNotOccupied) {
			return e.JSON(http.StatusConflict, map[string]any{"message": "port is not occupied", "port": port, "protocol": protocol})
		}
		if errors.Is(releaseErr, serversvc.ErrPortPIDNotResolvable) {
			return e.JSON(http.StatusConflict, map[string]any{
				"message":         releaseErr.Error(),
				"port":            port,
				"protocol":        protocol,
				"container_probe": result.ContainerProbe,
			})
		}
		var execErr *serversvc.PortCommandExecutionError
		if errors.As(releaseErr, &execErr) {
			response := map[string]any{"message": releaseErr.Error()}
			if execErr.Output != "" {
				response["output"] = execErr.Output
			}
			return e.JSON(http.StatusInternalServerError, response)
		}
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": releaseErr.Error()})
	}

	userID, _, ip, _ := clientInfo(e)
	status := audit.StatusSuccess
	if !result.Released {
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
			"owner_type":   result.OwnerType,
			"action_taken": result.ActionTaken,
			"released":     result.Released,
			"pid_targets":  result.PIDTargets,
		},
	})

	statusCode := http.StatusOK
	if !result.Released {
		statusCode = http.StatusConflict
	}

	return e.JSON(statusCode, map[string]any{
		"server_id":       serverID,
		"port":            port,
		"protocol":        protocol,
		"mode":            mode,
		"owner_type":      result.OwnerType,
		"action_taken":    result.ActionTaken,
		"pid_targets":     result.PIDTargets,
		"container_owner": result.ContainerOwner,
		"container_probe": result.ContainerProbe,
		"released":        result.Released,
		"before":          result.Before,
		"after":           result.After,
	})
}

func newPortRuntimeService(run routeSSHCommandRunner) serversvc.PortRuntimeService {
	return serversvc.PortRuntimeService{
		Run:                        routeSSHCommandAdapter(run),
		SSUsersProcessPattern:      ssUsersProcessPattern.String(),
		DockerPublishedPortPattern: dockerPublishedPortPattern.String(),
	}
}

func newDirectPortRuntimeService(cfg terminal.ConnectorConfig) serversvc.PortRuntimeService {
	return serversvc.PortRuntimeService{
		Run:                        directSSHCommandAdapter(cfg),
		SSUsersProcessPattern:      ssUsersProcessPattern.String(),
		DockerPublishedPortPattern: dockerPublishedPortPattern.String(),
	}
}
