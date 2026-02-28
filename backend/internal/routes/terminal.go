package routes

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/router"
	cryptossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"

	"github.com/websoft9/appos/backend/internal/audit"
	"github.com/websoft9/appos/backend/internal/crypto"
	"github.com/websoft9/appos/backend/internal/settings"
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
	sftp.GET("/constraints", handleSFTPConstraints)
	sftp.GET("/stat", handleSFTPStat)
	sftp.GET("/download", handleSFTPDownload)
	sftp.POST("/upload", handleSFTPUpload)
	sftp.POST("/mkdir", handleSFTPMkdir)
	sftp.POST("/rename", handleSFTPRename)
	sftp.POST("/chmod", handleSFTPChmod)
	sftp.POST("/chown", handleSFTPChown)
	sftp.POST("/symlink", handleSFTPSymlink)
	sftp.POST("/copy", handleSFTPCopy)
	sftp.GET("/copy-stream", handleSFTPCopyStream)
	sftp.POST("/move", handleSFTPMove)
	sftp.DELETE("/delete", handleSFTPDelete)
	sftp.GET("/read", handleSFTPRead)
	sftp.POST("/write", handleSFTPWrite)

	// ─── Docker exec WebSocket ───────────────────────────
	t.GET("/docker/{containerId}", handleDockerExecTerminal)

	// ─── Server Ops REST (Story 15.5) ───────────────────
	serverOps := t.Group("/server/{serverId}")
	serverOps.POST("/power", handleServerPower)
	serverOps.GET("/systemd/services", handleSystemdServices)
	serverOps.GET("/systemd/{service}/status", handleSystemdServiceStatus)
	serverOps.GET("/systemd/{service}/content", handleSystemdServiceContent)
	serverOps.GET("/systemd/{service}/logs", handleSystemdServiceLogs)
	serverOps.POST("/systemd/{service}/action", handleSystemdServiceAction)
	serverOps.GET("/systemd/{service}/unit", handleSystemdServiceUnitRead)
	serverOps.PUT("/systemd/{service}/unit", handleSystemdServiceUnitWrite)
	serverOps.POST("/systemd/{service}/unit/verify", handleSystemdServiceUnitVerify)
	serverOps.POST("/systemd/{service}/unit/apply", handleSystemdServiceUnitApply)
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

	var cfg terminal.ConnectorConfig
	var connector terminal.Connector
	if serverID == "local" {
		cfg = terminal.ConnectorConfig{
			Host:  containerID,
			Shell: shell,
		}
		connector = &terminal.DockerExecConnector{}
	} else {
		resolvedCfg, resolveErr := resolveServerConfig(e, serverID)
		if resolveErr != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
		}
		resolvedCfg.Shell = fmt.Sprintf("docker exec -it %s %s", containerID, shell)
		cfg = resolvedCfg
		connector = &terminal.SSHConnector{}
	}

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
		Detail:       map[string]any{"session_id": sessionID, "shell": shell, "server_id": serverID},
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

func handleSFTPConstraints(e *core.RequestEvent) error {
	cfg, _ := settings.GetGroup(e.App, "connect", "sftp", map[string]any{"maxUploadFiles": 10})
	return e.JSON(http.StatusOK, map[string]any{
		"max_upload_files": settings.Int(cfg, "maxUploadFiles", 10),
	})
}

func handleSFTPStat(e *core.RequestEvent) error {
	client, serverID, err := openSFTPClient(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}
	defer client.Close()

	filePath := e.Request.URL.Query().Get("path")
	if filePath == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "path required"})
	}

	attrs, err := client.Stat(filePath)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"server_id": serverID,
		"attrs":     attrs,
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

func handleSFTPChmod(e *core.RequestEvent) error {
	client, _, err := openSFTPClient(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}
	defer client.Close()

	var body struct {
		Path      string `json:"path"`
		Mode      string `json:"mode"`
		Recursive bool   `json:"recursive"`
	}
	if err := json.NewDecoder(e.Request.Body).Decode(&body); err != nil || body.Path == "" || body.Mode == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "path and mode required"})
	}

	val, err := strconv.ParseUint(body.Mode, 8, 32)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "mode must be octal like 755"})
	}

	if body.Recursive {
		err = client.ChmodRecursive(body.Path, os.FileMode(val))
	} else {
		err = client.Chmod(body.Path, os.FileMode(val))
	}
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
	}
	return e.JSON(http.StatusOK, map[string]any{"path": body.Path, "mode": body.Mode, "recursive": body.Recursive})
}

