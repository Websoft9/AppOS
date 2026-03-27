package routes

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/websoft9/appos/backend/internal/audit"
	servers "github.com/websoft9/appos/backend/internal/servers"
	"github.com/websoft9/appos/backend/internal/settings"
	settingscatalog "github.com/websoft9/appos/backend/internal/settings/catalog"
)

func registerServerFileRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	sftp := g.Group("/{serverId}/files")
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
}

// ════════════════════════════════════════════════════════════
// SFTP REST handlers
// ════════════════════════════════════════════════════════════

// handleSFTPList returns a directory listing on the remote server via SFTP.
//
// @Summary List directory
// @Description Returns a directory listing for the given path on the remote server. Superuser only.
// @Tags Server Files
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param path query string false "directory path (default /)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/files/list [get]
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

// handleSFTPSearch searches for files matching a query string under a base path.
//
// @Summary Search files
// @Description Recursively searches for files matching the query under the base path. Superuser only.
// @Tags Server Files
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param path query string false "base path (default /)"
// @Param query query string true "search term"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/files/search [get]
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

// handleSFTPConstraints returns the effective SFTP upload constraints (from settings).
//
// @Summary File constraints
// @Description Returns effective upload limits (max_upload_files) from settings. Superuser only.
// @Tags Server Files
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/servers/{serverId}/files/constraints [get]
func handleSFTPConstraints(e *core.RequestEvent) error {
	cfg, _ := settings.GetGroup(e.App, "connect", "sftp", settingscatalog.DefaultGroup("connect", "sftp"))
	return e.JSON(http.StatusOK, map[string]any{
		"max_upload_files": settings.Int(cfg, "maxUploadFiles", 10),
	})
}

// handleSFTPStat returns file/directory metadata for a remote path.
//
// @Summary Stat path
// @Description Returns stat attributes (size, permissions, mtime, etc.) for the given remote path. Superuser only.
// @Tags Server Files
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param path query string true "remote path"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/files/stat [get]
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

// handleSFTPDownload streams a remote file as a download attachment.
//
// @Summary Download file
// @Description Streams a remote file as Content-Disposition: attachment. Writes an audit entry. Superuser only.
// @Tags Server Files
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param path query string true "remote file path"
// @Success 200 {string} string "file content"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/files/download [get]
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

// handleSFTPUpload uploads a file to a remote directory via SFTP.
//
// @Summary Upload file
// @Description Accepts a multipart upload and saves the file to the given remote directory. Writes an audit entry. Superuser only.
// @Tags Server Files
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param path query string true "remote destination directory"
// @Param file formData file true "file to upload"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 413 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/files/upload [post]
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

// handleSFTPMkdir creates a directory (mkdir -p) on the remote server.
//
// @Summary Create directory
// @Description Creates the given directory (and parents) on the remote server. Superuser only.
// @Tags Server Files
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param body body object true "path: directory to create"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/files/mkdir [post]
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

// handleSFTPRename renames (moves) a file or directory on the remote server.
//
// @Summary Rename
// @Description Renames a file or directory from one path to another on the remote server. Superuser only.
// @Tags Server Files
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param body body object true "from, to (remote paths)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/files/rename [post]
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

// handleSFTPChmod changes permissions on a remote file or directory.
//
// @Summary Change permissions
// @Description Sets file permissions (octal mode) on a remote path. Superuser only.
// @Tags Server Files
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param body body object true "path, mode (octal string, e.g. \"755\"), recursive (bool)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/files/chmod [post]
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

// handleSFTPChown changes ownership of a remote file or directory.
//
// @Summary Change owner
// @Description Sets owner and group for a remote path by name. Superuser only.
// @Tags Server Files
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param body body object true "path, owner (username string), group (group name string)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/files/chown [post]
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

// handleSFTPSymlink creates a symbolic link on the remote server.
//
// @Summary Create symlink
// @Description Creates a symbolic link on the remote server. Superuser only.
// @Tags Server Files
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param body body object true "target (link destination), link_path (new symlink path)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/files/symlink [post]
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

// handleSFTPCopy copies a file or directory to another path on the remote server (blocking).
//
// @Summary Copy
// @Description Copies a remote file or directory to the destination path. Returns final progress. Superuser only.
// @Tags Server Files
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param body body object true "from, to (remote paths)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/files/copy [post]
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

// handleSFTPCopyStream copies a remote file/directory and streams SSE progress events.
//
// @Summary Copy with progress
// @Description Copies a remote file/directory and streams Server-Sent Events with progress updates. Superuser only.
// @Tags Server Files
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param from query string true "source remote path"
// @Param to query string true "destination remote path"
// @Success 200 {string} string "SSE stream (text/event-stream)"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/servers/{serverId}/files/copy-stream [get]
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

// handleSFTPMove moves a file or directory to another path on the remote server.
//
// @Summary Move
// @Description Moves (renames) a remote file or directory. Superuser only.
// @Tags Server Files
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param body body object true "from, to (remote paths)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/files/move [post]
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

// handleSFTPDelete deletes a file or directory on the remote server.
//
// @Summary Delete
// @Description Deletes the file or directory at the given remote path. Writes an audit entry. Superuser only.
// @Tags Server Files
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param path query string true "remote path to delete"
// @Success 204 {string} string "no content"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/files/delete [delete]
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

// handleSFTPRead returns the text content of a remote file (up to 2 MB).
//
// @Summary Read file
// @Description Returns UTF-8 text content of a remote file via SFTP (max 2 MB). Superuser only.
// @Tags Server Files
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param path query string true "remote file path"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 413 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/files/read [get]
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

// handleSFTPWrite writes text content to a remote file via SFTP.
//
// @Summary Write file
// @Description Overwrites the content of a remote file with the provided text. Writes audit entry. Superuser only.
// @Tags Server Files
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param body body object true "path, content"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/files/write [post]
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

// openSFTPClient resolves server config and opens an SFTP session.
// Returns the client, serverID, and any error.
func openSFTPClient(e *core.RequestEvent) (*servers.SFTPClient, string, error) {
	serverID := e.Request.PathValue("serverId")
	cfg, err := resolveServerConfig(e, serverID)
	if err != nil {
		return nil, serverID, err
	}
	client, err := servers.NewSFTPClient(e.Request.Context(), cfg)
	if err != nil {
		return nil, serverID, err
	}
	return client, serverID, nil
}
