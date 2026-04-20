// Package executor provides SSH-based execution of Software Delivery template actions
// against managed remote servers.
//
// The SSHExecutor is the sole concrete implementation of software.ComponentExecutor
// for server-target components. All placeholder substitution has already been applied
// to the ResolvedTemplate by the catalog loader; this package only interprets strategy
// strings and runs the resulting shell commands over SSH.
package executor

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	"github.com/websoft9/appos/backend/domain/software"
	"github.com/websoft9/appos/backend/domain/terminal"
)

const (
	detectTimeout   = 15 * time.Second
	preflightTimeout = 30 * time.Second
	installTimeout  = 180 * time.Second
	upgradeTimeout  = 180 * time.Second
	verifyTimeout   = 20 * time.Second
)

// executeSSHCommand is the SSH transport function. Overridable in tests.
var executeSSHCommand = terminal.ExecuteSSHCommand

// SSHExecutor implements software.ComponentExecutor against a remote server via SSH.
// It is created once per operation and is not safe for concurrent use.
type SSHExecutor struct {
	cfg terminal.ConnectorConfig
}

// NewSSHExecutor resolves the SSH configuration for serverID and returns a ready executor.
// userID may be empty; in that case the system account credential flow is used.
func NewSSHExecutor(app core.App, serverID, userID string) (*SSHExecutor, error) {
	access, err := servers.ResolveConfigForUserID(app, serverID, userID)
	if err != nil {
		return nil, fmt.Errorf("resolve server config for %s: %w", serverID, err)
	}
	return &SSHExecutor{
		cfg: terminal.ConnectorConfig{
			Host:     access.Host,
			Port:     access.Port,
			User:     access.User,
			AuthType: terminal.CredAuthType(access.AuthType),
			Secret:   access.Secret,
			Shell:    access.Shell,
		},
	}, nil
}

// Detect checks whether the component binary is present and returns the detected version.
// installed_hint commands are tried in order; the first successful output determines
// installed state. version_command is run only when the component is detected as installed.
func (e *SSHExecutor) Detect(ctx context.Context, _ string, tpl software.ResolvedTemplate) (software.InstalledState, string, error) {
	installed := false
	for _, hint := range tpl.Detect.InstalledHint {
		out, err := executeSSHCommand(ctx, e.cfg, hint, detectTimeout)
		if err == nil && strings.TrimSpace(out) != "" {
			installed = true
			break
		}
	}
	if !installed {
		return software.InstalledStateNotInstalled, "", nil
	}
	if tpl.Detect.VersionCommand == "" {
		return software.InstalledStateInstalled, "", nil
	}
	versionOut, _ := executeSSHCommand(ctx, e.cfg, tpl.Detect.VersionCommand, detectTimeout)
	version := strings.TrimSpace(firstLine(versionOut))
	return software.InstalledStateInstalled, version, nil
}

