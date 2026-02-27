package routes

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/websoft9/appos/backend/internal/audit"
	"github.com/websoft9/appos/backend/internal/crypto"
	"github.com/websoft9/appos/backend/internal/terminal"
)

var wsUpgrader = websocket.Upgrader{
	// CheckOrigin allows all origins. Authentication is enforced via JWT
	// (RequireSuperuserAuth) so a permissive CORS policy is acceptable for
	// this single-server deployment. Review before multi-tenant exposure.
	CheckOrigin: func(r *http.Request) bool { return true },
}

// wsTokenAuth is a middleware that authenticates WebSocket upgrade requests
// using a "token" query parameter. Browsers cannot set custom headers on WS
// upgrade, so the frontend sends the JWT as ?token=. PocketBase's global
// loadAuthToken middleware runs before route-level Bind, so we must resolve
// the auth record ourselves rather than just setting the header.
func wsTokenAuth() *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Id: "wsTokenAuth",
		// Must run AFTER loadAuthToken (-1020) but BEFORE RequireAuth (0).
		// Without this, RequireAuth from the parent /api/ext group rejects
		// the request before wsTokenAuth gets a chance to set e.Auth.
		Priority: -1019,
		Func: func(e *core.RequestEvent) error {
			if e.Auth != nil {
				return e.Next() // already authenticated (e.g. via header/cookie)
			}
			tok := e.Request.URL.Query().Get("token")
			if tok == "" {
				return e.Next()
			}
			record, err := e.App.FindAuthRecordByToken(tok, core.TokenTypeAuth)
			if err == nil && record != nil {
				e.Auth = record
			}
			return e.Next()
		},
	}
}

// registerTerminalRoutes registers SSH terminal and SFTP routes.
//
// Route groups:
//
//	/api/ext/terminal/ssh/:serverId    — WebSocket SSH PTY
//	/api/ext/terminal/sftp/:serverId/* — REST file operations
//	/api/ext/terminal/docker/:containerId — WebSocket Docker exec (Story 15.3)
func registerTerminalRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	t := g.Group("/terminal")
	t.Bind(wsTokenAuth())                // copy ?token= to Authorization header for WS
	t.Bind(apis.RequireSuperuserAuth()) // MVP: superuser only

	// ─── SSH WebSocket ───────────────────────────────────
	t.GET("/ssh/{serverId}", handleSSHTerminal)

	// ─── SFTP REST ───────────────────────────────────────
	sftp := t.Group("/sftp/{serverId}")
	sftp.GET("/list", handleSFTPList)
	sftp.GET("/search", handleSFTPSearch)
	sftp.GET("/download", handleSFTPDownload)
	sftp.POST("/upload", handleSFTPUpload)
	sftp.POST("/mkdir", handleSFTPMkdir)
	sftp.POST("/rename", handleSFTPRename)
	sftp.DELETE("/delete", handleSFTPDelete)
	sftp.GET("/read", handleSFTPRead)
	sftp.POST("/write", handleSFTPWrite)

	// ─── Docker exec WebSocket ───────────────────────────
	t.GET("/docker/{containerId}", handleDockerExecTerminal)
}

// ════════════════════════════════════════════════════════════
// SSH WebSocket handler
// ════════════════════════════════════════════════════════════

func handleSSHTerminal(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	cfg, err := resolveServerConfig(e, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	conn, err := wsUpgrader.Upgrade(e.Response, e.Request, nil)
	if err != nil {
		return nil // Upgrade already wrote response
	}
	defer conn.Close()

	connector := &terminal.SSHConnector{}
	sess, err := connector.Connect(e.Request.Context(), cfg)
	if err != nil {
		_ = writeWSControl(conn, "error", err.Error())
		return nil
	}

	sessionID := uuid.NewString()
	userID, _, ip, _ := clientInfo(e)
	startedAt := time.Now().UTC()
	var bytesOut, bytesIn atomic.Int64

	terminal.Register(sessionID, sess)
	defer func() {
		terminal.Unregister(sessionID)
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

	// Audit connect
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.ssh.connect",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail:       map[string]any{"session_id": sessionID},
	})

	// Bidirectional relay
	done := make(chan struct{})

	// PTY → WebSocket
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

	// WebSocket → PTY (+ control frames)
	go func() {
		for {
			mt, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}
			terminal.Touch(sessionID)

			// Control frame: JSON prefixed with 0x00
			if mt == websocket.TextMessage || (len(msg) > 0 && msg[0] == 0x00) {
				handleControlFrame(sess, msg)
				continue
			}
			// Raw stdin
			bytesIn.Add(int64(len(msg)))
			if _, err := sess.Write(msg); err != nil {
				break
			}
		}
	}()

	<-done
	return nil
}

