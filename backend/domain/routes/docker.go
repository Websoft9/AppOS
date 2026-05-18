package routes

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingscatalog "github.com/websoft9/appos/backend/domain/config/sysconfig/catalog"
	"github.com/websoft9/appos/backend/domain/dockerops"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	"github.com/websoft9/appos/backend/domain/software"
	"github.com/websoft9/appos/backend/domain/worker"
	"github.com/websoft9/appos/backend/infra/collections"
	"github.com/websoft9/appos/backend/infra/docker"
)

// localDockerClient is the Docker client for the local host, shared across all local requests.
var localDockerClient *docker.Client

var enqueueDockerImagePullTask = worker.EnqueueDockerImagePull

const dockerImageListCacheTTL = 15 * time.Second

type dockerImageListCacheEntry struct {
	output    string
	host      string
	fetchedAt time.Time
}

var dockerImageListCache = struct {
	mu      sync.RWMutex
	entries map[string]dockerImageListCacheEntry
}{
	entries: map[string]dockerImageListCacheEntry{},
}

func init() {
	exec := docker.NewLocalExecutor("")
	if os.Getuid() != 0 {
		// Running as non-root: wrap docker commands with passwordless sudo.
		// The system must have NOPASSWD configured for docker in sudoers.
		exec.SudoEnabled = true
	}
	localDockerClient = docker.New(exec)
}

func dockerImageListCacheKey(e *core.RequestEvent, client *docker.Client) string {
	if serverID := strings.TrimSpace(e.Request.PathValue("serverId")); serverID != "" {
		return dockerops.ImageListCacheKey(serverID, client.Host())
	}
	return dockerops.ImageListCacheKey("", client.Host())
}

func getCachedDockerImageList(key string) (dockerImageListCacheEntry, bool) {
	entry, ok := dockerops.GetCachedImageList(key)
	if !ok {
		return dockerImageListCacheEntry{}, false
	}
	return dockerImageListCacheEntry{output: entry.Output, host: entry.Host, fetchedAt: entry.FetchedAt}, true
}

func setCachedDockerImageList(key, output, host string) {
	dockerops.SetCachedImageList(key, output, host)
}

func invalidateDockerImageListCache(key string) {
	dockerops.InvalidateImageListCache(key)
}

// registerDockerRoutes registers all Docker operation routes under /api/servers.
func registerDockerRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	d := g.Group("")
	d.Bind(apis.RequireSuperuserAuth())

	// ─── Servers list ───────────────────────────────────
	d.GET("/docker-targets", handleDockerServers)

	serverDocker := d.Group("/{serverId}/docker")
	serverDocker.GET("/image-pull-operations", handleImagePullOperations)
	serverDocker.GET("/image-pull-operations/{operationId}", handleImagePullOperation)

	// ─── Compose ─────────────────────────────────────────
	compose := serverDocker.Group("/compose")
	compose.GET("/ls", handleComposeLs)
	compose.POST("/metadata", handleComposeMetadata)
	compose.POST("/up", handleComposeUp)
	compose.POST("/down", handleComposeDown)
	compose.POST("/start", handleComposeStart)
	compose.POST("/stop", handleComposeStop)
	compose.POST("/restart", handleComposeRestart)
	compose.POST("/pull", handleComposePull)
	compose.GET("/ps", handleComposePs)
	compose.GET("/logs", handleComposeLogs)
	compose.GET("/config", handleComposeConfigGet)
	compose.PUT("/config", handleComposeConfigWrite)

	// ─── Images ──────────────────────────────────────────
	images := serverDocker.Group("/images")
	images.GET("", handleImageList)
	images.GET("/registry/status", handleImageRegistryStatus)
	images.GET("/registry/search", handleImageRegistrySearch)
	images.GET("/{id}/inspect", handleImageInspect)
	images.POST("/pull", handleImagePull)
	images.DELETE("/{id...}", handleImageRemove)
	images.POST("/prune", handleImagePrune)

	// ─── Containers ──────────────────────────────────────
	containers := serverDocker.Group("/containers")
	containers.GET("/stats", handleContainerStats)
	containers.GET("/{id}/logs", handleContainerLogs)
	containers.GET("", handleContainerList)
	containers.POST("/metadata", handleContainerMetadata)
	containers.GET("/{id}", handleContainerInspect)
	containers.POST("/{id}/start", handleContainerStart)
	containers.POST("/{id}/stop", handleContainerStop)
	containers.POST("/{id}/restart", handleContainerRestart)
	containers.DELETE("/{id}", handleContainerRemove)

	// ─── Networks ────────────────────────────────────────
	networks := serverDocker.Group("/networks")
	networks.GET("", handleNetworkList)
	networks.GET("/{id}/inspect", handleNetworkInspect)
	networks.POST("", handleNetworkCreate)
	networks.DELETE("/{id}", handleNetworkRemove)

	// ─── Volumes ─────────────────────────────────────────
	volumes := serverDocker.Group("/volumes")
	volumes.GET("", handleVolumeList)
	volumes.GET("/{id}/inspect", handleVolumeInspect)
	volumes.DELETE("/{id}", handleVolumeRemove)
	volumes.POST("/prune", handleVolumePrune)

	// ─── Exec (arbitrary docker command) ─────────────────
	serverDocker.POST("/exec", handleDockerExec)
}