// RunPreflight evaluates OS support, root privilege, and network availability
// against the template's PreflightSpec.
func (e *SSHExecutor) RunPreflight(ctx context.Context, _ string, tpl software.ResolvedTemplate) (software.TargetReadinessResult, error) {
	result := software.TargetReadinessResult{
		OSSupported:     true,
		PrivilegeOK:     true,
		NetworkOK:       true,
		DependencyReady: true,
	}

	// OS check
	if len(tpl.Preflight.SupportedOS) > 0 {
		osOut, err := executeSSHCommand(ctx, e.cfg,
			`awk -F= '/^ID=/{gsub(/"/, "", $2); print $2}' /etc/os-release 2>/dev/null || true`,
			preflightTimeout)
		if err != nil {
			result.OSSupported = false
			result.Issues = append(result.Issues, "os_not_supported: could not determine OS")
		} else {
			osID := strings.TrimSpace(strings.ToLower(osOut))
			supported := false
			for _, supportedOS := range tpl.Preflight.SupportedOS {
				if strings.EqualFold(supportedOS, osID) {
					supported = true
					break
				}
			}
			if !supported {
				result.OSSupported = false
				result.Issues = append(result.Issues, fmt.Sprintf("os_not_supported: detected %q, supported: %v", osID, tpl.Preflight.SupportedOS))
			}
		}
	}

	// Root / privilege check
	if tpl.Preflight.RequireRoot {
		uidOut, err := executeSSHCommand(ctx, e.cfg, "id -u", preflightTimeout)
		if err != nil || strings.TrimSpace(uidOut) != "0" {
			// Accept passwordless sudo as an equivalent to root
			_, sudoErr := executeSSHCommand(ctx, e.cfg, "sudo -n true 2>/dev/null", preflightTimeout)
			if sudoErr != nil {
				result.PrivilegeOK = false
				result.Issues = append(result.Issues, "privilege_required: neither root nor passwordless sudo available")
			}
		}
	}

	// Network check
	if tpl.Preflight.RequireNetwork {
		_, err := executeSSHCommand(ctx, e.cfg,
			"curl -fs --max-time 5 https://get.docker.com -o /dev/null 2>/dev/null || "+
				"wget -q --timeout=5 https://get.docker.com -O /dev/null 2>/dev/null",
			preflightTimeout)
		if err != nil {
			result.NetworkOK = false
			result.Issues = append(result.Issues, "network_required: no outbound internet connectivity")
		}
	}

	result.OK = result.OSSupported && result.PrivilegeOK && result.NetworkOK && result.DependencyReady
	return result, nil
}

// Install executes the install step defined by the template strategy, then verifies.
// Supported strategies: "package" (apt-get), "script" (curl|sh).
// An empty strategy means the component is not installable via Software Delivery.
func (e *SSHExecutor) Install(ctx context.Context, serverID string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	switch tpl.Install.Strategy {
	case "package":
		cmd := fmt.Sprintf("DEBIAN_FRONTEND=noninteractive apt-get install -y %s",
			terminal.ShellQuote(tpl.Install.PackageName))
		if _, err := executeSSHCommand(ctx, e.cfg, withSudo(cmd), installTimeout); err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("install %s via apt-get: %w", tpl.Install.PackageName, err)
		}
	case "script":
		if strings.TrimSpace(tpl.Install.ScriptURL) == "" {
			return software.SoftwareComponentDetail{}, fmt.Errorf("component %s: script_url is empty (check system settings)", tpl.ComponentKey)
		}
		cmd := buildScriptCommand(tpl.Install.ScriptURL, tpl.Install.Args)
		if _, err := executeSSHCommand(ctx, e.cfg, cmd, installTimeout); err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("install %s via script: %w", tpl.ComponentKey, err)
		}
	case "":
		return software.SoftwareComponentDetail{}, fmt.Errorf("component %s does not support install", tpl.ComponentKey)
	default:
		return software.SoftwareComponentDetail{}, fmt.Errorf("unknown install strategy %q for %s", tpl.Install.Strategy, tpl.ComponentKey)
	}
	return e.Verify(ctx, serverID, tpl)
}

// Upgrade executes the upgrade step defined by the template strategy, then verifies.
// Supported strategies: "package" (apt-get --only-upgrade), "script" (curl|sh with args).
func (e *SSHExecutor) Upgrade(ctx context.Context, serverID string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	switch tpl.Upgrade.Strategy {
	case "package":
		cmd := fmt.Sprintf("DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade %s",
			terminal.ShellQuote(tpl.Upgrade.PackageName))
		if _, err := executeSSHCommand(ctx, e.cfg, withSudo(cmd), upgradeTimeout); err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("upgrade %s via apt-get: %w", tpl.Upgrade.PackageName, err)
		}
	case "script":
		if strings.TrimSpace(tpl.Upgrade.ScriptURL) == "" {
			return software.SoftwareComponentDetail{}, fmt.Errorf("component %s: script_url is empty for upgrade (check system settings)", tpl.ComponentKey)
		}
		cmd := buildScriptCommand(tpl.Upgrade.ScriptURL, tpl.Upgrade.Args)
		if _, err := executeSSHCommand(ctx, e.cfg, cmd, upgradeTimeout); err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("upgrade %s via script: %w", tpl.ComponentKey, err)
		}
	case "":
		return software.SoftwareComponentDetail{}, fmt.Errorf("component %s does not support upgrade", tpl.ComponentKey)
	default:
		return software.SoftwareComponentDetail{}, fmt.Errorf("unknown upgrade strategy %q for %s", tpl.Upgrade.Strategy, tpl.ComponentKey)
	}
	return e.Verify(ctx, serverID, tpl)
}

