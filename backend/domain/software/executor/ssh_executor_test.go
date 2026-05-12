package executor

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/websoft9/appos/backend/domain/software"
	"github.com/websoft9/appos/backend/domain/terminal"
)

// ─── Helper builders ──────────────────────────────────────────────────────────

func packageTemplate(pkg, svc string) software.ResolvedTemplate {
	return software.ResolvedTemplate{
		ComponentKey: software.ComponentKey("docker"),
		TemplateKind: software.TemplateKindPackage,
		Detect: software.DetectSpec{
			VersionCommand: "docker --version",
			InstalledHint:  []string{"command -v docker"},
		},
		Preflight: software.PreflightSpec{
			RequireRoot:    true,
			RequireNetwork: false,
			VerifiedOS:     []string{"ubuntu", "debian"},
			ServiceManager: "systemd",
			PackageManager: "apt",
		},
		Install: software.InstallSpec{
			Strategy:    "package",
			PackageName: pkg,
		},
		Upgrade: software.UpgradeSpec{
			Strategy:    "package",
			PackageName: pkg,
		},
		Uninstall: software.UninstallSpec{
			Strategy:    "package",
			PackageName: pkg,
		},
		Verify: software.VerifySpec{
			Strategy:    "systemd",
			ServiceName: svc,
		},
		Reinstall: software.ReinstallSpec{Strategy: "reinstall"},
	}
}

func scriptTemplate(url, svc string) software.ResolvedTemplate {
	return software.ResolvedTemplate{
		ComponentKey: software.ComponentKey("monitor-agent"),
		TemplateKind: software.TemplateKindScript,
		Detect: software.DetectSpec{
			VersionCommand: "netdata -V",
			InstalledHint:  []string{"command -v netdata"},
		},
		Preflight: software.PreflightSpec{
			RequireRoot:    true,
			RequireNetwork: true,
			VerifiedOS:     []string{"ubuntu"},
			ServiceManager: "systemd",
		},
		Install: software.InstallSpec{
			Strategy:  "script",
			ScriptURL: url,
		},
		Upgrade: software.UpgradeSpec{
			Strategy:  "script",
			ScriptURL: url,
			Args:      []string{"--upgrade"},
		},
		Uninstall: software.UninstallSpec{
			Strategy:  "script",
			ScriptURL: url,
			Args:      []string{"--uninstall"},
		},
		Verify: software.VerifySpec{
			Strategy:    "systemd",
			ServiceName: svc,
		},
		Reinstall: software.ReinstallSpec{Strategy: "reinstall"},
	}
}

// ─── buildScriptCommand ───────────────────────────────────────────────────────

func TestBuildScriptCommand_NoArgs(t *testing.T) {
	cmd := buildScriptCommand("https://example.com/install.sh", nil, nil)
	if cmd == "" {
		t.Fatal("expected non-empty command")
	}
	// Must contain the URL (shell-quoted)
	if !containsSubstring(cmd, "'https://example.com/install.sh'") {
		t.Errorf("expected shell-quoted URL in command, got: %s", cmd)
	}
	// Must contain set -eu
	if !containsSubstring(cmd, "set -eu") {
		t.Errorf("expected set -eu in command, got: %s", cmd)
	}
	// Must clean up temp file
	if !containsSubstring(cmd, "trap") {
		t.Errorf("expected trap cleanup in command, got: %s", cmd)
	}
}

func TestBuildScriptCommand_WithArgs(t *testing.T) {
	cmd := buildScriptCommand("https://example.com/install.sh", []string{"--upgrade", "--channel=stable"}, nil)
	if !containsSubstring(cmd, "'--upgrade'") {
		t.Errorf("expected --upgrade arg in command, got: %s", cmd)
	}
	if !containsSubstring(cmd, "'--channel=stable'") {
		t.Errorf("expected --channel=stable arg in command, got: %s", cmd)
	}
}

