package checks

import (
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/resource/servers"
)

const serverControlProbeTimeout = 5 * time.Second

const (
	ControlReachabilityReachable         = "reachable"
	ControlReachabilityUnreachable       = "unreachable"
	ControlReachabilityTunnelUnavailable = "tunnel_unavailable"
	ControlReachabilityUnknown           = "unknown"
)

type ServerControlReachabilityResult struct {
	Outcome   string
	Reason    string
	Protocol  string
	Host      string
	Port      int
	LatencyMS int64
}

func ProbeServerControlReachability(record *core.Record) ServerControlReachabilityResult {
	server := servers.ManagedServerFromRecord(record)
	if server == nil || strings.TrimSpace(server.ID) == "" {
		return ServerControlReachabilityResult{
			Outcome:  ControlReachabilityUnknown,
			Reason:   "server record is required",
			Protocol: "ssh",
		}
	}

	if server.ConnectType == servers.ConnectionModeTunnel {
		return probeTunnelControlReachability(record)
	}
	return probeDirectControlReachability(server.Host, server.Port, "ssh")
}

func probeTunnelControlReachability(record *core.Record) ServerControlReachabilityResult {
	runtime := servers.TunnelRuntimeFromRecord(record)
	if runtime.Status != servers.TunnelStatusOnline {
		return ServerControlReachabilityResult{
			Outcome:  ControlReachabilityTunnelUnavailable,
			Reason:   "tunnel is not online",
			Protocol: "tunnel",
		}
	}
	port, err := servers.TunnelSSHPortFromServices(runtime.ServicesRaw)
	if err != nil {
		return ServerControlReachabilityResult{
			Outcome:  ControlReachabilityTunnelUnavailable,
			Reason:   err.Error(),
			Protocol: "tunnel",
		}
	}
	return probeDirectControlReachability("127.0.0.1", port, "tunnel")
}

func probeDirectControlReachability(host string, port int, protocol string) ServerControlReachabilityResult {
	host = strings.TrimSpace(host)
	if protocol == "" {
		protocol = "ssh"
	}
	result := ServerControlReachabilityResult{
		Outcome:  ControlReachabilityUnreachable,
		Protocol: protocol,
		Host:     host,
		Port:     port,
	}
	if host == "" {
		result.Outcome = ControlReachabilityUnknown
		result.Reason = "server host is empty"
		return result
	}
	if port <= 0 {
		port = 22
		result.Port = port
	}

	start := time.Now()
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), serverControlProbeTimeout)
	if err != nil {
		result.Reason = err.Error()
		return result
	}
	_ = conn.Close()
	result.Outcome = ControlReachabilityReachable
	result.Reason = ""
	result.LatencyMS = time.Since(start).Milliseconds()
	return result
}

func serverControlReachabilityReason(outcome string, fallback string) string {
	fallback = strings.TrimSpace(fallback)
	switch outcome {
	case ControlReachabilityReachable:
		return ""
	case ControlReachabilityTunnelUnavailable:
		if fallback != "" {
			return fallback
		}
		return "tunnel unavailable"
	case ControlReachabilityUnreachable:
		if fallback != "" {
			return fallback
		}
		return "control path is unreachable"
	default:
		if fallback != "" {
			return fallback
		}
		return fmt.Sprintf("control reachability is %s", ControlReachabilityUnknown)
	}
}
