package remoteshell

import (
	"fmt"
	"net/url"
	"sort"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	"github.com/websoft9/appos/backend/domain/terminal"
	"github.com/websoft9/appos/backend/infra/egress"
)

const (
	TransportDirectSSH        = "direct_ssh"
	TransportTunnelControlSSH = "tunnel_control_plane"
)

type ExecutionPlan struct {
	Config     terminal.ConnectorConfig
	Env        map[string]string
	Transport  string
	Warnings   []string
	Source     string
	PolicyMode string
}

func ResolveExecutionPlan(app core.App, access servers.AccessConfig, serverID string, apposBaseURL string) (ExecutionPlan, error) {
	plan := ExecutionPlan{
		Config:    terminalConfigFromAccess(access),
		Transport: classifyTransport(access),
	}
	serverID = strings.TrimSpace(serverID)
	if app == nil || serverID == "" || serverID == "local" {
		return plan, nil
	}
	record, err := app.FindRecordById("servers", serverID)
	if err != nil {
		return ExecutionPlan{}, err
	}
	if serverRecordIsLocal(record) {
		return plan, nil
	}
	network := egress.LoadNetworkSettings(app)
	plan.Source = network.Source
	mode, err := egress.ResolveRemoteShellMode(app, serverID)
	if err != nil {
		return ExecutionPlan{}, err
	}
	plan.PolicyMode = string(mode)
	if mode == egress.ModeAlways {
		tunnelEnv, warning, envErr := BuildTunnelProxyEnv(app, serverID, apposBaseURL)
		if envErr != nil {
			return ExecutionPlan{}, envErr
		}
		if strings.TrimSpace(warning) != "" {
			plan.Warnings = append(plan.Warnings, warning)
		}
		plan.Env = tunnelEnv
	}
	if len(plan.Env) > 0 {
		plan.Config.Shell = wrapInteractiveShell(plan.Config.Shell, plan.Env)
	}
	return plan, nil
}

func terminalConfigFromAccess(access servers.AccessConfig) terminal.ConnectorConfig {
	return terminal.ConnectorConfig{
		Host:     access.Host,
		Port:     access.Port,
		User:     access.User,
		AuthType: terminal.CredAuthType(access.AuthType),
		Secret:   access.Secret,
		Shell:    access.Shell,
	}
}

func classifyTransport(access servers.AccessConfig) string {
	if strings.TrimSpace(access.Host) == "127.0.0.1" || strings.EqualFold(strings.TrimSpace(access.Host), "localhost") {
		return TransportTunnelControlSSH
	}
	return TransportDirectSSH
}

func wrapInteractiveShell(shell string, env map[string]string) string {
	if len(env) == 0 {
		return shell
	}
	keys := make([]string, 0, len(env))
	for key, value := range env {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(value) == "" {
			continue
		}
		keys = append(keys, key)
	}
	if len(keys) == 0 {
		return shell
	}
	sort.Strings(keys)
	exports := make([]string, 0, len(keys))
	for _, key := range keys {
		exports = append(exports, fmt.Sprintf("export %s=%s", key, terminal.ShellQuote(env[key])))
	}
	targetShell := strings.TrimSpace(shell)
	if targetShell == "" {
		targetShell = `${SHELL:-/bin/bash} -l`
	}
	return fmt.Sprintf("sh -lc %s", terminal.ShellQuote(strings.Join(exports, "; ")+"; exec "+targetShell))
}

func BuildTunnelProxyEnv(app core.App, serverID string, apposBaseURL string) (map[string]string, string, error) {
	plan, err := egress.BuildEnvPlan(app, "remote_shell.env")
	if err != nil {
		return nil, "", err
	}
	if plan.Decision.Mode == egress.ModeDisabled {
		return nil, "", nil
	}
	network := egress.LoadNetworkSettings(app)
	source := strings.TrimSpace(network.Source)
	switch source {
	case "self":
		// Self proxy is explicitly enabled for remote shell and uses the AppOS endpoint below.
	case "external":
		if !network.Enabled || !plan.Decision.UseProxy {
			return nil, "", nil
		}
	default:
		return nil, "", nil
	}
	serverID = strings.TrimSpace(serverID)
	apposBaseURL = strings.TrimRight(strings.TrimSpace(apposBaseURL), "/")
	if app == nil || serverID == "" || apposBaseURL == "" {
		return nil, "Remote shell proxy is set to Always, but the AppOS public URL is unavailable. This session runs with direct managed-server egress.", nil
	}
	token, err := egress.GetOrIssueSelfProxyToken(app, serverID)
	if err != nil {
		return nil, "", err
	}
	proxyURL, err := withBasicAuth(apposBaseURL, serverID, token)
	if err != nil {
		return nil, "", err
	}
	return map[string]string{
		"ALL_PROXY":   proxyURL,
		"all_proxy":   proxyURL,
		"HTTP_PROXY":  proxyURL,
		"http_proxy":  proxyURL,
		"HTTPS_PROXY": proxyURL,
		"https_proxy": proxyURL,
	}, "", nil
}

func withBasicAuth(rawBaseURL, username, password string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawBaseURL))
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("appos base URL must include scheme and host")
	}
	parsed.User = url.UserPassword(strings.TrimSpace(username), strings.TrimSpace(password))
	return parsed.String(), nil
}

func serverRecordIsLocal(record *core.Record) bool {
	if record == nil {
		return false
	}
	raw := record.Get("is_local")
	switch value := raw.(type) {
	case bool:
		return value
	case string:
		normalized := strings.TrimSpace(strings.ToLower(value))
		return normalized == "true" || normalized == "1" || normalized == "yes" || normalized == "on"
	default:
		return false
	}
}
