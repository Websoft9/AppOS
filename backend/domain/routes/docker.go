package routes

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"sync"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/infra/docker"
	sec "github.com/websoft9/appos/backend/domain/secrets"
)

// localDockerClient is the Docker client for the local host, shared across all local requests.
var localDockerClient *docker.Client

func init() {
	exec := docker.NewLocalExecutor("")
	if os.Getuid() != 0 {
		// Running as non-root: wrap docker commands with passwordless sudo.
		// The system must have NOPASSWD configured for docker in sudoers.
		exec.SudoEnabled = true
	}
	localDockerClient = docker.New(exec)
}

// registerDockerRoutes registers all Docker operation routes.
//
// Route groups:
//
//	/api/ext/docker/compose/*     — docker compose operations
//	/api/ext/docker/images/*      — image management
//	/api/ext/docker/containers/*  — container management
//	/api/ext/docker/networks/*    — network management
//	/api/ext/docker/volumes/*     — volume management
func registerDockerRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	d := g.Group("/docker")

	// ─── Servers list ───────────────────────────────────
	d.GET("/servers", handleDockerServers)

	// ─── Compose ─────────────────────────────────────────
	compose := d.Group("/compose")
	compose.GET("/ls", handleComposeLs)
	compose.POST("/up", handleComposeUp)
	compose.POST("/down", handleComposeDown)
	compose.POST("/start", handleComposeStart)
	compose.POST("/stop", handleComposeStop)
	compose.POST("/restart", handleComposeRestart)
	compose.GET("/logs", handleComposeLogs)
	compose.GET("/config", handleComposeConfigGet)
	compose.PUT("/config", handleComposeConfigWrite)

	// ─── Images ──────────────────────────────────────────
	images := d.Group("/images")
	images.GET("", handleImageList)
	images.GET("/registry/status", handleImageRegistryStatus)
	images.GET("/registry/search", handleImageRegistrySearch)
	images.GET("/{id}/inspect", handleImageInspect)
	images.POST("/pull", handleImagePull)
	images.DELETE("/{id...}", handleImageRemove)
	images.POST("/prune", handleImagePrune)

	// ─── Containers ──────────────────────────────────────
	containers := d.Group("/containers")
	containers.GET("/stats", handleContainerStats)
	containers.GET("/{id}/logs", handleContainerLogs)
	containers.GET("", handleContainerList)
	containers.GET("/{id}", handleContainerInspect)
	containers.POST("/{id}/start", handleContainerStart)
	containers.POST("/{id}/stop", handleContainerStop)
	containers.POST("/{id}/restart", handleContainerRestart)
	containers.DELETE("/{id}", handleContainerRemove)

	// ─── Networks ────────────────────────────────────────
	networks := d.Group("/networks")
	networks.GET("", handleNetworkList)
	networks.POST("", handleNetworkCreate)
	networks.DELETE("/{id}", handleNetworkRemove)

	// ─── Volumes ─────────────────────────────────────────
	volumes := d.Group("/volumes")
	volumes.GET("", handleVolumeList)
	volumes.GET("/{id}/inspect", handleVolumeInspect)
	volumes.DELETE("/{id}", handleVolumeRemove)
	volumes.POST("/prune", handleVolumePrune)

	// ─── Exec (arbitrary docker command) ─────────────────
	d.POST("/exec", handleDockerExec)
}

// ─── Server-aware executor helper ────────────────────────────────

// getDockerClient returns a Docker client for the server_id in the request query.
// Falls back to localDockerClient when server_id is absent or "local".
func getDockerClient(e *core.RequestEvent) (*docker.Client, error) {
	serverID := e.Request.URL.Query().Get("server_id")
	return getDockerClientByServerID(e.App, serverID)
}