// handleControlFrame parses JSON control messages (resize).
func handleControlFrame(sess terminal.Session, raw []byte) {
	// Strip 0x00 prefix if present
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

// writeWSControl sends a JSON control message on the WebSocket.
func writeWSControl(conn *websocket.Conn, msgType, message string) error {
	ctrl := map[string]string{"type": msgType, "message": message}
	data, _ := json.Marshal(ctrl)
	// Prepend 0x00 prefix
	payload := append([]byte{0x00}, data...)
	return conn.WriteMessage(websocket.BinaryMessage, payload)
}

// ════════════════════════════════════════════════════════════
// Docker exec WebSocket handler
// ════════════════════════════════════════════════════════════

func handleDockerExecTerminal(e *core.RequestEvent) error {
	containerID := e.Request.PathValue("containerId")
	if containerID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "containerId required"})
	}

	// Optional shell override via query param; default /bin/sh
	shell := e.Request.URL.Query().Get("shell")
	if shell == "" {
		shell = "/bin/sh"
	}

	conn, err := wsUpgrader.Upgrade(e.Response, e.Request, nil)
	if err != nil {
		return nil
	}
	defer conn.Close()

	cfg := terminal.ConnectorConfig{
		Host:  containerID,
		Shell: shell,
	}

	connector := &terminal.DockerExecConnector{}
	sess, err := connector.Connect(e.Request.Context(), cfg)
	if err != nil {
		_ = writeWSControl(conn, "error", err.Error())
		return nil
	}

	sessionID := uuid.NewString()
	userID, _, ip, _ := clientInfo(e)
	startedAt := time.Now().UTC()
	var bytesOut, bytesIn atomic.Int64

	terminal.Register(sessionID, sess)
	defer func() {
		terminal.Unregister(sessionID)
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

	// Audit connect
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.docker.exec",
		ResourceType: "container",
		ResourceID:   containerID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail:       map[string]any{"session_id": sessionID, "shell": shell},
	})

	// Bidirectional relay — same pattern as SSH
	done := make(chan struct{})

	// Container → WebSocket
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

	// WebSocket → Container (+ control frames)
	go func() {
		for {
			mt, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}
			terminal.Touch(sessionID)

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

// ════════════════════════════════════════════════════════════
// SFTP REST handlers
// ════════════════════════════════════════════════════════════

func handleSFTPList(e *core.RequestEvent) error {
	client, serverID, err := openSFTPClient(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}
	defer client.Close()

	dirPath := e.Request.URL.Query().Get("path")
	if dirPath == "" {
		dirPath = "/"
	}

	entries, err := client.ListDir(dirPath)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"path":      dirPath,
		"server_id": serverID,
		"entries":   entries,
	})
}

func handleSFTPSearch(e *core.RequestEvent) error {
	client, serverID, err := openSFTPClient(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}
	defer client.Close()

	basePath := e.Request.URL.Query().Get("path")
	if basePath == "" {
		basePath = "/"
	}
	query := e.Request.URL.Query().Get("query")
	if query == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "query required"})
	}

	results, err := client.SearchFiles(basePath, query)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"path":      basePath,
		"server_id": serverID,
		"query":     query,
		"results":   results,
	})
}

func handleSFTPDownload(e *core.RequestEvent) error {
	client, serverID, err := openSFTPClient(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}
	defer client.Close()

	filePath := e.Request.URL.Query().Get("path")
	if filePath == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "path required"})
	}

	filename := path.Base(filePath)
	e.Response.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	e.Response.Header().Set("Content-Type", "application/octet-stream")

	downloadErr := client.Download(filePath, e.Response)

	// Audit after the operation so status reflects actual outcome.
	userID, _, ip, _ := clientInfo(e)
	auditStatus := audit.StatusSuccess
	if downloadErr != nil {
		auditStatus = audit.StatusFailed
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.sftp.download",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       auditStatus,
		IP:           ip,
		Detail:       map[string]any{"path": filePath},
	})

	return downloadErr
}

func handleSFTPUpload(e *core.RequestEvent) error {
	client, serverID, err := openSFTPClient(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}
	defer client.Close()

	remotePath := e.Request.URL.Query().Get("path")
	if remotePath == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "path required"})
	}

	// Parse multipart — limit to 50 MB + overhead
	if err := e.Request.ParseMultipartForm(50 << 20); err != nil {
		return e.JSON(http.StatusRequestEntityTooLarge, map[string]any{"message": "file too large (max 50 MB)"})
	}

	file, header, err := e.Request.FormFile("file")
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "missing 'file' form field"})
	}
	defer file.Close()

	dest := path.Join(remotePath, header.Filename)
	if err := client.Upload(dest, file); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
	}

	// Audit upload
	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.sftp.upload",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail:       map[string]any{"path": dest, "size": header.Size},
	})

	return e.JSON(http.StatusOK, map[string]any{"path": dest, "size": header.Size})
}