// ─── Server-aware executor helper ────────────────────────────────

// getDockerClient returns a Docker client for the serverId path parameter.
func getDockerClient(e *core.RequestEvent) (*docker.Client, error) {
	serverID := strings.TrimSpace(e.Request.PathValue("serverId"))
	client, err := servers.NewDockerClient(e.App, serverID, localDockerClient)
	if err != nil {
		return nil, err
	}
	client.SetProxyEnv(loadDockerProxyEnv(e.App))
	return client, nil
}

func loadDockerProxyEnv(app core.App) map[string]string {
	group, _ := sysconfig.GetGroup(
		app,
		"proxy",
		"network",
		settingscatalog.DefaultGroup("proxy", "network"),
	)
	httpProxy := proxyURLWithCredentials(
		sysconfig.String(group, "httpProxy", ""),
		sysconfig.String(group, "username", ""),
		sysconfig.String(group, "password", ""),
	)
	httpsProxy := proxyURLWithCredentials(
		sysconfig.String(group, "httpsProxy", ""),
		sysconfig.String(group, "username", ""),
		sysconfig.String(group, "password", ""),
	)
	noProxy := strings.TrimSpace(sysconfig.String(group, "noProxy", ""))

	env := map[string]string{}
	if httpProxy != "" {
		env["HTTP_PROXY"] = httpProxy
		env["http_proxy"] = httpProxy
	}
	if httpsProxy != "" {
		env["HTTPS_PROXY"] = httpsProxy
		env["https_proxy"] = httpsProxy
	}
	if noProxy != "" {
		env["NO_PROXY"] = noProxy
		env["no_proxy"] = noProxy
	}
	if len(env) == 0 {
		return nil
	}
	return env
}