// Verify checks the component's current state using the template's verify strategy.
// Only "systemd" strategy is supported for server-target components.
func (e *SSHExecutor) Verify(ctx context.Context, _ string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	switch tpl.Verify.Strategy {
	case "systemd":
		return e.verifySystemd(ctx, tpl)
	default:
		return software.SoftwareComponentDetail{}, fmt.Errorf("unsupported verify strategy %q for component %s", tpl.Verify.Strategy, tpl.ComponentKey)
	}
}

// Repair re-executes the install step (strategy "reinstall") then verifies.
func (e *SSHExecutor) Repair(ctx context.Context, serverID string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	switch tpl.Repair.Strategy {
	case "reinstall":
		return e.Install(ctx, serverID, tpl)
	default:
		return software.SoftwareComponentDetail{}, fmt.Errorf("unsupported repair strategy %q for component %s", tpl.Repair.Strategy, tpl.ComponentKey)
	}
}

// verifySystemd checks a systemd service unit and returns the component detail.
// It detects installed state and version as part of the same pass.
func (e *SSHExecutor) verifySystemd(ctx context.Context, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	svc := tpl.Verify.ServiceName
	out, _ := executeSSHCommand(ctx, e.cfg,
		fmt.Sprintf("systemctl is-active %s 2>/dev/null; true", terminal.ShellQuote(svc)),
		verifyTimeout)

	vState := software.VerificationStateHealthy
	if strings.TrimSpace(out) != "active" {
		vState = software.VerificationStateDegraded
	}

	iState, version, _ := e.Detect(ctx, "", tpl)

	detail := software.SoftwareComponentDetail{}
	detail.ComponentKey = tpl.ComponentKey
	detail.TemplateKind = tpl.TemplateKind
	detail.InstalledState = iState
	detail.DetectedVersion = version
	detail.VerificationState = vState
	detail.ServiceName = svc
	return detail, nil
}

// buildScriptCommand builds a safe shell snippet that downloads a script via curl or
// wget and runs it with optional arguments. The script URL and arguments come
// exclusively from catalog metadata and are shell-quoted before use.
func buildScriptCommand(scriptURL string, args []string) string {
	quotedArgs := make([]string, len(args))
	for i, a := range args {
		quotedArgs[i] = terminal.ShellQuote(a)
	}
	argsStr := ""
	if len(quotedArgs) > 0 {
		argsStr = " " + strings.Join(quotedArgs, " ")
	}
	return fmt.Sprintf(
		"set -eu; _tmp=$(mktemp); trap 'rm -f \"$_tmp\"' EXIT; "+
			"(curl -fsSL %s -o \"$_tmp\" 2>/dev/null || wget -qO \"$_tmp\" %s); "+
			"chmod +x \"$_tmp\"; sh \"$_tmp\"%s",
		terminal.ShellQuote(scriptURL),
		terminal.ShellQuote(scriptURL),
		argsStr,
	)
}

// withSudo wraps a shell command to attempt execution via passwordless sudo first,
// falling back to direct execution if sudo is not available.
// This matches the pattern used in server_monitor_agent.go.
func withSudo(cmd string) string {
	return fmt.Sprintf("(sudo -n sh -c %s 2>/dev/null || sh -c %s)", terminal.ShellQuote(cmd), terminal.ShellQuote(cmd))
}

// firstLine returns the first non-empty line from a multi-line string.
func firstLine(s string) string {
	for _, line := range strings.Split(s, "\n") {
		if strings.TrimSpace(line) != "" {
			return line
		}
	}
	return s
}
