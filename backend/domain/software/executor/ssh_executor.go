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
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	"github.com/websoft9/appos/backend/domain/software"
	softwarescripts "github.com/websoft9/appos/backend/domain/software/scripts"
	"github.com/websoft9/appos/backend/domain/terminal"
	cryptossh "golang.org/x/crypto/ssh"
)

const (
	detectTimeout    = 15 * time.Second
	preflightTimeout = 30 * time.Second
	installTimeout   = 180 * time.Second
	upgradeTimeout   = 180 * time.Second
	uninstallTimeout = 180 * time.Second
	verifyTimeout    = 20 * time.Second
)

const dockerCEPackageRepoProfile = "docker-ce"

func networkProbeCommand() string {
	return strings.Join([]string{
		"curl -fs --max-time 5 https://get.docker.com -o /dev/null 2>/dev/null",
		"curl -fs --max-time 5 https://www.google.com/generate_204 -o /dev/null 2>/dev/null",
		"wget -q --timeout=5 https://get.docker.com -O /dev/null 2>/dev/null",
		"wget -q --timeout=5 https://www.google.com/generate_204 -O /dev/null 2>/dev/null",
		"(command -v nc >/dev/null 2>&1 && nc -z -w5 1.1.1.1 443 >/dev/null 2>&1)",
	}, " || ")
}

// executeSSHCommand is the SSH transport function. Overridable in tests.
// Used as a fallback when SSHExecutor has no established client (e.g., in unit tests).
var executeSSHCommand = terminal.ExecuteSSHCommand

// SSHExecutor implements software.ComponentExecutor against a remote server via SSH.
// It holds a single persistent SSH client connection that is reused for all commands,
// avoiding per-command TCP+SSH handshake overhead.
// It is created once per operation scope and is not safe for concurrent use.
type SSHExecutor struct {
	cfg          terminal.ConnectorConfig
	client       *cryptossh.Client                   // nil in unit-test mode (uses executeSSHCommand fallback)
	detectCache  map[string]software.DetectionResult // keyed by ComponentKey; avoids re-running Detect inside verifySystemd
	outputLogger func(string)
}

// SetOutputLogger attaches a best-effort line logger for long-running command output.
func (e *SSHExecutor) SetOutputLogger(logger func(string)) {
	if e == nil {
		return
	}
	e.outputLogger = logger
}

// Close releases the underlying SSH client connection if one was established.
// Safe to call on a nil receiver.
func (e *SSHExecutor) Close() {
	if e == nil || e.client == nil {
		return
	}
	_ = e.client.Close()
	e.client = nil
}

// runCommand executes a shell command over SSH. When e.client is set (normal production
// operation after NewSSHExecutor), it opens a new lightweight session on the already-
// established connection. When e.client is nil (unit-test mode), it falls back to the
// package-level executeSSHCommand variable which tests may override.
func (e *SSHExecutor) runCommand(ctx context.Context, command string, timeout time.Duration) (string, error) {
	if e.client != nil {
		return terminal.RunSSHSession(ctx, e.client, command, timeout)
	}
	return executeSSHCommand(ctx, e.cfg, command, timeout)
}

func (e *SSHExecutor) runCommandStreaming(ctx context.Context, command string, timeout time.Duration) (string, error) {
	if e.client != nil && e.outputLogger != nil {
		return terminal.RunSSHSessionStreaming(ctx, e.client, command, timeout, func(line string) {
			line = strings.TrimSpace(line)
			if line != "" {
				e.outputLogger("Script output: " + line)
			}
		})
	}
	return e.runCommand(ctx, command, timeout)
}

// NewSSHExecutor resolves the SSH configuration for serverID and establishes the
// underlying SSH connection. All subsequent commands reuse this single connection.
// userID may be empty; in that case the system account credential flow is used.
func NewSSHExecutor(app core.App, serverID, userID string) (*SSHExecutor, error) {
	access, err := servers.ResolveConfigForUserID(app, serverID, userID)
	if err != nil {
		return nil, fmt.Errorf("resolve server config for %s: %w", serverID, err)
	}
	cfg := terminal.ConnectorConfig{
		Host:     access.Host,
		Port:     access.Port,
		User:     access.User,
		AuthType: terminal.CredAuthType(access.AuthType),
		Secret:   access.Secret,
		Shell:    access.Shell,
	}
	client, err := terminal.DialSSH(context.Background(), cfg)
	if err != nil {
		return nil, fmt.Errorf("ssh connect to %s: %w", serverID, err)
	}
	return &SSHExecutor{cfg: cfg, client: client, detectCache: make(map[string]software.DetectionResult)}, nil
}

