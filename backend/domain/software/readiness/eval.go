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
//   - OS check: if VerifiedOS is non-empty, the target OS is compared against that verified
//     baseline (case-insensitive); an unmatched OS is flagged but does not by itself block OK.
//   - Privilege check: only enforced when RequireRoot is true.
//   - Network check: only enforced when RequireNetwork is true.
//   - Service manager and package manager checks are enforced when declared.
//   - Dependency check: always evaluated; caller provides the dependency ready flag.
//
// The Issues field accumulates one operator-readable message per failing dimension.
func EvaluateReadiness(preflight software.PreflightSpec, target software.TargetInfo, dependencyReady bool) software.TargetReadinessResult {
	result := software.TargetReadinessResult{
		DependencyReady:  dependencyReady,
		ServiceManagerOK: true,
		PackageManagerOK: true,
	}
	var issues []string

	// OS verified-baseline check
	if len(preflight.VerifiedOS) > 0 {
		supported := false
		for _, os := range preflight.VerifiedOS {
			if strings.EqualFold(os, target.OS) {
				supported = true
				break
			}
		}
		result.OSSupported = supported
		if !supported {
			issues = append(issues, fmt.Sprintf("%s: OS %q is outside the verified baseline %v",
				software.ReadinessIssueOSNotSupported, target.OS, preflight.VerifiedOS))
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

	// Service manager check
	if strings.TrimSpace(preflight.ServiceManager) != "" {
		result.ServiceManagerOK = strings.EqualFold(preflight.ServiceManager, target.ServiceManager)
		if !result.ServiceManagerOK {
			issues = append(issues, fmt.Sprintf("%s: required service manager %q is not available",
				software.ReadinessIssueServiceManagerMissing, preflight.ServiceManager))
		}
	}

	// Package manager check
	if strings.TrimSpace(preflight.PackageManager) != "" {
		if strings.EqualFold(preflight.PackageManager, "native") {
			result.PackageManagerOK = target.PackageManager != ""
		} else {
			result.PackageManagerOK = strings.EqualFold(preflight.PackageManager, target.PackageManager)
		}
		if !result.PackageManagerOK {
			issues = append(issues, fmt.Sprintf("%s: required package manager %q is not available",
				software.ReadinessIssuePackageManagerMissing, preflight.PackageManager))
		}
	}

	// Dependency check
	if !dependencyReady {
		issues = append(issues, fmt.Sprintf("%s: a prerequisite capability is not yet available",
			software.ReadinessIssueDependencyMissing))
	}

	result.Issues = issues
	result.OK = result.PrivilegeOK && result.DependencyReady && result.ServiceManagerOK && result.PackageManagerOK
	return result
}
