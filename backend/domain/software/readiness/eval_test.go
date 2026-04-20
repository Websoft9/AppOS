package readiness_test

import (
	"testing"

	"github.com/websoft9/appos/backend/domain/software"
	"github.com/websoft9/appos/backend/domain/software/readiness"
)

// TestReadinessIssueCodeConstants verifies all four readiness issue codes are defined.
func TestReadinessIssueCodeConstants(t *testing.T) {
	codes := []software.ReadinessIssueCode{
		software.ReadinessIssueOSNotSupported,
		software.ReadinessIssuePrivilegeRequired,
		software.ReadinessIssueNetworkRequired,
		software.ReadinessIssueDependencyMissing,
	}
	for _, code := range codes {
		if code == "" {
			t.Error("ReadinessIssueCode constant must not be empty")
		}
	}
}

// TestEvaluateReadiness_AllClear verifies that when all conditions are met, OK=true and no issues.
func TestEvaluateReadiness_AllClear(t *testing.T) {
	preflight := software.PreflightSpec{
		RequireRoot:    true,
		RequireNetwork: true,
		SupportedOS:    []string{"ubuntu", "debian"},
	}
	target := software.TargetInfo{
		OS:        "ubuntu",
		HasRoot:   true,
		NetworkOK: true,
	}
	result := readiness.EvaluateReadiness(preflight, target, true)

	if !result.OK {
		t.Error("expected OK=true when all conditions are met")
	}
	if !result.OSSupported {
		t.Error("expected OSSupported=true for ubuntu")
	}
	if !result.PrivilegeOK {
		t.Error("expected PrivilegeOK=true")
	}
	if !result.NetworkOK {
		t.Error("expected NetworkOK=true")
	}
	if !result.DependencyReady {
		t.Error("expected DependencyReady=true")
	}
	if len(result.Issues) != 0 {
		t.Errorf("expected no issues, got %v", result.Issues)
	}
}

// TestEvaluateReadiness_OSNotSupported verifies that an unsupported OS produces an issue.
func TestEvaluateReadiness_OSNotSupported(t *testing.T) {
	preflight := software.PreflightSpec{
		SupportedOS: []string{"ubuntu", "debian"},
	}
	target := software.TargetInfo{OS: "windows"}
	result := readiness.EvaluateReadiness(preflight, target, true)

	if result.OK {
		t.Error("expected OK=false for unsupported OS")
	}
	if result.OSSupported {
		t.Error("expected OSSupported=false for windows")
	}
	if len(result.Issues) == 0 {
		t.Error("expected at least one issue for unsupported OS")
	}
}

// TestEvaluateReadiness_OSCaseInsensitive verifies that OS matching is case-insensitive.
func TestEvaluateReadiness_OSCaseInsensitive(t *testing.T) {
	preflight := software.PreflightSpec{
		SupportedOS: []string{"Ubuntu"},
	}
	target := software.TargetInfo{OS: "ubuntu", HasRoot: true, NetworkOK: true}
	result := readiness.EvaluateReadiness(preflight, target, true)

	if !result.OSSupported {
		t.Error("expected OSSupported=true when case differs")
	}
}

// TestEvaluateReadiness_EmptyOSSupportedListAcceptsAny verifies that when SupportedOS is
// empty (no restriction), any OS is accepted.
func TestEvaluateReadiness_EmptyOSSupportedListAcceptsAny(t *testing.T) {
	preflight := software.PreflightSpec{
		SupportedOS: []string{},
	}
	target := software.TargetInfo{OS: "arch", HasRoot: true, NetworkOK: true}
	result := readiness.EvaluateReadiness(preflight, target, true)

	if !result.OSSupported {
		t.Error("expected OSSupported=true when SupportedOS is empty")
	}
}

// TestEvaluateReadiness_PrivilegeRequired verifies that missing root produces an issue.
func TestEvaluateReadiness_PrivilegeRequired(t *testing.T) {
	preflight := software.PreflightSpec{
		RequireRoot: true,
		SupportedOS: []string{"ubuntu"},
	}
	target := software.TargetInfo{OS: "ubuntu", HasRoot: false, NetworkOK: true}
	result := readiness.EvaluateReadiness(preflight, target, true)

	if result.OK {
		t.Error("expected OK=false when root is missing")
	}
	if result.PrivilegeOK {
		t.Error("expected PrivilegeOK=false when HasRoot=false")
	}
	if len(result.Issues) == 0 {
		t.Error("expected at least one issue for missing privilege")
	}
}

// TestEvaluateReadiness_NetworkRequired verifies that missing network produces an issue.
func TestEvaluateReadiness_NetworkRequired(t *testing.T) {
	preflight := software.PreflightSpec{
		RequireNetwork: true,
		SupportedOS:    []string{"ubuntu"},
	}
	target := software.TargetInfo{OS: "ubuntu", HasRoot: true, NetworkOK: false}
	result := readiness.EvaluateReadiness(preflight, target, true)

	if result.OK {
		t.Error("expected OK=false when network is unavailable")
	}
	if result.NetworkOK {
		t.Error("expected NetworkOK=false when NetworkOK=false")
	}
}

// TestEvaluateReadiness_DependencyNotReady verifies that a missing dependency produces an issue.
func TestEvaluateReadiness_DependencyNotReady(t *testing.T) {
	preflight := software.PreflightSpec{
		SupportedOS: []string{"ubuntu"},
	}
	target := software.TargetInfo{OS: "ubuntu", HasRoot: true, NetworkOK: true}
	result := readiness.EvaluateReadiness(preflight, target, false)

	if result.OK {
		t.Error("expected OK=false when dependency is not ready")
	}
	if result.DependencyReady {
		t.Error("expected DependencyReady=false")
	}
	if len(result.Issues) == 0 {
		t.Error("expected at least one issue for missing dependency")
	}
}

// TestEvaluateReadiness_MultipleIssues verifies that multiple failures accumulate into issues.
func TestEvaluateReadiness_MultipleIssues(t *testing.T) {
	preflight := software.PreflightSpec{
		RequireRoot:    true,
		RequireNetwork: true,
		SupportedOS:    []string{"ubuntu"},
	}
	target := software.TargetInfo{OS: "centos", HasRoot: false, NetworkOK: false}
	result := readiness.EvaluateReadiness(preflight, target, false)

	if result.OK {
		t.Error("expected OK=false for multiple failures")
	}
	if len(result.Issues) < 4 {
		t.Errorf("expected at least 4 issues (os, privilege, network, dependency), got %d: %v", len(result.Issues), result.Issues)
	}
}

// TestEvaluateReadiness_NoRootRequiredPassesWithoutRoot verifies that when RequireRoot=false,
// PrivilegeOK is true regardless of HasRoot.
func TestEvaluateReadiness_NoRootRequiredPassesWithoutRoot(t *testing.T) {
	preflight := software.PreflightSpec{
		RequireRoot: false,
		SupportedOS: []string{"ubuntu"},
	}
	target := software.TargetInfo{OS: "ubuntu", HasRoot: false, NetworkOK: true}
	result := readiness.EvaluateReadiness(preflight, target, true)

	if !result.PrivilegeOK {
		t.Error("expected PrivilegeOK=true when RequireRoot=false")
	}
	if !result.OK {
		t.Error("expected OK=true when no root is required")
	}
}