// Detect checks whether the component binary is present and returns the detected version.
// installed_hint commands are tried in order; the first successful output determines
// installed state. version_command is run only when the component is detected as installed.
func (e *SSHExecutor) Detect(ctx context.Context, _ string, tpl software.ResolvedTemplate) (software.DetectionResult, error) {
	key := string(tpl.ComponentKey)
	if e.detectCache != nil {
		if cached, ok := e.detectCache[key]; ok {
			return cached, nil
		}
	}

	installed := false
	for _, hint := range tpl.Detect.InstalledHint {
		out, err := e.runCommand(ctx, hint, detectTimeout)
		if err == nil && strings.TrimSpace(out) != "" {
			installed = true
			break
		}
	}
	if !installed {
		result := software.DetectionResult{InstalledState: software.InstalledStateNotInstalled, InstallSource: software.InstallSourceUnknown}
		if e.detectCache != nil {
			e.detectCache[key] = result
		}
		return result, nil
	}
	result := software.DetectionResult{
		InstalledState: software.InstalledStateInstalled,
		InstallSource:  software.InstallSourceUnknown,
	}
	if tpl.Detect.VersionCommand == "" {
		if tpl.ComponentKey == software.ComponentKeyDocker {
			result.InstallSource, result.SourceEvidence = e.detectDockerInstallSource(ctx, tpl)
		}
		if e.detectCache != nil {
			e.detectCache[key] = result
		}
		return result, nil
	}
	versionOut, _ := e.runCommand(ctx, tpl.Detect.VersionCommand, detectTimeout)
	result.DetectedVersion = strings.TrimSpace(firstLine(versionOut))
	if tpl.ComponentKey == software.ComponentKeyDocker {
		result.InstallSource, result.SourceEvidence = e.detectDockerInstallSource(ctx, tpl)
	}
	if e.detectCache != nil {
		e.detectCache[key] = result
	}
	return result, nil
}

// RunPreflight evaluates OS support, root privilege, and network availability
// against the template's PreflightSpec.
func (e *SSHExecutor) RunPreflight(ctx context.Context, _ string, tpl software.ResolvedTemplate) (software.TargetReadinessResult, error) {
	result := software.TargetReadinessResult{
		OSSupported:      true,
		PrivilegeOK:      true,
		NetworkOK:        true,
		DependencyReady:  true,
		ServiceManagerOK: true,
		PackageManagerOK: true,
	}

	// OS verified-baseline check
	if len(tpl.Preflight.VerifiedOS) > 0 {
		osOut, err := e.runCommand(ctx,
			`awk -F= '/^ID=/{gsub(/"/, "", $2); print $2}' /etc/os-release 2>/dev/null || true`,
			preflightTimeout)
		if err != nil {
			result.OSSupported = false
			result.Issues = append(result.Issues, "os_not_supported: could not determine OS for verified baseline check")
		} else {
			osID := strings.TrimSpace(strings.ToLower(osOut))
			supported := false
			for _, supportedOS := range tpl.Preflight.VerifiedOS {
				if strings.EqualFold(supportedOS, osID) {
					supported = true
					break
				}
			}
			if !supported {
				result.OSSupported = false
				result.Issues = append(result.Issues, fmt.Sprintf("os_not_supported: detected %q is outside verified baseline %v", osID, tpl.Preflight.VerifiedOS))
			}
		}
	}

	// Root / privilege check
	if tpl.Preflight.RequireRoot {
		uidOut, err := e.runCommand(ctx, "id -u", preflightTimeout)
		if err != nil || strings.TrimSpace(uidOut) != "0" {
			// Accept passwordless sudo as an equivalent to root
			_, sudoErr := e.runCommand(ctx, "sudo -n true 2>/dev/null", preflightTimeout)
			if sudoErr != nil {
				result.PrivilegeOK = false
				result.Issues = append(result.Issues, "privilege_required: neither root nor passwordless sudo available")
			}
		}
	}

	// Network check
	if tpl.Preflight.RequireNetwork {
		_, err := e.runCommand(ctx, networkProbeCommand(), preflightTimeout)
		if err != nil {
			result.NetworkOK = false
			result.Issues = append(result.Issues, "network_required: no outbound internet connectivity")
		}
	}

	// Service manager check
	if strings.TrimSpace(tpl.Preflight.ServiceManager) != "" {
		switch tpl.Preflight.ServiceManager {
		case "systemd":
			if _, err := e.runCommand(ctx, "command -v systemctl >/dev/null 2>&1", preflightTimeout); err != nil {
				result.ServiceManagerOK = false
				result.Issues = append(result.Issues, fmt.Sprintf("%s: required service manager %q is not available", software.ReadinessIssueServiceManagerMissing, tpl.Preflight.ServiceManager))
			}
		default:
			result.ServiceManagerOK = false
			result.Issues = append(result.Issues, fmt.Sprintf("%s: unsupported service manager requirement %q", software.ReadinessIssueServiceManagerMissing, tpl.Preflight.ServiceManager))
		}
	}

	// Package manager check
	if strings.TrimSpace(tpl.Preflight.PackageManager) != "" {
		switch tpl.Preflight.PackageManager {
		case "native":
			if _, _, err := e.detectPackageManager(ctx); err != nil {
				result.PackageManagerOK = false
				result.Issues = append(result.Issues, fmt.Sprintf("%s: no supported package manager (apt-get, dnf, yum) is available", software.ReadinessIssuePackageManagerMissing))
			}
		case "apt":
			if _, err := e.runCommand(ctx, "command -v apt-get >/dev/null 2>&1", preflightTimeout); err != nil {
				result.PackageManagerOK = false
				result.Issues = append(result.Issues, fmt.Sprintf("%s: required package manager %q is not available", software.ReadinessIssuePackageManagerMissing, tpl.Preflight.PackageManager))
			}
		default:
			result.PackageManagerOK = false
			result.Issues = append(result.Issues, fmt.Sprintf("%s: unsupported package manager requirement %q", software.ReadinessIssuePackageManagerMissing, tpl.Preflight.PackageManager))
		}
	}

	result.OK = result.PrivilegeOK && result.DependencyReady && result.ServiceManagerOK && result.PackageManagerOK
	return result, nil
}