func TestBuildScriptCommand_ShellQuotesURL(t *testing.T) {
	// URL must be shell-quoted to prevent injection even from catalog metadata
	cmd := buildScriptCommand("https://example.com/path with spaces/install.sh", nil, nil)
	if !containsSubstring(cmd, "'https://example.com/path with spaces/install.sh'") {
		t.Errorf("expected properly quoted URL, got: %s", cmd)
	}
}

func TestBuildScriptCommand_WithMultilineEnv(t *testing.T) {
	cmd := buildScriptCommand("https://example.com/install.sh", nil, map[string]string{"APPOS_CONFIG_YAML": "line1\nline2\n"})
	if !containsSubstring(cmd, "APPOS_CONFIG_YAML=$(cat <<'APPOS_ENV_0'") {
		t.Fatalf("expected multiline env heredoc, got: %s", cmd)
	}
	if !containsSubstring(cmd, "line1\nline2") {
		t.Fatalf("expected env value in command, got: %s", cmd)
	}
}

func TestBuildManagedScriptCommand_EmbeddedScript(t *testing.T) {
	cmd, err := buildManagedScriptCommand("docker-install.sh", "", nil, nil)
	if err != nil {
		t.Fatalf("buildManagedScriptCommand error: %v", err)
	}
	if !containsSubstring(cmd, "APPOS_EMBEDDED_SCRIPT") {
		t.Fatalf("expected embedded script heredoc command, got: %s", cmd)
	}
	if !containsSubstring(cmd, "docker-install") {
		t.Fatalf("expected embedded docker-install.sh contents, got: %s", cmd)
	}
}

func TestBuildManagedScriptCommand_EmbeddedScriptWithEnv(t *testing.T) {
	cmd, err := buildManagedScriptCommand("docker-install.sh", "", nil, map[string]string{"APPOS_SYSTEMD_UNIT": "unit-content"})
	if err != nil {
		t.Fatalf("buildManagedScriptCommand error: %v", err)
	}
	if !containsSubstring(cmd, "APPOS_SYSTEMD_UNIT=$(cat <<'APPOS_ENV_0'") {
		t.Fatalf("expected env injection in embedded command, got: %s", cmd)
	}
	if !containsSubstring(cmd, "unit-content") {
		t.Fatalf("expected env value in embedded command, got: %s", cmd)
	}
}

// ─── withSudo ─────────────────────────────────────────────────────────────────

func TestWithSudo_ContainsFallback(t *testing.T) {
	cmd := withSudo("apt-get install -y docker")
	// Must attempt sudo first, then fall back
	if !containsSubstring(cmd, "sudo -n") {
		t.Errorf("expected sudo attempt, got: %s", cmd)
	}
	// Must have the sh -c fallback
	if !containsSubstring(cmd, "sh -c") {
		t.Errorf("expected sh -c fallback, got: %s", cmd)
	}
}

// ─── firstLine ────────────────────────────────────────────────────────────────

func TestFirstLine_SingleLine(t *testing.T) {
	if got := firstLine("hello"); got != "hello" {
		t.Errorf("got %q", got)
	}
}

func TestFirstLine_MultiLine(t *testing.T) {
	if got := firstLine("\nfirst\nsecond"); got != "first" {
		t.Errorf("got %q, expected %q", got, "first")
	}
}

func TestFirstLine_Empty(t *testing.T) {
	if got := firstLine(""); got != "" {
		t.Errorf("got %q", got)
	}
}

// ─── Detect ───────────────────────────────────────────────────────────────────

func TestDetect_InstalledWithVersion(t *testing.T) {
	orig := executeSSHCommand
	defer func() { executeSSHCommand = orig }()

	callCount := 0
	executeSSHCommand = func(_ context.Context, _ terminal.ConnectorConfig, cmd string, _ time.Duration) (string, error) {
		callCount++
		if containsSubstring(cmd, "command -v") {
			return "/usr/bin/docker", nil // hint satisfied
		}
		return "Docker version 24.0.5, build abc123", nil // version command
	}

	tpl := packageTemplate("docker.io", "docker.service")
	ex := &SSHExecutor{}
	detection, err := ex.Detect(context.Background(), "", tpl)
	if err != nil {
		t.Fatalf("Detect error: %v", err)
	}
	if detection.InstalledState != software.InstalledStateInstalled {
		t.Errorf("expected installed, got %q", detection.InstalledState)
	}
	if !containsSubstring(detection.DetectedVersion, "Docker version") {
		t.Errorf("expected version string, got %q", detection.DetectedVersion)
	}
}