func handleSFTPChown(e *core.RequestEvent) error {
	client, _, err := openSFTPClient(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}
	defer client.Close()

	var body struct {
		Path  string `json:"path"`
		Owner any    `json:"owner"`
		Group any    `json:"group"`
	}
	if err := json.NewDecoder(e.Request.Body).Decode(&body); err != nil || body.Path == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "path required"})
	}
	owner := strings.TrimSpace(fmt.Sprint(body.Owner))
	group := strings.TrimSpace(fmt.Sprint(body.Group))
	if owner == "<nil>" {
		owner = ""
	}
	if group == "<nil>" {
		group = ""
	}
	if owner == "" || group == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "owner and group are required"})
	}

	if err := client.ChownByName(body.Path, owner, group); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
	}
	return e.JSON(http.StatusOK, map[string]any{"path": body.Path, "owner": owner, "group": group})
}

func handleSFTPSymlink(e *core.RequestEvent) error {
	client, _, err := openSFTPClient(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}
	defer client.Close()

	var body struct {
		Target   string `json:"target"`
		LinkPath string `json:"link_path"`
	}
	if err := json.NewDecoder(e.Request.Body).Decode(&body); err != nil || body.Target == "" || body.LinkPath == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "target and link_path required"})
	}

	if err := client.Symlink(body.Target, body.LinkPath); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
	}
	return e.JSON(http.StatusOK, map[string]any{"target": body.Target, "link_path": body.LinkPath})
}

func handleSFTPCopy(e *core.RequestEvent) error {
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

	var copied, total int64
	_, err = client.Copy(body.From, body.To, func(done, sum int64) {
		copied = done
		total = sum
	})
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error(), "progress": map[string]any{"copied": copied, "total": total}})
	}

	return e.JSON(http.StatusOK, map[string]any{"from": body.From, "to": body.To, "progress": map[string]any{"copied": copied, "total": total}})
}

func handleSFTPCopyStream(e *core.RequestEvent) error {
	client, _, err := openSFTPClient(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}
	defer client.Close()

	from := e.Request.URL.Query().Get("from")
	to := e.Request.URL.Query().Get("to")
	if from == "" || to == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "from and to required"})
	}

	flusher, ok := e.Response.(http.Flusher)
	if !ok {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": "streaming unsupported"})
	}

	e.Response.Header().Set("Content-Type", "text/event-stream")
	e.Response.Header().Set("Cache-Control", "no-cache")
	e.Response.Header().Set("Connection", "keep-alive")

	push := func(event string, payload map[string]any) {
		b, _ := json.Marshal(payload)
		_, _ = fmt.Fprintf(e.Response, "event: %s\n", event)
		_, _ = fmt.Fprintf(e.Response, "data: %s\n\n", string(b))
		flusher.Flush()
	}

	push("start", map[string]any{"from": from, "to": to})
	_, err = client.Copy(from, to, func(copied, total int64) {
		push("progress", map[string]any{"copied": copied, "total": total})
	})
	if err != nil {
		push("error", map[string]any{"message": err.Error()})
		return nil
	}

	push("done", map[string]any{"from": from, "to": to})
	return nil
}

