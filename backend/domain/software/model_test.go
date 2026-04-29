package software

import (
	"context"
	"encoding/json"
	"testing"
)

// ── Constant value tests ──────────────────────────────────────────────────────

func TestTargetTypeConstants(t *testing.T) {
	cases := []struct {
		got  TargetType
		want string
	}{
		{TargetTypeLocal, "local"},
		{TargetTypeServer, "server"},
	}
	for _, c := range cases {
		if string(c.got) != c.want {
			t.Errorf("TargetType: got %q, want %q", c.got, c.want)
		}
	}
}

func TestComponentKeyConstants(t *testing.T) {
	cases := []struct {
		got  ComponentKey
		want string
	}{
		// Only server-target keys are constants; local keys live in catalog YAML.
		{ComponentKeyDocker, "docker"},
		{ComponentKeyMonitorAgent, "monitor-agent"},
		{ComponentKeyAppOSAgent, "appos-agent"},
		{ComponentKeyReverseProxy, "reverse-proxy"},
	}
	for _, c := range cases {
		if string(c.got) != c.want {
			t.Errorf("ComponentKey: got %q, want %q", c.got, c.want)
		}
	}
}

func TestComponentKeyReservedRouteKeys(t *testing.T) {
	cases := []struct {
		key  ComponentKey
		want bool
	}{
		{ComponentKey("operations"), true},
		{ComponentKey("capabilities"), true},
		{ComponentKey("Operations"), true},
		{ComponentKeyDocker, false},
		{ComponentKey("custom-agent"), false},
	}
	for _, c := range cases {
		if got := c.key.IsReservedRouteKey(); got != c.want {
			t.Errorf("ComponentKey(%q).IsReservedRouteKey() = %v, want %v", c.key, got, c.want)
		}
	}
}

func TestCapabilityConstants(t *testing.T) {
	cases := []struct {
		got  Capability
		want string
	}{
		{CapabilityContainerRuntime, "container_runtime"},
		{CapabilityMonitorAgent, "monitor_agent"},
		{CapabilityControlPlane, "control_plane"},
		{CapabilityReverseProxy, "reverse_proxy"},
	}
	for _, c := range cases {
		if string(c.got) != c.want {
			t.Errorf("Capability: got %q, want %q", c.got, c.want)
		}
	}
}

func TestInstalledStateConstants(t *testing.T) {
	cases := []struct {
		got  InstalledState
		want string
	}{
		{InstalledStateInstalled, "installed"},
		{InstalledStateNotInstalled, "not_installed"},
		{InstalledStateUnknown, "unknown"},
	}
	for _, c := range cases {
		if string(c.got) != c.want {
			t.Errorf("InstalledState: got %q, want %q", c.got, c.want)
		}
	}
}

func TestVerificationStateConstants(t *testing.T) {
	cases := []struct {
		got  VerificationState
		want string
	}{
		{VerificationStateHealthy, "healthy"},
		{VerificationStateDegraded, "degraded"},
		{VerificationStateUnknown, "unknown"},
	}
	for _, c := range cases {
		if string(c.got) != c.want {
			t.Errorf("VerificationState: got %q, want %q", c.got, c.want)
		}
	}
}

func TestActionConstants(t *testing.T) {
	cases := []struct {
		got  Action
		want string
	}{
		{ActionInstall, "install"},
		{ActionUpgrade, "upgrade"},
		{ActionStart, "start"},
		{ActionStop, "stop"},
		{ActionRestart, "restart"},
		{ActionVerify, "verify"},
		{ActionReinstall, "reinstall"},
		{ActionUninstall, "uninstall"},
	}
	for _, c := range cases {
		if string(c.got) != c.want {
			t.Errorf("Action: got %q, want %q", c.got, c.want)
		}
	}
}

func TestOperationPhaseConstants(t *testing.T) {
	cases := []struct {
		got  OperationPhase
		want string
	}{
		{OperationPhaseAccepted, "accepted"},
		{OperationPhasePreflight, "preflight"},
		{OperationPhaseExecuting, "executing"},
		{OperationPhaseVerifying, "verifying"},
		{OperationPhaseSucceeded, "succeeded"},
		{OperationPhaseFailed, "failed"},
		{OperationPhaseAttentionRequired, "attention_required"},
	}
	for _, c := range cases {
		if string(c.got) != c.want {
			t.Errorf("OperationPhase: got %q, want %q", c.got, c.want)
		}
	}
}