func proxyURLWithCredentials(rawValue, username, password string) string {
	rawValue = strings.TrimSpace(rawValue)
	if rawValue == "" {
		return ""
	}
	username = strings.TrimSpace(username)
	password = strings.TrimSpace(password)
	if username == "" || strings.Contains(rawValue, "@") {
		return rawValue
	}
	parsed, err := url.Parse(rawValue)
	if err != nil || parsed.Host == "" {
		return rawValue
	}
	if password != "" {
		parsed.User = url.UserPassword(username, password)
	} else {
		parsed.User = url.User(username)
	}
	return parsed.String()
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
// @Router /api/servers/docker-targets [get]
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

	managedServers, err := servers.ListManagedServers(e.App)
	if err != nil || len(managedServers) == 0 {
		return e.JSON(http.StatusOK, result)
	}

	entries := make([]serverEntry, len(managedServers))
	var wg sync.WaitGroup
	for i, s := range managedServers {
		wg.Add(1)
		s := s // capture loop variable
		go func(idx int) {
			defer wg.Done()
			status := "offline"
			var reason string
			host := s.Host
			sshConfig, resolveErr := s.DockerSSHConfig(e.App, "")
			if resolveErr == nil {
				host = sshConfig.Host
				execSSH := docker.NewSSHExecutor(sshConfig)
				if pingErr := execSSH.Ping(e.Request.Context()); pingErr == nil {
					status = "online"
					reason = ""
				} else {
					reason = pingErr.Error()
				}
			} else {
				reason = resolveErr.Error()
			}
			entries[idx] = serverEntry{
				ID:     s.ID,
				Label:  s.Name,
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

// bodyStringSlice extracts a string slice field from body.
func bodyStringSlice(body map[string]any, key string) []string {
	raw, ok := body[key]
	if !ok || raw == nil {
		return nil
	}
	if values, ok := raw.([]string); ok {
		return values
	}
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		value, ok := item.(string)
		if !ok {
			continue
		}
		result = append(result, value)
	}
	return result
}

// ─── Compose Handlers ────────────────────────────────────

// handleComposeLs lists all Docker Compose projects on the target server.
//
// @Summary List Compose projects
// @Description Returns all docker compose projects on the specified server. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param serverId path string true "server ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/compose/ls [get]
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

type dockerContainerListRow struct {
	ID     string `json:"ID"`
	Names  string `json:"Names"`
	Image  string `json:"Image"`
	State  string `json:"State"`
	Status string `json:"Status"`
}

type composeMetadataContainer struct {
	ID     string `json:"id,omitempty"`
	Name   string `json:"name,omitempty"`
	Image  string `json:"image,omitempty"`
	State  string `json:"state,omitempty"`
	Status string `json:"status,omitempty"`
}

type composeMetadataItem struct {
	Containers []composeMetadataContainer `json:"containers"`
}

// handleComposeMetadata returns compact metadata for the requested compose projects.
//
// @Summary Get Compose metadata
// @Description Returns compact metadata for the requested Compose projects, including linked containers. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param serverId path string true "server ID"
// @Param body body object true "projects: array of Compose project names"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/compose/metadata [post]
func handleComposeMetadata(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	rawProjects := bodyStringSlice(body, "projects")
	projects := make([]string, 0, len(rawProjects))
	projectSet := make(map[string]struct{}, len(rawProjects))
	for _, rawProject := range rawProjects {
		project := strings.TrimSpace(rawProject)
		if project == "" {
			continue
		}
		if _, ok := projectSet[project]; ok {
			continue
		}
		projectSet[project] = struct{}{}
		projects = append(projects, project)
	}
	if len(projects) == 0 {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projects is required"})
	}
	if len(projects) > 200 {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projects exceeds limit 200"})
	}

	containerOutput, err := client.ContainerList(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "list containers failed", err)
	}
	containers, err := parseDockerContainerListRows(containerOutput)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "parse containers failed", err)
	}

	ids := make([]string, 0, len(containers))
	for _, container := range containers {
		id := strings.TrimSpace(container.ID)
		if id != "" {
			ids = append(ids, id)
		}
	}

	metadata := map[string]containerMetadataItem{}
	if len(ids) > 0 {
		inspectOutput, err := client.ContainerInspectMany(e.Request.Context(), ids)
		if err != nil {
			return dockerError(e, http.StatusInternalServerError, "inspect compose metadata failed", err)
		}
		metadata, err = parseContainerMetadataItems(inspectOutput, ids)
		if err != nil {
			return dockerError(e, http.StatusInternalServerError, "parse compose metadata failed", err)
		}
	}

	items := make(map[string]composeMetadataItem, len(projects))
	for _, project := range projects {
		items[project] = composeMetadataItem{Containers: []composeMetadataContainer{}}
	}
	for _, container := range containers {
		item := metadata[container.ID]
		project := item.ComposeProject
		if _, ok := projectSet[project]; !ok {
			continue
		}
		projectItem := items[project]
		projectItem.Containers = append(projectItem.Containers, composeMetadataContainer{
			ID:     container.ID,
			Name:   strings.TrimPrefix(container.Names, "/"),
			Image:  container.Image,
			State:  container.State,
			Status: container.Status,
		})
		items[project] = projectItem
	}

	return e.JSON(http.StatusOK, map[string]any{"items": items})
}

func parseDockerContainerListRows(output string) ([]dockerContainerListRow, error) {
	output = strings.TrimSpace(output)
	if output == "" {
		return []dockerContainerListRow{}, nil
	}
	rows := make([]dockerContainerListRow, 0)
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var row dockerContainerListRow
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			return nil, err
		}
		rows = append(rows, row)
	}
	return rows, nil
}

