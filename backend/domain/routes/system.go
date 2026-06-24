package routes

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

var (
	loadSystemRuntimeComponents = loadLocalRuntimeComponentItems
	loadSystemRuntimeServices   = loadLocalComponentServiceItems
	loadSystemRuntimeFacts      = readSystemRuntimeFacts
	systemTraefikDashboardURL   = "http://127.0.0.1:8081"
	systemTraefikServicePath    = "/etc/service/traefik"
	ensureSystemTraefikReady    = ensureSystemTraefikDashboardReady
	runSystemTraefikCommand     = func(ctx context.Context, command string, args ...string) (string, error) {
		cmd := exec.CommandContext(ctx, command, args...)
		output, err := cmd.CombinedOutput()
		text := strings.TrimSpace(string(output))
		if err != nil {
			if text == "" {
				return "", err
			}
			return text, fmt.Errorf("%w: %s", err, text)
		}
		return text, nil
	}
)

type systemRuntimeResponse struct {
	Summary         systemRuntimeSummary        `json:"summary"`
	Components      []softwareComponentListItem `json:"components"`
	Processes       []componentServiceItem      `json:"processes"`
	HostKernelFacts systemHostKernelFacts       `json:"host_kernel_facts"`
	RuntimeLimits   systemRuntimeLimits         `json:"runtime_limits"`
}

type systemRuntimeSummary struct {
	RunningComponents  int    `json:"runningComponents"`
	DegradedComponents int    `json:"degradedComponents"`
	CheckingComponents int    `json:"checkingComponents"`
	RuntimeShape       string `json:"runtimeShape"`
}

type systemCPUQuotaStatus string

type systemHostKernelFacts struct {
	KernelRelease      string                   `json:"kernel_release"`
	Architecture       string                   `json:"architecture"`
	CPUTopologyVisible systemVisibleCPUTopology `json:"cpu_topology_visible"`
}

type systemVisibleCPUTopology struct {
	ModelName      string `json:"model_name"`
	OnlineCPUCount int    `json:"online_cpu_count"`
}

type systemRuntimeLimits struct {
	CPUSetEffective  string         `json:"cpuset_effective"`
	CPUQuota         systemCPUQuota `json:"cpu_quota"`
	MemoryLimitBytes *int64         `json:"memory_limit_bytes"`
}

type systemCPUQuota struct {
	Status          systemCPUQuotaStatus `json:"status"`
	QuotaUS         *int64               `json:"quota_us"`
	PeriodUS        *int64               `json:"period_us"`
	CoresEquivalent *float64             `json:"cores_equivalent"`
}

const (
	systemCPUQuotaUnknown      systemCPUQuotaStatus = "unknown"
	systemCPUQuotaUnrestricted systemCPUQuotaStatus = "unrestricted"
	systemCPUQuotaConstrained  systemCPUQuotaStatus = "constrained"
)

// registerSystemRoutes registers system-level routes.
//
// Endpoints:
//
//	GET  /api/system/metrics   — CPU, memory, disk usage
//	GET  /api/system/files     — file browser listing
//	GET  /api/system/runtime   — Platform Runtime read model
func registerSystemRoutes(system *router.RouterGroup[*core.RequestEvent]) {
	system.Bind(apis.RequireSuperuserAuth())

	system.GET("/metrics", handleSystemMetrics)
	system.GET("/files", handleFileBrowser)
	system.GET("/runtime", handleSystemRuntime)
}

func registerPublicTraefikRoutes(se *core.ServeEvent) {
	se.Router.GET("/api/settings/public/traefik", handlePublicTraefikDashboard)
	se.Router.GET("/api/settings/public/traefik/{path...}", handlePublicTraefikDashboard)
}

