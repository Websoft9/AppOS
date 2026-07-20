package routes

import (
	"net/http"
	"strings"
	"time"

	"github.com/websoft9/appos/backend/domain/monitor"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
)

type componentServiceItem struct {
	Name           string  `json:"name"`
	Lifecycle      string  `json:"lifecycle"`
	Visibility     string  `json:"visibility"`
	State          string  `json:"state"`
	PID            int     `json:"pid"`
	Uptime         int64   `json:"uptime"`
	CPU            float64 `json:"cpu"`
	Memory         int64   `json:"memory"`
	LastDetectedAt string  `json:"last_detected_at"`
	LogAvailable   bool    `json:"log_available"`
}

func loadLocalComponentServiceItems() ([]componentServiceItem, error) {
	registry, err := swcatalog.LoadLocalRegistry()
	if err != nil {
		return nil, err
	}

	observations := monitor.ObserveLocalServices(registry)
	items := make([]componentServiceItem, 0, len(observations))
	for _, service := range observations {
		items = append(items, componentServiceItem{
			Name:           service.Name,
			Lifecycle:      service.Lifecycle,
			Visibility:     service.Visibility,
			State:          service.State,
			PID:            service.PID,
			Uptime:         service.Uptime,
			CPU:            service.CPU,
			Memory:         service.Memory,
			LastDetectedAt: service.LastDetectedAt,
			LogAvailable:   service.LogAvailable,
		})
	}
	return items, nil
}

func loadLocalComponentServiceLog(name, stream string, tail int) (map[string]any, int, error) {
	registry, err := swcatalog.LoadLocalRegistry()
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}

	service, ok := registry.FindService(name)
	if !ok {
		return nil, http.StatusNotFound, nil
	}

	if stream == "" {
		stream = service.LogAccess.DefaultStream
	}
	if stream == "" {
		stream = "stdout"
	}

	maxBytes := tail * 256
	if maxBytes < 4096 {
		maxBytes = 4096
	}
	if maxBytes > 1024*1024 {
		maxBytes = 1024 * 1024
	}

	content, truncated, err := monitor.LoadLocalServiceLog(service, stream, maxBytes)
	if err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "disabled") {
			status = http.StatusConflict
		}
		return nil, status, err
	}

	return map[string]any{
		"name":             name,
		"stream":           stream,
		"content":          content,
		"truncated":        truncated,
		"last_detected_at": time.Now().UTC().Format(time.RFC3339),
	}, http.StatusOK, nil
}