// handleComposeUp deploys a Docker Compose project (docker compose up -d).
//
// @Summary Deploy Compose project
// @Description Runs `docker compose up -d` in the given project directory. Writes audit entry. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param serverId path string true "server ID"
// @Param body body object true "projectDir: absolute path to the compose project"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/compose/up [post]
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
// @Param serverId path string true "server ID"
// @Param body body object true "projectDir, removeVolumes (optional bool)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/compose/down [post]
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
// @Param serverId path string true "server ID"
// @Param body body object true "projectDir"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/compose/start [post]
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
// @Param serverId path string true "server ID"
// @Param body body object true "projectDir"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/compose/stop [post]
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
// @Param serverId path string true "server ID"
// @Param body body object true "projectDir"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/compose/restart [post]
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

// handleComposePull pulls images for a Docker Compose project.
//
// @Summary Pull Compose images
// @Description Runs `docker compose pull` in the given project directory. Writes audit entry. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param serverId path string true "server ID"
// @Param body body object true "projectDir"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/compose/pull [post]
func handleComposePull(e *core.RequestEvent) error {
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
	output, err := client.ComposePull(e.Request.Context(), projectDir)
	if err != nil {
		audit.Write(e.App, audit.Entry{
			UserID: userID, UserEmail: userEmail,
			Action: "app.pull", ResourceType: "app",
			ResourceID: projectDir, ResourceName: projectDir,
			IP: ip, UserAgent: ua,
			Status: audit.StatusFailed,
			Detail: map[string]any{"errorMessage": err.Error()},
		})
		return dockerError(e, http.StatusInternalServerError, "compose pull failed", err)
	}
	audit.Write(e.App, audit.Entry{
		UserID: userID, UserEmail: userEmail,
		Action: "app.pull", ResourceType: "app",
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
// @Param serverId path string true "server ID"
// @Param projectDir query string true "absolute path to the compose project"
// @Param tail query integer false "number of log lines (default 100)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/compose/logs [get]
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
		if parsed, err := strconv.Atoi(t); err == nil {
			tail = parsed
		}
	}
	output, err := client.ComposeLogs(e.Request.Context(), projectDir, tail)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "compose logs failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleComposePs returns compose service status output for a Docker Compose project.
//
// @Summary Get Compose ps
// @Description Returns docker compose ps output in JSON format for the specified project. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param serverId path string true "server ID"
// @Param projectDir query string true "absolute path to the compose project"
// @Param projectName query string false "compose project name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/compose/ps [get]
func handleComposePs(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	projectDir := e.Request.URL.Query().Get("projectDir")
	if projectDir == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projectDir is required"})
	}
	projectName := e.Request.URL.Query().Get("projectName")
	output, err := client.ComposePs(e.Request.Context(), projectName, projectDir)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "compose ps failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleComposeConfigGet reads the docker-compose.yml content for a project (local only).
//
// @Summary Get Compose config
// @Description Returns the raw docker-compose.yml content for the specified project directory (local server only). Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param serverId path string true "server ID"
// @Param projectDir query string true "absolute path to the compose project"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/compose/config [get]
func handleComposeConfigGet(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	projectDir := e.Request.URL.Query().Get("projectDir")
	if projectDir == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "projectDir is required"})
	}
	content, err := readAppComposeConfig(e, serverID, projectDir)
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
// @Param serverId path string true "server ID"
// @Param body body object true "projectDir, content"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/compose/config [put]
func handleComposeConfigWrite(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
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
	if err := writeAppComposeConfig(e, serverID, projectDir, content); err != nil {
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
// @Param serverId path string true "server ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/images [get]
func handleImageList(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	cacheKey := dockerImageListCacheKey(e, client)
	if cached, ok := getCachedDockerImageList(cacheKey); ok {
		return e.JSON(http.StatusOK, map[string]any{"output": cached.output, "host": cached.host})
	}
	output, err := client.ImageList(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "list images failed", err)
	}
	setCachedDockerImageList(cacheKey, output, client.Host())
	return e.JSON(http.StatusOK, map[string]any{"output": output, "host": client.Host()})
}

// handleImageRegistryStatus checks whether Docker Hub is reachable from the target server.
//
// @Summary Check registry status
// @Description Pings Docker Hub to verify registry connectivity from the target server. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param serverId path string true "server ID"
// @Success 200 {object} map[string]any "available: bool"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/servers/{serverId}/docker/images/registry/status [get]
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
// @Param serverId path string true "server ID"
// @Param q query string true "search query"
// @Param limit query integer false "max results (default 20, max 100)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/images/registry/search [get]
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
// @Param serverId path string true "server ID"
// @Param id path string true "image ID or name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/images/{id}/inspect [get]
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
// @Description Accepts a background image pull operation for the specified image and returns an operation ID for polling. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param serverId path string true "server ID"
// @Param body body object true "name: image name/tag"
// @Success 202 {object} software.AsyncCommandResponse
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Failure 503 {object} map[string]any
// @Router /api/servers/{serverId}/docker/images/pull [post]
func handleImagePull(e *core.RequestEvent) error {
	_, err := getDockerClient(e)
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
	serverID := strings.TrimSpace(e.Request.PathValue("serverId"))
	if serverID == "" {
		serverID = "local"
	}
	normalizedName := worker.NormalizeDockerImageReference(name)
	inFlight, err := worker.FindInFlightDockerImagePullOperation(e.App, serverID, normalizedName)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "check pull operation failed", err)
	}
	if inFlight != nil {
		return e.JSON(http.StatusAccepted, map[string]any{
			"accepted":     true,
			"operation_id": inFlight.Id,
			"phase":        inFlight.GetString("phase"),
			"message":      "pull already in progress",
			"deduplicated": true,
		})
	}
	if asynqClient == nil {
		return e.JSON(http.StatusServiceUnavailable, map[string]any{
			"error":   "queue_not_configured",
			"message": "background task queue is not configured",
		})
	}
	record, err := worker.PrepareDockerImagePullOperation(e.App, serverID, name)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "prepare pull operation failed", err)
	}
	userID, userEmail, _, _ := clientInfo(e)
	if err := enqueueDockerImagePullTask(asynqClient, record.Id, serverID, name, userID, userEmail); err != nil {
		markDockerImagePullEnqueueFailed(e, record, err)
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "enqueue_failed",
			"message": err.Error(),
		})
	}
	return e.JSON(http.StatusAccepted, software.AsyncCommandResponse{
		Accepted:    true,
		OperationID: record.Id,
		Phase:       software.OperationPhaseAccepted,
		Message:     "pull accepted",
	})
}

