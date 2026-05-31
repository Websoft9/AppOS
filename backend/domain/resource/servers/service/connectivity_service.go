package service

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/websoft9/appos/backend/domain/terminal"
)

type ConnectivitySSHConnector func(context.Context, terminal.ConnectorConfig) (io.Closer, error)
type ConnectivityTunnelChecker func(string) bool

type ConnectivityTCPProbeResult struct {
	AccessStatus string
	AccessReason string
	Detail       string
	LatencyMS    int64
}

type ConnectivityTCPProbe func(string, int) ConnectivityTCPProbeResult

type ConnectivityRuntimeService struct {
	TunnelConnected ConnectivityTunnelChecker
	ConnectSSH      ConnectivitySSHConnector
	ProbeTCP        ConnectivityTCPProbe
}

type ConnectivityCheckInput struct {
	ServerID    string
	Mode        string
	Host        string
	Port        int
	Config      *terminal.ConnectorConfig
	ConfigError error
}

type ConnectivityCheckResult struct {
	Status      string `json:"status"`
	Mode        string `json:"mode"`
	Reason      string `json:"reason,omitempty"`
	Category    string `json:"category,omitempty"`
	LatencyMS   int64  `json:"latency_ms,omitempty"`
	ShouldWarm  bool
	ShouldCache bool
	CacheStatus string
	CacheReason string
}

func cacheReasonFromConnectCategory(category terminal.ConnectErrorCategory) string {
	switch category {
	case terminal.ErrCatAuthFailed:
		return "credential_auth_failed"
	case terminal.ErrCatNetworkUnreachable, terminal.ErrCatConnectionRefused:
		return "tcp_connect_failed"
	case terminal.ErrCatCredentialInvalid:
		return "credential_invalid"
	case terminal.ErrCatSessionFailed:
		return "ssh_session_failed"
	case terminal.ErrCatServerDisconnected:
		return "ssh_server_disconnected"
	default:
		return "connectivity_check_failed"
	}
}

func (s ConnectivityRuntimeService) Check(ctx context.Context, input ConnectivityCheckInput) (ConnectivityCheckResult, error) {
	result := ConnectivityCheckResult{Status: "offline", Mode: input.Mode}

	switch input.Mode {
	case "tunnel":
		if s.TunnelConnected != nil && s.TunnelConnected(input.ServerID) {
			result.Status = "online"
			result.ShouldWarm = true
		}
		return result, nil
	case "ssh":
		if input.ConfigError != nil {
			result.Reason = input.ConfigError.Error()
			return result, nil
		}
		if input.Config == nil {
			return result, fmt.Errorf("ssh connector config is required")
		}
		if s.ConnectSSH == nil {
			return result, fmt.Errorf("ssh connectivity connector is required")
		}

		probeCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		defer cancel()
		start := time.Now()
		conn, err := s.ConnectSSH(probeCtx, *input.Config)
		if err != nil {
			reason := err.Error()
			cacheReason := "connectivity_check_failed"
			var ce *terminal.ConnectError
			if ok := AsConnectError(err, &ce); ok {
				result.Category = string(ce.Category)
				reason = ce.Message
				cacheReason = cacheReasonFromConnectCategory(ce.Category)
			}
			result.Reason = reason
			result.ShouldCache = true
			result.CacheStatus = "unavailable"
			result.CacheReason = cacheReason
			return result, nil
		}
		_ = conn.Close()
		result.Status = "online"
		result.LatencyMS = time.Since(start).Milliseconds()
		result.ShouldWarm = true
		result.ShouldCache = true
		result.CacheStatus = "available"
		return result, nil
	default:
		if s.ProbeTCP == nil {
			return result, fmt.Errorf("tcp connectivity probe is required")
		}
		probe := s.ProbeTCP(input.Host, input.Port)
		result.ShouldCache = true
		result.CacheStatus = probe.AccessStatus
		result.CacheReason = probe.AccessReason
		if probe.AccessStatus != "available" {
			result.Reason = probe.Detail
			return result, nil
		}
		result.Status = "online"
		result.LatencyMS = probe.LatencyMS
		result.ShouldWarm = true
		return result, nil
	}
}

func AsConnectError(err error, target **terminal.ConnectError) bool {
	if err == nil || target == nil {
		return false
	}
	ce, ok := err.(*terminal.ConnectError)
	if ok {
		*target = ce
		return true
	}
	return false
}
