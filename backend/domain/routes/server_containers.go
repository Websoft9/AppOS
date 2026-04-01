package routes

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/websoft9/appos/backend/domain/audit"
	servers "github.com/websoft9/appos/backend/domain/servers"
)

func registerServerContainerRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	g.GET("/containers/{containerId}/shell", handleDockerExecTerminal)
}

// handleDockerExecTerminal upgrades to a WebSocket PTY for docker exec on a container.
//
// @Summary Docker exec WebSocket terminal
// @Description Upgrades to a WebSocket PTY session inside the given container via docker exec. Supports remote servers via server_id. Superuser only.
// @Tags Server Containers
// @Security BearerAuth
// @Param containerId path string true "container ID or name"
// @Param server_id query string false "server ID (omit for local)"
// @Param shell query string false "shell binary" Enums(/bin/sh, /bin/bash, /bin/zsh)
// @Success 101 {string} string "WebSocket upgrade"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/servers/containers/{containerId}/shell [get]
func handleDockerExecTerminal(e *core.RequestEvent) error {
	containerID := e.Request.PathValue("containerId")
	if containerID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "containerId required"})
	}

	shell := e.Request.URL.Query().Get("shell")
	if shell == "" {
		shell = "/bin/sh"
	}
	if shell != "/bin/sh" && shell != "/bin/bash" && shell != "/bin/zsh" {
		shell = "/bin/sh"
	}
	containerPattern := regexp.MustCompile(`^[a-zA-Z0-9_.-]+$`)
	if !containerPattern.MatchString(containerID) {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "invalid containerId"})
	}

	serverID := e.Request.URL.Query().Get("server_id")
	if serverID == "" {
		serverID = "local"
	}

	conn, err := wsUpgrader.Upgrade(e.Response, e.Request, nil)
	if err != nil {
		return nil
	}
	defer conn.Close()

	var cfg servers.ConnectorConfig
	var connector servers.Connector
	if serverID == "local" {
		cfg = servers.ConnectorConfig{Host: containerID, Shell: shell}
		connector = &servers.DockerExecConnector{}
	} else {
		resolvedCfg, resolveErr := resolveServerConfig(e, serverID)
		if resolveErr != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
		}
		resolvedCfg.Shell = fmt.Sprintf("docker exec -it %s %s", containerID, shell)
		cfg = resolvedCfg
		connector = &servers.SSHConnector{}
	}

	sess, err := connector.Connect(e.Request.Context(), cfg)
	if err != nil {
		var ce *servers.ConnectError
		if errors.As(err, &ce) {
			_ = writeWSConnectError(conn, ce)
		} else {
			_ = writeWSControl(conn, "error", err.Error())
		}
		_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, truncateCloseReason(err.Error())), time.Now().Add(2*time.Second))
		return nil
	}

	sessionID := uuid.NewString()
	userID, _, ip, _ := clientInfo(e)
	startedAt := time.Now().UTC()
	var bytesOut, bytesIn atomic.Int64

	servers.Register(sessionID, sess)
	defer func() {
		servers.Unregister(sessionID)
		_ = sess.Close()
		audit.Write(e.App, audit.Entry{
			UserID:       userID,
			Action:       "terminal.docker.disconnect",
			ResourceType: "container",
			ResourceID:   containerID,
			Status:       audit.StatusSuccess,
			IP:           ip,
			Detail: map[string]any{
				"session_id": sessionID,
				"started_at": startedAt.Format(time.RFC3339),
				"ended_at":   time.Now().UTC().Format(time.RFC3339),
				"bytes_in":   bytesIn.Load(),
				"bytes_out":  bytesOut.Load(),
			},
		})
	}()

	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.docker.exec",
		ResourceType: "container",
		ResourceID:   containerID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail:       map[string]any{"session_id": sessionID, "shell": shell, "server_id": serverID},
	})

	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 4096)
		for {
			n, err := sess.Read(buf)
			if err != nil {
				break
			}
			bytesOut.Add(int64(n))
			if err := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
				break
			}
		}
	}()

	go func() {
		defer func() { _ = sess.Close() }() // unblock Read goroutine on client disconnect
		for {
			mt, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}
			servers.Touch(sessionID)
			if mt == websocket.TextMessage || (len(msg) > 0 && msg[0] == 0x00) {
				handleControlFrame(sess, msg)
				continue
			}
			bytesIn.Add(int64(len(msg)))
			if _, err := sess.Write(msg); err != nil {
				break
			}
		}
	}()

	<-done
	return nil
}