// handleImagePullOperation returns the current state of an async image pull operation.
//
// @Summary Get Docker image pull operation
// @Description Returns the current status, logs, and terminal state for a previously accepted image pull operation. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param serverId path string true "server ID"
// @Param operationId path string true "pull operation ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/servers/{serverId}/docker/image-pull-operations/{operationId} [get]
func handleImagePullOperation(e *core.RequestEvent) error {
	operationID := strings.TrimSpace(e.Request.PathValue("operationId"))
	if operationID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "operationId is required"})
	}
	record, err := e.App.FindRecordById(collections.DockerImagePullOperations, operationID)
	if err != nil {
		return e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "pull operation not found"})
	}
	serverID := strings.TrimSpace(e.Request.PathValue("serverId"))
	if serverID == "" {
		serverID = "local"
	}
	if record.GetString("server_id") != serverID {
		return e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "pull operation not found"})
	}
	return e.JSON(http.StatusOK, dockerImagePullOperationResponse(record))
}

// handleImagePullOperations returns recent image pull operations for one server.
//
// @Summary List Docker image pull operations
// @Description Returns recent image pull operations for the specified server, with optional status filtering. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param serverId path string true "server ID"
// @Param status query string false "in_progress|completed|failed|all (default in_progress)"
// @Param limit query integer false "max items (default 20, max 50)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/image-pull-operations [get]
func handleImagePullOperations(e *core.RequestEvent) error {
	serverID := strings.TrimSpace(e.Request.PathValue("serverId"))
	if serverID == "" {
		serverID = "local"
	}

	status := strings.TrimSpace(e.Request.URL.Query().Get("status"))
	if status == "" {
		status = "in_progress"
	}

	limit := 20
	if raw := strings.TrimSpace(e.Request.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "limit must be a positive integer"})
		}
		limit = parsed
	}
	if limit > 50 {
		limit = 50
	}

	terminalFilter := ""
	switch status {
	case "in_progress":
		terminalFilter = string(software.TerminalStatusNone)
	case "completed":
		terminalFilter = string(software.TerminalStatusSuccess)
	case "failed":
		terminalFilter = string(software.TerminalStatusFailed)
	case "all":
		terminalFilter = ""
	default:
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "status must be one of in_progress, completed, failed, all"})
	}

	filter := fmt.Sprintf("server_id = '%s'", escapePBFilterValue(serverID))
	if terminalFilter != "" {
		filter += fmt.Sprintf(" && terminal_status = '%s'", escapePBFilterValue(terminalFilter))
	}

	records, err := e.App.FindRecordsByFilter(
		collections.DockerImagePullOperations,
		filter,
		"-updated",
		limit,
		0,
	)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "list pull operations failed", err)
	}

	items := make([]map[string]any, 0, len(records))
	for _, record := range records {
		items = append(items, dockerImagePullOperationResponse(record))
	}

	return e.JSON(http.StatusOK, map[string]any{"items": items})
}

