package routes

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/terminal"
)

const (
	monitorAgentServiceName       = "netdata.service"
	monitorAgentRemoteBinary      = "/usr/sbin/netdata"
	monitorAgentRemoteConfig      = "/etc/netdata"
	monitorAgentRemoteExporting   = "/etc/netdata/exporting.conf"
	monitorAgentRemoteUnit        = "netdata.service"
	monitorAgentKickstartURL      = "https://get.netdata.cloud/kickstart.sh"
	monitorAgentStableChannelName = "stable"
	monitorAgentRemoteWritePath   = "/api/monitor/netdata/write"
)

var executeSSHCommand = terminal.ExecuteSSHCommand

type monitorAgentDeployResponse struct {
	ServerID    string            `json:"server_id"`
	Service     string            `json:"service"`
	Status      string            `json:"status"`
	BinaryPath  string            `json:"binary_path"`
	ConfigPath  string            `json:"config_path"`
	UnitPath    string            `json:"unit_path"`
	Output      string            `json:"output"`
	Systemd     map[string]string `json:"systemd,omitempty"`
	StatusText  string            `json:"status_text,omitempty"`
	PackagedVer string            `json:"packaged_version,omitempty"`
}

func handleMonitorAgentInstall(e *core.RequestEvent) error {
	return handleMonitorAgentDeploy(e, "installed")
}

func handleMonitorAgentUpdate(e *core.RequestEvent) error {
	return handleMonitorAgentDeploy(e, "updated")
}

func handleMonitorAgentDeploy(e *core.RequestEvent, resultStatus string) error {
	serverID := strings.TrimSpace(e.Request.PathValue("serverId"))
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}

	if _, err := findMonitorServer(e.App, serverID); err != nil {
		return e.NotFoundError("server not found", err)
	}

	remoteWriteURL := monitorBaseURL(e) + monitorAgentRemoteWritePath
	exportingConfig, err := buildNetdataExportingConfig(serverID, remoteWriteURL)
	if err != nil {
		return e.BadRequestError("failed to build netdata exporting config", err)
	}

	cfg, err := resolveTerminalConfig(e.App, e.Auth, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	installArgs := []string{"--non-interactive", "--native-only", "--release-channel", monitorAgentStableChannelName}
	if resultStatus == "updated" {
		installArgs = append(installArgs, "--reinstall")
	}
	quotedArgs := make([]string, 0, len(installArgs))
	for _, arg := range installArgs {
		quotedArgs = append(quotedArgs, terminal.ShellQuote(arg))
	}
	tmpScript := fmt.Sprintf("/tmp/netdata-kickstart-%d.sh", time.Now().UnixNano())
	tmpConfig := fmt.Sprintf("/tmp/netdata-exporting-%d.conf", time.Now().UnixNano())
	installCmd := strings.Join([]string{
		"set -eu",
		fmt.Sprintf("tmp_script=%s", terminal.ShellQuote(tmpScript)),
		fmt.Sprintf("tmp_config=%s", terminal.ShellQuote(tmpConfig)),
		"cleanup() { rm -f \"$tmp_script\" \"$tmp_config\"; }",
		"trap cleanup EXIT",
		fmt.Sprintf("if command -v curl >/dev/null 2>&1; then curl -fsSL %s -o \"$tmp_script\"; elif command -v wget >/dev/null 2>&1; then wget -qO \"$tmp_script\" %s; else echo 'curl or wget is required to install Netdata' >&2; exit 1; fi", terminal.ShellQuote(monitorAgentKickstartURL), terminal.ShellQuote(monitorAgentKickstartURL)),
		"chmod +x \"$tmp_script\"",
		fmt.Sprintf("printf %s > \"$tmp_config\"", terminal.ShellQuote(exportingConfig)),
		fmt.Sprintf("(sudo -n env DISABLE_TELEMETRY=1 sh \"$tmp_script\" %s || env DISABLE_TELEMETRY=1 sh \"$tmp_script\" %s)", strings.Join(quotedArgs, " "), strings.Join(quotedArgs, " ")),
		fmt.Sprintf("(sudo -n install -D -m 0644 \"$tmp_config\" %s || install -D -m 0644 \"$tmp_config\" %s)", terminal.ShellQuote(monitorAgentRemoteExporting), terminal.ShellQuote(monitorAgentRemoteExporting)),
		fmt.Sprintf("(sudo -n systemctl enable --now %s || systemctl enable --now %s)", terminal.ShellQuote(monitorAgentServiceName), terminal.ShellQuote(monitorAgentServiceName)),
		fmt.Sprintf("(sudo -n systemctl restart %s || systemctl restart %s)", terminal.ShellQuote(monitorAgentServiceName), terminal.ShellQuote(monitorAgentServiceName)),
	}, " && ")

	output, runErr := executeSSHCommand(e.Request.Context(), cfg, installCmd, 60*time.Second)
	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error(), "output": output})
	}

	statusDetails, statusText, _ := readRemoteSystemdStatus(e, cfg, monitorAgentServiceName)
	installedVersion, _ := executeSSHCommand(e.Request.Context(), cfg, "netdata -V 2>/dev/null | head -n 1 || true", 10*time.Second)
	installedVersion = strings.TrimSpace(installedVersion)

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "server.ops.monitor_agent.deploy",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail: map[string]any{
			"service":          monitorAgentServiceName,
			"result_status":    resultStatus,
			"binary_path":      monitorAgentRemoteBinary,
			"config_path":      monitorAgentRemoteConfig,
			"unit_path":        monitorAgentRemoteUnit,
			"remote_write_url": remoteWriteURL,
			"packaged_version": installedVersion,
		},
	})

	return e.JSON(http.StatusOK, monitorAgentDeployResponse{
		ServerID:    serverID,
		Service:     monitorAgentServiceName,
		Status:      resultStatus,
		BinaryPath:  monitorAgentRemoteBinary,
		ConfigPath:  monitorAgentRemoteConfig,
		UnitPath:    monitorAgentRemoteUnit,
		Output:      output,
		Systemd:     statusDetails,
		StatusText:  statusText,
		PackagedVer: installedVersion,
	})
}

