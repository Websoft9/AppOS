package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/software"
)

type fakeSoftwareExecutor struct {
	preflightCalled bool
	preflight       software.TargetReadinessResult
	preflightErr    error
	verifyCalled    int
	installDetail   software.SoftwareComponentDetail
	installErr      error
	startErr        error
	stopErr         error
	restartErr      error
	verifyDetail    software.SoftwareComponentDetail
	verifyErr       error
	uninstallDetail software.SoftwareComponentDetail
	uninstallErr    error
	detectState     software.InstalledState
	detectVersion   string
	detectErr       error
}

func (f *fakeSoftwareExecutor) Detect(context.Context, string, software.ResolvedTemplate) (software.InstalledState, string, error) {
	if f.detectState != "" || f.detectVersion != "" || f.detectErr != nil {
		return f.detectState, f.detectVersion, f.detectErr
	}
	return software.InstalledStateInstalled, "1.0.0", nil
}

func (f *fakeSoftwareExecutor) RunPreflight(context.Context, string, software.ResolvedTemplate) (software.TargetReadinessResult, error) {
	f.preflightCalled = true
	return f.preflight, f.preflightErr
}

func (f *fakeSoftwareExecutor) Install(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return f.installDetail, f.installErr
}

func (f *fakeSoftwareExecutor) Upgrade(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return f.installDetail, f.installErr
}

func (f *fakeSoftwareExecutor) Start(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return f.installDetail, f.startErr
}

func (f *fakeSoftwareExecutor) Stop(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return f.installDetail, f.stopErr
}

func (f *fakeSoftwareExecutor) Restart(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return f.installDetail, f.restartErr
}

func (f *fakeSoftwareExecutor) Uninstall(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return f.uninstallDetail, f.uninstallErr
}

func (f *fakeSoftwareExecutor) Verify(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	f.verifyCalled++
	if f.verifyDetail.VerificationState != "" || f.verifyErr != nil || f.verifyDetail.DetectedVersion != "" || f.verifyDetail.InstalledState != "" {
		return f.verifyDetail, f.verifyErr
	}
	return f.installDetail, f.installErr
}

func (f *fakeSoftwareExecutor) Reinstall(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return f.installDetail, f.installErr
}

// TestSoftwareTaskTypeValues verifies that the software delivery task type constants
// use the expected values so that Asynq queue entries are human-readable.
func TestSoftwareTaskTypeValues(t *testing.T) {
	cases := []struct {
		constant string
		expected string
	}{
		{TaskSoftwareInstall, "software:install"},
		{TaskSoftwareUpgrade, "software:upgrade"},
		{TaskSoftwareStart, "software:start"},
		{TaskSoftwareStop, "software:stop"},
		{TaskSoftwareRestart, "software:restart"},
		{TaskSoftwareVerify, "software:verify"},
		{TaskSoftwareReinstall, "software:reinstall"},
		{TaskSoftwareUninstall, "software:uninstall"},
	}
	for _, tc := range cases {
		if tc.constant != tc.expected {
			t.Errorf("expected task type %q, got %q", tc.expected, tc.constant)
		}
	}
}

// TestNewSoftwareActionTask_ReturnsTask verifies that NewSoftwareActionTask creates an
// Asynq task with the correct type and a parseable payload.
func TestNewSoftwareActionTask_ReturnsTask(t *testing.T) {
	task, err := NewSoftwareActionTask("op-1", "srv-1", software.ComponentKeyDocker, software.ActionInstall, "u1", "u1@test.com")
	if err != nil {
		t.Fatalf("NewSoftwareActionTask: %v", err)
	}
	if task.Type() != TaskSoftwareInstall {
		t.Errorf("expected task type %q, got %q", TaskSoftwareInstall, task.Type())
	}
	var payload SoftwareActionPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		t.Fatalf("payload unmarshal: %v", err)
	}
	if payload.ServerID != "srv-1" {
		t.Errorf("expected ServerID=srv-1, got %q", payload.ServerID)
	}
	if payload.OperationID != "op-1" {
		t.Errorf("expected OperationID=op-1, got %q", payload.OperationID)
	}
	if payload.ComponentKey != software.ComponentKeyDocker {
		t.Errorf("expected ComponentKey=docker, got %q", payload.ComponentKey)
	}
	if payload.Action != software.ActionInstall {
		t.Errorf("expected Action=install, got %q", payload.Action)
	}
}