func TestDetect_NotInstalled(t *testing.T) {
	orig := executeSSHCommand
	defer func() { executeSSHCommand = orig }()

	executeSSHCommand = func(_ context.Context, _ terminal.ConnectorConfig, _ string, _ time.Duration) (string, error) {
		return "", ErrCommandFailed
	}

	tpl := packageTemplate("docker.io", "docker.service")
	ex := &SSHExecutor{}
	detection, err := ex.Detect(context.Background(), "", tpl)
	if err != nil {
		t.Fatalf("Detect error: %v", err)
	}
	if detection.InstalledState != software.InstalledStateNotInstalled {
		t.Errorf("expected not_installed, got %q", detection.InstalledState)
	}
	if detection.DetectedVersion != "" {
		t.Errorf("expected empty version, got %q", detection.DetectedVersion)
	}
}

func TestDetect_DockerManagedInstallSource(t *testing.T) {
	orig := executeSSHCommand
	defer func() { executeSSHCommand = orig }()

	executeSSHCommand = func(_ context.Context, _ terminal.ConnectorConfig, cmd string, _ time.Duration) (string, error) {
		switch {
		case containsSubstring(cmd, "command -v docker"):
			return "/usr/bin/docker", nil
		case containsSubstring(cmd, "Docker version"):
			return "Docker version 27.0.1, build abc123", nil
		case containsSubstring(cmd, "dpkg-query -W") && containsSubstring(cmd, "docker-ce"):
			return "ii ", nil
		default:
			return "", nil
		}
	}

	tpl := packageTemplate("docker-ce", "docker.service")
	tpl.Install.PackageNames = []string{"docker-ce", "docker-ce-cli"}
	ex := &SSHExecutor{}
	detection, err := ex.Detect(context.Background(), "", tpl)
	if err != nil {
		t.Fatalf("Detect error: %v", err)
	}
	if detection.InstallSource != software.InstallSourceManaged {
		t.Fatalf("expected managed install source, got %q", detection.InstallSource)
	}
	if detection.SourceEvidence != "apt:docker-ce" {
		t.Fatalf("expected apt evidence, got %q", detection.SourceEvidence)
	}
}

func TestDetect_DockerForeignPackageInstallSource(t *testing.T) {
	orig := executeSSHCommand
	defer func() { executeSSHCommand = orig }()

	executeSSHCommand = func(_ context.Context, _ terminal.ConnectorConfig, cmd string, _ time.Duration) (string, error) {
		switch {
		case containsSubstring(cmd, "command -v docker"):
			return "/usr/bin/docker", nil
		case containsSubstring(cmd, "Docker version"):
			return "Docker version 27.0.1, build abc123", nil
		case containsSubstring(cmd, "dpkg-query -W"):
			return "", nil
		case containsSubstring(cmd, "dpkg-query -S"):
			return "docker.io: /usr/bin/docker", nil
		default:
			return "", nil
		}
	}

	tpl := packageTemplate("docker-ce", "docker.service")
	ex := &SSHExecutor{}
	detection, err := ex.Detect(context.Background(), "", tpl)
	if err != nil {
		t.Fatalf("Detect error: %v", err)
	}
	if detection.InstallSource != software.InstallSourceForeignPackage {
		t.Fatalf("expected foreign_package install source, got %q", detection.InstallSource)
	}
	if detection.SourceEvidence != "apt:docker.io" {
		t.Fatalf("expected apt foreign evidence, got %q", detection.SourceEvidence)
	}
}

