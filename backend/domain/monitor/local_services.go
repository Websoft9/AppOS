package monitor

import (
	"fmt"
	"os"
	"path/filepath"
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

func ObserveLocalServices(registry *swcatalog.LocalRegistry) []LocalServiceObservation {
	client := supervisor.NewClient(supervisor.DefaultConfig())
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
			uptime = process.Uptime
			if resource, exists := resources[process.PID]; exists {
				cpu = resource.CPU
				memory = resource.Memory
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