// handleSystemMetrics returns host CPU, memory, and disk usage metrics.
//
// @Summary Get system metrics
// @Description Returns current CPU, memory, and disk usage for the host. Superuser only.
// @Tags Runtime Operations
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/system/metrics [get]
func handleSystemMetrics(e *core.RequestEvent) error {
	// TODO: collect and return CPU, memory, disk metrics
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

// handleFileBrowser returns a paginated listing of files on the local host.
//
// @Summary Browse local files
// @Description Returns a directory listing for the local server filesystem. Superuser only.
// @Tags Runtime Operations
// @Security BearerAuth
// @Param path query string false "directory path to list"
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/system/files [get]
func handleFileBrowser(e *core.RequestEvent) error {
	// TODO: list files with pagination and filtering
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

// @Summary Get platform runtime read model
// @Description Returns the aggregated Platform Runtime view for local AppOS components, services, and runtime-visible facts. Superuser only.
// @Tags Runtime Operations
// @Security BearerAuth
// @Success 200 {object} systemRuntimeResponse
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/system/runtime [get]
func handleSystemRuntime(e *core.RequestEvent) error {
	components, err := loadSystemRuntimeComponents(e.App)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "runtime_component_load_failed",
			"message": err.Error(),
		})
	}
	processes, err := loadSystemRuntimeServices()
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "runtime_process_load_failed",
			"message": err.Error(),
		})
	}
	facts, limits, err := loadSystemRuntimeFacts()
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "runtime_fact_load_failed",
			"message": err.Error(),
		})
	}

	return e.JSON(http.StatusOK, systemRuntimeResponse{
		Summary:         summarizeSystemRuntime(components),
		Components:      components,
		Processes:       processes,
		HostKernelFacts: facts,
		RuntimeLimits:   limits,
	})
}

// @Summary Proxy bundled Traefik dashboard
// @Description Proxies the embedded Traefik dashboard and API through AppOS under /api/settings/public/traefik. Public route.
// @Tags Runtime Operations
// @Success 200 {string} string "Traefik dashboard content"
// @Failure 502 {object} map[string]any
// @Failure 503 {object} map[string]any
// @Router /api/settings/public/traefik [get]
// @Router /api/settings/public/traefik/{path...} [get]
func handlePublicTraefikDashboard(e *core.RequestEvent) error {
	if err := ensureSystemTraefikReady(e.Request.Context()); err != nil {
		return e.JSON(http.StatusServiceUnavailable, map[string]any{
			"error":   "traefik_dashboard_unavailable",
			"message": err.Error(),
		})
	}

	target, err := url.Parse(systemTraefikDashboardURL)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "traefik_dashboard_proxy_invalid",
			"message": err.Error(),
		})
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, proxyErr error) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(fmt.Sprintf(`{"error":"traefik_dashboard_proxy_failed","message":%q}`+"\n", proxyErr.Error())))
	}
	proxy.ServeHTTP(e.Response, e.Request)
	return nil
}

func ensureSystemTraefikDashboardReady(ctx context.Context) error {
	if _, err := runSystemTraefikCommand(ctx, "sv", "up", systemTraefikServicePath); err != nil {
		return fmt.Errorf("start traefik service: %w", err)
	}

	client := &http.Client{Timeout: 500 * time.Millisecond}
	deadline := time.Now().Add(5 * time.Second)
	for {
		if time.Now().After(deadline) {
			return fmt.Errorf("traefik dashboard did not become ready in time")
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, systemTraefikDashboardURL+"/ping", nil)
		if err == nil {
			resp, reqErr := client.Do(req)
			if reqErr == nil {
				_ = resp.Body.Close()
				if resp.StatusCode >= 200 && resp.StatusCode < 500 {
					return nil
				}
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(150 * time.Millisecond):
		}
	}
}

func summarizeSystemRuntime(components []softwareComponentListItem) systemRuntimeSummary {
	available := 0
	degraded := 0
	checking := 0
	for _, component := range components {
		if component.ProbePending {
			checking++
			continue
		}
		if component.Available {
			available++
			continue
		}
		degraded++
	}
	return systemRuntimeSummary{
		RunningComponents:  available,
		DegradedComponents: degraded,
		CheckingComponents: checking,
		RuntimeShape:       "single-container appos with embedded control-plane services",
	}
}

func readSystemRuntimeFacts() (systemHostKernelFacts, systemRuntimeLimits, error) {
	var uname syscall.Utsname
	if err := syscall.Uname(&uname); err != nil {
		return systemHostKernelFacts{}, systemRuntimeLimits{}, err
	}

	modelName, onlineCPUCount := readVisibleCPUTopology()
	memoryLimitBytes, err := readMemoryLimitBytes()
	if err != nil {
		return systemHostKernelFacts{}, systemRuntimeLimits{}, err
	}

	return systemHostKernelFacts{
			KernelRelease: utsString(uname.Release[:]),
			Architecture:  utsString(uname.Machine[:]),
			CPUTopologyVisible: systemVisibleCPUTopology{
				ModelName:      modelName,
				OnlineCPUCount: onlineCPUCount,
			},
		}, systemRuntimeLimits{
			CPUSetEffective:  readCPUSetEffective(),
			CPUQuota:         readCPUQuota(),
			MemoryLimitBytes: memoryLimitBytes,
		}, nil
}

func utsString(raw []int8) string {
	buf := make([]byte, 0, len(raw))
	for _, ch := range raw {
		if ch == 0 {
			break
		}
		buf = append(buf, byte(ch))
	}
	return string(buf)
}

func readVisibleCPUTopology() (string, int) {
	content, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return "", runtime.NumCPU()
	}
	modelName := ""
	onlineCPUCount := 0
	for _, line := range strings.Split(string(content), "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "model name":
			if modelName == "" {
				modelName = strings.TrimSpace(value)
			}
		case "processor":
			onlineCPUCount++
		}
	}
	if onlineCPUCount == 0 {
		onlineCPUCount = runtime.NumCPU()
	}
	return modelName, onlineCPUCount
}