func TestTerminalStatusConstants(t *testing.T) {
	cases := []struct {
		got  TerminalStatus
		want string
	}{
		{TerminalStatusNone, "none"},
		{TerminalStatusSuccess, "success"},
		{TerminalStatusFailed, "failed"},
		{TerminalStatusAttentionRequired, "attention_required"},
	}
	for _, c := range cases {
		if string(c.got) != c.want {
			t.Errorf("TerminalStatus: got %q, want %q", c.got, c.want)
		}
	}
}

func TestFailureCodeConstants(t *testing.T) {
	cases := []struct {
		got  FailureCode
		want string
	}{
		{FailureCodeEnqueueError, "enqueue_error"},
		{FailureCodePreflightError, "preflight_error"},
		{FailureCodePreflightBlocked, "preflight_blocked"},
		{FailureCodeExecutionError, "execution_error"},
		{FailureCodeVerificationDegraded, "verification_degraded"},
		{FailureCodeVerificationError, "verification_error"},
		{FailureCodeUninstallTruthMismatch, "uninstall_truth_mismatch"},
	}
	for _, c := range cases {
		if string(c.got) != c.want {
			t.Errorf("FailureCode: got %q, want %q", c.got, c.want)
		}
	}
}

func TestAuditActionConstants(t *testing.T) {
	cases := []struct {
		name string
		got  string
		want string
	}{
		{"Install", AuditActionInstall, "server.software.install"},
		{"Upgrade", AuditActionUpgrade, "server.software.upgrade"},
		{"Start", AuditActionStart, "server.software.start"},
		{"Stop", AuditActionStop, "server.software.stop"},
		{"Restart", AuditActionRestart, "server.software.restart"},
		{"Verify", AuditActionVerify, "server.software.verify"},
		{"Reinstall", AuditActionReinstall, "server.software.reinstall"},
		{"Uninstall", AuditActionUninstall, "server.software.uninstall"},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("AuditAction%s: got %q, want %q", c.name, c.got, c.want)
		}
	}
}

// ── JSON marshaling tests ─────────────────────────────────────────────────────

func TestSoftwareComponentSummaryJSON(t *testing.T) {
	s := SoftwareComponentSummary{
		ComponentKey:      ComponentKeyDocker,
		Label:             "Docker",
		TemplateKind:      TemplateKindPackage,
		InstalledState:    InstalledStateInstalled,
		DetectedVersion:   "26.1.4",
		InstallSource:     InstallSourceManaged,
		SourceEvidence:    "apt:docker-ce",
		PackagedVersion:   "26.1.4",
		VerificationState: VerificationStateHealthy,
		AvailableActions:  []Action{ActionUpgrade, ActionVerify},
		LastAction: &SoftwareDeliveryLastAction{
			Action: "verify",
			Result: "success",
			At:     "2026-04-15T08:00:00Z",
		},
	}

	data, err := json.Marshal(s)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}

	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	mustHaveKey := func(key string) {
		t.Helper()
		if _, ok := m[key]; !ok {
			t.Errorf("missing JSON key %q in SoftwareComponentSummary", key)
		}
	}
	mustHaveKey("component_key")
	mustHaveKey("label")
	mustHaveKey("template_kind")
	mustHaveKey("installed_state")
	mustHaveKey("detected_version")
	mustHaveKey("install_source")
	mustHaveKey("source_evidence")
	mustHaveKey("packaged_version")
	mustHaveKey("verification_state")
	mustHaveKey("available_actions")
	mustHaveKey("last_action")

	if m["component_key"] != "docker" {
		t.Errorf("component_key: got %v, want docker", m["component_key"])
	}
	if m["installed_state"] != "installed" {
		t.Errorf("installed_state: got %v, want installed", m["installed_state"])
	}
}

func TestTargetReadinessResultJSON(t *testing.T) {
	r := TargetReadinessResult{
		OK:               true,
		OSSupported:      true,
		PrivilegeOK:      true,
		NetworkOK:        true,
		DependencyReady:  true,
		ServiceManagerOK: true,
		PackageManagerOK: true,
		Issues:           nil,
	}

	data, err := json.Marshal(r)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}

	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	for _, key := range []string{"ok", "os_supported", "privilege_ok", "network_ok", "dependency_ready", "service_manager_ok", "package_manager_ok"} {
		if _, ok := m[key]; !ok {
			t.Errorf("missing JSON key %q in TargetReadinessResult", key)
		}
	}

	if m["dependency_ready"] != true {
		t.Errorf("dependency_ready: got %v, want true", m["dependency_ready"])
	}
}

