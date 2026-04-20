// Package readiness evaluates target readiness against a PreflightSpec.
// See the parent software package boundary.go for domain boundary documentation.
package readiness

import (
	"fmt"
	"strings"

	"github.com/websoft9/appos/backend/domain/software"
)

// EvaluateReadiness evaluates a PreflightSpec against a TargetInfo and a dependency readiness
// flag, and returns a fully populated TargetReadinessResult.
//
// Rules:
//   - OS check: if SupportedOS is non-empty, the target OS must appear in it (case-insensitive);
//     an empty SupportedOS list accepts any OS.
//   - Privilege check: only enforced when RequireRoot is true.
//   - Network check: only enforced when RequireNetwork is true.
//   - Dependency check: always evaluated; caller provides the dependency ready flag.
//
// The Issues field accumulates one operator-readable message per failing dimension.
func EvaluateReadiness(preflight software.PreflightSpec, target software.TargetInfo, dependencyReady bool) software.TargetReadinessResult {
	result := software.TargetReadinessResult{
		DependencyReady: dependencyReady,
	}
	var issues []string

	// OS check
	if len(preflight.SupportedOS) > 0 {
		supported := false
		for _, os := range preflight.SupportedOS {
			if strings.EqualFold(os, target.OS) {
				supported = true
				break
			}
		}
		result.OSSupported = supported
		if !supported {
			issues = append(issues, fmt.Sprintf("%s: OS %q is not supported; supported: %v",
				software.ReadinessIssueOSNotSupported, target.OS, preflight.SupportedOS))
		}
	} else {
		result.OSSupported = true
	}

	// Privilege check
	if preflight.RequireRoot {
		result.PrivilegeOK = target.HasRoot
		if !target.HasRoot {
			issues = append(issues, fmt.Sprintf("%s: root privilege is required but not available",
				software.ReadinessIssuePrivilegeRequired))
		}
	} else {
		result.PrivilegeOK = true
	}

	// Network check
	if preflight.RequireNetwork {
		result.NetworkOK = target.NetworkOK
		if !target.NetworkOK {
			issues = append(issues, fmt.Sprintf("%s: network access is required but not reachable",
				software.ReadinessIssueNetworkRequired))
		}
	} else {
		result.NetworkOK = true
	}

	// Dependency check
	if !dependencyReady {
		issues = append(issues, fmt.Sprintf("%s: a prerequisite capability is not yet available",
			software.ReadinessIssueDependencyMissing))
	}

	result.Issues = issues
	result.OK = result.OSSupported && result.PrivilegeOK && result.NetworkOK && result.DependencyReady
	return result
}