func handleSFTPMove(e *core.RequestEvent) error {
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
// Server Ops handlers (Story 15.5)
// ════════════════════════════════════════════════════════════

var systemdServicePattern = regexp.MustCompile(`^[a-zA-Z0-9@._-]+(?:\.service)?$`)

func normalizeServiceName(name string) (string, error) {
	service := strings.TrimSpace(name)
	if service == "" {
		return "", fmt.Errorf("service required")
	}
	if !systemdServicePattern.MatchString(service) {
		return "", fmt.Errorf("invalid service name")
	}
	if !strings.HasSuffix(service, ".service") {
		service += ".service"
	}
	return service, nil
}

func handleServerPower(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}

	var body struct {
		Action string `json:"action"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "invalid request body"})
	}

	action := strings.ToLower(strings.TrimSpace(body.Action))
	var command string
	switch action {
	case "restart":
		command = "(sudo -n systemctl reboot || sudo -n reboot || systemctl reboot || reboot)"
	case "shutdown":
		command = "(sudo -n systemctl poweroff || sudo -n shutdown -h now || systemctl poweroff || shutdown -h now)"
	default:
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "action must be restart or shutdown"})
	}

	cfg, err := resolveServerConfig(e, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	output, runErr := executeSSHCommand(e.Request.Context(), cfg, command, 20*time.Second)
	expectedDisconnect := runErr != nil && isExpectedPowerDisconnect(runErr)
	userID, _, ip, _ := clientInfo(e)
	status := audit.StatusSuccess
	if runErr != nil && !expectedDisconnect {
		status = audit.StatusFailed
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.server.power",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       status,
		IP:           ip,
		Detail:       map[string]any{"action": action, "output": output},
	})

	if runErr != nil && !expectedDisconnect {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error(), "output": output})
	}
	if expectedDisconnect {
		return e.JSON(http.StatusAccepted, map[string]any{"server_id": serverID, "action": action, "status": "accepted", "output": output})
	}

	return e.JSON(http.StatusOK, map[string]any{"server_id": serverID, "action": action, "status": "accepted", "output": output})
}

func isExpectedPowerDisconnect(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	// Only match errors that clearly indicate the remote end dropped the
	// connection (expected when we just told it to reboot/shutdown).
	// Do NOT match generic "eof" (could be auth failure) or
	// "connection refused" (server may have never been reachable).
	return strings.Contains(message, "connection reset") ||
		strings.Contains(message, "broken pipe") ||
		strings.Contains(message, "use of closed network connection") ||
		strings.Contains(message, "unexpected eof")
}

func handleSystemdServices(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}

	cfg, err := resolveServerConfig(e, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	raw, runErr := executeSSHCommand(e.Request.Context(), cfg, "systemctl list-units --type=service --all --no-legend --no-pager", 20*time.Second)
	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
	}

	keyword := strings.ToLower(strings.TrimSpace(e.Request.URL.Query().Get("keyword")))
	services := make([]map[string]string, 0)
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 5 {
			continue
		}
		name := parts[0]
		desc := strings.Join(parts[4:], " ")
		if keyword != "" && !strings.Contains(strings.ToLower(name), keyword) && !strings.Contains(strings.ToLower(desc), keyword) {
			continue
		}
		services = append(services, map[string]string{
			"name":        name,
			"load_state":  parts[1],
			"active_state": parts[2],
			"sub_state":   parts[3],
			"description": desc,
		})
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.systemd.services",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail:       map[string]any{"count": len(services), "keyword": keyword},
	})

	return e.JSON(http.StatusOK, map[string]any{"server_id": serverID, "services": services})
}

func handleSystemdServiceStatus(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := normalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, resolveErr := resolveServerConfig(e, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	showCmd := fmt.Sprintf("systemctl show %s --no-pager --property=Id,Description,LoadState,ActiveState,SubState,UnitFileState,MainPID,ExecMainStatus,ExecMainCode,StateChangeTimestamp", service)
	showRaw, runErr := executeSSHCommand(e.Request.Context(), cfg, showCmd, 20*time.Second)
	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
	}

	statusCmd := fmt.Sprintf("systemctl status %s --no-pager --full --lines=40", service)
	statusRaw, _ := executeSSHCommand(e.Request.Context(), cfg, statusCmd, 20*time.Second)

	details := make(map[string]string)
	for _, line := range strings.Split(showRaw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		details[parts[0]] = parts[1]
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.systemd.status",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail:       map[string]any{"service": service},
	})

	return e.JSON(http.StatusOK, map[string]any{
		"server_id":   serverID,
		"service":     service,
		"status":      details,
		"status_text": statusRaw,
	})
}

func handleSystemdServiceLogs(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := normalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	lines := 200
	if raw := strings.TrimSpace(e.Request.URL.Query().Get("lines")); raw != "" {
		if v, convErr := strconv.Atoi(raw); convErr == nil {
			if v < 20 {
				v = 20
			}
			if v > 1000 {
				v = 1000
			}
			lines = v
		}
	}

	cfg, resolveErr := resolveServerConfig(e, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	cmd := fmt.Sprintf("journalctl -u %s -n %d --no-pager --output=short-iso", service, lines)
	raw, runErr := executeSSHCommand(e.Request.Context(), cfg, cmd, 25*time.Second)
	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
	}

	entries := make([]string, 0)
	for _, line := range strings.Split(raw, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		entries = append(entries, line)
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.systemd.logs",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail:       map[string]any{"service": service, "lines": lines},
	})

	return e.JSON(http.StatusOK, map[string]any{
		"server_id": serverID,
		"service":   service,
		"lines":     lines,
		"entries":   entries,
		"raw":       raw,
	})
}

func handleSystemdServiceContent(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := normalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, resolveErr := resolveServerConfig(e, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	cmd := fmt.Sprintf("systemctl cat %s --no-pager", service)
	raw, runErr := executeSSHCommand(e.Request.Context(), cfg, cmd, 20*time.Second)
	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.systemd.content",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail:       map[string]any{"service": service},
	})

	return e.JSON(http.StatusOK, map[string]any{
		"server_id": serverID,
		"service":   service,
		"content":   raw,
	})
}

func handleSystemdServiceAction(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := normalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	var body struct {
		Action string `json:"action"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "invalid request body"})
	}

	action := strings.ToLower(strings.TrimSpace(body.Action))
	allowed := map[string]bool{
		"start":   true,
		"stop":    true,
		"restart": true,
		"enable":  true,
		"disable": true,
	}
	if !allowed[action] {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "action must be start, stop, restart, enable, or disable"})
	}

	cfg, resolveErr := resolveServerConfig(e, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	cmd := fmt.Sprintf("(sudo -n systemctl %s %s || systemctl %s %s)", action, service, action, service)
	output, runErr := executeSSHCommand(e.Request.Context(), cfg, cmd, 25*time.Second)

	userID, _, ip, _ := clientInfo(e)
	status := audit.StatusSuccess
	if runErr != nil {
		status = audit.StatusFailed
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.systemd.action",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       status,
		IP:           ip,
		Detail:       map[string]any{"service": service, "action": action, "output": output},
	})

	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error(), "output": output})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"server_id": serverID,
		"service":   service,
		"action":    action,
		"status":    "accepted",
		"output":    output,
	})
}

