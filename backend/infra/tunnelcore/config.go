package tunnelcore

import (
	"golang.org/x/time/rate"
	"strconv"
	"time"
)

const (
	DefaultPortRangeStart = 40000
	DefaultPortRangeEnd   = 49999
	DefaultSSHPort        = 2222

	DefaultMaxPending = 50

	DefaultKeepaliveInterval = 30 * time.Second
	DefaultKeepaliveTimeout  = 15 * time.Second

	HostKeyFile = "tunnel_host_key"
)

const DefaultRateLimit rate.Limit = 10

type PortRange struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

func DefaultPortRange() PortRange {
	return PortRange{
		Start: DefaultPortRangeStart,
		End:   DefaultPortRangeEnd,
	}
}

func (p PortRange) ToMap() map[string]any {
	return map[string]any{
		"start": p.Start,
		"end":   p.End,
	}
}

func NormalizePortRange(raw map[string]any) PortRange {
	portRange := DefaultPortRange()
	if raw == nil {
		return portRange
	}

	start := intFromMap(raw, "start", DefaultPortRangeStart)
	end := intFromMap(raw, "end", DefaultPortRangeEnd)
	if start < 1 || start > 65535 || end < 1 || end > 65535 || start >= end {
		return portRange
	}
	if start <= DefaultSSHPort && DefaultSSHPort <= end {
		return portRange
	}

	portRange.Start = start
	portRange.End = end
	return portRange
}

func intFromMap(raw map[string]any, key string, fallback int) int {
	value, ok := raw[key]
	if !ok || value == nil {
		return fallback
	}

	switch typed := value.(type) {
	case int:
		return typed
	case int8:
		return int(typed)
	case int16:
		return int(typed)
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case float32:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		parsed, err := strconv.Atoi(typed)
		if err != nil {
			return fallback
		}
		return parsed
	default:
		return fallback
	}
}