func TestDetect_DockerManualInstallSource(t *testing.T) {
	orig := executeSSHCommand
	defer func() { executeSSHCommand = orig }()

	executeSSHCommand = func(_ context.Context, _ terminal.ConnectorConfig, cmd string, _ time.Duration) (string, error) {
		switch {
		case containsSubstring(cmd, "command -v docker"):
			return "/usr/local/bin/docker", nil
		case containsSubstring(cmd, "Docker version"):
			return "Docker version 27.0.1, build abc123", nil
		default:
			return "", nil
		}
	}

	tpl := packageTemplate("docker-ce", "docker.service")
	ex := &SSHExecutor{}
	detection, err := ex.Detect(context.Background(), "", tpl)
	if err != nil {
		t.Fatalf("Detect error: %v", err)
	}
	if detection.InstallSource != software.InstallSourceManual {
		t.Fatalf("expected manual install source, got %q", detection.InstallSource)
	}
	if detection.SourceEvidence != "binary:/usr/local/bin/docker" {
		t.Fatalf("expected binary evidence, got %q", detection.SourceEvidence)
	}
}

// ─── Verify strategy routing ─────────────────────────────────────────────────

func TestVerify_UnknownStrategy_ReturnsError(t *testing.T) {
	ex := &SSHExecutor{}
	tpl := packageTemplate("docker.io", "docker.service")
	tpl.Verify.Strategy = "unknown-strategy"
	_, err := ex.Verify(context.Background(), "", tpl)
	if err == nil {
		t.Fatal("expected error for unknown verify strategy")
	}
}

// ─── Install strategy routing ─────────────────────────────────────────────────

func TestInstall_EmptyStrategy_ReturnsError(t *testing.T) {
	ex := &SSHExecutor{}
	tpl := packageTemplate("docker.io", "docker.service")
	tpl.Install.Strategy = ""
	_, err := ex.Install(context.Background(), "srv-1", tpl)
	if err == nil {
		t.Fatal("expected error for empty install strategy")
	}
}

func TestInstall_ScriptWithEmptyURL_ReturnsError(t *testing.T) {
	ex := &SSHExecutor{}
	tpl := scriptTemplate("", "netdata.service")
	_, err := ex.Install(context.Background(), "srv-1", tpl)
	if err == nil {
		t.Fatal("expected error when script_url is empty")
	}
}

func TestInstall_ScriptWithEmbeddedPath(t *testing.T) {
	orig := executeSSHCommand
	defer func() { executeSSHCommand = orig }()

	executeSSHCommand = func(_ context.Context, _ terminal.ConnectorConfig, cmd string, _ time.Duration) (string, error) {
		if containsSubstring(cmd, "APPOS_EMBEDDED_SCRIPT") {
			return "", nil
		}
		if containsSubstring(cmd, "is-active") {
			t.Fatalf("install should not run verification command inside executing phase: %s", cmd)
		}
		return "", nil
	}

	ex := &SSHExecutor{}
	tpl := packageTemplate("docker-ce", "docker.service")
	tpl.Install.Strategy = "script"
	tpl.Install.ScriptPath = "docker-install.sh"
	detail, err := ex.Install(context.Background(), "srv-1", tpl)
	if err != nil {
		t.Fatalf("Install error: %v", err)
	}
	if detail.VerificationState != "" {
		t.Fatalf("expected no verification result during install execution, got %q", detail.VerificationState)
	}
	if detail.ServiceName != "docker.service" {
		t.Fatalf("expected service name to survive execution detail, got %q", detail.ServiceName)
	}
}

