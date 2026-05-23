package service

import (
	"context"
	"errors"
	"io"
	"testing"

	"github.com/websoft9/appos/backend/domain/terminal"
)

type nopCloser struct{}

func (nopCloser) Close() error { return nil }

func TestConnectivityRuntimeServiceTunnelOnline(t *testing.T) {
	service := ConnectivityRuntimeService{
		TunnelConnected: func(serverID string) bool { return serverID == "srv-1" },
	}

	result, err := service.Check(context.Background(), ConnectivityCheckInput{ServerID: "srv-1", Mode: "tunnel"})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.Status != "online" || !result.ShouldWarm || result.ShouldCache {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestConnectivityRuntimeServiceSSHOfflineWithCategory(t *testing.T) {
	service := ConnectivityRuntimeService{
		ConnectSSH: func(context.Context, terminal.ConnectorConfig) (io.Closer, error) {
			return nil, terminal.NewConnectError(terminal.ErrCatAuthFailed, "credentials rejected", errors.New("denied"))
		},
	}

	config := terminal.ConnectorConfig{Host: "example.com", Port: 22, User: "root"}
	result, err := service.Check(context.Background(), ConnectivityCheckInput{Mode: "ssh", Config: &config})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.Status != "offline" || result.Category != string(terminal.ErrCatAuthFailed) || result.Reason != "credentials rejected" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if !result.ShouldCache || result.CacheStatus != "unavailable" || result.CacheReason != "credential_auth_failed" {
		t.Fatalf("expected unavailable cache result, got %#v", result)
	}
}

func TestConnectivityRuntimeServiceSSHNetworkErrorCachesStableReasonCode(t *testing.T) {
	service := ConnectivityRuntimeService{
		ConnectSSH: func(context.Context, terminal.ConnectorConfig) (io.Closer, error) {
			return nil, terminal.NewConnectError(terminal.ErrCatNetworkUnreachable, "network unreachable", errors.New("timeout"))
		},
	}

	config := terminal.ConnectorConfig{Host: "example.com", Port: 22, User: "root"}
	result, err := service.Check(context.Background(), ConnectivityCheckInput{Mode: "ssh", Config: &config})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.CacheReason != "tcp_connect_failed" {
		t.Fatalf("expected tcp_connect_failed cache reason, got %#v", result)
	}
}

func TestConnectivityRuntimeServiceSSHOnline(t *testing.T) {
	service := ConnectivityRuntimeService{
		ConnectSSH: func(context.Context, terminal.ConnectorConfig) (io.Closer, error) {
			return nopCloser{}, nil
		},
	}

	config := terminal.ConnectorConfig{Host: "example.com", Port: 22, User: "root"}
	result, err := service.Check(context.Background(), ConnectivityCheckInput{Mode: "ssh", Config: &config})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.Status != "online" || !result.ShouldWarm || !result.ShouldCache || result.CacheStatus != "available" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.LatencyMS < 0 {
		t.Fatalf("expected non-negative latency, got %#v", result)
	}
}

func TestConnectivityRuntimeServiceTCPAvailable(t *testing.T) {
	service := ConnectivityRuntimeService{
		ProbeTCP: func(host string, port int) ConnectivityTCPProbeResult {
			if host != "1.2.3.4" || port != 2222 {
				t.Fatalf("unexpected target: %s:%d", host, port)
			}
			return ConnectivityTCPProbeResult{AccessStatus: "available", LatencyMS: 42}
		},
	}

	result, err := service.Check(context.Background(), ConnectivityCheckInput{Mode: "tcp", Host: "1.2.3.4", Port: 2222})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.Status != "online" || result.LatencyMS != 42 || result.CacheStatus != "available" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestConnectivityRuntimeServiceTCPUnavailable(t *testing.T) {
	service := ConnectivityRuntimeService{
		ProbeTCP: func(host string, port int) ConnectivityTCPProbeResult {
			return ConnectivityTCPProbeResult{AccessStatus: "unavailable", AccessReason: "tcp_connect_failed", Detail: "dial timeout"}
		},
	}

	result, err := service.Check(context.Background(), ConnectivityCheckInput{Mode: "tcp", Host: "1.2.3.4", Port: 22})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.Status != "offline" || result.Reason != "dial timeout" || result.CacheReason != "tcp_connect_failed" {
		t.Fatalf("unexpected result: %#v", result)
	}
}