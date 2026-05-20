package routes

import (
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
	"github.com/websoft9/appos/backend/domain/terminal"
)

func registerServerContainerRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	g.GET("/docker/{containerId}", handleDockerExecTerminal)
}

// handleDockerExecTerminal upgrades to a WebSocket PTY for docker exec on a container.
//
// @Summary Docker exec WebSocket terminal
// @Description Upgrades to a WebSocket PTY session inside the given container via docker exec. Supports remote servers via server_id. Superuser only.
// @Tags Terminal Docker
// @Security BearerAuth
// @Param containerId path string true "container ID or name"
// @Param server_id query string false "server ID (omit for local)"
// @Param shell query string false "shell binary" Enums(/bin/sh, /bin/bash, /bin/zsh)
// @Success 101 {string} string "WebSocket upgrade"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/terminal/docker/{containerId} [get]
func handleDockerExecTerminal(e *core.RequestEvent) error {
	containerID := e.Request.PathValue("containerId")
	if containerID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "containerId required"})
	}
	requestedSessionID := e.Request.URL.Query().Get("session_id")

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

	var cfg terminal.ConnectorConfig
	var connector terminal.Connector
	if serverID == "local" {
		cfg = terminal.ConnectorConfig{Host: containerID, Shell: shell}
		connector = &terminal.DockerExecConnector{}
	} else {
		resolvedCfg, resolveErr := resolveTerminalConfig(e.App, e.Auth, serverID)
		if resolveErr != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
		}
		resolvedCfg.Shell = fmt.Sprintf("docker exec -it %s %s", containerID, shell)
		cfg = resolvedCfg
		connector = &terminal.SSHConnector{}
	}

	userID, _, ip, _ := clientInfo(e)
	startedAt := time.Now().UTC()
	var (
		sess      terminal.Session
		err       error
		sessionID string
	)
	if requestedSessionID != "" {
		sessionID = requestedSessionID
	} else {
		sessionID = uuid.NewString()
	}

	if requestedSessionID == "" {
		sess, err = connector.Connect(e.Request.Context(), cfg)
		if err != nil {
			conn, upgradeErr := wsUpgrader.Upgrade(e.Response, e.Request, nil)
			if upgradeErr == nil {
				defer conn.Close()
				closeWSWithError(conn, err)
			}
			return nil
		}
	}

	conn, err := wsUpgrader.Upgrade(e.Response, e.Request, nil)
	if err != nil {
		return nil
	}
	defer conn.Close()
	var bytesOut, bytesIn atomic.Int64
	if requestedSessionID == "" {
		terminal.RegisterResumableDetailed(sessionID, sess, userID, "container", containerID, "docker")
		audit.Write(e.App, audit.Entry{
			UserID:       userID,
			Action:       "terminal.docker.exec",
			ResourceType: "container",
			ResourceID:   containerID,
			Status:       audit.StatusSuccess,
			IP:           ip,
			Detail:       map[string]any{"session_id": sessionID, "shell": shell, "server_id": serverID},
		})
	} else {
		sess, err = terminal.FindResumableForAttach(sessionID, userID, "container", containerID, "docker")
		if err != nil {
			_ = writeWSSessionFrame(conn, sessionID)
			_ = writeWSControl(conn, "error", err.Error())
			_ = conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.ClosePolicyViolation, truncateCloseReason(err.Error())),
				time.Now().Add(2*time.Second),
			)
			return nil
		}
	}

	if err := writeWSSessionFrame(conn, sessionID); err != nil {
		if requestedSessionID == "" {
			terminal.Close(sessionID)
		}
		return nil
	}
	if attachErr := terminal.AttachResumable(sessionID, userID, "container", containerID, "docker", conn); attachErr != nil {
		if requestedSessionID == "" {
			terminal.Close(sessionID)
		}
		_ = writeWSControl(conn, "error", attachErr.Error())
		return nil
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			mt, msg, err := conn.ReadMessage()
			if err != nil {
				if closeErr, ok := err.(*websocket.CloseError); ok && closeErr.Code == websocket.CloseNormalClosure && closeErr.Text == "disconnect" {
					terminal.Close(sessionID)
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
				} else {
					terminal.Detach(sessionID)
				}
				break
			}
			terminal.Touch(sessionID)
			if mt == websocket.TextMessage || (len(msg) > 0 && msg[0] == 0x00) {
				handleControlFrame(sess, msg)
				continue
			}
			bytesIn.Add(int64(len(msg)))
			if _, err := sess.Write(msg); err != nil {
				terminal.Close(sessionID)
				break
			}
		}
	}()

	<-done
	return nil
}
