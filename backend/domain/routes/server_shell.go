package routes

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/websoft9/appos/backend/domain/audit"
	servers "github.com/websoft9/appos/backend/domain/resource/control/servers"
)

func registerServerShellRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	g.GET("/{serverId}/shell", handleSSHTerminal)
}

// handleSSHTerminal upgrades the HTTP connection to a WebSocket SSH PTY session for the given server.
//
// @Summary SSH WebSocket terminal
// @Description Upgrades to a WebSocket PTY session for the given server via SSH. Auth via ?token= or Authorization header. Superuser only.
// @Tags Server Shell
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param token query string false "auth token (for WebSocket clients that cannot set headers)"
// @Success 101 {string} string "WebSocket upgrade"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/servers/{serverId}/shell [get]
func handleSSHTerminal(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	cfg, err := servers.ResolveConfig(e.App, e.Auth, serverID)
	if err != nil {
		log.Printf("[server-shell] resolveServerConfig failed serverId=%s err=%v", serverID, err)
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	conn, err := wsUpgrader.Upgrade(e.Response, e.Request, nil)
	if err != nil {
		log.Printf("[server-shell] websocket upgrade failed serverId=%s err=%v", serverID, err)
		return nil
	}
	defer conn.Close()

	connector := &servers.SSHConnector{}
	sess, err := connector.Connect(e.Request.Context(), cfg)
	if err != nil {
		log.Printf("[server-shell] ssh connect failed serverId=%s host=%s port=%d user=%s authType=%s err=%v", serverID, cfg.Host, cfg.Port, cfg.User, cfg.AuthType, err)
		// Extract structured category if available
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
	}()

	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.ssh.connect",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail:       map[string]any{"session_id": sessionID},
	})

	done := make(chan struct{})

	go func() {
		defer close(done)
		buf := make([]byte, 4096)
		for {
			n, err := sess.Read(buf)
			if err != nil {
				log.Printf("[server-shell] session read closed serverId=%s sessionId=%s err=%v", serverID, sessionID, err)
				break
			}
			bytesOut.Add(int64(n))
			if err := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
				log.Printf("[server-shell] websocket write failed serverId=%s sessionId=%s err=%v", serverID, sessionID, err)
				break
			}
		}
	}()

	go func() {
		defer func() { _ = sess.Close() }() // unblock Read goroutine on client disconnect
		for {
			mt, msg, err := conn.ReadMessage()
			if err != nil {
				log.Printf("[server-shell] websocket read closed serverId=%s sessionId=%s err=%v", serverID, sessionID, err)
				break
			}
			servers.Touch(sessionID)

			if mt == websocket.TextMessage || (len(msg) > 0 && msg[0] == 0x00) {
				handleControlFrame(sess, msg)
				continue
			}
			bytesIn.Add(int64(len(msg)))
			if _, err := sess.Write(msg); err != nil {
				log.Printf("[server-shell] session write failed serverId=%s sessionId=%s err=%v", serverID, sessionID, err)
				break
			}
		}
	}()

	<-done
	return nil
}

func handleControlFrame(sess servers.Session, raw []byte) {
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
func writeWSConnectError(conn *websocket.Conn, ce *servers.ConnectError) error {
	ctrl := map[string]string{
		"type":     "error",
		"category": string(ce.Category),
		"message":  ce.Message,
	}
	data, _ := json.Marshal(ctrl)
	payload := append([]byte{0x00}, data...)
	return conn.WriteMessage(websocket.BinaryMessage, payload)
}

// truncateCloseReason ensures the WS close reason fits within the 123-byte limit.
func truncateCloseReason(s string) string {
	if len(s) <= 123 {
		return s
	}
	return s[:120] + "..."
}
