package routes

import (
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	"github.com/websoft9/appos/backend/domain/terminal"
	"github.com/websoft9/appos/backend/infra/remoteshell"
)

func resolveTerminalConfig(app core.App, auth *core.Record, serverID string) (terminal.ConnectorConfig, error) {
	plan, err := resolveTerminalExecutionPlan(app, auth, serverID)
	if err != nil {
		return terminal.ConnectorConfig{}, err
	}
	return plan.Config, nil
}

func resolveTerminalConfigWithProxyForRequest(e *core.RequestEvent, serverID string) (terminal.ConnectorConfig, map[string]string, error) {
	plan, err := resolveTerminalExecutionPlanForRequest(e, serverID)
	if err != nil {
		return terminal.ConnectorConfig{}, nil, err
	}
	return plan.Config, plan.Env, nil
}

func resolveTerminalExecutionPlan(app core.App, auth *core.Record, serverID string) (remoteshell.ExecutionPlan, error) {
	return resolveTerminalExecutionPlanWithAppOSBaseURL(app, auth, serverID, "")
}

func resolveTerminalExecutionPlanForRequest(e *core.RequestEvent, serverID string) (remoteshell.ExecutionPlan, error) {
	if e == nil {
		return remoteshell.ExecutionPlan{}, nil
	}
	return resolveTerminalExecutionPlanWithAppOSBaseURL(e.App, e.Auth, serverID, resolveAppOSBaseURLFromHTTPRequest(e.Request))
}

func resolveTerminalExecutionPlanWithAppOSBaseURL(app core.App, auth *core.Record, serverID string, apposBaseURL string) (remoteshell.ExecutionPlan, error) {
	access, err := servers.ResolveConfig(app, auth, serverID)
	if err != nil {
		return remoteshell.ExecutionPlan{}, err
	}
	return remoteshell.ResolveExecutionPlan(app, access, serverID, apposBaseURL)
}

func resolveAppOSBaseURLFromHTTPRequest(r *http.Request) string {
	if r == nil {
		return ""
	}
	scheme := "http"
	if strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https") || r.TLS != nil {
		scheme = "https"
	}
	host := strings.TrimSpace(firstForwardedHostValue(r.Header.Get("X-Forwarded-Host")))
	if host == "" {
		host = strings.TrimSpace(firstForwardedHostValue(r.Host))
	}
	if host == "" {
		return ""
	}
	return scheme + "://" + host
}