// Install executes the install step defined by the template strategy.
// Supported strategies: "package" (apt-get), "script" (managed script).
// An empty strategy means the component is not installable via Software Delivery.
func (e *SSHExecutor) Install(ctx context.Context, serverID string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	switch tpl.Install.Strategy {
	case "package":
		cmd, err := e.buildPackageActionCommand(ctx, "install", tpl.Install.PackageName, tpl.Install.PackageNames, tpl.Install.PackageRepoProfile)
		if err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("install %s via package manager: %w", tpl.ComponentKey, err)
		}
		if _, err := e.runCommand(ctx, withSudo(cmd), installTimeout); err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("install %s via package manager: %w", tpl.ComponentKey, err)
		}
	case "script":
		cmd, err := buildManagedScriptCommand(tpl.Install.ScriptPath, tpl.Install.ScriptURL, tpl.Install.Args, tpl.Install.Env)
		if err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("component %s install script resolution failed: %w", tpl.ComponentKey, err)
		}
		if _, err := e.runCommandStreaming(ctx, cmd, installTimeout); err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("install %s via script: %w", tpl.ComponentKey, err)
		}
	case "":
		return software.SoftwareComponentDetail{}, fmt.Errorf("component %s does not support install", tpl.ComponentKey)
	default:
		return software.SoftwareComponentDetail{}, fmt.Errorf("unknown install strategy %q for %s", tpl.Install.Strategy, tpl.ComponentKey)
	}
	return software.SoftwareComponentDetail{
		SoftwareComponentSummary: software.SoftwareComponentSummary{
			ComponentKey: tpl.ComponentKey,
			TemplateKind: tpl.TemplateKind,
		},
		ServiceName: tpl.Verify.ServiceName,
	}, nil
}

// Upgrade executes the upgrade step defined by the template strategy.
// Supported strategies: "package" (apt-get --only-upgrade), "script" (managed script with args).
func (e *SSHExecutor) Upgrade(ctx context.Context, serverID string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	switch tpl.Upgrade.Strategy {
	case "package":
		cmd, err := e.buildPackageActionCommand(ctx, "upgrade", tpl.Upgrade.PackageName, tpl.Upgrade.PackageNames, tpl.Upgrade.PackageRepoProfile)
		if err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("upgrade %s via package manager: %w", tpl.ComponentKey, err)
		}
		if _, err := e.runCommand(ctx, withSudo(cmd), upgradeTimeout); err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("upgrade %s via package manager: %w", tpl.ComponentKey, err)
		}
	case "script":
		cmd, err := buildManagedScriptCommand(tpl.Upgrade.ScriptPath, tpl.Upgrade.ScriptURL, tpl.Upgrade.Args, tpl.Upgrade.Env)
		if err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("component %s upgrade script resolution failed: %w", tpl.ComponentKey, err)
		}
		if _, err := e.runCommandStreaming(ctx, cmd, upgradeTimeout); err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("upgrade %s via script: %w", tpl.ComponentKey, err)
		}
	case "":
		return software.SoftwareComponentDetail{}, fmt.Errorf("component %s does not support upgrade", tpl.ComponentKey)
	default:
		return software.SoftwareComponentDetail{}, fmt.Errorf("unknown upgrade strategy %q for %s", tpl.Upgrade.Strategy, tpl.ComponentKey)
	}
	return software.SoftwareComponentDetail{
		SoftwareComponentSummary: software.SoftwareComponentSummary{
			ComponentKey: tpl.ComponentKey,
			TemplateKind: tpl.TemplateKind,
		},
		ServiceName: tpl.Verify.ServiceName,
	}, nil
}

