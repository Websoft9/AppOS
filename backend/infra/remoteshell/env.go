package remoteshell

import (
	"fmt"
	"net/url"
	"sort"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/proxy"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	"github.com/websoft9/appos/backend/domain/terminal"
	proxyinfra "github.com/websoft9/appos/backend/infra/proxy"
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
	network := proxy.LoadNetworkSettings(app)
	plan.Source = network.Source
	mode, err := proxy.ResolveRemoteShellMode(app, serverID)
	if err != nil {
		return ExecutionPlan{}, err
	}
	plan.PolicyMode = string(mode)
	if network.Source == "self" && mode == proxyinfra.ModeAlways {
		selfProxyEnv, envErr := BuildSelfProxyEnv(app, serverID, apposBaseURL)
		if envErr != nil {
			return ExecutionPlan{}, envErr
		}
		if len(selfProxyEnv) == 0 {
			plan.Warnings = append(plan.Warnings,
				"Self Proxy is selected for remote shell, but the AppOS public URL is unavailable. This session falls back to the direct SSH control path.")
		} else {
			plan.Env = selfProxyEnv
		}
	}
	if len(plan.Env) == 0 {
		env, err := proxy.ProxyEnvForRemoteShellServer(app, serverID)
		if err != nil {
			return ExecutionPlan{}, err
		}
		plan.Env = env
	}
	if len(plan.Env) > 0 {
		plan.Config.Shell = wrapInteractiveShell(plan.Config.Shell, plan.Env)
	}
	return plan, nil
}

func ResolveExecutionEnv(app core.App, serverID string) (map[string]string, error) {
	serverID = strings.TrimSpace(serverID)
	if app == nil || serverID == "" || serverID == "local" {
		return nil, nil
	}
	record, err := app.FindRecordById("servers", serverID)
	if err != nil {
		return nil, err
	}
	if serverRecordIsLocal(record) {
		return nil, nil
	}
	return proxy.ProxyEnvForRemoteShellServer(app, serverID)
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

func BuildSelfProxyEnv(app core.App, serverID string, apposBaseURL string) (map[string]string, error) {
	serverID = strings.TrimSpace(serverID)
	apposBaseURL = strings.TrimRight(strings.TrimSpace(apposBaseURL), "/")
	if app == nil || serverID == "" || apposBaseURL == "" {
		return nil, nil
	}
	token, err := GetOrIssueSelfProxyToken(app, serverID)
	if err != nil {
		return nil, err
	}
	proxyURL, err := withBasicAuth(apposBaseURL, serverID, token)
	if err != nil {
		return nil, err
	}
	return map[string]string{
		"ALL_PROXY":   proxyURL,
		"all_proxy":   proxyURL,
		"HTTP_PROXY":  proxyURL,
		"http_proxy":  proxyURL,
		"HTTPS_PROXY": proxyURL,
		"https_proxy": proxyURL,
	}, nil
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