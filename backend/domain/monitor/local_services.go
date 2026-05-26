package monitor

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"strings"
	"time"

	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
	"github.com/websoft9/appos/backend/infra/supervisor"
)

type LocalServiceObservation struct {
	Name           string
	Lifecycle      string
	Visibility     string
	State          string
	PID            int
	Uptime         int64
	CPU            float64
	Memory         int64
	LastDetectedAt string
	LogAvailable   bool
}

var localServiceProcessInfoFn = func() ([]supervisor.ProcessInfo, error) {
	client := supervisor.NewClient(supervisor.DefaultConfig())
	return client.GetAllProcessInfo()
}

var localServiceResourceFn = supervisor.GetProcessResources
var localServiceMemoryFn = supervisor.GetProcessMemory
var localServiceUptimeFn = supervisor.GetProcessUptime

var localServiceObservationCache = struct {
	mu         sync.Mutex
	items      []LocalServiceObservation
	initialized bool
	refreshing bool
}{}

func ObserveLocalServices(registry *swcatalog.LocalRegistry) []LocalServiceObservation {
	if items, ok := loadLocalServiceObservationSnapshot(); ok {
		startLocalServiceObservationRefresh(registry)
		return items
	}

	items := observeLocalServicesSnapshot(registry, false)
	storeLocalServiceObservationSnapshot(items)
	startLocalServiceObservationRefresh(registry)
	return items
}

func observeLocalServicesSnapshot(registry *swcatalog.LocalRegistry, includeCPU bool) []LocalServiceObservation {
	processes, procErr := localServiceProcessInfoFn()
	resources := map[int]supervisor.ResourceInfo{}
	memoryByPID := map[int]int64{}
	uptimeByPID := map[int]int64{}
	processMap := map[string]supervisor.ProcessInfo{}
	if procErr == nil {
		pids := make([]int, 0, len(processes))
		for _, process := range processes {
			processMap[process.Name] = process
			if process.PID > 0 {
				pids = append(pids, process.PID)
			}
		}
		if includeCPU {
			resources = localServiceResourceFn(pids)
		} else {
			memoryByPID = localServiceMemoryFn(pids)
		}
		uptimeByPID = localServiceUptimeFn(pids)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	items := make([]LocalServiceObservation, 0, len(registry.EnabledServices()))
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
			if observedUptime, exists := uptimeByPID[process.PID]; exists {
				uptime = observedUptime
			}
			if resource, exists := resources[process.PID]; exists {
				cpu = resource.CPU
				memory = resource.Memory
			} else if fastMemory, exists := memoryByPID[process.PID]; exists {
				memory = fastMemory
			}
		} else if procErr == nil {
			state = "missing"
		}
		items = append(items, LocalServiceObservation{
			Name:           service.Name,
			Lifecycle:      service.Lifecycle,
			Visibility:     service.Visibility,
			State:          state,
			PID:            pid,
			Uptime:         uptime,
			CPU:            cpu,
			Memory:         memory,
			LastDetectedAt: now,
			LogAvailable:   strings.TrimSpace(service.LogAccess.Type) != "",
		})
	}
	return items
}

func loadLocalServiceObservationSnapshot() ([]LocalServiceObservation, bool) {
	localServiceObservationCache.mu.Lock()
	defer localServiceObservationCache.mu.Unlock()
	if !localServiceObservationCache.initialized {
		return nil, false
	}
	return cloneLocalServiceObservations(localServiceObservationCache.items), true
}

func storeLocalServiceObservationSnapshot(items []LocalServiceObservation) {
	localServiceObservationCache.mu.Lock()
	localServiceObservationCache.items = cloneLocalServiceObservations(items)
	localServiceObservationCache.initialized = true
	localServiceObservationCache.mu.Unlock()
}

func startLocalServiceObservationRefresh(registry *swcatalog.LocalRegistry) {
	localServiceObservationCache.mu.Lock()
	if localServiceObservationCache.refreshing {
		localServiceObservationCache.mu.Unlock()
		return
	}
	localServiceObservationCache.refreshing = true
	localServiceObservationCache.mu.Unlock()

	go func() {
		items := observeLocalServicesSnapshot(registry, true)
		localServiceObservationCache.mu.Lock()
		localServiceObservationCache.items = cloneLocalServiceObservations(items)
		localServiceObservationCache.initialized = true
		localServiceObservationCache.refreshing = false
		localServiceObservationCache.mu.Unlock()
	}()
}

func cloneLocalServiceObservations(items []LocalServiceObservation) []LocalServiceObservation {
	if len(items) == 0 {
		return []LocalServiceObservation{}
	}
	cloned := make([]LocalServiceObservation, len(items))
	copy(cloned, items)
	return cloned
}

func LoadLocalServiceLog(service swcatalog.LocalService, stream string, maxBytes int) (string, bool, error) {
	switch service.LogAccess.Type {
	case "supervisor":
		client := supervisor.NewClient(supervisor.DefaultConfig())
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