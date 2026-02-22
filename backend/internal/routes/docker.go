package routes

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/internal/crypto"
	"github.com/websoft9/appos/backend/internal/docker"
)

// localDockerClient is the Docker client for the local host, shared across all local requests.
var localDockerClient *docker.Client

func init() {
	exec := docker.NewLocalExecutor("")
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
	images.POST("/pull", handleImagePull)
	images.DELETE("/{id...}", handleImageRemove)
	images.POST("/prune", handleImagePrune)

	// ─── Containers ──────────────────────────────────────
	containers := d.Group("/containers")
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
	if serverID == "" || serverID == "local" {
		return localDockerClient, nil
	}

	// Fetch server record
	serverRec, err := e.App.FindRecordById("servers", serverID)
	if err != nil {
		return nil, fmt.Errorf("server %s not found: %w", serverID, err)
	}

	host := serverRec.GetString("host")
	port := serverRec.GetInt("port")
	user := serverRec.GetString("user")
	authType := serverRec.GetString("auth_type")
	credentialID := serverRec.GetString("credential")

	if port == 0 {
		port = 22
	}

	// Fetch and decrypt the secret credential
	var secretValue string
	if credentialID != "" {
		secretRec, err := e.App.FindRecordById("secrets", credentialID)
		if err != nil {
			return nil, fmt.Errorf("credential not found: %w", err)
		}
		encrypted := secretRec.GetString("value")
		if encrypted != "" {
			secretValue, err = crypto.Decrypt(encrypted)
			if err != nil {
				return nil, fmt.Errorf("decrypt credential: %w", err)
			}
		}
	}

	exec := docker.NewSSHExecutor(docker.SSHConfig{
		Host:     host,
		Port:     port,
		User:     user,
		AuthType: authType,
		Secret:   secretValue,
	})
	return docker.New(exec), nil
}

// handleDockerServers returns all available servers (local + resource store servers)
// with their online/offline ping status. Pings are done concurrently.
func handleDockerServers(e *core.RequestEvent) error {
	type serverEntry struct {
		ID     string `json:"id"`
		Label  string `json:"label"`
		Host   string `json:"host"`
		Status string `json:"status"`
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
			host := s.GetString("host")
			port := s.GetInt("port")
			if port == 0 {
				port = 22
			}
			user := s.GetString("user")
			authType := s.GetString("auth_type")
			var secretValue string
			if credID := s.GetString("credential"); credID != "" {
				if secRec, err2 := e.App.FindRecordById("secrets", credID); err2 == nil {
					if enc := secRec.GetString("value"); enc != "" {
						if dec, err3 := crypto.Decrypt(enc); err3 == nil {
							secretValue = dec
						}
					}
				}
			}
			execSSH := docker.NewSSHExecutor(docker.SSHConfig{
				Host: host, Port: port, User: user, AuthType: authType, Secret: secretValue,
			})
			if pingErr := execSSH.Ping(e.Request.Context()); pingErr == nil {
				status = "online"
			}
			entries[idx] = serverEntry{
				ID:     s.Id,
				Label:  s.GetString("name"),
				Host:   host,
				Status: status,
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

// ─── Compose Handlers ────────────────────────────────────

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
	output, err := client.ComposeUp(e.Request.Context(), projectDir)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "compose up failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

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
	removeVolumes := bodyBool(body, "removeVolumes")
	output, err := client.ComposeDown(e.Request.Context(), projectDir, removeVolumes)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "compose down failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

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
	output, err := client.ComposeStart(e.Request.Context(), projectDir)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "compose start failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

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
	output, err := client.ComposeStop(e.Request.Context(), projectDir)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "compose stop failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

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
	output, err := client.ComposeRestart(e.Request.Context(), projectDir)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "compose restart failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

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
	if err := localDockerClient.ComposeConfigWrite(projectDir, content); err != nil {
		return dockerError(e, http.StatusInternalServerError, "write config failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"message": "saved"})
}

// ─── Image Handlers ──────────────────────────────────────

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

func handleContainerRemove(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	id := e.Request.PathValue("id")
	output, err := client.ContainerRemove(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "remove container failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// ─── Network Handlers ────────────────────────────────────

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