func (e *SSHExecutor) Start(ctx context.Context, _ string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	if tpl.Verify.Strategy != "systemd" || strings.TrimSpace(tpl.Verify.ServiceName) == "" {
		return software.SoftwareComponentDetail{}, fmt.Errorf("component %s does not support start", tpl.ComponentKey)
	}
	cmd := fmt.Sprintf("systemctl start %s", terminal.ShellQuote(tpl.Verify.ServiceName))
	if _, err := e.runCommand(ctx, withSudo(cmd), verifyTimeout); err != nil {
		return software.SoftwareComponentDetail{}, fmt.Errorf("start %s via systemd: %w", tpl.ComponentKey, err)
	}
	return software.SoftwareComponentDetail{SoftwareComponentSummary: software.SoftwareComponentSummary{ComponentKey: tpl.ComponentKey, TemplateKind: tpl.TemplateKind}, ServiceName: tpl.Verify.ServiceName}, nil
}

func (e *SSHExecutor) Stop(ctx context.Context, _ string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	if tpl.Verify.Strategy != "systemd" || strings.TrimSpace(tpl.Verify.ServiceName) == "" {
		return software.SoftwareComponentDetail{}, fmt.Errorf("component %s does not support stop", tpl.ComponentKey)
	}
	cmd := fmt.Sprintf("systemctl stop %s", terminal.ShellQuote(tpl.Verify.ServiceName))
	if _, err := e.runCommand(ctx, withSudo(cmd), verifyTimeout); err != nil {
		return software.SoftwareComponentDetail{}, fmt.Errorf("stop %s via systemd: %w", tpl.ComponentKey, err)
	}
	return software.SoftwareComponentDetail{SoftwareComponentSummary: software.SoftwareComponentSummary{ComponentKey: tpl.ComponentKey, TemplateKind: tpl.TemplateKind}, ServiceName: tpl.Verify.ServiceName}, nil
}

func (e *SSHExecutor) Restart(ctx context.Context, _ string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	if tpl.Verify.Strategy != "systemd" || strings.TrimSpace(tpl.Verify.ServiceName) == "" {
		return software.SoftwareComponentDetail{}, fmt.Errorf("component %s does not support restart", tpl.ComponentKey)
	}
	cmd := fmt.Sprintf("systemctl restart %s", terminal.ShellQuote(tpl.Verify.ServiceName))
	if _, err := e.runCommand(ctx, withSudo(cmd), verifyTimeout); err != nil {
		return software.SoftwareComponentDetail{}, fmt.Errorf("restart %s via systemd: %w", tpl.ComponentKey, err)
	}
	return software.SoftwareComponentDetail{SoftwareComponentSummary: software.SoftwareComponentSummary{ComponentKey: tpl.ComponentKey, TemplateKind: tpl.TemplateKind}, ServiceName: tpl.Verify.ServiceName}, nil
}

// Uninstall executes the uninstall step defined by the template strategy.
// Supported strategies: "package" (apt-get remove), "script" (managed script with args).
func (e *SSHExecutor) Uninstall(ctx context.Context, serverID string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	if tpl.Verify.Strategy == "systemd" && strings.TrimSpace(tpl.Verify.ServiceName) != "" {
		stopCmd := fmt.Sprintf("systemctl stop %s", terminal.ShellQuote(tpl.Verify.ServiceName))
		if _, err := e.runCommand(ctx, withSudo(stopCmd), uninstallTimeout); err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("stop %s before uninstall: %w", tpl.ComponentKey, err)
		}
	}

	switch tpl.Uninstall.Strategy {
	case "package":
		cmd, err := e.buildPackageActionCommand(ctx, "uninstall", tpl.Uninstall.PackageName, tpl.Uninstall.PackageNames, tpl.Uninstall.PackageRepoProfile)
		if err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("uninstall %s via package manager: %w", tpl.ComponentKey, err)
		}
		if _, err := e.runCommand(ctx, withSudo(cmd), uninstallTimeout); err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("uninstall %s via package manager: %w", tpl.ComponentKey, err)
		}
	case "script":
		cmd, err := buildManagedScriptCommand(tpl.Uninstall.ScriptPath, tpl.Uninstall.ScriptURL, tpl.Uninstall.Args, tpl.Uninstall.Env)
		if err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("component %s uninstall script resolution failed: %w", tpl.ComponentKey, err)
		}
		if _, err := e.runCommandStreaming(ctx, cmd, uninstallTimeout); err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("uninstall %s via script: %w", tpl.ComponentKey, err)
		}
	case "":
		return software.SoftwareComponentDetail{}, fmt.Errorf("component %s does not support uninstall", tpl.ComponentKey)
	default:
		return software.SoftwareComponentDetail{}, fmt.Errorf("unknown uninstall strategy %q for %s", tpl.Uninstall.Strategy, tpl.ComponentKey)
	}
	return software.SoftwareComponentDetail{
		SoftwareComponentSummary: software.SoftwareComponentSummary{
			ComponentKey: tpl.ComponentKey,
			TemplateKind: tpl.TemplateKind,
		},
		ServiceName: tpl.Verify.ServiceName,
	}, nil
}