func getDockerClientByServerID(app core.App, serverID string) (*docker.Client, error) {
	if serverID == "" || serverID == "local" {
		return localDockerClient, nil
	}

	// Fetch server record
	serverRec, err := app.FindRecordById("servers", serverID)
	if err != nil {
		return nil, fmt.Errorf("server %s not found: %w", serverID, err)
	}

	host := serverRec.GetString("host")
	port := serverRec.GetInt("port")
	user := serverRec.GetString("user")
	credentialID := serverRec.GetString("credential")

	// auth_type inferred from secret template_id (servers.auth_type removed in Story 20.1)
	authType := credAuthType(app, credentialID)

	resolvedHost, resolvedPort, resolveErr := resolveDockerSSHAddress(serverRec)
	if resolveErr != nil {
		return nil, resolveErr
	}
	host = resolvedHost
	port = resolvedPort

	if port == 0 {
		port = 22
	}

	// Resolve credential via sec.Resolve (supports both payload_encrypted and legacy value).
	var secretValue string
	if credentialID != "" {
		payload, resolveErr := sec.Resolve(app, credentialID, "")
		if resolveErr != nil {
			return nil, fmt.Errorf("credential resolve: %w", resolveErr)
		}
		if authType == "password" {
			secretValue = sec.FirstStringFromPayload(payload, "password", "value")
		} else {
			secretValue = sec.FirstStringFromPayload(payload, "private_key", "key", "value")
		}
	}

	// When the remote user is not root, escalate via sudo.
	// For password-based auth, the same credential is used as the sudo password.
	sudoEnabled := user != "root"
	sudoPassword := ""
	if sudoEnabled && authType == "password" {
		sudoPassword = secretValue
	}

	exec := docker.NewSSHExecutor(docker.SSHConfig{
		Host:         host,
		Port:         port,
		User:         user,
		AuthType:     authType,
		Secret:       secretValue,
		SudoEnabled:  sudoEnabled,
		SudoPassword: sudoPassword,
	})
	return docker.New(exec), nil
}

func resolveDockerSSHAddress(serverRec *core.Record) (string, int, error) {
	host := serverRec.GetString("host")
	port := serverRec.GetInt("port")
	if port == 0 {
		port = 22
	}

	if serverRec.GetString("connect_type") != "tunnel" {
		return host, port, nil
	}

	if serverRec.GetString("tunnel_status") != "online" {
		return "", 0, fmt.Errorf("tunnel server %s is offline", serverRec.Id)
	}

	sshPort, err := tunnelSSHPortFromServices(serverRec.GetString("tunnel_services"))
	if err != nil {
		return "", 0, err
	}

	return "127.0.0.1", sshPort, nil
}

func tunnelSSHPortFromServices(raw string) (int, error) {
	if raw == "" || raw == "null" {
		return 0, fmt.Errorf("tunnel_services is empty")
	}

	var services []struct {
		Name       string `json:"service_name"`
		TunnelPort int    `json:"tunnel_port"`
	}
	if err := json.Unmarshal([]byte(raw), &services); err != nil {
		return 0, fmt.Errorf("invalid tunnel_services: %w", err)
	}

	for _, svc := range services {
		if svc.Name == "ssh" && svc.TunnelPort > 0 {
			return svc.TunnelPort, nil
		}
	}

	return 0, fmt.Errorf("ssh tunnel service not found")
}

