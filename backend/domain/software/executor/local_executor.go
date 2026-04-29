package executor

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/software"
	swreadiness "github.com/websoft9/appos/backend/domain/software/readiness"
)

const (
	localDetectTimeout    = 5 * time.Second
	localVerifyTimeout    = 10 * time.Second
	localReinstallTimeout = 20 * time.Second
	localPreflightTimeout = 5 * time.Second
)

// LocalExecutor implements software.ComponentExecutor for AppOS-local components.
// Local components are read-mostly inventory entries; install and upgrade remain unsupported.
type LocalExecutor struct{}

func NewLocalExecutor(_ core.App) (*LocalExecutor, error) {
	return &LocalExecutor{}, nil
}

func (e *LocalExecutor) Detect(ctx context.Context, _ string, tpl software.ResolvedTemplate) (software.DetectionResult, error) {
	installed := false
	for _, hint := range tpl.Detect.InstalledHint {
		out, err := executeLocalCommand(ctx, hint, localDetectTimeout)
		if err == nil && strings.TrimSpace(out) != "" {
			installed = true
			break
		}
	}
	if !installed {
		return software.DetectionResult{InstalledState: software.InstalledStateNotInstalled, InstallSource: software.InstallSourceUnknown}, nil
	}
	if strings.TrimSpace(tpl.Detect.VersionCommand) == "" {
		return software.DetectionResult{InstalledState: software.InstalledStateInstalled, InstallSource: software.InstallSourceUnknown}, nil
	}
	versionOut, _ := executeLocalCommand(ctx, tpl.Detect.VersionCommand, localDetectTimeout)
	return software.DetectionResult{
		InstalledState:  software.InstalledStateInstalled,
		DetectedVersion: strings.TrimSpace(firstLine(versionOut)),
		InstallSource:   software.InstallSourceUnknown,
	}, nil
}

func (e *LocalExecutor) RunPreflight(_ context.Context, _ string, tpl software.ResolvedTemplate) (software.TargetReadinessResult, error) {
	target := software.TargetInfo{
		OS:             strings.ToLower(runtime.GOOS),
		HasRoot:        os.Geteuid() == 0,
		NetworkOK:      true,
		ServiceManager: "supervisor",
	}
	return swreadiness.EvaluateReadiness(tpl.Preflight, target, true), nil
}

func (e *LocalExecutor) Install(_ context.Context, _ string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return software.SoftwareComponentDetail{}, fmt.Errorf("component %s does not support install on local target", tpl.ComponentKey)
}

func (e *LocalExecutor) Upgrade(_ context.Context, _ string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return software.SoftwareComponentDetail{}, fmt.Errorf("component %s does not support upgrade on local target", tpl.ComponentKey)
}

func (e *LocalExecutor) Start(_ context.Context, _ string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return software.SoftwareComponentDetail{}, fmt.Errorf("component %s does not support start on local target", tpl.ComponentKey)
}

func (e *LocalExecutor) Stop(_ context.Context, _ string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return software.SoftwareComponentDetail{}, fmt.Errorf("component %s does not support stop on local target", tpl.ComponentKey)
}

func (e *LocalExecutor) Restart(_ context.Context, _ string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return software.SoftwareComponentDetail{}, fmt.Errorf("component %s does not support restart on local target", tpl.ComponentKey)
}

func (e *LocalExecutor) Uninstall(_ context.Context, _ string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return software.SoftwareComponentDetail{}, fmt.Errorf("component %s does not support uninstall on local target", tpl.ComponentKey)
}

func (e *LocalExecutor) Verify(ctx context.Context, _ string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	detection, _ := e.Detect(ctx, "", tpl)
	detail := software.SoftwareComponentDetail{}
	detail.ComponentKey = tpl.ComponentKey
	detail.TemplateKind = tpl.TemplateKind
	detail.InstalledState = detection.InstalledState
	detail.DetectedVersion = detection.DetectedVersion
	detail.InstallSource = detection.InstallSource
	detail.SourceEvidence = detection.SourceEvidence
	detail.ServiceName = tpl.Verify.ServiceName

	switch tpl.Verify.Strategy {
	case "supervisor":
		out, err := executeLocalCommand(ctx,
			fmt.Sprintf("supervisorctl status %s 2>/dev/null || true", shellQuoteLocal(tpl.Verify.ServiceName)),
			localVerifyTimeout,
		)
		if err != nil {
			detail.VerificationState = software.VerificationStateDegraded
			return detail, nil
		}
		fields := strings.Fields(strings.TrimSpace(out))
		if len(fields) >= 2 && strings.EqualFold(fields[1], "RUNNING") {
			detail.VerificationState = software.VerificationStateHealthy
		} else {
			detail.VerificationState = software.VerificationStateDegraded
		}
		return detail, nil
	case "detect":
		if detection.InstalledState == software.InstalledStateInstalled {
			detail.VerificationState = software.VerificationStateHealthy
		} else {
			detail.VerificationState = software.VerificationStateDegraded
		}
		return detail, nil
	default:
		return software.SoftwareComponentDetail{}, fmt.Errorf("unsupported verify strategy %q for local component %s", tpl.Verify.Strategy, tpl.ComponentKey)
	}
}

func (e *LocalExecutor) Reinstall(ctx context.Context, _ string, tpl software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	switch tpl.Reinstall.Strategy {
	case "supervisor-restart":
		if _, err := executeLocalCommand(ctx,
			fmt.Sprintf("supervisorctl restart %s", shellQuoteLocal(tpl.Verify.ServiceName)),
			localReinstallTimeout,
		); err != nil {
			return software.SoftwareComponentDetail{}, fmt.Errorf("restart local service %s: %w", tpl.Verify.ServiceName, err)
		}
		return e.Verify(ctx, "", tpl)
	case "":
		return software.SoftwareComponentDetail{}, fmt.Errorf("component %s does not support reinstall on local target", tpl.ComponentKey)
	default:
		return software.SoftwareComponentDetail{}, fmt.Errorf("unsupported reinstall strategy %q for local component %s", tpl.Reinstall.Strategy, tpl.ComponentKey)
	}
}

func executeLocalCommand(ctx context.Context, command string, timeout time.Duration) (string, error) {
	cmdCtx := ctx
	var cancel context.CancelFunc
	if timeout > 0 {
		cmdCtx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}
	cmd := exec.CommandContext(cmdCtx, "sh", "-c", command)
	out, err := cmd.CombinedOutput()
	trimmed := strings.TrimSpace(string(out))
	if err != nil {
		if trimmed != "" {
			return string(out), fmt.Errorf("%w: %s", err, trimmed)
		}
		return string(out), err
	}
	return string(out), nil
}

func shellQuoteLocal(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}