// Verify checks the component's current state using the template's verify strategy.
// Only "systemd" strategy is supported for server-target components.
func (e *SSHExecutor) Verify(ctx context.Context, serverID string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	switch tpl.Verify.Strategy {
	case "systemd":
		return e.verifySystemd(ctx, serverID, tpl)
	default:
		return software.SoftwareComponentDetail{}, fmt.Errorf("unsupported verify strategy %q for component %s", tpl.Verify.Strategy, tpl.ComponentKey)
	}
}

// Reinstall re-executes the primary reinstall step.
func (e *SSHExecutor) Reinstall(ctx context.Context, serverID string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	switch tpl.Reinstall.Strategy {
	case "reinstall":
		return e.Install(ctx, serverID, tpl)
	default:
		return software.SoftwareComponentDetail{}, fmt.Errorf("unsupported reinstall strategy %q for component %s", tpl.Reinstall.Strategy, tpl.ComponentKey)
	}
}

// verifySystemd checks a systemd service unit and returns the component detail.
// It detects installed state and version as part of the same pass.
func (e *SSHExecutor) verifySystemd(ctx context.Context, serverID string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	svc := tpl.Verify.ServiceName
	out, _ := e.runCommand(ctx,
		fmt.Sprintf("systemctl is-active %s 2>/dev/null; true", terminal.ShellQuote(svc)),
		verifyTimeout)

	vState := software.VerificationStateHealthy
	if strings.TrimSpace(out) != "active" {
		vState = software.VerificationStateDegraded
	}

	detection, _ := e.Detect(ctx, "", tpl)

	detail := software.SoftwareComponentDetail{}
	detail.ComponentKey = tpl.ComponentKey
	detail.TemplateKind = tpl.TemplateKind
	detail.InstalledState = detection.InstalledState
	detail.DetectedVersion = detection.DetectedVersion
	detail.InstallSource = detection.InstallSource
	detail.SourceEvidence = detection.SourceEvidence
	detail.VerificationState = vState
	detail.ServiceName = svc
	if tpl.ComponentKey == software.ComponentKeyMonitorAgent {
		applyMonitorAgentReportingVerification(ctx, e, &detail, serverID, strings.TrimSpace(out) == "active")
	}
	if tpl.ComponentKey == software.ComponentKeyDocker {
		composeVersionOut, _ := e.runCommand(ctx, "docker compose version --short 2>/dev/null || true", verifyTimeout)
		composeVersion := strings.TrimSpace(firstLine(composeVersionOut))
		composeAvailable := composeVersion != ""
		if detection.InstalledState == software.InstalledStateInstalled && !composeAvailable {
			detail.VerificationState = software.VerificationStateDegraded
		}
		reason := ""
		if detection.InstalledState == software.InstalledStateInstalled && !composeAvailable {
			reason = "docker compose plugin not available"
		}
		detail.Verification = &software.SoftwareVerificationResult{
			State:  detail.VerificationState,
			Reason: reason,
			Details: map[string]any{
				"engine_version":    detection.DetectedVersion,
				"compose_available": composeAvailable,
				"compose_version":   composeVersion,
			},
		}
	}
	return detail, nil
}

func applyMonitorAgentReportingVerification(ctx context.Context, e *SSHExecutor, detail *software.SoftwareComponentDetail, serverID string, runtimeActive bool) {
	out, _ := e.runCommand(ctx, monitorAgentReportingConfigCommand(serverID), verifyTimeout)
	checks := parseBoolKeyValueOutput(out)

	configPresent := checks["config_present"]
	enabled := checks["enabled"]
	destinationConfigured := checks["destination_configured"]
	usernameOK := checks["username_ok"]
	passwordConfigured := checks["password_configured"]
	reportingConfigured := configPresent && enabled && destinationConfigured && usernameOK && passwordConfigured

	reason := ""
	if runtimeActive && !reportingConfigured {
		detail.VerificationState = software.VerificationStateDegraded
		reason = "monitor remote-write configuration is incomplete"
	}

	detail.Verification = &software.SoftwareVerificationResult{
		State:  detail.VerificationState,
		Reason: reason,
		Details: map[string]any{
			"runtime_active":                   runtimeActive,
			"remote_write_config_present":      configPresent,
			"remote_write_enabled":             enabled,
			"remote_write_destination_present": destinationConfigured,
			"remote_write_username_matches":    usernameOK,
			"remote_write_password_present":    passwordConfigured,
		},
	}
}