// handleDockerServers returns all available servers (local + resource store servers)
// with their online/offline ping status. Pings are done concurrently.
//
// @Summary List Docker servers
// @Description Returns all configured servers with concurrent online/offline ping status. Superuser only.
// @Tags Servers Operate
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/ext/docker/servers [get]
func handleDockerServers(e *core.RequestEvent) error {
	type serverEntry struct {
		ID     string `json:"id"`
		Label  string `json:"label"`
		Host   string `json:"host"`
		Status string `json:"status"`
		Reason string `json:"reason,omitempty"`
	}

	result := []serverEntry{{
		ID:     "local",
		Label:  "local",
		Host:   "local",
		Status: "online",
	}}

	servers, err := e.App.FindAllRecords("servers")
	if err != nil || len(servers) == 0 {
		return e.JSON(http.StatusOK, result)
	}

	entries := make([]serverEntry, len(servers))
	var wg sync.WaitGroup
	for i, s := range servers {
		wg.Add(1)
		s := s // capture loop variable
		go func(idx int) {
			defer wg.Done()
			status := "offline"
			reason := "server unreachable"
			host := s.GetString("host")
			port := s.GetInt("port")
			resolvedHost, resolvedPort, resolveErr := resolveDockerSSHAddress(s)
			if resolveErr == nil {
				host = resolvedHost
				port = resolvedPort
			} else {
				reason = resolveErr.Error()
			}
			if port == 0 {
				port = 22
			}
			user := s.GetString("user")
			credID := s.GetString("credential")
			authType := credAuthType(e.App, credID)
			var secretValue string
			if credID != "" {
				if payload, err2 := sec.Resolve(e.App, credID, ""); err2 == nil {
					if authType == "password" {
						secretValue = sec.FirstStringFromPayload(payload, "password", "value")
					} else {
						secretValue = sec.FirstStringFromPayload(payload, "private_key", "key", "value")
					}
				}
			}
			srvSudoEnabled := user != "root"
			srvSudoPassword := ""
			if srvSudoEnabled && authType == "password" {
				srvSudoPassword = secretValue
			}
			if resolveErr == nil {
				execSSH := docker.NewSSHExecutor(docker.SSHConfig{
					Host:         host,
					Port:         port,
					User:         user,
					AuthType:     authType,
					Secret:       secretValue,
					SudoEnabled:  srvSudoEnabled,
					SudoPassword: srvSudoPassword,
				})
				if pingErr := execSSH.Ping(e.Request.Context()); pingErr == nil {
					status = "online"
					reason = ""
				} else {
					reason = pingErr.Error()
				}
			}
			entries[idx] = serverEntry{
				ID:     s.Id,
				Label:  s.GetString("name"),
				Host:   host,
				Status: status,
				Reason: reason,
			}
		}(i)
	}
	wg.Wait()

	result = append(result, entries...)
	return e.JSON(http.StatusOK, result)
}

// ─── Helper ──────────────────────────────────────────────

// dockerError returns a PocketBase-style error response.
func dockerError(e *core.RequestEvent, status int, msg string, err error) error {
	return e.JSON(status, map[string]any{
		"code":    status,
		"message": msg,
		"data":    map[string]any{"error": err.Error()},
	})
}

// authInfo extracts user ID and email from the request's authenticated record.
// Returns empty strings when the request is unauthenticated.
func authInfo(e *core.RequestEvent) (userID, userEmail string) {
	if e.Auth != nil {
		userID = e.Auth.Id
		userEmail = e.Auth.GetString("email")
	}
	return
}

// clientInfo extracts user ID, email, source IP, and User-Agent from the request.
// IP is resolved via PocketBase's trusted-proxy-aware RealIP().
// Returns empty strings for unauthenticated or missing values.
func clientInfo(e *core.RequestEvent) (userID, userEmail, ip, userAgent string) {
	if e.Auth != nil {
		userID = e.Auth.Id
		userEmail = e.Auth.GetString("email")
	}
	ip = e.RealIP()
	userAgent = e.Request.Header.Get("User-Agent")
	return
}

// readBody parses JSON request body into a map.
func readBody(e *core.RequestEvent) (map[string]any, error) {
	var body map[string]any
	if err := json.NewDecoder(e.Request.Body).Decode(&body); err != nil {
		return nil, err
	}
	return body, nil
}

// bodyString extracts a string field from body.
func bodyString(body map[string]any, key string) string {
	if v, ok := body[key].(string); ok {
		return v
	}
	return ""
}

// bodyBool extracts a bool field from body.
func bodyBool(body map[string]any, key string) bool {
	if v, ok := body[key].(bool); ok {
		return v
	}
	return false
}