func TestReinstall_DoesNotVerifyDuringExecution(t *testing.T) {
	orig := executeSSHCommand
	defer func() { executeSSHCommand = orig }()

	executeSSHCommand = func(_ context.Context, _ terminal.ConnectorConfig, cmd string, _ time.Duration) (string, error) {
		if containsSubstring(cmd, "is-active") {
			t.Fatalf("reinstall should not run verification command inside executing phase: %s", cmd)
		}
		if containsSubstring(cmd, "apt-get install") {
			return "", nil
		}
		if containsSubstring(cmd, "command -v apt-get") {
			return "apt-get", nil
		}
		if containsSubstring(cmd, "/etc/os-release") {
			return "ubuntu", nil
		}
		return "", nil
	}

	ex := &SSHExecutor{}
	tpl := packageTemplate("docker.io", "docker.service")
	detail, err := ex.Reinstall(context.Background(), "srv-1", tpl)
	if err != nil {
		t.Fatalf("Reinstall error: %v", err)
	}
	if detail.VerificationState != "" {
		t.Fatalf("expected no verification result during reinstall execution, got %q", detail.VerificationState)
	}
}

func TestUpgrade_EmptyStrategy_ReturnsError(t *testing.T) {
	ex := &SSHExecutor{}
	tpl := packageTemplate("docker.io", "docker.service")
	tpl.Upgrade.Strategy = ""
	_, err := ex.Upgrade(context.Background(), "srv-1", tpl)
	if err == nil {
		t.Fatal("expected error for empty upgrade strategy")
	}
}

func TestUninstall_EmptyStrategy_ReturnsError(t *testing.T) {
	ex := &SSHExecutor{}
	tpl := packageTemplate("docker.io", "docker.service")
	tpl.Uninstall.Strategy = ""
	_, err := ex.Uninstall(context.Background(), "srv-1", tpl)
	if err == nil {
		t.Fatal("expected error for empty uninstall strategy")
	}
}

func TestUninstall_ScriptWithEmptyURL_ReturnsError(t *testing.T) {
	ex := &SSHExecutor{}
	tpl := scriptTemplate("", "netdata.service")
	_, err := ex.Uninstall(context.Background(), "srv-1", tpl)
	if err == nil {
		t.Fatal("expected error when script_url is empty for uninstall")
	}
}

func TestUninstall_StopsServiceBeforePackageRemoval(t *testing.T) {
	orig := executeSSHCommand
	defer func() { executeSSHCommand = orig }()

	commands := []string{}
	executeSSHCommand = func(_ context.Context, _ terminal.ConnectorConfig, cmd string, _ time.Duration) (string, error) {
		commands = append(commands, cmd)
		switch {
		case containsSubstring(cmd, "systemctl stop") && containsSubstring(cmd, "docker.service"):
			return "", nil
		case containsSubstring(cmd, "/etc/os-release"):
			return "ubuntu", nil
		case containsSubstring(cmd, "command -v apt-get"):
			return "apt-get", nil
		case containsSubstring(cmd, "apt-get remove -y") && containsSubstring(cmd, "docker-ce"):
			return "", nil
		default:
			return "", nil
		}
	}

	ex := &SSHExecutor{}
	tpl := packageTemplate("docker-ce", "docker.service")
	_, err := ex.Uninstall(context.Background(), "srv-1", tpl)
	if err != nil {
		t.Fatalf("Uninstall error: %v", err)
	}
	if len(commands) < 3 {
		t.Fatalf("expected stop + package-manager detection + remove commands, got %v", commands)
	}
	stopIndex := -1
	removeIndex := -1
	for i, cmd := range commands {
		if containsSubstring(cmd, "systemctl stop") && containsSubstring(cmd, "docker.service") {
			stopIndex = i
		}
		if containsSubstring(cmd, "apt-get remove -y") && containsSubstring(cmd, "docker-ce") {
			removeIndex = i
		}
	}
	if stopIndex == -1 {
		t.Fatalf("expected uninstall to stop service first, commands=%v", commands)
	}
	if removeIndex == -1 {
		t.Fatalf("expected uninstall to remove docker package, commands=%v", commands)
	}
	if stopIndex > removeIndex {
		t.Fatalf("expected service stop before package removal, commands=%v", commands)
	}
}

// ─── Reinstall strategy routing ─────────────────────────────────────────────

