package routes

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/terminal"
)

func registerServerShellRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	g.GET("/ssh/{serverId}", handleSSHTerminal)
}

// handleSSHTerminal upgrades the HTTP connection to a WebSocket SSH PTY session for the given server.
//
// @Summary SSH WebSocket terminal
// @Description Upgrades to a WebSocket PTY session for the given server via SSH. Auth via ?token= or Authorization header. Superuser only.
// @Tags Terminal SSH
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param token query string false "auth token (for WebSocket clients that cannot set headers)"
// @Success 101 {string} string "WebSocket upgrade"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/terminal/ssh/{serverId} [get]
func handleSSHTerminal(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	requestedSessionID := e.Request.URL.Query().Get("session_id")
	userID, _, ip, _ := clientInfo(e)

	var (
		sess      terminal.Session
		err       error
		sessionID string
		startedAt = time.Now().UTC()
	)

	if requestedSessionID != "" {
		sessionID = requestedSessionID
	} else {
		sessionID = uuid.NewString()
	}

	if requestedSessionID == "" {
		plan, resolveErr := resolveTerminalExecutionPlanForRequest(e, serverID)
		if resolveErr != nil {
			log.Printf("[server-shell] resolveServerConfig failed serverId=%s err=%v", serverID, resolveErr)
			return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
		}
		connector := &terminal.SSHConnector{}
		sess, err = connector.Connect(e.Request.Context(), plan.Config)
		if err != nil {
			cfg := plan.Config
			log.Printf("[server-shell] ssh connect failed serverId=%s host=%s port=%d user=%s authType=%s transport=%s err=%v", serverID, cfg.Host, cfg.Port, cfg.User, cfg.AuthType, plan.Transport, err)
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
		log.Printf("[server-shell] websocket upgrade failed serverId=%s err=%v", serverID, err)
		return nil
	}
	defer conn.Close()
	var bytesOut, bytesIn atomic.Int64
	if requestedSessionID == "" {
		terminal.RegisterResumableDetailed(sessionID, sess, userID, "server", serverID, "ssh")
		audit.Write(e.App, audit.Entry{
			UserID:       userID,
			Action:       "terminal.ssh.connect",
			ResourceType: "server",
			ResourceID:   serverID,
			Status:       audit.StatusSuccess,
			IP:           ip,
			Detail:       map[string]any{"session_id": sessionID},
		})
	} else {
		sess, err = terminal.FindResumableForAttach(sessionID, userID, "server", serverID, "ssh")
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
	if requestedSessionID == "" {
		if plan, planErr := resolveTerminalExecutionPlanForRequest(e, serverID); planErr == nil {
			for _, warning := range plan.Warnings {
				if strings.TrimSpace(warning) == "" {
					continue
				}
				if err := writeWSControl(conn, "warning", warning); err != nil {
					if requestedSessionID == "" {
						terminal.Close(sessionID)
					}
					return nil
				}
			}
		}
	}
	if attachErr := terminal.AttachResumable(sessionID, userID, "server", serverID, "ssh", conn); attachErr != nil {
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
				log.Printf("[server-shell] websocket read closed serverId=%s sessionId=%s err=%v", serverID, sessionID, err)
				if closeErr, ok := err.(*websocket.CloseError); ok && closeErr.Code == websocket.CloseNormalClosure && closeErr.Text == "disconnect" {
					terminal.Close(sessionID)
					audit.Write(e.App, audit.Entry{
						UserID:       userID,
						Action:       "terminal.ssh.disconnect",
						ResourceType: "server",
						ResourceID:   serverID,
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
				log.Printf("[server-shell] session write failed serverId=%s sessionId=%s err=%v", serverID, sessionID, err)
				terminal.Close(sessionID)
				break
			}
		}
	}()

	<-done
	return nil
}

func writeWSSessionFrame(conn *websocket.Conn, sessionID string) error {
	ctrl := map[string]string{"type": "session", "session_id": sessionID}
	data, _ := json.Marshal(ctrl)
	payload := append([]byte{0x00}, data...)
	return conn.WriteMessage(websocket.BinaryMessage, payload)
}

func handleControlFrame(sess terminal.Session, raw []byte) {
	if len(raw) > 0 && raw[0] == 0x00 {
		raw = raw[1:]
	}
	var ctrl struct {
		Type string `json:"type"`
		Rows uint16 `json:"rows"`
		Cols uint16 `json:"cols"`
	}
	if err := json.Unmarshal(raw, &ctrl); err != nil {
		return
	}
	if ctrl.Type == "resize" && ctrl.Rows > 0 && ctrl.Cols > 0 {
		_ = sess.Resize(ctrl.Rows, ctrl.Cols)
	}
}

func writeWSControl(conn *websocket.Conn, msgType, message string) error {
	ctrl := map[string]string{"type": msgType, "message": message}
	data, _ := json.Marshal(ctrl)
	payload := append([]byte{0x00}, data...)
	return conn.WriteMessage(websocket.BinaryMessage, payload)
}

// writeWSConnectError sends a structured error control frame with category.
func writeWSConnectError(conn *websocket.Conn, ce *terminal.ConnectError) error {
	ctrl := map[string]string{
		"type":     "error",
		"category": string(ce.Category),
		"message":  ce.Message,
	}
	data, _ := json.Marshal(ctrl)
	payload := append([]byte{0x00}, data...)
	return conn.WriteMessage(websocket.BinaryMessage, payload)
}

func closeWSWithError(conn *websocket.Conn, err error) {
	var ce *terminal.ConnectError
	if errors.As(err, &ce) {
		_ = writeWSConnectError(conn, ce)
	} else {
		_ = writeWSControl(conn, "error", err.Error())
	}
	_ = conn.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.ClosePolicyViolation, truncateCloseReason(err.Error())),
		time.Now().Add(2*time.Second),
	)
	// Give the browser a brief chance to receive the control payload + close frame
	// before the handler returns and the deferred conn.Close() tears down the socket.
	time.Sleep(75 * time.Millisecond)
}

// truncateCloseReason ensures the WS close reason fits within the 123-byte limit.
func truncateCloseReason(s string) string {
	if len(s) <= 123 {
		return s
	}
	return s[:120] + "..."
}
