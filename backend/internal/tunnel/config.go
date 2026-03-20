package tunnel

import (
	"time"

	"golang.org/x/time/rate"
)

const (
	DefaultPortRangeStart = 40000
	DefaultPortRangeEnd   = 49999

	DefaultMaxPending = 50

	DefaultKeepaliveInterval = 30 * time.Second
	DefaultKeepaliveTimeout  = 15 * time.Second

	HostKeyFile = "tunnel_host_key"
)

const DefaultRateLimit rate.Limit = 10