func TestSoftwareDeliveryOperationJSON(t *testing.T) {
	op := SoftwareDeliveryOperation{
		OperationID:    "op-123",
		ServerID:       "srv-abc",
		Capability:     CapabilityContainerRuntime,
		ComponentKey:   ComponentKeyDocker,
		Action:         ActionInstall,
		Phase:          OperationPhaseAccepted,
		TerminalStatus: TerminalStatusNone,
		FailurePhase:   OperationPhaseVerifying,
		FailureCode:    FailureCodeVerificationDegraded,
		CreatedAt:      "2026-04-20T00:00:00Z",
		UpdatedAt:      "2026-04-20T00:00:00Z",
	}

	data, err := json.Marshal(op)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}

	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	for _, key := range []string{
		"operation_id", "server_id", "capability", "component_key",
		"action", "phase", "terminal_status", "failure_phase", "failure_code", "created_at", "updated_at",
	} {
		if _, ok := m[key]; !ok {
			t.Errorf("missing JSON key %q in SoftwareDeliveryOperation", key)
		}
	}

	if m["phase"] != "accepted" {
		t.Errorf("phase: got %v, want accepted", m["phase"])
	}
	if m["failure_phase"] != "verifying" {
		t.Errorf("failure_phase: got %v, want verifying", m["failure_phase"])
	}
	if m["failure_code"] != "verification_degraded" {
		t.Errorf("failure_code: got %v, want verification_degraded", m["failure_code"])
	}
}

func TestAsyncCommandResponseJSON(t *testing.T) {
	r := AsyncCommandResponse{
		Accepted:    true,
		OperationID: "op-456",
		Phase:       OperationPhaseAccepted,
		Message:     "queued",
	}

	data, err := json.Marshal(r)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}

	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	if m["accepted"] != true {
		t.Errorf("accepted: got %v, want true", m["accepted"])
	}
	if m["operation_id"] != "op-456" {
		t.Errorf("operation_id: got %v, want op-456", m["operation_id"])
	}
}

// ── Event constant tests ──────────────────────────────────────────────────────

func TestEventConstants(t *testing.T) {
	cases := []struct {
		got  string
		want string
	}{
		{EventSoftwareCapabilityReady, "software.capability.ready"},
		{EventSoftwareCapabilityDegraded, "software.capability.degraded"},
		{EventSoftwareActionSucceeded, "software.action.succeeded"},
		{EventSoftwareActionFailed, "software.action.failed"},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("Event constant: got %q, want %q", c.got, c.want)
		}
	}
}

func TestReadinessIssueCodeConstants(t *testing.T) {
	cases := []struct {
		got  ReadinessIssueCode
		want string
	}{
		{ReadinessIssueOSNotSupported, "os_not_supported"},
		{ReadinessIssuePrivilegeRequired, "privilege_required"},
		{ReadinessIssueNetworkRequired, "network_required"},
		{ReadinessIssueDependencyMissing, "dependency_missing"},
		{ReadinessIssueServiceManagerMissing, "service_manager_missing"},
		{ReadinessIssuePackageManagerMissing, "package_manager_missing"},
	}
	for _, c := range cases {
		if string(c.got) != c.want {
			t.Errorf("ReadinessIssueCode: got %q, want %q", c.got, c.want)
		}
	}
}

// ── Interface compilation tests ───────────────────────────────────────────────
// These ensure the interfaces are valid Go - if they compile, the test passes.

// mockQuerier is a compile-time check that CapabilityQuerier can be implemented.
type mockQuerier struct{}

func (mockQuerier) ListCapabilities(_ context.Context, _ string) ([]CapabilityStatus, error) {
	return nil, nil
}
func (mockQuerier) GetCapabilityStatus(_ context.Context, _ string, _ Capability) (CapabilityStatus, error) {
	return CapabilityStatus{}, nil
}
func (mockQuerier) IsCapabilityReady(_ context.Context, _ string, _ Capability) (bool, error) {
	return false, nil
}

// mockCommander is a compile-time check that CapabilityCommander can be implemented.
type mockCommander struct{}

func (mockCommander) EnsureCapability(_ context.Context, _ string, _ Capability) (AsyncCommandResponse, error) {
	return AsyncCommandResponse{}, nil
}
func (mockCommander) UpgradeCapability(_ context.Context, _ string, _ Capability) (AsyncCommandResponse, error) {
	return AsyncCommandResponse{}, nil
}
func (mockCommander) VerifyCapability(_ context.Context, _ string, _ Capability) (AsyncCommandResponse, error) {
	return AsyncCommandResponse{}, nil
}

// TestCapabilityQuerierInterface verifies the interface contract is satisfiable.
func TestCapabilityQuerierInterface(t *testing.T) {
	var _ CapabilityQuerier = mockQuerier{}
}

// TestCapabilityCommanderInterface verifies the interface contract is satisfiable.
func TestCapabilityCommanderInterface(t *testing.T) {
	var _ CapabilityCommander = mockCommander{}
}