func TestReinstall_UnknownStrategy_ReturnsError(t *testing.T) {
	ex := &SSHExecutor{}
	tpl := packageTemplate("docker.io", "docker.service")
	tpl.Reinstall.Strategy = "unknown"
	_, err := ex.Reinstall(context.Background(), "srv-1", tpl)
	if err == nil {
		t.Fatal("expected error for unknown reinstall strategy")
	}
}

// ─── verifySystemd ─────────────────────────────────────────────────────────────

func TestVerifySystemd_ActiveService_ReturnsHealthy(t *testing.T) {
	orig := executeSSHCommand
	defer func() { executeSSHCommand = orig }()

	executeSSHCommand = func(_ context.Context, _ terminal.ConnectorConfig, cmd string, _ time.Duration) (string, error) {
		if containsSubstring(cmd, "is-active") {
			return "active", nil
		}
		// installed_hint
		if containsSubstring(cmd, "command -v") {
			return "/usr/bin/docker", nil
		}
		return "Docker version 24.0.5", nil
	}

	tpl := packageTemplate("docker.io", "docker.service")
	ex := &SSHExecutor{}
	detail, err := ex.verifySystemd(context.Background(), tpl)
	if err != nil {
		t.Fatalf("verifySystemd error: %v", err)
	}
	if detail.VerificationState != software.VerificationStateHealthy {
		t.Errorf("expected healthy, got %q", detail.VerificationState)
	}
}

func TestVerifySystemd_InactiveService_ReturnsDegraded(t *testing.T) {
	orig := executeSSHCommand
	defer func() { executeSSHCommand = orig }()

	executeSSHCommand = func(_ context.Context, _ terminal.ConnectorConfig, cmd string, _ time.Duration) (string, error) {
		if containsSubstring(cmd, "is-active") {
			return "inactive", nil
		}
		return "", ErrCommandFailed
	}

	tpl := packageTemplate("docker.io", "docker.service")
	ex := &SSHExecutor{}
	detail, err := ex.verifySystemd(context.Background(), tpl)
	if err != nil {
		t.Fatalf("verifySystemd error: %v", err)
	}
	if detail.VerificationState != software.VerificationStateDegraded {
		t.Errorf("expected degraded, got %q", detail.VerificationState)
	}
}

// ─── RunPreflight ─────────────────────────────────────────────────────────────

func TestRunPreflight_AllDimensionsOK(t *testing.T) {
	orig := executeSSHCommand
	defer func() { executeSSHCommand = orig }()

	executeSSHCommand = func(_ context.Context, _ terminal.ConnectorConfig, cmd string, _ time.Duration) (string, error) {
		if containsSubstring(cmd, "/etc/os-release") {
			return "ubuntu", nil
		}
		if containsSubstring(cmd, "systemctl") {
			return "", nil
		}
		if containsSubstring(cmd, "apt-get") {
			return "", nil
		}
		if containsSubstring(cmd, "id -u") {
			return "0", nil
		}
		if containsSubstring(cmd, "get.docker.com") {
			return "", nil
		}
		return "", nil
	}

	tpl := packageTemplate("docker.io", "docker.service")
	tpl.Preflight.RequireNetwork = true
	ex := &SSHExecutor{}
	result, err := ex.RunPreflight(context.Background(), "", tpl)
	if err != nil {
		t.Fatalf("RunPreflight error: %v", err)
	}
	if !result.OK {
		t.Errorf("expected OK preflight, issues: %v", result.Issues)
	}
}

