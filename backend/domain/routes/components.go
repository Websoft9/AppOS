package routes

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	comp "github.com/websoft9/appos/backend/domain/components"
	"github.com/websoft9/appos/backend/infra/supervisor"
)

type componentInventoryItem struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Version   string `json:"version"`
	Available bool   `json:"available"`
	UpdatedAt string `json:"updated_at"`
}

type componentServiceItem struct {
	Name           string  `json:"name"`
	State          string  `json:"state"`
	PID            int     `json:"pid"`
	Uptime         int64   `json:"uptime"`
	CPU            float64 `json:"cpu"`
	Memory         int64   `json:"memory"`
	LastDetectedAt string  `json:"last_detected_at"`
	LogAvailable   bool    `json:"log_available"`
}

func registerComponentsRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	g.GET("", handleComponentsList)

	services := g.Group("/services")
	services.GET("", handleComponentServicesList)
	services.GET("/{name}/logs", handleComponentServiceLogs)
}

var (
	inventoryCache    []componentInventoryItem
	inventoryCachedAt time.Time
	inventoryMu       sync.RWMutex
	inventoryCacheTTL = 15 * time.Minute
)

// @Summary List components
// @Description Returns the installed component inventory with version and availability status. Auth required.
// @Tags Components
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/components [get]
func handleComponentsList(e *core.RequestEvent) error {
	force := e.Request.URL.Query().Get("force") == "1"

	if !force {
		inventoryMu.RLock()
		cached := inventoryCache
		cachedAt := inventoryCachedAt
		inventoryMu.RUnlock()
		if len(cached) > 0 && time.Since(cachedAt) < inventoryCacheTTL {
			return e.JSON(http.StatusOK, cached)
		}
	}

	registry, err := comp.LoadRegistry()
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "components_registry_invalid",
			"message": err.Error(),
		})
	}

	enabled := registry.EnabledComponents()
	items := make([]componentInventoryItem, len(enabled))
	var wg sync.WaitGroup
	for i, item := range enabled {
		wg.Add(1)
		go func(i int, item comp.Component) {
			defer wg.Done()
			version, vErr := comp.DetectVersion(item.VersionProbe)
			if vErr != nil || strings.TrimSpace(version) == "" {
				version = "unknown"
			}
			available, aErr := comp.CheckAvailability(item.AvailabilityProbe)
			if aErr != nil {
				available = false
			}
			items[i] = componentInventoryItem{
				ID:        item.ID,
				Name:      item.Name,
				Version:   version,
				Available: available,
				UpdatedAt: comp.DetectUpdateTime(item.UpdateProbe),
			}
		}(i, item)
	}
	wg.Wait()

	inventoryMu.Lock()
	inventoryCache = items
	inventoryCachedAt = time.Now()
	inventoryMu.Unlock()

	return e.JSON(http.StatusOK, items)
}

// @Summary List component services
// @Description Returns runtime services under the components domain. Auth required.
// @Tags Services
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/components/services [get]
func handleComponentServicesList(e *core.RequestEvent) error {
	registry, err := comp.LoadRegistry()
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "components_registry_invalid",
			"message": err.Error(),
		})
	}

	client := newSupervisorClient()
	processes, procErr := client.GetAllProcessInfo()
	resources := map[int]supervisor.ResourceInfo{}
	processMap := map[string]supervisor.ProcessInfo{}
	if procErr == nil {
		pids := make([]int, 0, len(processes))
		for _, process := range processes {
			processMap[process.Name] = process
			if process.PID > 0 {
				pids = append(pids, process.PID)
			}
		}
		resources = supervisor.GetProcessResources(pids)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	items := make([]componentServiceItem, 0, len(registry.EnabledServices()))
	for _, service := range registry.EnabledServices() {
		process, ok := processMap[service.Name]
		state := "unknown"
		pid := 0
		uptime := int64(0)
		cpu := 0.0
		memory := int64(0)
		if ok {
			state = strings.ToLower(process.StateName)
			pid = process.PID
			uptime = process.Uptime
			if resource, exists := resources[process.PID]; exists {
				cpu = resource.CPU
				memory = resource.Memory
			}
		} else if procErr == nil {
			state = "missing"
		}
		items = append(items, componentServiceItem{
			Name:           service.Name,
			State:          state,
			PID:            pid,
			Uptime:         uptime,
			CPU:            cpu,
			Memory:         memory,
			LastDetectedAt: now,
			LogAvailable:   strings.TrimSpace(service.LogAccess.Type) != "",
		})
	}

	return e.JSON(http.StatusOK, items)
}

// @Summary Get component service logs
// @Description Returns service logs for one component service. Auth required.
// @Tags Services
// @Security BearerAuth
// @Param name path string true "service name"
// @Param stream query string false "stdout or stderr"
// @Param tail query integer false "approximate line count"
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 409 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/components/services/{name}/logs [get]
func handleComponentServiceLogs(e *core.RequestEvent) error {
	registry, err := comp.LoadRegistry()
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "components_registry_invalid",
			"message": err.Error(),
		})
	}

	name := e.Request.PathValue("name")
	if strings.TrimSpace(name) == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"error": "missing service name"})
	}

	service, ok := registry.FindService(name)
	if !ok {
		return e.JSON(http.StatusNotFound, map[string]any{"error": "service_not_found", "message": "service not found: " + name})
	}

	stream := e.Request.URL.Query().Get("stream")
	if stream == "" {
		stream = e.Request.URL.Query().Get("type")
	}
	if stream == "" {
		stream = service.LogAccess.DefaultStream
	}
	if stream == "" {
		stream = "stdout"
	}

	tail := 200
	if raw := e.Request.URL.Query().Get("tail"); raw != "" {
		if parsed, parseErr := strconv.Atoi(raw); parseErr == nil && parsed > 0 {
			tail = parsed
		}
	}
	maxBytes := tail * 256
	if maxBytes < 4096 {
		maxBytes = 4096
	}
	if maxBytes > 1024*1024 {
		maxBytes = 1024 * 1024
	}

	content, truncated, err := loadServiceLog(service, stream, maxBytes)
	if err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "disabled") {
			status = http.StatusConflict
		}
		return e.JSON(status, map[string]any{"error": "logs_failed", "message": err.Error()})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"name":             name,
		"stream":           stream,
		"content":          content,
		"truncated":        truncated,
		"last_detected_at": time.Now().UTC().Format(time.RFC3339),
	})
}

func loadServiceLog(service comp.Service, stream string, maxBytes int) (string, bool, error) {
	switch service.LogAccess.Type {
	case "supervisor":
		client := newSupervisorClient()
		if stream == "stderr" {
			content, _, _, err := client.TailErrLog(service.LogAccess.Service, 0, maxBytes)
			return content, len(content) >= maxBytes, err
		}
		content, _, _, err := client.TailLog(service.LogAccess.Service, 0, maxBytes)
		return content, len(content) >= maxBytes, err
	case "file":
		path := service.LogAccess.StdoutPath
		if stream == "stderr" {
			path = service.LogAccess.StderrPath
		}
		if strings.TrimSpace(path) == "" {
			return "", false, fmt.Errorf("log access disabled for stream %s", stream)
		}
		data, err := os.ReadFile(filepath.Clean(path))
		if err != nil {
			return "", false, err
		}
		truncated := len(data) > maxBytes
		if truncated {
			data = data[len(data)-maxBytes:]
		}
		return string(data), truncated, nil
	default:
		return "", false, fmt.Errorf("log access disabled for service %s", service.Name)
	}
}