// bodyMap extracts a nested object field from body.
func bodyMap(body map[string]any, key string) map[string]any {
	if v, ok := body[key].(map[string]any); ok {
		return v
	}
	return nil
}

// bodyInt extracts an integer field from body.
func bodyInt(body map[string]any, key string) int {
	switch v := body[key].(type) {
	case int:
		return v
	case int32:
		return int(v)
	case int64:
		return int(v)
	case float64:
		return int(v)
	case float32:
		return int(v)
	default:
		return 0
	}
}

// ─── Compose Handlers ────────────────────────────────────

// handleComposeLs lists all Docker Compose projects on the target server.
//
// @Summary List Compose projects
// @Description Returns all docker compose projects on the specified server. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/compose/ls [get]
func handleComposeLs(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	output, err := client.ComposeLs(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "list compose projects failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output, "host": client.Host()})
}

// handleComposeUp deploys a Docker Compose project (docker compose up -d).
//
// @Summary Deploy Compose project
// @Description Runs `docker compose up -d` in the given project directory. Writes audit entry. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param body body object true "projectDir: absolute path to the compose project"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/compose/up [post]
func handleComposeUp(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	projectDir := bodyString(body, "projectDir")
	if projectDir == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projectDir is required"})
	}
	userID, userEmail, ip, ua := clientInfo(e)
	output, err := client.ComposeUp(e.Request.Context(), projectDir)
	if err != nil {
		audit.Write(e.App, audit.Entry{
			UserID: userID, UserEmail: userEmail,
			Action: "app.deploy", ResourceType: "app",
			ResourceID: projectDir, ResourceName: projectDir,
			IP: ip, UserAgent: ua,
			Status: audit.StatusFailed,
			Detail: map[string]any{"errorMessage": err.Error()},
		})
		return dockerError(e, http.StatusInternalServerError, "compose up failed", err)
	}
	audit.Write(e.App, audit.Entry{
		UserID: userID, UserEmail: userEmail,
		Action: "app.deploy", ResourceType: "app",
		ResourceID: projectDir, ResourceName: projectDir,
		IP: ip, UserAgent: ua,
		Status: audit.StatusSuccess,
	})
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleComposeDown tears down a Docker Compose project (docker compose down).
//
// @Summary Tear down Compose project
// @Description Runs `docker compose down` in the given project directory. Writes audit entry. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param body body object true "projectDir, removeVolumes (optional bool)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/compose/down [post]
func handleComposeDown(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	projectDir := bodyString(body, "projectDir")
	if projectDir == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projectDir is required"})
	}
	userID, userEmail, ip, ua := clientInfo(e)
	removeVolumes := bodyBool(body, "removeVolumes")
	output, err := client.ComposeDown(e.Request.Context(), projectDir, removeVolumes)
	if err != nil {
		audit.Write(e.App, audit.Entry{
			UserID: userID, UserEmail: userEmail,
			Action: "app.delete", ResourceType: "app",
			ResourceID: projectDir, ResourceName: projectDir,
			IP: ip, UserAgent: ua,
			Status: audit.StatusFailed,
			Detail: map[string]any{"errorMessage": err.Error()},
		})
		return dockerError(e, http.StatusInternalServerError, "compose down failed", err)
	}
	audit.Write(e.App, audit.Entry{
		UserID: userID, UserEmail: userEmail,
		Action: "app.delete", ResourceType: "app",
		ResourceID: projectDir, ResourceName: projectDir,
		IP: ip, UserAgent: ua,
		Status: audit.StatusSuccess,
	})
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleComposeStart starts a stopped Docker Compose project.
//
// @Summary Start Compose project
// @Description Runs `docker compose start` in the given project directory. Writes audit entry. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param body body object true "projectDir"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/compose/start [post]
func handleComposeStart(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	projectDir := bodyString(body, "projectDir")
	if projectDir == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projectDir is required"})
	}
	userID, userEmail, ip, ua := clientInfo(e)
	output, err := client.ComposeStart(e.Request.Context(), projectDir)
	if err != nil {
		audit.Write(e.App, audit.Entry{
			UserID: userID, UserEmail: userEmail,
			Action: "app.start", ResourceType: "app",
			ResourceID: projectDir, ResourceName: projectDir,
			IP: ip, UserAgent: ua,
			Status: audit.StatusFailed,
			Detail: map[string]any{"errorMessage": err.Error()},
		})
		return dockerError(e, http.StatusInternalServerError, "compose start failed", err)
	}
	audit.Write(e.App, audit.Entry{
		UserID: userID, UserEmail: userEmail,
		Action: "app.start", ResourceType: "app",
		ResourceID: projectDir, ResourceName: projectDir,
		IP: ip, UserAgent: ua,
		Status: audit.StatusSuccess,
	})
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleComposeStop stops a running Docker Compose project.
//
// @Summary Stop Compose project
// @Description Runs `docker compose stop` in the given project directory. Writes audit entry. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param body body object true "projectDir"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/compose/stop [post]
func handleComposeStop(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	projectDir := bodyString(body, "projectDir")
	if projectDir == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projectDir is required"})
	}
	userID, userEmail, ip, ua := clientInfo(e)
	output, err := client.ComposeStop(e.Request.Context(), projectDir)
	if err != nil {
		audit.Write(e.App, audit.Entry{
			UserID: userID, UserEmail: userEmail,
			Action: "app.stop", ResourceType: "app",
			ResourceID: projectDir, ResourceName: projectDir,
			IP: ip, UserAgent: ua,
			Status: audit.StatusFailed,
			Detail: map[string]any{"errorMessage": err.Error()},
		})
		return dockerError(e, http.StatusInternalServerError, "compose stop failed", err)
	}
	audit.Write(e.App, audit.Entry{
		UserID: userID, UserEmail: userEmail,
		Action: "app.stop", ResourceType: "app",
		ResourceID: projectDir, ResourceName: projectDir,
		IP: ip, UserAgent: ua,
		Status: audit.StatusSuccess,
	})
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleComposeRestart restarts a Docker Compose project.
//
// @Summary Restart Compose project
// @Description Runs `docker compose restart` in the given project directory. Writes audit entry. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param body body object true "projectDir"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/compose/restart [post]
func handleComposeRestart(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	projectDir := bodyString(body, "projectDir")
	if projectDir == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projectDir is required"})
	}
	userID, userEmail, ip, ua := clientInfo(e)
	output, err := client.ComposeRestart(e.Request.Context(), projectDir)
	if err != nil {
		audit.Write(e.App, audit.Entry{
			UserID: userID, UserEmail: userEmail,
			Action: "app.restart", ResourceType: "app",
			ResourceID: projectDir, ResourceName: projectDir,
			IP: ip, UserAgent: ua,
			Status: audit.StatusFailed,
			Detail: map[string]any{"errorMessage": err.Error()},
		})
		return dockerError(e, http.StatusInternalServerError, "compose restart failed", err)
	}
	audit.Write(e.App, audit.Entry{
		UserID: userID, UserEmail: userEmail,
		Action: "app.restart", ResourceType: "app",
		ResourceID: projectDir, ResourceName: projectDir,
		IP: ip, UserAgent: ua,
		Status: audit.StatusSuccess,
	})
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleComposeLogs returns recent log output for a Docker Compose project.
//
// @Summary Get Compose logs
// @Description Returns recent log output for all services in the compose project. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param projectDir query string true "absolute path to the compose project"
// @Param tail query integer false "number of log lines (default 100)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/compose/logs [get]
func handleComposeLogs(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	projectDir := e.Request.URL.Query().Get("projectDir")
	if projectDir == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projectDir is required"})
	}
	tail := 100
	if t := e.Request.URL.Query().Get("tail"); t != "" {
		fmt.Sscanf(t, "%d", &tail)
	}
	output, err := client.ComposeLogs(e.Request.Context(), projectDir, tail)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "compose logs failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleComposeConfigGet reads the docker-compose.yml content for a project (local only).
//
// @Summary Get Compose config
// @Description Returns the raw docker-compose.yml content for the specified project directory (local server only). Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param projectDir query string true "absolute path to the compose project"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/compose/config [get]
func handleComposeConfigGet(e *core.RequestEvent) error {
	projectDir := e.Request.URL.Query().Get("projectDir")
	if projectDir == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projectDir is required"})
	}
	content, err := localDockerClient.ComposeConfigRead(projectDir)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "read config failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"content": content})
}