func monitorAgentReportingConfigCommand(serverID string) string {
	quotedServerID := terminal.ShellQuote(serverID)
	return strings.Join([]string{
		fmt.Sprintf("expected_server_id=%s", quotedServerID),
		"conf=",
		"for p in /etc/netdata/exporting.conf /opt/netdata/etc/netdata/exporting.conf; do",
		"  if sudo test -f \"$p\" 2>/dev/null || test -f \"$p\" 2>/dev/null; then conf=\"$p\"; break; fi",
		"done",
		"if [ -z \"$conf\" ]; then echo config_present=false; exit 0; fi",
		"content=$(sudo cat \"$conf\" 2>/dev/null || cat \"$conf\" 2>/dev/null || true)",
		"echo config_present=true",
		"printf '%s\n' \"$content\" | grep -Eiq '^[[:space:]]*enabled[[:space:]]*=[[:space:]]*yes[[:space:]]*$' && echo enabled=true || echo enabled=false",
		"printf '%s\n' \"$content\" | grep -Eiq '^[[:space:]]*destination[[:space:]]*=[[:space:]]*[^[:space:]]+' && echo destination_configured=true || echo destination_configured=false",
		"actual_username=$(printf '%s\n' \"$content\" | awk -F= 'tolower($1) ~ /^[[:space:]]*username[[:space:]]*$/ {gsub(/^[ \\t]+|[ \\t]+$/, \"\", $2); print $2; exit}')",
		"[ \"$actual_username\" = \"$expected_server_id\" ] && echo username_ok=true || echo username_ok=false",
		"printf '%s\n' \"$content\" | grep -Eiq '^[[:space:]]*password[[:space:]]*=[[:space:]]*.+' && echo password_configured=true || echo password_configured=false",
	}, "\n")
}

func parseBoolKeyValueOutput(out string) map[string]bool {
	result := map[string]bool{}
	for _, line := range strings.Split(out, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}
		result[strings.TrimSpace(key)] = strings.EqualFold(strings.TrimSpace(value), "true")
	}
	return result
}

func (e *SSHExecutor) detectDockerInstallSource(ctx context.Context, tpl software.ResolvedTemplate) (software.InstallSource, string) {
	binaryPathOut, _ := e.runCommand(ctx, "command -v docker 2>/dev/null || true", detectTimeout)
	binaryPath := strings.TrimSpace(firstLine(binaryPathOut))
	if binaryPath == "" {
		return software.InstallSourceUnknown, ""
	}

	expectedPackages := normalizePackageNames(tpl.Install.PackageName, tpl.Install.PackageNames)
	for _, pkg := range expectedPackages {
		checkCmd := fmt.Sprintf("dpkg-query -W -f='${db:Status-Abbrev}' %s 2>/dev/null || true", terminal.ShellQuote(pkg))
		out, _ := e.runCommand(ctx, checkCmd, detectTimeout)
		if strings.HasPrefix(strings.TrimSpace(out), "ii") {
			return software.InstallSourceManaged, "apt:" + pkg
		}
	}

	aptOwnerCmd := fmt.Sprintf("dpkg-query -S %s 2>/dev/null | head -n1 || true", terminal.ShellQuote(binaryPath))
	if owner, ok := parsePackageOwner(firstLine(mustSSHOutput(ctx, e, aptOwnerCmd))); ok {
		if containsString(expectedPackages, owner) {
			return software.InstallSourceManaged, "apt:" + owner
		}
		return software.InstallSourceForeignPackage, "apt:" + owner
	}

	rpmOwnerCmd := fmt.Sprintf("rpm -qf %s --qf '%%{NAME}\n' 2>/dev/null || true", terminal.ShellQuote(binaryPath))
	if owner, ok := parsePackageOwner(firstLine(mustSSHOutput(ctx, e, rpmOwnerCmd))); ok {
		if containsString(expectedPackages, owner) {
			return software.InstallSourceManaged, "rpm:" + owner
		}
		return software.InstallSourceForeignPackage, "rpm:" + owner
	}

	return software.InstallSourceManual, "binary:" + binaryPath
}

func mustSSHOutput(ctx context.Context, e *SSHExecutor, cmd string) string {
	out, _ := e.runCommand(ctx, cmd, detectTimeout)
	return strings.TrimSpace(out)
}

func parsePackageOwner(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", false
	}
	if strings.Contains(trimmed, ":") {
		trimmed = strings.TrimSpace(strings.SplitN(trimmed, ":", 2)[0])
	}
	if strings.Contains(trimmed, ",") {
		trimmed = strings.TrimSpace(strings.SplitN(trimmed, ",", 2)[0])
	}
	return trimmed, trimmed != ""
}