// TestNewSoftwareActionTask_ValidatesOperationID verifies that an empty operation_id is rejected.
func TestNewSoftwareActionTask_ValidatesOperationID(t *testing.T) {
	_, err := NewSoftwareActionTask("", "srv-1", software.ComponentKeyDocker, software.ActionInstall, "u1", "u1@test.com")
	if err == nil {
		t.Error("expected error for empty operation_id")
	}
}

// TestNewSoftwareActionTask_ValidatesServerID verifies that an empty server_id is rejected.
func TestNewSoftwareActionTask_ValidatesServerID(t *testing.T) {
	_, err := NewSoftwareActionTask("op-1", "", software.ComponentKeyDocker, software.ActionInstall, "u1", "u1@test.com")
	if err == nil {
		t.Error("expected error for empty server_id")
	}
}

// TestNewSoftwareActionTask_ValidatesComponentKey verifies that an empty component_key is rejected.
func TestNewSoftwareActionTask_ValidatesComponentKey(t *testing.T) {
	_, err := NewSoftwareActionTask("op-1", "srv-1", "", software.ActionInstall, "u1", "u1@test.com")
	if err == nil {
		t.Error("expected error for empty component_key")
	}
}

// TestNewSoftwareActionTask_ValidatesAction verifies that an empty action is rejected.
func TestNewSoftwareActionTask_ValidatesAction(t *testing.T) {
	_, err := NewSoftwareActionTask("op-1", "srv-1", software.ComponentKeyDocker, "", "u1", "u1@test.com")
	if err == nil {
		t.Error("expected error for empty action")
	}
}

// TestEnqueueSoftwareAction_RequiresNonNilClient verifies that EnqueueSoftwareAction returns
// an error when passed a nil Asynq client.
func TestEnqueueSoftwareAction_RequiresNonNilClient(t *testing.T) {
	err := EnqueueSoftwareAction(nil, "op-1", "srv-1", software.ComponentKeyDocker, software.ActionInstall, "u1", "u1@test.com")
	if err == nil {
		t.Error("expected error when asynq client is nil")
	}
}

// TestSoftwarePhaseIsForward verifies that isSoftwarePhaseForward correctly identifies
// valid forward phase transitions.
func TestSoftwarePhaseIsForward(t *testing.T) {
	cases := []struct {
		current software.OperationPhase
		next    software.OperationPhase
		want    bool
	}{
		{software.OperationPhaseAccepted, software.OperationPhasePreflight, true},
		{software.OperationPhasePreflight, software.OperationPhaseExecuting, true},
		{software.OperationPhaseExecuting, software.OperationPhaseVerifying, true},
		{software.OperationPhaseVerifying, software.OperationPhaseSucceeded, true},
		{software.OperationPhaseVerifying, software.OperationPhaseFailed, true},
		{software.OperationPhasePreflight, software.OperationPhaseFailed, true},
		// Backward or same-level transitions
		{software.OperationPhaseExecuting, software.OperationPhaseAccepted, false},
		{software.OperationPhaseSucceeded, software.OperationPhaseVerifying, false},
		{software.OperationPhaseAccepted, software.OperationPhaseAccepted, false},
	}
	for _, tc := range cases {
		got := isSoftwarePhaseForward(tc.current, tc.next)
		if got != tc.want {
			t.Errorf("isSoftwarePhaseForward(%q, %q) = %v, want %v", tc.current, tc.next, got, tc.want)
		}
	}
}