func readCPUSetEffective() string {
	for _, candidate := range []string{
		filepath.Join("/sys/fs/cgroup", "cpuset.cpus.effective"),
		filepath.Join("/sys/fs/cgroup", "cpuset", "cpuset.cpus.effective"),
		filepath.Join("/sys/fs/cgroup", "cpuset", "cpuset.cpus"),
	} {
		content, err := os.ReadFile(candidate)
		if err != nil {
			continue
		}
		if text := strings.TrimSpace(string(content)); text != "" {
			return text
		}
	}
	return ""
}

func readCPUQuota() systemCPUQuota {
	content, err := os.ReadFile(filepath.Join("/sys/fs/cgroup", "cpu.max"))
	if err == nil {
		fields := strings.Fields(strings.TrimSpace(string(content)))
		if len(fields) >= 2 {
			periodValue, periodOK := parseCPUQuotaInt(fields[1])
			if fields[0] == "max" {
				return systemCPUQuota{Status: systemCPUQuotaUnrestricted, PeriodUS: periodValueOrNil(periodValue, periodOK)}
			}
			quotaValue, quotaOK := parseCPUQuotaInt(fields[0])
			return newStructuredCPUQuota(quotaValue, quotaOK, periodValue, periodOK)
		}
	}
	quotaBytes, quotaErr := os.ReadFile(filepath.Join("/sys/fs/cgroup", "cpu", "cpu.cfs_quota_us"))
	periodBytes, periodErr := os.ReadFile(filepath.Join("/sys/fs/cgroup", "cpu", "cpu.cfs_period_us"))
	if quotaErr != nil || periodErr != nil {
		return systemCPUQuota{Status: systemCPUQuotaUnknown}
	}
	quota := strings.TrimSpace(string(quotaBytes))
	period := strings.TrimSpace(string(periodBytes))
	periodValue, periodOK := parseCPUQuotaInt(period)
	if quota == "-1" {
		return systemCPUQuota{Status: systemCPUQuotaUnrestricted, PeriodUS: periodValueOrNil(periodValue, periodOK)}
	}
	if quota == "" || period == "" {
		return systemCPUQuota{Status: systemCPUQuotaUnknown}
	}
	quotaValue, quotaOK := parseCPUQuotaInt(quota)
	return newStructuredCPUQuota(quotaValue, quotaOK, periodValue, periodOK)
}

func parseCPUQuotaInt(value string) (int64, bool) {
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || parsed <= 0 {
		return 0, false
	}
	return parsed, true
}

func periodValueOrNil(value int64, ok bool) *int64 {
	if !ok {
		return nil
	}
	return &value
}

func newStructuredCPUQuota(quotaValue int64, quotaOK bool, periodValue int64, periodOK bool) systemCPUQuota {
	quota := systemCPUQuota{Status: systemCPUQuotaUnknown}
	if quotaOK {
		quota.QuotaUS = &quotaValue
	}
	if periodOK {
		quota.PeriodUS = &periodValue
	}
	if quotaOK && periodOK {
		quota.Status = systemCPUQuotaConstrained
		coresEquivalent := float64(quotaValue) / float64(periodValue)
		quota.CoresEquivalent = &coresEquivalent
	}
	return quota
}

func readMemoryLimitBytes() (*int64, error) {
	for _, candidate := range []string{
		filepath.Join("/sys/fs/cgroup", "memory.max"),
		filepath.Join("/sys/fs/cgroup", "memory", "memory.limit_in_bytes"),
	} {
		content, err := os.ReadFile(candidate)
		if err != nil {
			continue
		}
		trimmed := strings.TrimSpace(string(content))
		if trimmed == "" || trimmed == "max" {
			return nil, nil
		}
		value, err := strconv.ParseInt(trimmed, 10, 64)
		if err != nil {
			return nil, err
		}
		if value <= 0 || value >= 1<<60 {
			return nil, nil
		}
		return &value, nil
	}
	return nil, nil
}