func containsString(items []string, want string) bool {
	for _, item := range items {
		if strings.EqualFold(strings.TrimSpace(item), strings.TrimSpace(want)) {
			return true
		}
	}
	return false
}

// buildScriptCommand builds a safe shell snippet that downloads a script via curl or
// wget and runs it with optional arguments. The script URL and arguments come
// exclusively from catalog metadata and are shell-quoted before use. Downloaded
// scripts are run with bash when their shebang asks for it; otherwise sh is used.
func buildScriptCommand(scriptURL string, args []string, env map[string]string) string {
	quotedArgs := make([]string, len(args))
	for i, a := range args {
		quotedArgs[i] = terminal.ShellQuote(a)
	}
	argsStr := ""
	if len(quotedArgs) > 0 {
		argsStr = " " + strings.Join(quotedArgs, " ")
	}
	envScript := buildEnvScript(env)
	return fmt.Sprintf(
		"set -eu; %s_tmp=$(mktemp); trap 'rm -f \"$_tmp\"' EXIT; "+
			"(curl -fsSL %s -o \"$_tmp\" 2>/dev/null || wget -qO \"$_tmp\" %s); "+
			"chmod +x \"$_tmp\"; %s",
		envScript,
		terminal.ShellQuote(scriptURL),
		terminal.ShellQuote(scriptURL),
		buildDownloadedScriptRunner(argsStr),
	)
}

func buildEmbeddedScriptCommand(scriptBody string, args []string, env map[string]string) string {
	quotedArgs := make([]string, len(args))
	for i, a := range args {
		quotedArgs[i] = terminal.ShellQuote(a)
	}
	argsStr := ""
	if len(quotedArgs) > 0 {
		argsStr = " " + strings.Join(quotedArgs, " ")
	}
	envScript := buildEnvScript(env)
	runner := buildEmbeddedScriptRunner(scriptBody, argsStr)
	return fmt.Sprintf(
		"set -eu; %s_tmp=$(mktemp); trap 'rm -f \"$_tmp\"' EXIT; cat > \"$_tmp\" <<'APPOS_EMBEDDED_SCRIPT'\n%s\nAPPOS_EMBEDDED_SCRIPT\nchmod +x \"$_tmp\"; %s",
		envScript,
		scriptBody,
		runner,
	)
}

func buildEmbeddedScriptRunner(scriptBody, argsStr string) string {
	if scriptRequiresBash(scriptBody) {
		return fmt.Sprintf("command -v bash >/dev/null 2>&1 || { echo 'bash is required to run this script' >&2; exit 127; }; bash \"$_tmp\"%s", argsStr)
	}
	return fmt.Sprintf("sh \"$_tmp\"%s", argsStr)
}

func buildDownloadedScriptRunner(argsStr string) string {
	return fmt.Sprintf("case \"$(head -n 1 \"$_tmp\" 2>/dev/null || true)\" in *bash*) command -v bash >/dev/null 2>&1 || { echo 'bash is required to run this script' >&2; exit 127; }; bash \"$_tmp\"%s ;; *) sh \"$_tmp\"%s ;; esac", argsStr, argsStr)
}

func scriptRequiresBash(scriptBody string) bool {
	first := strings.TrimSpace(firstLine(scriptBody))
	return strings.HasPrefix(first, "#!") && strings.Contains(first, "bash")
}

func buildManagedScriptCommand(scriptPath, scriptURL string, args []string, env map[string]string) (string, error) {
	if strings.TrimSpace(scriptPath) != "" {
		body, err := softwarescripts.ReadEmbeddedScript(scriptPath)
		if err != nil {
			return "", err
		}
		return buildEmbeddedScriptCommand(body, args, env), nil
	}

	if strings.TrimSpace(scriptURL) != "" {
		return buildScriptCommand(scriptURL, args, env), nil
	}

	return "", fmt.Errorf("both script_path and script_url are empty")
}

func buildEnvScript(env map[string]string) string {
	if len(env) == 0 {
		return ""
	}
	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var builder strings.Builder
	for index, key := range keys {
		value := env[key]
		heredoc := fmt.Sprintf("APPOS_ENV_%d", index)
		builder.WriteString(key)
		builder.WriteString("=$(cat <<'")
		builder.WriteString(heredoc)
		builder.WriteString("'\n")
		builder.WriteString(value)
		if !strings.HasSuffix(value, "\n") {
			builder.WriteString("\n")
		}
		builder.WriteString(heredoc)
		builder.WriteString("\n); export ")
		builder.WriteString(key)
		builder.WriteString("; ")
	}
	return builder.String()
}