// handleComposeConfigWrite writes updated content to docker-compose.yml for a project (local only).
//
// @Summary Write Compose config
// @Description Overwrites docker-compose.yml for the specified project directory. Writes audit entry. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param body body object true "projectDir, content"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/compose/config [put]
func handleComposeConfigWrite(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	projectDir := bodyString(body, "projectDir")
	content := bodyString(body, "content")
	if projectDir == "" || content == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projectDir and content are required"})
	}
	userID, userEmail, ip, ua := clientInfo(e)
	if err := localDockerClient.ComposeConfigWrite(projectDir, content); err != nil {
		audit.Write(e.App, audit.Entry{
			UserID: userID, UserEmail: userEmail,
			Action: "app.env_update", ResourceType: "app",
			ResourceID: projectDir, ResourceName: projectDir,
			IP: ip, UserAgent: ua,
			Status: audit.StatusFailed,
			Detail: map[string]any{"errorMessage": err.Error()},
		})
		return dockerError(e, http.StatusInternalServerError, "write config failed", err)
	}
	audit.Write(e.App, audit.Entry{
		UserID: userID, UserEmail: userEmail,
		Action: "app.env_update", ResourceType: "app",
		ResourceID: projectDir, ResourceName: projectDir,
		IP: ip, UserAgent: ua,
		Status: audit.StatusSuccess,
	})
	return e.JSON(http.StatusOK, map[string]any{"message": "saved"})
}

