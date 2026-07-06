package checks

import (
	"net"
	"strconv"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/resource/instances"
)

type ReachabilityResult struct {
	Status    string
	LatencyMS int64
	Reason    string
	Protocol  string
	Host      string
	Port      int
}

func ProbeInstanceReachability(item *instances.Instance) ReachabilityResult {
	return ProbeInstanceReachabilityWithTimeout(item, monitor.DefaultPolicySettings().ReachabilityProbeTimeout)
}

func LoadReachabilityProbeTimeout(app core.App) time.Duration {
	if app == nil {
		return monitor.DefaultPolicySettings().ReachabilityProbeTimeout
	}
	return monitor.LoadPolicySettings(app).ReachabilityProbeTimeout
}

func ProbeInstanceReachabilityWithTimeout(item *instances.Instance, timeout time.Duration) ReachabilityResult {
	target, err := instances.ResolveProbeTarget(item)
	if err != nil {
		return ReachabilityResult{
			Status:   "unknown",
			Reason:   err.Error(),
			Protocol: "tcp",
			Host:     target.Host,
			Port:     target.Port,
		}
	}

	addr := net.JoinHostPort(target.Host, strconv.Itoa(target.Port))
	start := time.Now()
	conn, dialErr := net.DialTimeout("tcp", addr, normalizedReachabilityProbeTimeout(timeout))
	if dialErr != nil {
		return ReachabilityResult{
			Status:   "offline",
			Reason:   dialErr.Error(),
			Protocol: "tcp",
			Host:     target.Host,
			Port:     target.Port,
		}
	}
	_ = conn.Close()
	return ReachabilityResult{
		Status:    "online",
		LatencyMS: time.Since(start).Milliseconds(),
		Protocol:  "tcp",
		Host:      target.Host,
		Port:      target.Port,
	}
}

func normalizedReachabilityProbeTimeout(timeout time.Duration) time.Duration {
	if timeout <= 0 {
		return monitor.DefaultPolicySettings().ReachabilityProbeTimeout
	}
	return timeout
}