func (e *SSHExecutor) detectPackageManager(ctx context.Context) (string, string, error) {
	checks := []struct {
		name    string
		command string
	}{
		{name: "apt", command: "command -v apt-get >/dev/null 2>&1 && echo apt-get"},
		{name: "dnf", command: "command -v dnf >/dev/null 2>&1 && echo dnf"},
		{name: "yum", command: "command -v yum >/dev/null 2>&1 && echo yum"},
	}

	for _, check := range checks {
		out, err := e.runCommand(ctx, check.command, preflightTimeout)
		if err == nil && strings.TrimSpace(out) != "" {
			return check.name, strings.TrimSpace(out), nil
		}
	}

	return "", "", fmt.Errorf("no supported package manager detected")
}

func (e *SSHExecutor) detectOS(ctx context.Context) (string, error) {
	out, err := e.runCommand(ctx,
		`awk -F= '/^ID=/{gsub(/"/, "", $2); print $2}' /etc/os-release 2>/dev/null || true`,
		preflightTimeout)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(strings.ToLower(out)), nil
}

func normalizePackageNames(packageName string, packageNames []string) []string {
	if len(packageNames) > 0 {
		result := make([]string, 0, len(packageNames))
		for _, name := range packageNames {
			trimmed := strings.TrimSpace(name)
			if trimmed != "" {
				result = append(result, trimmed)
			}
		}
		return result
	}

	if strings.TrimSpace(packageName) == "" {
		return nil
	}

	return strings.Fields(packageName)
}

func shellQuoteAll(items []string) string {
	quoted := make([]string, 0, len(items))
	for _, item := range items {
		quoted = append(quoted, terminal.ShellQuote(item))
	}
	return strings.Join(quoted, " ")
}

func (e *SSHExecutor) buildPackageActionCommand(ctx context.Context, action, packageName string, packageNames []string, repoProfile string) (string, error) {
	packages := normalizePackageNames(packageName, packageNames)
	if len(packages) == 0 {
		return "", fmt.Errorf("package action %s requires at least one package name", action)
	}

	osID, err := e.detectOS(ctx)
	if err != nil {
		return "", fmt.Errorf("detect target OS: %w", err)
	}

	managerName, managerBin, err := e.detectPackageManager(ctx)
	if err != nil {
		return "", fmt.Errorf("detect package manager: %w", err)
	}

	quotedPackages := shellQuoteAll(packages)

	if osID == "amzn" && repoProfile == dockerCEPackageRepoProfile {
		setup := []string{
			fmt.Sprintf("%s -y install dnf-plugins-core", managerBin),
			fmt.Sprintf("%s config-manager addrepo --save-filename=docker-ce.repo --from-repofile=%s", managerBin, terminal.ShellQuote("https://download.docker.com/linux/rhel/docker-ce.repo")),
			"sed -i 's|\\$releasever|9|g' /etc/yum.repos.d/docker-ce.repo",
			fmt.Sprintf("%s makecache", managerBin),
		}

		switch action {
		case "install":
			setup = append(setup, fmt.Sprintf("%s install -y %s --enablerepo=%s", managerBin, quotedPackages, terminal.ShellQuote("docker-ce-stable")))
		case "upgrade":
			setup = append(setup, fmt.Sprintf("%s upgrade -y %s --enablerepo=%s", managerBin, quotedPackages, terminal.ShellQuote("docker-ce-stable")))
		case "uninstall":
			setup = append(setup, fmt.Sprintf("%s remove -y %s --enablerepo=%s", managerBin, quotedPackages, terminal.ShellQuote("docker-ce-stable")))
		default:
			return "", fmt.Errorf("unsupported package action %q", action)
		}

		return strings.Join(setup, " && "), nil
	}

	switch managerName {
	case "apt":
		switch action {
		case "install":
			return fmt.Sprintf("DEBIAN_FRONTEND=noninteractive apt-get install -y %s", quotedPackages), nil
		case "upgrade":
			return fmt.Sprintf("DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade %s", quotedPackages), nil
		case "uninstall":
			return fmt.Sprintf("DEBIAN_FRONTEND=noninteractive apt-get remove -y %s", quotedPackages), nil
		}
	case "dnf":
		switch action {
		case "install":
			return fmt.Sprintf("dnf install -y %s", quotedPackages), nil
		case "upgrade":
			return fmt.Sprintf("dnf upgrade -y %s", quotedPackages), nil
		case "uninstall":
			return fmt.Sprintf("dnf remove -y %s", quotedPackages), nil
		}
	case "yum":
		switch action {
		case "install":
			return fmt.Sprintf("yum install -y %s", quotedPackages), nil
		case "upgrade":
			return fmt.Sprintf("yum update -y %s", quotedPackages), nil
		case "uninstall":
			return fmt.Sprintf("yum remove -y %s", quotedPackages), nil
		}
	}

	return "", fmt.Errorf("unsupported package manager/action combination: manager=%s action=%s", managerName, action)
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