// ─── Image Handlers ──────────────────────────────────────

// handleImageList returns all Docker images on the target server.
//
// @Summary List Docker images
// @Description Returns all local images on the specified server. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/images [get]
func handleImageList(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	output, err := client.ImageList(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "list images failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output, "host": client.Host()})
}

// handleImageRegistryStatus checks whether Docker Hub is reachable from the target server.
//
// @Summary Check registry status
// @Description Pings Docker Hub to verify registry connectivity from the target server. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Success 200 {object} map[string]any "available: bool"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/ext/docker/images/registry/status [get]
func handleImageRegistryStatus(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	_, err = client.RegistryStatus(e.Request.Context())
	if err != nil {
		return e.JSON(http.StatusOK, map[string]any{
			"available": false,
			"registry":  "Docker Hub",
			"reason":    err.Error(),
		})
	}
	return e.JSON(http.StatusOK, map[string]any{
		"available": true,
		"registry":  "Docker Hub",
	})
}

// handleImageRegistrySearch searches Docker Hub for images matching a query.
//
// @Summary Search image registry
// @Description Searches Docker Hub for images matching the query string. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param q query string true "search query"
// @Param limit query integer false "max results (default 20, max 100)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/images/registry/search [get]
func handleImageRegistrySearch(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	query := e.Request.URL.Query().Get("q")
	if query == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "q is required"})
	}
	limit := 20
	if raw := e.Request.URL.Query().Get("limit"); raw != "" {
		if parsed, convErr := strconv.Atoi(raw); convErr == nil && parsed > 0 {
			limit = parsed
		}
	}
	if limit > 100 {
		limit = 100
	}
	output, err := client.RegistrySearch(e.Request.Context(), query, limit)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "search registry failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleImageInspect returns detailed metadata for a Docker image.
