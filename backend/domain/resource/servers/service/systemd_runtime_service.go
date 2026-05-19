package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/websoft9/appos/backend/domain/terminal"
)

type SystemdCommandRunner func(context.Context, string, time.Duration) (string, error)

type SystemdRuntimeService struct {
	Run SystemdCommandRunner
}

type SystemdStatusResult struct {
	Properties map[string]string `json:"properties"`
	StatusText string            `json:"status_text"`
}

type SystemdLogsResult struct {
	Lines   int      `json:"lines"`
	Entries []string `json:"entries"`
	Raw     string   `json:"raw"`
}

type SystemdActionResult struct {
	Action string `json:"action"`
	Status string `json:"status"`
	Output string `json:"output"`
}

type SystemdUnitWriteResult struct {
	Path   string `json:"path"`
	Status string `json:"status"`
	Output string `json:"output"`
}

type SystemdUnitVerifyResult struct {
	Path         string `json:"path"`
	Status       string `json:"status"`
	VerifyOutput string `json:"verify_output"`
}

type SystemdUnitApplyResult struct {
	Status       string `json:"status"`
	ReloadOutput string `json:"reload_output"`
	ApplyOutput  string `json:"apply_output"`
}

const MaxSystemdUnitContentBytes = 64 * 1024

func (s SystemdRuntimeService) ListServices(ctx context.Context, keyword string) ([]SystemdServiceItem, error) {
	raw, err := s.run(ctx, "systemctl list-units --type=service --all --plain --no-legend --no-pager", 20*time.Second)
	if err != nil {
		return nil, err
	}
	return ParseSystemdServicesOutput(raw, keyword), nil
}

func (s SystemdRuntimeService) Status(ctx context.Context, service string) (SystemdStatusResult, error) {
	showCmd := fmt.Sprintf("systemctl show %s --no-pager --property=Id,Description,LoadState,ActiveState,SubState,UnitFileState,MainPID,ExecMainStatus,ExecMainCode,StateChangeTimestamp,FragmentPath", service)
	showRaw, err := s.run(ctx, showCmd, 20*time.Second)
	if err != nil {
		return SystemdStatusResult{}, err
	}

	statusCmd := fmt.Sprintf("systemctl status %s --no-pager --full --lines=40", service)
	statusRaw, _ := s.run(ctx, statusCmd, 20*time.Second)

	return SystemdStatusResult{
		Properties: ParseSystemdShowProperties(showRaw),
		StatusText: statusRaw,
	}, nil
}

func (s SystemdRuntimeService) Logs(ctx context.Context, service string, lines int) (SystemdLogsResult, error) {
	cmd := fmt.Sprintf("journalctl -u %s -n %d --no-pager --output=short-iso", service, lines)
	raw, err := s.run(ctx, cmd, 25*time.Second)
	if err != nil {
		return SystemdLogsResult{}, err
	}

	entries := make([]string, 0)
	for _, line := range strings.Split(raw, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		entries = append(entries, line)
	}

	return SystemdLogsResult{Lines: lines, Entries: entries, Raw: raw}, nil
}

func (s SystemdRuntimeService) Content(ctx context.Context, service string) (string, error) {
	cmd := fmt.Sprintf("systemctl cat %s --no-pager", service)
	return s.run(ctx, cmd, 20*time.Second)
}

func (s SystemdRuntimeService) ResolveUnitPath(ctx context.Context, service string) (string, error) {
	cmd := fmt.Sprintf("systemctl show %s --property=FragmentPath --value --no-pager", service)
	raw, err := s.run(ctx, cmd, 20*time.Second)
	if err != nil {
		return "", err
	}
	return ResolveSystemdUnitPath(raw)
}

func (s SystemdRuntimeService) Action(ctx context.Context, service, action string) (SystemdActionResult, error) {
	cmd := fmt.Sprintf("(sudo -n systemctl %s %s || systemctl %s %s)", action, service, action, service)
	output, err := s.run(ctx, cmd, 25*time.Second)
	if err != nil {
		return SystemdActionResult{Action: action, Output: output}, err
	}
	return SystemdActionResult{Action: action, Status: "accepted", Output: output}, nil
}

func (s SystemdRuntimeService) WriteUnit(ctx context.Context, service, content string) (SystemdUnitWriteResult, error) {
	if err := ValidateSystemdUnitContent(content); err != nil {
		return SystemdUnitWriteResult{}, err
	}
	path, err := s.ResolveUnitPath(ctx, service)
	if err != nil {
		return SystemdUnitWriteResult{}, err
	}
	encoded := base64.StdEncoding.EncodeToString([]byte(content))
	cmd := fmt.Sprintf("printf '%%s' '%s' | base64 -d | (sudo -n tee %s >/dev/null || tee %s >/dev/null)", encoded, terminal.ShellQuote(path), terminal.ShellQuote(path))
	output, err := s.run(ctx, cmd, 25*time.Second)
	if err != nil {
		return SystemdUnitWriteResult{Path: path, Output: output}, err
	}
	return SystemdUnitWriteResult{Path: path, Status: "saved", Output: output}, nil
}

func (s SystemdRuntimeService) VerifyUnit(ctx context.Context, service string) (SystemdUnitVerifyResult, error) {
	path, err := s.ResolveUnitPath(ctx, service)
	if err != nil {
		return SystemdUnitVerifyResult{}, err
	}
	cmd := fmt.Sprintf("(sudo -n systemd-analyze verify %s || systemd-analyze verify %s)", terminal.ShellQuote(path), terminal.ShellQuote(path))
	output, err := s.run(ctx, cmd, 25*time.Second)
	if err != nil {
		return SystemdUnitVerifyResult{Path: path, VerifyOutput: output}, err
	}
	return SystemdUnitVerifyResult{Path: path, Status: "valid", VerifyOutput: output}, nil
}

func (s SystemdRuntimeService) ApplyUnit(ctx context.Context, service string) (SystemdUnitApplyResult, error) {
	reloadCmd := "(sudo -n systemctl daemon-reload || systemctl daemon-reload)"
	reloadOutput, err := s.run(ctx, reloadCmd, 20*time.Second)
	if err != nil {
		return SystemdUnitApplyResult{ReloadOutput: reloadOutput}, err
	}
	applyCmd := fmt.Sprintf("(sudo -n systemctl try-restart %s || systemctl try-restart %s)", service, service)
	applyOutput, err := s.run(ctx, applyCmd, 25*time.Second)
	if err != nil {
		return SystemdUnitApplyResult{ReloadOutput: reloadOutput, ApplyOutput: applyOutput}, err
	}
	return SystemdUnitApplyResult{Status: "applied", ReloadOutput: reloadOutput, ApplyOutput: applyOutput}, nil
}

func ValidateSystemdUnitContent(content string) error {
	if strings.TrimSpace(content) == "" {
		return fmt.Errorf("content required")
	}
	if len(content) > MaxSystemdUnitContentBytes {
		return fmt.Errorf("content too large (max 64KB)")
	}
	return nil
}

func (s SystemdRuntimeService) run(ctx context.Context, command string, timeout time.Duration) (string, error) {
	if s.Run == nil {
		return "", fmt.Errorf("systemd command runner is required")
	}
	return s.Run(ctx, command, timeout)
}