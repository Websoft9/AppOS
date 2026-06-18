package egress

import (
	"context"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func TestBuildEnvPlanWarnsWhenAlwaysWithoutCapability(t *testing.T) {
	app := newTestApp(t)
	if err := sysconfig.SetGroup(app, "proxy", "network", map[string]any{"source": "self", "enabled": false, "socks5ConnectorId": "", "httpConnectorId": "", "httpsConnectorId": ""}); err != nil {
		t.Fatal(err)
	}
	if err := sysconfig.SetGroup(app, "proxy", "policies", map[string]any{"items": []map[string]any{{"consumerKey": "git.general", "mode": "always"}}}); err != nil {
		t.Fatal(err)
	}
	plan, err := BuildEnvPlan(app, "git.general")
	if err != nil {
		t.Fatal(err)
	}
	if plan.Decision.Mode != ModeAlways {
		t.Fatalf("expected selected mode always, got %q", plan.Decision.Mode)
	}
	if plan.Decision.UseProxy {
		t.Fatal("expected no usable proxy env")
	}
	if len(plan.Decision.Warnings) != 1 {
		t.Fatalf("expected one warning, got %#v", plan.Decision.Warnings)
	}
	if !strings.Contains(plan.Decision.Warnings[0].Message, "source=self") {
		t.Fatalf("expected self-source warning, got %q", plan.Decision.Warnings[0].Message)
	}
	if len(plan.Env) != 0 {
		t.Fatalf("expected empty env, got %#v", plan.Env)
	}
}

func TestNewDialerPlanFallsBackDirectWithWarningWhenNoCapability(t *testing.T) {
	app := newTestApp(t)
	if err := sysconfig.SetGroup(app, "proxy", "network", map[string]any{"source": "none", "enabled": false, "socks5ConnectorId": "", "httpConnectorId": "", "httpsConnectorId": ""}); err != nil {
		t.Fatal(err)
	}
	if err := sysconfig.SetGroup(app, "proxy", "policies", map[string]any{"items": []map[string]any{{"consumerKey": "remote_shell.tunnel_dialer", "mode": "always"}}}); err != nil {
		t.Fatal(err)
	}
	plan, err := NewDialerPlan(app, "remote_shell.tunnel_dialer", 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Decision.Mode != ModeAlways {
		t.Fatalf("expected always mode, got %q", plan.Decision.Mode)
	}
	if plan.Decision.UseProxy {
		t.Fatal("expected direct fallback")
	}
	if len(plan.Decision.Warnings) != 1 {
		t.Fatalf("expected warning, got %#v", plan.Decision.Warnings)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	accepted := make(chan struct{}, 1)
	go func() {
		conn, acceptErr := ln.Accept()
		if acceptErr == nil {
			accepted <- struct{}{}
			_ = conn.Close()
		}
	}()
	conn, err := plan.DialContext(context.Background(), "tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	_ = conn.Close()
	select {
	case <-accepted:
	case <-time.After(2 * time.Second):
		t.Fatal("expected direct dial to reach listener")
	}
}

func TestNewHTTPClientPlanFallsBackDirectWithWarningWhenSelfSource(t *testing.T) {
	app := newTestApp(t)
	if err := sysconfig.SetGroup(app, "proxy", "network", map[string]any{"source": "self", "enabled": false, "socks5ConnectorId": "", "httpConnectorId": "", "httpsConnectorId": ""}); err != nil {
		t.Fatal(err)
	}
	if err := sysconfig.SetGroup(app, "proxy", "policies", map[string]any{"items": []map[string]any{{"consumerKey": "http.ai", "mode": "always"}}}); err != nil {
		t.Fatal(err)
	}
	plan, err := NewHTTPClientPlan(app, "http.ai", 5*time.Second, false)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Decision.Mode != ModeAlways {
		t.Fatalf("expected always mode, got %q", plan.Decision.Mode)
	}
	if plan.Decision.UseProxy {
		t.Fatal("expected direct fallback for self source")
	}
	if len(plan.Decision.Warnings) != 1 {
		t.Fatalf("expected warning, got %#v", plan.Decision.Warnings)
	}
	if !strings.Contains(plan.Decision.Warnings[0].Message, "http_client") {
		t.Fatalf("expected http_client warning, got %q", plan.Decision.Warnings[0].Message)
	}
}

func TestNewTunnelDialerPlanUsesSelfCapabilityWithoutWarning(t *testing.T) {
	app := newTestApp(t)
	if err := sysconfig.SetGroup(app, "proxy", "network", map[string]any{"source": "self", "enabled": false, "socks5ConnectorId": "", "httpConnectorId": "", "httpsConnectorId": ""}); err != nil {
		t.Fatal(err)
	}
	if err := sysconfig.SetGroup(app, "proxy", "policies", map[string]any{"items": []map[string]any{{"consumerKey": "remote_shell.global", "mode": "always"}}}); err != nil {
		t.Fatal(err)
	}
	plan, err := NewTunnelDialerPlan(app, "remote_shell.tunnel_dialer", 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Decision.Capability != CapabilitySelf {
		t.Fatalf("expected self capability, got %q", plan.Decision.Capability)
	}
	if plan.DialerMode != EffectiveDialerModeSelf {
		t.Fatalf("expected self dialer mode, got %q", plan.DialerMode)
	}
	if len(plan.Decision.Warnings) != 0 {
		t.Fatalf("expected no warning, got %#v", plan.Decision.Warnings)
	}
	if plan.Decision.UseProxy {
		t.Fatal("expected AppOS-side direct dialing for self capability")
	}
}

func TestBuildEnvPlanRejectsWrongAdapter(t *testing.T) {
	app := newTestApp(t)
	if _, err := BuildEnvPlan(app, "http.ai"); err == nil {
		t.Fatal("expected adapter mismatch error for env plan on http client consumer")
	}
}

func TestNewTunnelHTTPClientPlanUsesModuleEnrollment(t *testing.T) {
	app := newTestApp(t)
	if err := sysconfig.SetGroup(app, "proxy", "network", map[string]any{"source": "self", "enabled": false, "socks5ConnectorId": "", "httpConnectorId": "", "httpsConnectorId": ""}); err != nil {
		t.Fatal(err)
	}
	if err := sysconfig.SetGroup(app, "proxy", "policies", map[string]any{"items": []map[string]any{{"consumerKey": "remote_shell.global", "mode": "always"}}}); err != nil {
		t.Fatal(err)
	}
	plan, err := NewTunnelHTTPClientPlan(app, "remote_shell.tunnel_http", 5*time.Second, false)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Decision.Mode != ModeAlways {
		t.Fatalf("expected module enrollment to apply, got %q", plan.Decision.Mode)
	}
}

func TestProxyURLForDialAddressPrefersHTTPSProxyForRawTCP(t *testing.T) {
	proxyURL, err := proxyURLForDialAddress(map[string]string{
		"HTTPS_PROXY": "https://secure-proxy.example.com:8443",
	}, "example.com:443")
	if err != nil {
		t.Fatal(err)
	}
	if proxyURL == nil || proxyURL.String() != "https://secure-proxy.example.com:8443" {
		t.Fatalf("expected HTTPS proxy selection, got %#v", proxyURL)
	}
}

func newTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)
	return app
}