// TestSoftwareActionPayloadRoundTrip verifies that SoftwareActionPayload serializes and
// deserializes all fields correctly.
func TestSoftwareActionPayloadRoundTrip(t *testing.T) {
	original := SoftwareActionPayload{
		OperationID:  "op-1",
		ServerID:     "srv-1",
		ComponentKey: software.ComponentKeyMonitorAgent,
		Action:       software.ActionVerify,
		UserID:       "user-1",
		UserEmail:    "user@example.com",
	}
	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded SoftwareActionPayload
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.ServerID != original.ServerID {
		t.Errorf("ServerID mismatch: %q vs %q", decoded.ServerID, original.ServerID)
	}
	if decoded.OperationID != original.OperationID {
		t.Errorf("OperationID mismatch: %q vs %q", decoded.OperationID, original.OperationID)
	}
	if decoded.ComponentKey != original.ComponentKey {
		t.Errorf("ComponentKey mismatch: %q vs %q", decoded.ComponentKey, original.ComponentKey)
	}
	if decoded.Action != original.Action {
		t.Errorf("Action mismatch: %q vs %q", decoded.Action, original.Action)
	}
}

func TestRunSoftwarePhaseLoopUsesExecutorPreflightAndAuditsTerminalFailure(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	oldFactory := softwareExecutorFactory
	defer func() { softwareExecutorFactory = oldFactory }()

	fakeExecutor := &fakeSoftwareExecutor{
		preflight: software.TargetReadinessResult{
			OK:              false,
			OSSupported:     true,
			PrivilegeOK:     false,
			NetworkOK:       true,
			DependencyReady: true,
			Issues:          []string{"privilege_required: root missing"},
		},
	}
	softwareExecutorFactory = func(app core.App, serverID, userID string) (software.ComponentExecutor, error) {
		return fakeExecutor, nil
	}

	w := &Worker{app: app}
	record, err := createSoftwareOperationRecord(app, SoftwareActionPayload{
		ServerID:     "srv-1",
		ComponentKey: software.ComponentKeyDocker,
		Action:       software.ActionInstall,
	})
	if err != nil {
		t.Fatal(err)
	}
	payload := SoftwareActionPayload{
		OperationID:  record.Id,
		ServerID:     "srv-1",
		ComponentKey: software.ComponentKeyDocker,
		Action:       software.ActionInstall,
		UserID:       "user-1",
		UserEmail:    "user@example.com",
	}

	w.runSoftwarePhaseLoop(context.Background(), record, payload)

	if !fakeExecutor.preflightCalled {
		t.Fatal("expected runSoftwarePhaseLoop to invoke executor.RunPreflight")
	}
	updated, err := app.FindRecordById("software_operations", record.Id)
	if err != nil {
		t.Fatal(err)
	}
	if updated.GetString("phase") != string(software.OperationPhaseFailed) {
		t.Fatalf("expected failed phase, got %q", updated.GetString("phase"))
	}
	if updated.GetString("terminal_status") != string(software.TerminalStatusFailed) {
		t.Fatalf("expected failed terminal_status, got %q", updated.GetString("terminal_status"))
	}
	if updated.GetString("failure_phase") != string(software.OperationPhasePreflight) {
		t.Fatalf("expected preflight failure_phase, got %q", updated.GetString("failure_phase"))
	}
	if updated.GetString("failure_code") != string(software.FailureCodePreflightBlocked) {
		t.Fatalf("expected preflight_blocked failure_code, got %q", updated.GetString("failure_code"))
	}
	audits, err := app.FindRecordsByFilter("audit_logs", "action = 'server.software.install'", "-created", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(audits) != 1 {
		t.Fatalf("expected one audit record, got %d", len(audits))
	}
	if audits[0].GetString("status") != "failed" {
		t.Fatalf("expected failed audit status, got %q", audits[0].GetString("status"))
	}
	snapshots, err := app.FindRecordsByFilter("software_inventory_snapshots", "target_id = 'srv-1' && component_key = 'docker'", "", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshots) != 1 {
		t.Fatalf("expected one snapshot record after terminal failure, got %d", len(snapshots))
	}
	lastAction := decodeWorkerJSONObject(t, snapshots[0].Get("last_action_json"))
	if lastAction["result"] != "failed" {
		t.Fatalf("expected failed snapshot action result, got %#v", lastAction)
	}
}

func TestRunSoftwarePhaseLoopRefreshesSnapshotOnSuccess(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	oldFactory := softwareExecutorFactory
	defer func() { softwareExecutorFactory = oldFactory }()

	fakeExecutor := &fakeSoftwareExecutor{
		preflight: software.TargetReadinessResult{
			OK:              true,
			OSSupported:     true,
			PrivilegeOK:     true,
			NetworkOK:       true,
			DependencyReady: true,
			Issues:          []string{},
		},
		installDetail: software.SoftwareComponentDetail{
			SoftwareComponentSummary: software.SoftwareComponentSummary{
				InstalledState:    software.InstalledStateInstalled,
				DetectedVersion:   "1.2.3",
				PackagedVersion:   "1.2.3",
				VerificationState: software.VerificationStateHealthy,
			},
			ServiceName: "docker",
		},
	}
	softwareExecutorFactory = func(app core.App, serverID, userID string) (software.ComponentExecutor, error) {
		return fakeExecutor, nil
	}

	w := &Worker{app: app}
	record, err := createSoftwareOperationRecord(app, SoftwareActionPayload{
		ServerID:     "srv-2",
		ComponentKey: software.ComponentKeyDocker,
		Action:       software.ActionInstall,
	})
	if err != nil {
		t.Fatal(err)
	}
	payload := SoftwareActionPayload{
		OperationID:  record.Id,
		ServerID:     "srv-2",
		ComponentKey: software.ComponentKeyDocker,
		Action:       software.ActionInstall,
		UserID:       "user-2",
		UserEmail:    "user2@example.com",
	}

	w.runSoftwarePhaseLoop(context.Background(), record, payload)

	snapshots, err := app.FindRecordsByFilter("software_inventory_snapshots", "target_id = 'srv-2' && component_key = 'docker'", "", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshots) != 1 {
		t.Fatalf("expected one snapshot record after success, got %d", len(snapshots))
	}
	if snapshots[0].GetString("terminal_status") != "" {
		t.Fatalf("snapshot should not store terminal_status directly, got %q", snapshots[0].GetString("terminal_status"))
	}
	if snapshots[0].GetString("detected_version") != "1.2.3" {
		t.Fatalf("expected snapshot detected_version 1.2.3, got %q", snapshots[0].GetString("detected_version"))
	}
	lastAction := decodeWorkerJSONObject(t, snapshots[0].Get("last_action_json"))
	if lastAction["result"] != "success" {
		t.Fatalf("expected successful snapshot action result, got %#v", lastAction)
	}
}

func TestRunSoftwarePhaseLoopFailsWhenPostActionVerifyIsDegraded(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	oldFactory := softwareExecutorFactory
	defer func() { softwareExecutorFactory = oldFactory }()

	fakeExecutor := &fakeSoftwareExecutor{
		preflight: software.TargetReadinessResult{
			OK:              true,
			OSSupported:     true,
			PrivilegeOK:     true,
			NetworkOK:       true,
			DependencyReady: true,
		},
		installDetail: software.SoftwareComponentDetail{
			SoftwareComponentSummary: software.SoftwareComponentSummary{
				InstalledState: software.InstalledStateInstalled,
			},
		},
		verifyDetail: software.SoftwareComponentDetail{
			SoftwareComponentSummary: software.SoftwareComponentSummary{
				InstalledState:    software.InstalledStateInstalled,
				VerificationState: software.VerificationStateDegraded,
			},
		},
	}
	softwareExecutorFactory = func(app core.App, serverID, userID string) (software.ComponentExecutor, error) {
		return fakeExecutor, nil
	}

	w := &Worker{app: app}
	record, err := createSoftwareOperationRecord(app, SoftwareActionPayload{
		ServerID:     "srv-3",
		ComponentKey: software.ComponentKeyDocker,
		Action:       software.ActionInstall,
	})
	if err != nil {
		t.Fatal(err)
	}
	payload := SoftwareActionPayload{
		OperationID:  record.Id,
		ServerID:     "srv-3",
		ComponentKey: software.ComponentKeyDocker,
		Action:       software.ActionInstall,
	}

	w.runSoftwarePhaseLoop(context.Background(), record, payload)

	updated, err := app.FindRecordById("software_operations", record.Id)
	if err != nil {
		t.Fatal(err)
	}
	if updated.GetString("phase") != string(software.OperationPhaseAttentionRequired) {
		t.Fatalf("expected attention_required phase after degraded verify, got %q", updated.GetString("phase"))
	}
	if updated.GetString("terminal_status") != string(software.TerminalStatusAttentionRequired) {
		t.Fatalf("expected attention_required terminal_status after degraded verify, got %q", updated.GetString("terminal_status"))
	}
	if fakeExecutor.verifyCalled == 0 {
		t.Fatal("expected post-action verifying to call executor.Verify")
	}
	if updated.GetString("failure_phase") != string(software.OperationPhaseVerifying) {
		t.Fatalf("expected verifying failure_phase, got %q", updated.GetString("failure_phase"))
	}
	if updated.GetString("failure_code") != string(software.FailureCodeVerificationDegraded) {
		t.Fatalf("expected verification_degraded failure_code, got %q", updated.GetString("failure_code"))
	}
	if !strings.Contains(updated.GetString("failure_reason"), "post-action verification failed") {
		t.Fatalf("expected verification failure reason, got %q", updated.GetString("failure_reason"))
	}
	if !strings.Contains(updated.GetString("failure_reason"), "component is degraded") {
		t.Fatalf("expected degraded verification detail, got %q", updated.GetString("failure_reason"))
	}
	audits, err := app.FindRecordsByFilter("audit_logs", "action = 'server.software.install'", "-created", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(audits) != 1 {
		t.Fatalf("expected one audit record, got %d", len(audits))
	}
	if audits[0].GetString("status") != "attention_required" {
		t.Fatalf("expected attention_required audit status, got %q", audits[0].GetString("status"))
	}
}

func TestRunSoftwarePhaseLoopFailsWhenUninstallTruthStillDetectsInstalled(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	oldFactory := softwareExecutorFactory
	defer func() { softwareExecutorFactory = oldFactory }()

	fakeExecutor := &fakeSoftwareExecutor{
		preflight: software.TargetReadinessResult{
			OK:              true,
			OSSupported:     true,
			PrivilegeOK:     true,
			NetworkOK:       true,
			DependencyReady: true,
		},
		uninstallDetail: software.SoftwareComponentDetail{},
		detectState:     software.InstalledStateInstalled,
		detectVersion:   "29.4.1",
	}
	softwareExecutorFactory = func(app core.App, serverID, userID string) (software.ComponentExecutor, error) {
		return fakeExecutor, nil
	}

	w := &Worker{app: app}
	record, err := createSoftwareOperationRecord(app, SoftwareActionPayload{
		ServerID:     "srv-4",
		ComponentKey: software.ComponentKeyDocker,
		Action:       software.ActionUninstall,
	})
	if err != nil {
		t.Fatal(err)
	}
	payload := SoftwareActionPayload{
		OperationID:  record.Id,
		ServerID:     "srv-4",
		ComponentKey: software.ComponentKeyDocker,
		Action:       software.ActionUninstall,
	}

	w.runSoftwarePhaseLoop(context.Background(), record, payload)

	updated, err := app.FindRecordById("software_operations", record.Id)
	if err != nil {
		t.Fatal(err)
	}
	if updated.GetString("phase") != string(software.OperationPhaseAttentionRequired) {
		t.Fatalf("expected attention_required phase after uninstall truth check, got %q", updated.GetString("phase"))
	}
	if updated.GetString("terminal_status") != string(software.TerminalStatusAttentionRequired) {
		t.Fatalf("expected attention_required terminal_status for uninstall truth check, got %q", updated.GetString("terminal_status"))
	}
	if updated.GetString("failure_phase") != string(software.OperationPhaseVerifying) {
		t.Fatalf("expected verifying failure_phase for uninstall truth check, got %q", updated.GetString("failure_phase"))
	}
	if updated.GetString("failure_code") != string(software.FailureCodeUninstallTruthMismatch) {
		t.Fatalf("expected uninstall_truth_mismatch failure_code, got %q", updated.GetString("failure_code"))
	}
	if !strings.Contains(updated.GetString("failure_reason"), "still detected as installed") {
		t.Fatalf("expected uninstall detect failure reason, got %q", updated.GetString("failure_reason"))
	}
	snapshots, err := app.FindRecordsByFilter("software_inventory_snapshots", "target_id = 'srv-4' && component_key = 'docker'", "", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshots) != 1 {
		t.Fatalf("expected one snapshot record after attention_required terminal, got %d", len(snapshots))
	}
	lastAction := decodeWorkerJSONObject(t, snapshots[0].Get("last_action_json"))
	if lastAction["result"] != "attention_required" {
		t.Fatalf("expected snapshot attention_required action result, got %#v", lastAction)
	}
}

func TestRunSoftwarePhaseLoopMarksVerificationErrorCodeForVerifyErrors(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	oldFactory := softwareExecutorFactory
	defer func() { softwareExecutorFactory = oldFactory }()

	fakeExecutor := &fakeSoftwareExecutor{
		preflight: software.TargetReadinessResult{OK: true, OSSupported: true, PrivilegeOK: true, NetworkOK: true, DependencyReady: true},
		installDetail: software.SoftwareComponentDetail{SoftwareComponentSummary: software.SoftwareComponentSummary{InstalledState: software.InstalledStateInstalled}},
		verifyErr:     fmt.Errorf("systemctl verify check failed"),
	}
	softwareExecutorFactory = func(app core.App, serverID, userID string) (software.ComponentExecutor, error) {
		return fakeExecutor, nil
	}

	w := &Worker{app: app}
	record, err := createSoftwareOperationRecord(app, SoftwareActionPayload{ServerID: "srv-5", ComponentKey: software.ComponentKeyDocker, Action: software.ActionInstall})
	if err != nil {
		t.Fatal(err)
	}
	payload := SoftwareActionPayload{OperationID: record.Id, ServerID: "srv-5", ComponentKey: software.ComponentKeyDocker, Action: software.ActionInstall}

	w.runSoftwarePhaseLoop(context.Background(), record, payload)

	updated, err := app.FindRecordById("software_operations", record.Id)
	if err != nil {
		t.Fatal(err)
	}
	if updated.GetString("failure_code") != string(software.FailureCodeVerificationError) {
		t.Fatalf("expected verification_error failure_code, got %q", updated.GetString("failure_code"))
	}
	if updated.GetString("phase") != string(software.OperationPhaseAttentionRequired) {
		t.Fatalf("expected attention_required phase, got %q", updated.GetString("phase"))
	}
}

func decodeWorkerJSONObject(t *testing.T, value any) map[string]any {
	t.Helper()
	switch raw := value.(type) {
	case map[string]any:
		return raw
	case types.JSONRaw:
		if len(raw) == 0 {
			return map[string]any{}
		}
		var decoded map[string]any
		if err := json.Unmarshal(raw, &decoded); err != nil {
			t.Fatalf("unmarshal JSONRaw: %v", err)
		}
		return decoded
	case []byte:
		var decoded map[string]any
		if err := json.Unmarshal(raw, &decoded); err != nil {
			t.Fatalf("unmarshal bytes: %v", err)
		}
		return decoded
	default:
		t.Fatalf("expected JSON object field, got %#v", value)
		return nil
	}
}
