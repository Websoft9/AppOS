package routes

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/internal/docker"
)

// dockerClient is the shared Docker client used by all docker route handlers.
var dockerClient *docker.Client

func init() {
	exec := docker.NewLocalExecutor("")
	dockerClient = docker.New(exec)
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
	output, err := dockerClient.ComposeLs(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "list compose projects failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output, "host": dockerClient.Host()})
}

func handleComposeUp(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	projectDir := bodyString(body, "projectDir")
	if projectDir == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projectDir is required"})
	}
	output, err := dockerClient.ComposeUp(e.Request.Context(), projectDir)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "compose up failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

func handleComposeDown(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	projectDir := bodyString(body, "projectDir")
	if projectDir == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projectDir is required"})
	}
	removeVolumes := bodyBool(body, "removeVolumes")
	output, err := dockerClient.ComposeDown(e.Request.Context(), projectDir, removeVolumes)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "compose down failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

func handleComposeStart(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	projectDir := bodyString(body, "projectDir")
	if projectDir == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projectDir is required"})
	}
	output, err := dockerClient.ComposeStart(e.Request.Context(), projectDir)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "compose start failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

func handleComposeStop(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	projectDir := bodyString(body, "projectDir")
	if projectDir == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projectDir is required"})
	}
	output, err := dockerClient.ComposeStop(e.Request.Context(), projectDir)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "compose stop failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

func handleComposeRestart(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	projectDir := bodyString(body, "projectDir")
	if projectDir == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projectDir is required"})
	}
	output, err := dockerClient.ComposeRestart(e.Request.Context(), projectDir)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "compose restart failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

func handleComposeLogs(e *core.RequestEvent) error {
	projectDir := e.Request.URL.Query().Get("projectDir")
	if projectDir == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projectDir is required"})
	}
	tail := 100
	if t := e.Request.URL.Query().Get("tail"); t != "" {
		fmt.Sscanf(t, "%d", &tail)
	}
	output, err := dockerClient.ComposeLogs(e.Request.Context(), projectDir, tail)
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
	content, err := dockerClient.ComposeConfigRead(projectDir)
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
	if err := dockerClient.ComposeConfigWrite(projectDir, content); err != nil {
		return dockerError(e, http.StatusInternalServerError, "write config failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"message": "saved"})
}

// ─── Image Handlers ──────────────────────────────────────

func handleImageList(e *core.RequestEvent) error {
	output, err := dockerClient.ImageList(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "list images failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output, "host": dockerClient.Host()})
}

func handleImagePull(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	name := bodyString(body, "name")
	if name == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "name is required"})
	}
	output, err := dockerClient.ImagePull(e.Request.Context(), name)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "pull image failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

func handleImageRemove(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if id == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "id is required"})
	}
	output, err := dockerClient.ImageRemove(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "remove image failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

func handleImagePrune(e *core.RequestEvent) error {
	output, err := dockerClient.ImagePrune(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "prune images failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// ─── Container Handlers ──────────────────────────────────

func handleContainerList(e *core.RequestEvent) error {
	output, err := dockerClient.ContainerList(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "list containers failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output, "host": dockerClient.Host()})
}

func handleContainerInspect(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	output, err := dockerClient.ContainerInspect(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "inspect container failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

func handleContainerStart(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	output, err := dockerClient.ContainerStart(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "start container failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

func handleContainerStop(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	output, err := dockerClient.ContainerStop(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "stop container failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

func handleContainerRestart(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	output, err := dockerClient.ContainerRestart(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "restart container failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

func handleContainerRemove(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	output, err := dockerClient.ContainerRemove(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "remove container failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// ─── Network Handlers ────────────────────────────────────

func handleNetworkList(e *core.RequestEvent) error {
	output, err := dockerClient.NetworkList(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "list networks failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output, "host": dockerClient.Host()})
}

func handleNetworkCreate(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	name := bodyString(body, "name")
	if name == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "name is required"})
	}
	output, err := dockerClient.NetworkCreate(e.Request.Context(), name)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "create network failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

func handleNetworkRemove(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	output, err := dockerClient.NetworkRemove(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "remove network failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// ─── Volume Handlers ─────────────────────────────────────

func handleVolumeList(e *core.RequestEvent) error {
	output, err := dockerClient.VolumeList(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "list volumes failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output, "host": dockerClient.Host()})
}

func handleVolumeRemove(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	output, err := dockerClient.VolumeRemove(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "remove volume failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

func handleVolumePrune(e *core.RequestEvent) error {
	output, err := dockerClient.VolumePrune(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "prune volumes failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// ─── Exec Handler ────────────────────────────────────────

func handleDockerExec(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	command := bodyString(body, "command")
	if command == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "command is required"})
	}
	args := parseCommand(command)
	output, err := dockerClient.Exec(e.Request.Context(), args...)
	if err != nil {
		return e.JSON(http.StatusOK, map[string]any{"output": "", "error": err.Error(), "host": dockerClient.Host()})
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output, "host": dockerClient.Host()})
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