//
// @Summary Inspect Docker image
// @Description Returns docker inspect output for the given image ID or name. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param id path string true "image ID or name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/images/{id}/inspect [get]
func handleImageInspect(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	id := e.Request.PathValue("id")
	if id == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "id is required"})
	}
	output, err := client.ImageInspect(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "inspect image failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleImagePull pulls a Docker image from the registry.
//
// @Summary Pull Docker image
// @Description Pulls the specified image from the registry. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param body body object true "name: image name/tag"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/images/pull [post]
func handleImagePull(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	name := bodyString(body, "name")
	if name == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "name is required"})
	}
	output, err := client.ImagePull(e.Request.Context(), name)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "pull image failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleImageRemove removes a Docker image by ID or name.
//
// @Summary Remove Docker image
// @Description Removes the specified image from the server. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param id path string true "image ID or name (supports path wildcard)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/images/{id} [delete]
func handleImageRemove(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	id := e.Request.PathValue("id")
	if id == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "id is required"})
	}
	output, err := client.ImageRemove(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "remove image failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleImagePrune removes all unused Docker images.
//
// @Summary Prune unused images
// @Description Removes all dangling and unused Docker images. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/images/prune [post]
func handleImagePrune(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	output, err := client.ImagePrune(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "prune images failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// ─── Container Handlers ──────────────────────────────────

// handleContainerList returns all Docker containers on the target server.
//
// @Summary List containers
// @Description Returns all containers (running and stopped) on the specified server. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/containers [get]
func handleContainerList(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	output, err := client.ContainerList(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "list containers failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output, "host": client.Host()})
}

// handleContainerInspect returns detailed metadata for a container.
//
// @Summary Inspect container
// @Description Returns docker inspect output for the given container ID. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param id path string true "container ID or name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/containers/{id} [get]
func handleContainerInspect(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	id := e.Request.PathValue("id")
	output, err := client.ContainerInspect(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "inspect container failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleContainerStats returns real-time resource usage stats for all running containers.
//
// @Summary Get container stats
// @Description Returns CPU/memory/network usage for all running containers. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/containers/stats [get]
func handleContainerStats(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	output, err := client.ContainerStats(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "container stats failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output, "host": client.Host()})
}

// handleContainerLogs returns recent log output for a container.
//
// @Summary Get container logs
// @Description Returns recent stdout/stderr output for the given container. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param id path string true "container ID or name"
// @Param tail query integer false "number of log lines (default 200)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/containers/{id}/logs [get]
func handleContainerLogs(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	id := e.Request.PathValue("id")
	if id == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "id is required"})
	}
	tail := 200
	if t := e.Request.URL.Query().Get("tail"); t != "" {
		fmt.Sscanf(t, "%d", &tail)
	}
	if tail <= 0 {
		tail = 200
	}
	output, err := client.ContainerLogs(e.Request.Context(), id, tail)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "container logs failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleContainerStart starts a stopped Docker container.
//
// @Summary Start container
// @Description Starts the specified container. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param id path string true "container ID or name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/containers/{id}/start [post]
func handleContainerStart(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	id := e.Request.PathValue("id")
	output, err := client.ContainerStart(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "start container failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleContainerStop stops a running Docker container.
//
// @Summary Stop container
// @Description Stops the specified container. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param id path string true "container ID or name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/containers/{id}/stop [post]
func handleContainerStop(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	id := e.Request.PathValue("id")
	output, err := client.ContainerStop(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "stop container failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleContainerRestart restarts a Docker container.
//
// @Summary Restart container
// @Description Restarts the specified container. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param id path string true "container ID or name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/containers/{id}/restart [post]
func handleContainerRestart(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	id := e.Request.PathValue("id")
	output, err := client.ContainerRestart(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "restart container failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleContainerRemove removes a Docker container.
//
// @Summary Remove container
// @Description Removes the specified container. Use ?force=true to force-remove a running container. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param id path string true "container ID or name"
// @Param force query boolean false "force remove a running container"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/containers/{id} [delete]
func handleContainerRemove(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	id := e.Request.PathValue("id")
	forceRaw := e.Request.URL.Query().Get("force")
	force := forceRaw == "1" || forceRaw == "true" || forceRaw == "yes"
	output, err := client.ContainerRemove(e.Request.Context(), id, force)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "remove container failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// ─── Network Handlers ────────────────────────────────────

// handleNetworkList returns all Docker networks on the target server.
//
// @Summary List networks
// @Description Returns all Docker networks on the specified server. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/networks [get]
func handleNetworkList(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	output, err := client.NetworkList(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "list networks failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output, "host": client.Host()})
}

// handleNetworkCreate creates a new Docker network.
//
// @Summary Create network
// @Description Creates a new Docker user-defined network. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param body body object true "name: network name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/networks [post]
func handleNetworkCreate(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	name := bodyString(body, "name")
	if name == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "name is required"})
	}
	output, err := client.NetworkCreate(e.Request.Context(), name)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "create network failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleNetworkRemove removes a Docker network by ID.
//
// @Summary Remove network
// @Description Removes the specified Docker network. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param id path string true "network ID or name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/networks/{id} [delete]
func handleNetworkRemove(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	id := e.Request.PathValue("id")
	output, err := client.NetworkRemove(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "remove network failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// ─── Volume Handlers ─────────────────────────────────────

// handleVolumeList returns all Docker volumes on the target server.
//
// @Summary List volumes
// @Description Returns all Docker volumes on the specified server. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/volumes [get]
func handleVolumeList(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	output, err := client.VolumeList(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "list volumes failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output, "host": client.Host()})
}

// handleVolumeInspect returns detailed metadata for a Docker volume.
//
// @Summary Inspect volume
// @Description Returns docker inspect output for the given volume. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param id path string true "volume name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/volumes/{id}/inspect [get]
func handleVolumeInspect(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	id := e.Request.PathValue("id")
	if id == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "id is required"})
	}
	output, err := client.VolumeInspect(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "inspect volume failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleVolumeRemove removes a Docker volume by name.
//
// @Summary Remove volume
// @Description Removes the specified Docker volume. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param id path string true "volume name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/volumes/{id} [delete]
func handleVolumeRemove(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	id := e.Request.PathValue("id")
	output, err := client.VolumeRemove(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "remove volume failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleVolumePrune removes all unused Docker volumes.
//
// @Summary Prune unused volumes
// @Description Removes all unused Docker volumes. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/docker/volumes/prune [post]
func handleVolumePrune(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	output, err := client.VolumePrune(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "prune volumes failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// ─── Exec Handler ────────────────────────────────────────

// handleDockerExec runs an arbitrary Docker CLI command on the target server.
//
// @Summary Run arbitrary Docker command
// @Description Executes a docker CLI command string on the specified server. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param server_id query string false "server ID (omit for local)"
// @Param body body object true "command: docker command string (e.g. \"info\")"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/ext/docker/exec [post]
func handleDockerExec(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	command := bodyString(body, "command")
	if command == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "command is required"})
	}
	args := parseCommand(command)
	output, err := client.Exec(e.Request.Context(), args...)
	if err != nil {
		return e.JSON(http.StatusOK, map[string]any{"output": "", "error": err.Error(), "host": client.Host()})
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output, "host": client.Host()})
}

// parseCommand splits a command string into args, handling basic quoting.
func parseCommand(s string) []string {
	var args []string
	var current []byte
	var quote byte
	for i := 0; i < len(s); i++ {
		c := s[i]
		if quote != 0 {
			if c == quote {
				quote = 0
			} else {
				current = append(current, c)
			}
		} else if c == '"' || c == '\'' {
			quote = c
		} else if c == ' ' || c == '\t' {
			if len(current) > 0 {
				args = append(args, string(current))
				current = current[:0]
			}
		} else {
			current = append(current, c)
		}
	}
	if len(current) > 0 {
		args = append(args, string(current))
	}
	return args
}