func handleSystemdServiceUnitRead(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := normalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, resolveErr := resolveServerConfig(e, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	unitPath, pathErr := resolveSystemdUnitPath(e.Request.Context(), cfg, service)
	if pathErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": pathErr.Error()})
	}

	raw, runErr := executeSSHCommand(e.Request.Context(), cfg, fmt.Sprintf("cat %s", shellQuote(unitPath)), 20*time.Second)
	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"server_id": serverID,
		"service":   service,
		"path":      unitPath,
		"content":   raw,
	})
}

func handleSystemdServiceUnitWrite(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := normalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	var body struct {
		Content string `json:"content"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "invalid request body"})
	}
	if strings.TrimSpace(body.Content) == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "content required"})
	}
	// Guard against excessively large unit file content (64 KB limit).
	// base64-encoded payload is ~33% larger; combined with shell command
	// overhead this keeps the SSH command well under typical limits.
	const maxUnitContentBytes = 64 * 1024
	if len(body.Content) > maxUnitContentBytes {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "content too large (max 64KB)"})
	}

	cfg, resolveErr := resolveServerConfig(e, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	unitPath, pathErr := resolveSystemdUnitPath(e.Request.Context(), cfg, service)
	if pathErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": pathErr.Error()})
	}

	encoded := base64.StdEncoding.EncodeToString([]byte(body.Content))
	writeCmd := fmt.Sprintf("printf '%%s' '%s' | base64 -d | (sudo -n tee %s >/dev/null || tee %s >/dev/null)", encoded, shellQuote(unitPath), shellQuote(unitPath))
	writeOutput, writeErr := executeSSHCommand(e.Request.Context(), cfg, writeCmd, 25*time.Second)
	if writeErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": writeErr.Error(), "output": writeOutput})
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.systemd.unit.write",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail: map[string]any{
			"service": service,
			"path":    unitPath,
			"output":  writeOutput,
		},
	})

	return e.JSON(http.StatusOK, map[string]any{
		"server_id": serverID,
		"service":   service,
		"path":      unitPath,
		"status":    "saved",
		"output":    writeOutput,
	})
}

func handleSystemdServiceUnitVerify(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := normalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, resolveErr := resolveServerConfig(e, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	unitPath, pathErr := resolveSystemdUnitPath(e.Request.Context(), cfg, service)
	if pathErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": pathErr.Error()})
	}

	verifyCmd := fmt.Sprintf("(sudo -n systemd-analyze verify %s || systemd-analyze verify %s)", shellQuote(unitPath), shellQuote(unitPath))
	verifyOutput, verifyErr := executeSSHCommand(e.Request.Context(), cfg, verifyCmd, 25*time.Second)

	userID, _, ip, _ := clientInfo(e)
	status := audit.StatusSuccess
	if verifyErr != nil {
		status = audit.StatusFailed
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.systemd.unit.verify",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       status,
		IP:           ip,
		Detail: map[string]any{
			"service":       service,
			"path":          unitPath,
			"verify_output": verifyOutput,
		},
	})

	if verifyErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": verifyErr.Error(), "verify_output": verifyOutput})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"server_id":     serverID,
		"service":       service,
		"path":          unitPath,
		"status":        "valid",
		"verify_output": verifyOutput,
	})
}

func handleSystemdServiceUnitApply(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := normalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, resolveErr := resolveServerConfig(e, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	reloadCmd := "(sudo -n systemctl daemon-reload || systemctl daemon-reload)"
	reloadOutput, reloadErr := executeSSHCommand(e.Request.Context(), cfg, reloadCmd, 20*time.Second)
	if reloadErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": reloadErr.Error(), "reload_output": reloadOutput})
	}

	applyCmd := fmt.Sprintf("(sudo -n systemctl try-restart %s || systemctl try-restart %s)", service, service)
	applyOutput, applyErr := executeSSHCommand(e.Request.Context(), cfg, applyCmd, 25*time.Second)

	userID, _, ip, _ := clientInfo(e)
	status := audit.StatusSuccess
	if applyErr != nil {
		status = audit.StatusFailed
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.systemd.unit.apply",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       status,
		IP:           ip,
		Detail: map[string]any{
			"service":       service,
			"reload_output": reloadOutput,
			"apply_output":  applyOutput,
		},
	})

	if applyErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": applyErr.Error(), "apply_output": applyOutput, "reload_output": reloadOutput})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"server_id":     serverID,
		"service":       service,
		"status":        "applied",
		"reload_output": reloadOutput,
		"apply_output":  applyOutput,
	})
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

func resolveSystemdUnitPath(ctx context.Context, cfg terminal.ConnectorConfig, service string) (string, error) {
	cmd := fmt.Sprintf("systemctl show %s --property=FragmentPath --value --no-pager", service)
	raw, err := executeSSHCommand(ctx, cfg, cmd, 20*time.Second)
	if err != nil {
		return "", err
	}
	unitPath := strings.TrimSpace(raw)
	if unitPath == "" || unitPath == "/dev/null" {
		return "", fmt.Errorf("systemd unit file not found")
	}
	return unitPath, nil
}

func shellQuote(value string) string {
	if value == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func sshAuthMethodFromConfig(cfg terminal.ConnectorConfig) (cryptossh.AuthMethod, error) {
	switch cfg.AuthType {
	case "password":
		return cryptossh.Password(cfg.Secret), nil
	case "private_key", "key":
		signer, err := cryptossh.ParsePrivateKey([]byte(cfg.Secret))
		if err != nil {
			return nil, fmt.Errorf("parse private key: %w", err)
		}
		return cryptossh.PublicKeys(signer), nil
	default:
		return nil, fmt.Errorf("unsupported auth_type: %q", cfg.AuthType)
	}
}

// cachedHostKeyCallback is resolved once at first use and reused for the
// process lifetime, avoiding repeated disk I/O on every SSH command.
var (
	cachedHostKeyCB   cryptossh.HostKeyCallback
	cachedHostKeyCBOK bool
)

// sshHostKeyCallback returns a host key callback.
//
// Resolution order:
//  1. If APPOS_SSH_KNOWN_HOSTS or standard known_hosts files exist → use them.
//  2. Otherwise default to InsecureIgnoreHostKey (consistent with the
//     WebSocket SSH terminal which also skips host-key verification).
//  3. If APPOS_REQUIRE_SSH_HOST_KEY=1 is set, refuse to connect without known_hosts.
func sshHostKeyCallback() (cryptossh.HostKeyCallback, error) {
	if cachedHostKeyCBOK {
		return cachedHostKeyCB, nil
	}

	cb, err := resolveHostKeyCallback()
	if err != nil {
		return nil, err
	}
	cachedHostKeyCB = cb
	cachedHostKeyCBOK = true
	return cb, nil
}

func resolveHostKeyCallback() (cryptossh.HostKeyCallback, error) {
	knownHostsPath := strings.TrimSpace(os.Getenv("APPOS_SSH_KNOWN_HOSTS"))
	candidates := make([]string, 0, 3)
	if knownHostsPath != "" {
		candidates = append(candidates, knownHostsPath)
	}
	if homeDir, err := os.UserHomeDir(); err == nil && homeDir != "" {
		candidates = append(candidates, filepath.Join(homeDir, ".ssh", "known_hosts"))
	}
	candidates = append(candidates, "/etc/ssh/ssh_known_hosts")

	existing := make([]string, 0, len(candidates))
	seen := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			existing = append(existing, candidate)
		}
	}

	if len(existing) > 0 {
		callback, err := knownhosts.New(existing...)
		if err != nil {
			return nil, fmt.Errorf("load known_hosts: %w", err)
		}
		return callback, nil
	}

	// No known_hosts found. Check if strict mode is required.
	requireStrict := strings.ToLower(strings.TrimSpace(os.Getenv("APPOS_REQUIRE_SSH_HOST_KEY")))
	if requireStrict == "1" || requireStrict == "true" || requireStrict == "yes" {
		return nil, fmt.Errorf("ssh host key verification required: no known_hosts file found (set by APPOS_REQUIRE_SSH_HOST_KEY)")
	}

	// Default: skip host-key verification (matches WebSocket SSH terminal behavior).
	return cryptossh.InsecureIgnoreHostKey(), nil
}

func executeSSHCommand(ctx context.Context, cfg terminal.ConnectorConfig, command string, timeout time.Duration) (string, error) {
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	authMethod, err := sshAuthMethodFromConfig(cfg)
	if err != nil {
		return "", err
	}
	hostKeyCallback, err := sshHostKeyCallback()
	if err != nil {
		return "", err
	}

	clientCfg := &cryptossh.ClientConfig{
		User:            cfg.User,
		Auth:            []cryptossh.AuthMethod{authMethod},
		HostKeyCallback: hostKeyCallback,
		Timeout:         10 * time.Second,
	}

	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))
	type dialResult struct {
		client *cryptossh.Client
		err    error
	}
	dialCh := make(chan dialResult, 1)
	go func() {
		client, dialErr := cryptossh.Dial("tcp", addr, clientCfg)
		dialCh <- dialResult{client: client, err: dialErr}
	}()

	var client *cryptossh.Client
	select {
	case <-cmdCtx.Done():
		return "", cmdCtx.Err()
	case result := <-dialCh:
		if result.err != nil {
			return "", fmt.Errorf("ssh dial failed: %w", result.err)
		}
		client = result.client
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("ssh new session failed: %w", err)
	}
	defer session.Close()

	type commandResult struct {
		output []byte
		err    error
	}
	cmdCh := make(chan commandResult, 1)
	go func() {
		out, cmdErr := session.CombinedOutput(command)
		cmdCh <- commandResult{output: out, err: cmdErr}
	}()

	select {
	case <-cmdCtx.Done():
		_ = session.Close()
		return "", cmdCtx.Err()
	case result := <-cmdCh:
		output := strings.TrimSpace(string(result.output))
		if result.err != nil {
			if output == "" {
				return output, result.err
			}
			return output, fmt.Errorf("%w: %s", result.err, output)
		}
		return output, nil
	}
}