func TestRunPreflight_NetworkRequired_FallbackProbeOK(t *testing.T) {
	orig := executeSSHCommand
	defer func() { executeSSHCommand = orig }()

	executeSSHCommand = func(_ context.Context, _ terminal.ConnectorConfig, cmd string, _ time.Duration) (string, error) {
		if containsSubstring(cmd, "/etc/os-release") {
			return "ubuntu", nil
		}
		if containsSubstring(cmd, "systemctl") {
			return "", nil
		}
		if containsSubstring(cmd, "apt-get") {
			return "", nil
		}
		if containsSubstring(cmd, "id -u") {
			return "0", nil
		}
		if containsSubstring(cmd, "get.docker.com") && containsSubstring(cmd, "google.com/generate_204") {
			return "", nil
		}
		return "", nil
	}

	tpl := packageTemplate("docker.io", "docker.service")
	tpl.Preflight.RequireNetwork = true
	ex := &SSHExecutor{}
	result, err := ex.RunPreflight(context.Background(), "", tpl)
	if err != nil {
		t.Fatalf("RunPreflight error: %v", err)
	}
	if !result.OK {
		t.Errorf("expected OK preflight via fallback probe, issues: %v", result.Issues)
	}
}

func TestRunPreflight_NetworkRequired_ProbeFailureIsAdvisory(t *testing.T) {
	orig := executeSSHCommand
	defer func() { executeSSHCommand = orig }()

	executeSSHCommand = func(_ context.Context, _ terminal.ConnectorConfig, cmd string, _ time.Duration) (string, error) {
		if containsSubstring(cmd, "/etc/os-release") {
			return "ubuntu", nil
		}
		if containsSubstring(cmd, "systemctl") {
			return "", nil
		}
		if containsSubstring(cmd, "apt-get") {
			return "", nil
		}
		if containsSubstring(cmd, "id -u") {
			return "0", nil
		}
		if containsSubstring(cmd, "get.docker.com") && containsSubstring(cmd, "google.com/generate_204") {
			return "", ErrCommandFailed
		}
		return "", nil
	}

	tpl := packageTemplate("docker.io", "docker.service")
	tpl.Preflight.RequireNetwork = true
	ex := &SSHExecutor{}
	result, err := ex.RunPreflight(context.Background(), "", tpl)
	if err != nil {
		t.Fatalf("RunPreflight error: %v", err)
	}
	if !result.OK {
		t.Fatalf("expected advisory network probe failure to keep preflight OK, issues: %v", result.Issues)
	}
	if result.NetworkOK {
		t.Fatal("expected NetworkOK=false when all outbound network probes fail")
	}
	if len(result.Issues) == 0 {
		t.Fatal("expected advisory network issue when probes fail")
	}
}

func TestRunPreflight_UnverifiedOS_WarnsButStaysOK(t *testing.T) {
	orig := executeSSHCommand
	defer func() { executeSSHCommand = orig }()

	executeSSHCommand = func(_ context.Context, _ terminal.ConnectorConfig, cmd string, _ time.Duration) (string, error) {
		if containsSubstring(cmd, "/etc/os-release") {
			return "alpine", nil // not in supported list
		}
		if containsSubstring(cmd, "systemctl") {
			return "", nil
		}
		if containsSubstring(cmd, "apt-get") {
			return "", nil
		}
		if containsSubstring(cmd, "id -u") {
			return "0", nil
		}
		return "", nil
	}

	tpl := packageTemplate("docker.io", "docker.service")
	ex := &SSHExecutor{}
	result, err := ex.RunPreflight(context.Background(), "", tpl)
	if err != nil {
		t.Fatalf("RunPreflight error: %v", err)
	}
	if result.OSSupported {
		t.Error("expected OSSupported=false")
	}
	if !result.OK {
		t.Error("expected preflight to remain OK when only the verified OS baseline does not match")
	}
}