func buildNetdataExportingConfig(serverID string, remoteWriteURL string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(remoteWriteURL))
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("remote write url must include scheme and host")
	}
	destinationHost := parsed.Hostname()
	if destinationHost == "" {
		return "", fmt.Errorf("remote write url must include destination host")
	}
	port := parsed.Port()
	if port == "" {
		switch strings.ToLower(parsed.Scheme) {
		case "https":
			port = "443"
		default:
			port = "80"
		}
	}
	section := "[prometheus_remote_write:appos]"
	if strings.EqualFold(parsed.Scheme, "https") {
		section = "[prometheus_remote_write:https:appos]"
	}
	config := strings.Join([]string{
		"# Managed by AppOS. Changes may be overwritten by Monitor tab install/update actions.",
		section,
		"    enabled = yes",
		fmt.Sprintf("    destination = %s:%s", destinationHost, port),
		fmt.Sprintf("    remote write URL path = %s", parsed.EscapedPath()),
		"    data source = average",
		"    prefix = netdata",
		fmt.Sprintf("    hostname = %s", strings.TrimSpace(serverID)),
		"    update every = 10",
		"    send charts matching = system.cpu system.ram system.io system.net net.net disk_space.*",
		"    send names instead of ids = yes",
		"    send configured labels = no",
		"    send automatic labels = no",
		"",
	}, "\n")
	return config, nil
}

func readRemoteSystemdStatus(e *core.RequestEvent, cfg terminal.ConnectorConfig, service string) (map[string]string, string, error) {
	showCmd := fmt.Sprintf("systemctl show %s --no-pager --property=Id,Description,LoadState,ActiveState,SubState,UnitFileState,MainPID,ExecMainStatus,ExecMainCode,StateChangeTimestamp", service)
	showRaw, err := executeSSHCommand(e.Request.Context(), cfg, showCmd, 20*time.Second)
	if err != nil {
		return nil, "", err
	}
	statusCmd := fmt.Sprintf("systemctl status %s --no-pager --full --lines=40", service)
	statusRaw, _ := executeSSHCommand(e.Request.Context(), cfg, statusCmd, 20*time.Second)
	details := make(map[string]string)
	for _, line := range strings.Split(showRaw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		details[parts[0]] = parts[1]
	}
	return details, statusRaw, nil
}
