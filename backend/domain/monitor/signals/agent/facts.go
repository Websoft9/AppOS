package agent

import (
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
)

const FactsBatchLimit = 1

type FactsIngest struct {
	ServerID   string
	ServerName string
	ReportedAt time.Time
	Items      []FactsItem
}

type FactsItem struct {
	TargetType string
	TargetID   string
	Facts      map[string]any
	ObservedAt time.Time
}

func IngestFacts(app core.App, input FactsIngest) (int, error) {
	serverID := strings.TrimSpace(input.ServerID)
	serverRecord, err := app.FindRecordById("servers", serverID)
	if err != nil {
		return 0, err
	}
	accepted := 0
	for _, item := range input.Items {
		if strings.TrimSpace(item.TargetType) != monitor.TargetTypeServer {
			return accepted, ErrFactsTargetTypeUnsupported
		}
		if strings.TrimSpace(item.TargetID) == "" || strings.TrimSpace(item.TargetID) != serverID {
			return accepted, ErrFactsTargetMismatch
		}
		observedAt := item.ObservedAt
		if observedAt.IsZero() {
			observedAt = input.ReportedAt
		}
		normalized, err := normalizeFactsSnapshot(item.Facts)
		if err != nil {
			return accepted, fmt.Errorf("%w: %v", ErrFactsPayloadInvalid, err)
		}
		serverRecord.Set("facts_json", normalized)
		serverRecord.Set("facts_observed_at", observedAt.UTC().Format(time.RFC3339))
		if err := app.Save(serverRecord); err != nil {
			return accepted, err
		}
		accepted++
	}
	return accepted, nil
}

func normalizeFactsSnapshot(facts map[string]any) (map[string]any, error) {
	if len(facts) == 0 {
		return nil, fmt.Errorf("facts snapshot is empty")
	}
	normalized := make(map[string]any, len(facts))
	for key, value := range facts {
		switch strings.TrimSpace(key) {
		case "os":
			group, err := normalizeOSFacts(value)
			if err != nil {
				return nil, err
			}
			normalized["os"] = group
		case "kernel":
			group, err := normalizeKernelFacts(value)
			if err != nil {
				return nil, err
			}
			normalized["kernel"] = group
		case "architecture":
			text, err := normalizeRequiredString(value, "architecture")
			if err != nil {
				return nil, err
			}
			normalized["architecture"] = text
		case "cpu":
			group, err := normalizeCPUFacts(value)
			if err != nil {
				return nil, err
			}
			normalized["cpu"] = group
		case "memory":
			group, err := normalizeMemoryFacts(value)
			if err != nil {
				return nil, err
			}
			normalized["memory"] = group
		default:
			return nil, fmt.Errorf("unknown facts group %q", key)
		}
	}
	return normalized, nil
}

func normalizeOSFacts(value any) (map[string]any, error) {
	group, err := requireMap(value, "os")
	if err != nil {
		return nil, err
	}
	normalized := make(map[string]any, len(group))
	for key, nested := range group {
		switch strings.TrimSpace(key) {
		case "family", "distribution", "version":
			text, err := normalizeRequiredString(nested, "os."+key)
			if err != nil {
				return nil, err
			}
			normalized[key] = text
		default:
			return nil, fmt.Errorf("unknown facts field %q", "os."+key)
		}
	}
	if len(normalized) == 0 {
		return nil, fmt.Errorf("os facts are empty")
	}
	return normalized, nil
}

func normalizeKernelFacts(value any) (map[string]any, error) {
	group, err := requireMap(value, "kernel")
	if err != nil {
		return nil, err
	}
	normalized := make(map[string]any, len(group))
	for key, nested := range group {
		switch strings.TrimSpace(key) {
		case "release":
			text, err := normalizeRequiredString(nested, "kernel.release")
			if err != nil {
				return nil, err
			}
			normalized[key] = text
		default:
			return nil, fmt.Errorf("unknown facts field %q", "kernel."+key)
		}
	}
	if len(normalized) == 0 {
		return nil, fmt.Errorf("kernel facts are empty")
	}
	return normalized, nil
}

func normalizeCPUFacts(value any) (map[string]any, error) {
	group, err := requireMap(value, "cpu")
	if err != nil {
		return nil, err
	}
	normalized := make(map[string]any, len(group))
	for key, nested := range group {
		switch strings.TrimSpace(key) {
		case "cores":
			count, err := normalizePositiveInteger(nested, "cpu.cores")
			if err != nil {
				return nil, err
			}
			normalized[key] = count
		default:
			return nil, fmt.Errorf("unknown facts field %q", "cpu."+key)
		}
	}
	if len(normalized) == 0 {
		return nil, fmt.Errorf("cpu facts are empty")
	}
	return normalized, nil
}

func normalizeMemoryFacts(value any) (map[string]any, error) {
	group, err := requireMap(value, "memory")
	if err != nil {
		return nil, err
	}
	normalized := make(map[string]any, len(group))
	for key, nested := range group {
		switch strings.TrimSpace(key) {
		case "total_bytes":
			totalBytes, err := normalizePositiveInteger(nested, "memory.total_bytes")
			if err != nil {
				return nil, err
			}
			normalized[key] = totalBytes
		default:
			return nil, fmt.Errorf("unknown facts field %q", "memory."+key)
		}
	}
	if len(normalized) == 0 {
		return nil, fmt.Errorf("memory facts are empty")
	}
	return normalized, nil
}

func requireMap(value any, field string) (map[string]any, error) {
	group, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s must be an object", field)
	}
	return group, nil
}

func normalizeRequiredString(value any, field string) (string, error) {
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return "", fmt.Errorf("%s must be a non-empty string", field)
	}
	return text, nil
}

func normalizePositiveInteger(value any, field string) (int64, error) {
	switch number := value.(type) {
	case int:
		if number <= 0 {
			return 0, fmt.Errorf("%s must be positive", field)
		}
		return int64(number), nil
	case int32:
		if number <= 0 {
			return 0, fmt.Errorf("%s must be positive", field)
		}
		return int64(number), nil
	case int64:
		if number <= 0 {
			return 0, fmt.Errorf("%s must be positive", field)
		}
		return number, nil
	case float64:
		if number <= 0 || number != float64(int64(number)) {
			return 0, fmt.Errorf("%s must be a positive integer", field)
		}
		return int64(number), nil
	default:
		return 0, fmt.Errorf("%s must be a positive integer", field)
	}
}