func TestRunPreflight_MissingPackageManager_NotOK(t *testing.T) {
	orig := executeSSHCommand
	defer func() { executeSSHCommand = orig }()

	executeSSHCommand = func(_ context.Context, _ terminal.ConnectorConfig, cmd string, _ time.Duration) (string, error) {
		if containsSubstring(cmd, "/etc/os-release") {
			return "ubuntu", nil
		}
		if containsSubstring(cmd, "systemctl") {
			return "", nil
		}
		if containsSubstring(cmd, "apt-get") {
			return "", ErrCommandFailed
		}
		if containsSubstring(cmd, "id -u") {
			return "0", nil
		}
		return "", nil
	}

	tpl := packageTemplate("docker.io", "docker.service")
	ex := &SSHExecutor{}
	result, err := ex.RunPreflight(context.Background(), "", tpl)
	if err != nil {
		t.Fatalf("RunPreflight error: %v", err)
	}
	if result.OK {
		t.Error("expected preflight to fail when required package manager is unavailable")
	}
	if result.PackageManagerOK {
		t.Error("expected PackageManagerOK=false")
	}
}

func TestRunPreflight_NativePackageManagerOKWithDnf(t *testing.T) {
	orig := executeSSHCommand
	defer func() { executeSSHCommand = orig }()

	executeSSHCommand = func(_ context.Context, _ terminal.ConnectorConfig, cmd string, _ time.Duration) (string, error) {
		if containsSubstring(cmd, "/etc/os-release") {
			return "amzn", nil
		}
		if containsSubstring(cmd, "systemctl") {
			return "", nil
		}
		if containsSubstring(cmd, "apt-get") {
			return "", ErrCommandFailed
		}
		if containsSubstring(cmd, "dnf") {
			return "dnf", nil
		}
		if containsSubstring(cmd, "id -u") {
			return "0", nil
		}
		return "", nil
	}

	tpl := packageTemplate("docker-ce", "docker.service")
	tpl.Preflight.PackageManager = "native"
	tpl.Preflight.VerifiedOS = []string{"amzn"}
	ex := &SSHExecutor{}
	result, err := ex.RunPreflight(context.Background(), "", tpl)
	if err != nil {
		t.Fatalf("RunPreflight error: %v", err)
	}
	if !result.OK {
		t.Fatalf("expected preflight OK with dnf available, issues: %v", result.Issues)
	}
	if !result.PackageManagerOK {
		t.Fatal("expected PackageManagerOK=true for native package manager with dnf")
	}
}

func TestBuildPackageActionCommand_AmznDockerCEUpgrade(t *testing.T) {
	orig := executeSSHCommand
	defer func() { executeSSHCommand = orig }()

	executeSSHCommand = func(_ context.Context, _ terminal.ConnectorConfig, cmd string, _ time.Duration) (string, error) {
		switch {
		case containsSubstring(cmd, "/etc/os-release"):
			return "amzn", nil
		case containsSubstring(cmd, "apt-get"):
			return "", ErrCommandFailed
		case containsSubstring(cmd, "command -v dnf"):
			return "dnf", nil
		default:
			return "", nil
		}
	}

	ex := &SSHExecutor{}
	cmd, err := ex.buildPackageActionCommand(context.Background(), "upgrade", "docker-ce", []string{"docker-ce", "docker-ce-cli"}, dockerCEPackageRepoProfile)
	if err != nil {
		t.Fatalf("buildPackageActionCommand error: %v", err)
	}
	if !containsSubstring(cmd, "config-manager addrepo") {
		t.Fatalf("expected repo bootstrap in amzn docker-ce command, got: %s", cmd)
	}
	if !containsSubstring(cmd, "sed -i 's|\\$releasever|9|g'") {
		t.Fatalf("expected releasever rewrite in amzn docker-ce command, got: %s", cmd)
	}
	if !containsSubstring(cmd, "dnf upgrade -y 'docker-ce' 'docker-ce-cli' --enablerepo='docker-ce-stable'") {
		t.Fatalf("unexpected dnf upgrade command: %s", cmd)
	}
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func containsSubstring(s, sub string) bool {
	return len(sub) > 0 && len(s) >= len(sub) &&
		func() bool {
			for i := 0; i <= len(s)-len(sub); i++ {
				if s[i:i+len(sub)] == sub {
					return true
				}
			}
			return false
		}()
}

// ErrCommandFailed is a sentinel error used in tests to simulate SSH command failures.
var ErrCommandFailed = fmt.Errorf("command failed")