func handleSFTPMkdir(e *core.RequestEvent) error {
	client, _, err := openSFTPClient(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}
	defer client.Close()

	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(e.Request.Body).Decode(&body); err != nil || body.Path == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "path required"})
	}

	if err := client.Mkdir(body.Path); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
	}
	return e.JSON(http.StatusOK, map[string]any{"path": body.Path})
}

func handleSFTPRename(e *core.RequestEvent) error {
	client, _, err := openSFTPClient(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}
	defer client.Close()

	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := json.NewDecoder(e.Request.Body).Decode(&body); err != nil || body.From == "" || body.To == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "from and to required"})
	}

	if err := client.Rename(body.From, body.To); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
	}
	return e.JSON(http.StatusOK, map[string]any{"from": body.From, "to": body.To})
}

func handleSFTPDelete(e *core.RequestEvent) error {
	client, serverID, err := openSFTPClient(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}
	defer client.Close()

	filePath := e.Request.URL.Query().Get("path")
	if filePath == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "path required"})
	}

	if err := client.Delete(filePath); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
	}

	// Audit delete
	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.sftp.delete",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail:       map[string]any{"path": filePath},
	})

	return e.NoContent(http.StatusNoContent)
}

// ─── Read / Write text file via SFTP ─────────────────────

const sftpMaxReadBytes = 2 << 20 // 2 MB — reasonable limit for text editing

func handleSFTPRead(e *core.RequestEvent) error {
	client, _, err := openSFTPClient(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}
	defer client.Close()

	filePath := e.Request.URL.Query().Get("path")
	if filePath == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "path required"})
	}

	content, err := client.ReadFile(filePath, sftpMaxReadBytes)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"path":    filePath,
		"content": content,
	})
}

func handleSFTPWrite(e *core.RequestEvent) error {
	client, serverID, err := openSFTPClient(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}
	defer client.Close()

	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(e.Request.Body).Decode(&body); err != nil || body.Path == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "path and content required"})
	}

	if err := client.WriteFile(body.Path, body.Content); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
	}

	// Audit write
	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.sftp.write",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail:       map[string]any{"path": body.Path, "size": len(body.Content)},
	})

	return e.JSON(http.StatusOK, map[string]any{"path": body.Path, "size": len(body.Content)})
}

// ════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════

// resolveServerConfig looks up the server record + decrypted credential and
// returns a ConnectorConfig. This is the single place where a secret leaves
// the database in plaintext — it is never serialized or sent to the client.
func resolveServerConfig(e *core.RequestEvent, serverID string) (terminal.ConnectorConfig, error) {
	var cfg terminal.ConnectorConfig

	server, err := e.App.FindRecordById("servers", serverID)
	if err != nil {
		return cfg, fmt.Errorf("server not found: %w", err)
	}

	cfg.Host = server.GetString("host")
	cfg.Port = server.GetInt("port")
	if cfg.Port == 0 {
		cfg.Port = 22
	}
	cfg.User = server.GetString("user")
	cfg.AuthType = server.GetString("auth_type")
	cfg.Shell = server.GetString("shell")

	credID := server.GetString("credential")
	if credID != "" {
		secretRec, err := e.App.FindRecordById("secrets", credID)
		if err != nil {
			return cfg, fmt.Errorf("credential record not found: %w", err)
		}
		encrypted := secretRec.GetString("value")
		if encrypted != "" {
			decrypted, err := crypto.Decrypt(encrypted)
			if err != nil {
				return cfg, fmt.Errorf("credential decrypt failed: %w", err)
			}
			cfg.Secret = decrypted
		}
	}

	// Tunnel servers: override host/port using the locally forwarded SSH port.
	if server.GetString("connect_type") == "tunnel" {
		var services []struct {
			Name       string `json:"service_name"`
			TunnelPort int    `json:"tunnel_port"`
		}
		_ = json.Unmarshal([]byte(server.GetString("tunnel_services")), &services)
		for _, svc := range services {
			if svc.Name == "ssh" && svc.TunnelPort > 0 {
				cfg.Host = "127.0.0.1"
				cfg.Port = svc.TunnelPort
				break
			}
		}
	}

	return cfg, nil
}

// openSFTPClient resolves server config and opens an SFTP session.
// Returns the client, serverID, and any error.
func openSFTPClient(e *core.RequestEvent) (*terminal.SFTPClient, string, error) {
	serverID := e.Request.PathValue("serverId")
	cfg, err := resolveServerConfig(e, serverID)
	if err != nil {
		return nil, serverID, err
	}
	client, err := terminal.NewSFTPClient(e.Request.Context(), cfg)
	if err != nil {
		return nil, serverID, err
	}
	return client, serverID, nil
}