func dockerImagePullOperationResponse(record *core.Record) map[string]any {
	return map[string]any{
		"id":              record.Id,
		"server_id":       record.GetString("server_id"),
		"image_name":      record.GetString("image_name"),
		"normalized_name": record.GetString("normalized_name"),
		"phase":           record.GetString("phase"),
		"terminal_status": record.GetString("terminal_status"),
		"failure_phase":   record.GetString("failure_phase"),
		"failure_reason":  record.GetString("failure_reason"),
		"output":          record.GetString("output"),
		"created":         record.GetDateTime("created").String(),
		"updated":         record.GetDateTime("updated").String(),
	}
}

func markDockerImagePullEnqueueFailed(e *core.RequestEvent, record *core.Record, enqueueErr error) {
	record.Set("phase", string(software.OperationPhaseFailed))
	record.Set("terminal_status", string(software.TerminalStatusFailed))
	record.Set("failure_phase", string(software.OperationPhaseAccepted))
	record.Set("failure_reason", fmt.Sprintf("enqueue failed: %v", enqueueErr))
	record.Set("output", strings.TrimSpace(record.GetString("output"))+"\nEnqueue failed.")
	if err := e.App.Save(record); err != nil {
		e.App.Logger().Error("save failed docker image pull operation after enqueue error", "operation_id", record.Id, "err", err)
	}
}

// handleImageRemove removes a Docker image by ID or name.
//
// @Summary Remove Docker image
// @Description Removes the specified image from the server. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param serverId path string true "server ID"
// @Param id path string true "image ID or name (supports path wildcard)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/images/{id...} [delete]
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
	invalidateDockerImageListCache(dockerImageListCacheKey(e, client))
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleImagePrune removes all unused Docker images.
//
// @Summary Prune unused images
// @Description Removes all dangling and unused Docker images. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param serverId path string true "server ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/images/prune [post]
func handleImagePrune(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	output, err := client.ImagePrune(e.Request.Context())
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "prune images failed", err)
	}
	invalidateDockerImageListCache(dockerImageListCacheKey(e, client))
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// ─── Container Handlers ──────────────────────────────────

// handleContainerList returns all Docker containers on the target server.
//
// @Summary List containers
// @Description Returns all containers (running and stopped) on the specified server. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param serverId path string true "server ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/containers [get]
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
// @Param serverId path string true "server ID"
// @Param id path string true "container ID or name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/containers/{id} [get]
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

type containerMetadataItem struct {
	Created        string   `json:"created,omitempty"`
	ComposeProject string   `json:"compose_project,omitempty"`
	VolumeNames    []string `json:"volume_names,omitempty"`
}

type dockerContainerInspectMetadata struct {
	ID      string `json:"Id"`
	Created string `json:"Created"`
	Config  struct {
		Labels map[string]string `json:"Labels"`
	} `json:"Config"`
	Mounts []struct {
		Name string `json:"Name"`
		Type string `json:"Type"`
	} `json:"Mounts"`
}

// handleContainerMetadata returns compact metadata for the requested container IDs.
//
// @Summary Get container metadata
// @Description Returns compact metadata for the requested container IDs, including created time, compose project, and linked volume names. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param serverId path string true "server ID"
// @Param body body object true "ids: array of container IDs or names"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/containers/metadata [post]
func handleContainerMetadata(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	body, err := readBody(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "invalid request body", err)
	}
	rawIDs := bodyStringSlice(body, "ids")
	ids := make([]string, 0, len(rawIDs))
	seen := make(map[string]struct{}, len(rawIDs))
	for _, rawID := range rawIDs {
		id := strings.TrimSpace(rawID)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "ids is required"})
	}
	if len(ids) > 200 {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "ids exceeds limit 200"})
	}
	output, err := client.ContainerInspectMany(e.Request.Context(), ids)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "inspect container metadata failed", err)
	}
	items, err := parseContainerMetadataItems(output, ids)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "parse container metadata failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"items": items})
}

