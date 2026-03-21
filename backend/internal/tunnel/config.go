package tunnel

import (
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/settings"
	"golang.org/x/time/rate"
)

const (
	SettingsModule = "tunnel"
	PortRangeKey   = "port_range"

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

	start := settings.Int(raw, "start", DefaultPortRangeStart)
	end := settings.Int(raw, "end", DefaultPortRangeEnd)
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

func LoadPortRange(app core.App) PortRange {
	if app == nil {
		return DefaultPortRange()
	}

	raw, _ := settings.GetGroup(app, SettingsModule, PortRangeKey, DefaultPortRange().ToMap())
	return NormalizePortRange(raw)
}