func parseContainerMetadataItems(output string, requestedIDs []string) (map[string]containerMetadataItem, error) {
	if strings.TrimSpace(output) == "" {
		return map[string]containerMetadataItem{}, nil
	}
	var inspected []dockerContainerInspectMetadata
	if err := json.Unmarshal([]byte(output), &inspected); err != nil {
		return nil, err
	}
	items := make(map[string]containerMetadataItem, len(inspected))
	for index, entry := range inspected {
		volumeNames := make([]string, 0, len(entry.Mounts))
		seenVolumes := make(map[string]struct{}, len(entry.Mounts))
		for _, mount := range entry.Mounts {
			if mount.Type != "volume" || strings.TrimSpace(mount.Name) == "" {
				continue
			}
			if _, ok := seenVolumes[mount.Name]; ok {
				continue
			}
			seenVolumes[mount.Name] = struct{}{}
			volumeNames = append(volumeNames, mount.Name)
		}
		item := containerMetadataItem{
			Created:        entry.Created,
			ComposeProject: entry.Config.Labels["com.docker.compose.project"],
			VolumeNames:    volumeNames,
		}
		items[entry.ID] = item
		if index < len(requestedIDs) {
			requestedID := strings.TrimSpace(requestedIDs[index])
			if requestedID != "" {
				items[requestedID] = item
			}
		}
	}
	return items, nil
}

// handleContainerStats returns real-time resource usage stats for all running containers.
//
// @Summary Get container stats
// @Description Returns CPU/memory/network usage for all running containers. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param serverId path string true "server ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/containers/stats [get]
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
// @Param serverId path string true "server ID"
// @Param id path string true "container ID or name"
// @Param tail query integer false "number of log lines (default 200)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/containers/{id}/logs [get]
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
		if parsed, err := strconv.Atoi(t); err == nil {
			tail = parsed
		}
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
// @Param serverId path string true "server ID"
// @Param id path string true "container ID or name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/containers/{id}/start [post]
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
// @Param serverId path string true "server ID"
// @Param id path string true "container ID or name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/containers/{id}/stop [post]
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
// @Param serverId path string true "server ID"
// @Param id path string true "container ID or name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/containers/{id}/restart [post]
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
// @Param serverId path string true "server ID"
// @Param id path string true "container ID or name"
// @Param force query boolean false "force remove a running container"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/containers/{id} [delete]
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
// @Param serverId path string true "server ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/networks [get]
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

// handleNetworkInspect returns detailed metadata for a Docker network.
//
// @Summary Inspect network
// @Description Returns docker network inspect output for the given network ID or name. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param serverId path string true "server ID"
// @Param id path string true "network ID or name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/networks/{id}/inspect [get]
func handleNetworkInspect(e *core.RequestEvent) error {
	client, err := getDockerClient(e)
	if err != nil {
		return dockerError(e, http.StatusBadRequest, "server not found", err)
	}
	id := e.Request.PathValue("id")
	if id == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "id is required"})
	}
	output, err := client.NetworkInspect(e.Request.Context(), id)
	if err != nil {
		return dockerError(e, http.StatusInternalServerError, "inspect network failed", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"output": output})
}

// handleNetworkCreate creates a new Docker network.
//
// @Summary Create network
// @Description Creates a new Docker user-defined network. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param serverId path string true "server ID"
// @Param body body object true "name: network name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/networks [post]
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
// @Param serverId path string true "server ID"
// @Param id path string true "network ID or name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/networks/{id} [delete]
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
// @Param serverId path string true "server ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/volumes [get]
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
// @Param serverId path string true "server ID"
// @Param id path string true "volume name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/volumes/{id}/inspect [get]
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
// @Param serverId path string true "server ID"
// @Param id path string true "volume name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/volumes/{id} [delete]
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
// @Param serverId path string true "server ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/docker/volumes/prune [post]
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
// @Param serverId path string true "server ID"
// @Param body body object true "command: docker command string (e.g. \"info\")"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/servers/{serverId}/docker/exec [post]
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
