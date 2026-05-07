package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/software"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

type fakeComponentExecutor struct {
	detection       software.DetectionResult
	detectErr       error
	preflight       software.TargetReadinessResult
	preflightErr    error
	verifyDetail    software.SoftwareComponentDetail
	verifyErr       error
	installDetail   software.SoftwareComponentDetail
	installErr      error
	upgradeDetail   software.SoftwareComponentDetail
	upgradeErr      error
	startDetail     software.SoftwareComponentDetail
	startErr        error
	stopDetail      software.SoftwareComponentDetail
	stopErr         error
	restartDetail   software.SoftwareComponentDetail
	restartErr      error
	uninstallDetail software.SoftwareComponentDetail
	uninstallErr    error
	reinstallDetail software.SoftwareComponentDetail
	reinstallErr    error
}

func (f *fakeComponentExecutor) Detect(context.Context, string, software.ResolvedTemplate) (software.DetectionResult, error) {
	return f.detection, f.detectErr
}

func (f *fakeComponentExecutor) RunPreflight(context.Context, string, software.ResolvedTemplate) (software.TargetReadinessResult, error) {
	return f.preflight, f.preflightErr
}

func (f *fakeComponentExecutor) Install(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return f.installDetail, f.installErr
}

func (f *fakeComponentExecutor) Upgrade(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return f.upgradeDetail, f.upgradeErr
}

func (f *fakeComponentExecutor) Start(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return f.startDetail, f.startErr
}

func (f *fakeComponentExecutor) Stop(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return f.stopDetail, f.stopErr
}

func (f *fakeComponentExecutor) Restart(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return f.restartDetail, f.restartErr
}

func (f *fakeComponentExecutor) Uninstall(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return f.uninstallDetail, f.uninstallErr
}

func (f *fakeComponentExecutor) Verify(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return f.verifyDetail, f.verifyErr
}

func (f *fakeComponentExecutor) Reinstall(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return f.reinstallDetail, f.reinstallErr
}

func TestBuildComputedComponentsProjectsSnapshotRecord(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	svc := &Service{app: app}
	executor := &fakeComponentExecutor{
		detection: software.DetectionResult{
			InstalledState:  software.InstalledStateInstalled,
			DetectedVersion: "27.0.0",
			InstallSource:   software.InstallSourceManaged,
			SourceEvidence:  "apt:docker-ce",
		},
		preflight: software.TargetReadinessResult{
			OK:              true,
			OSSupported:     true,
			PrivilegeOK:     true,
			NetworkOK:       true,
			DependencyReady: true,
			Issues:          []string{},
		},
		verifyDetail: software.SoftwareComponentDetail{
			SoftwareComponentSummary: software.SoftwareComponentSummary{
				InstalledState:    software.InstalledStateInstalled,
				DetectedVersion:   "27.0.0",
				PackagedVersion:   "27.0.0",
				VerificationState: software.VerificationStateHealthy,
			},
			ServiceName: "docker",
		},
	}

	entry := software.CatalogEntry{
		ComponentKey:     software.ComponentKeyDocker,
		TargetType:       software.TargetTypeServer,
		Label:            "Docker",
		TemplateRef:      "tpl-docker",
		Binary:           "docker",
		ServiceName:      "docker",
		SupportedActions: []software.Action{software.ActionInstall, software.ActionVerify},
	}
	cat := software.ComponentCatalog{Components: []software.CatalogEntry{entry}}
	reg := software.TemplateRegistry{Templates: map[string]software.ComponentTemplate{
		"tpl-docker": {
			TemplateKind: software.TemplateKindPackage,
		},
	}}
	latestOps := map[string]*OperationSummary{
		string(software.ComponentKeyDocker): {
			Action:         software.ActionVerify,
			Phase:          software.OperationPhaseSucceeded,
			TerminalStatus: software.TerminalStatusSuccess,
			FailurePhase:   software.OperationPhaseVerifying,
			FailureCode:    software.FailureCodeVerificationDegraded,
			UpdatedAt:      "2026-04-20 10:00:00.000Z",
		},
	}

	items, err := svc.buildComputedComponents(context.Background(), cat, reg, software.TargetTypeServer, "srv-1", executor, nil, latestOps)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 computed item, got %d", len(items))
	}
	if items[0].Detail.InstalledState != software.InstalledStateInstalled {
		t.Fatalf("expected installed state to be projected, got %q", items[0].Detail.InstalledState)
	}
	if items[0].Detail.InstallSource != software.InstallSourceManaged {
		t.Fatalf("expected managed install source, got %q", items[0].Detail.InstallSource)
	}
	if items[0].Detail.LastAction == nil || items[0].Detail.LastAction.Result != "success" {
		t.Fatalf("expected successful last_action projection, got %#v", items[0].Detail.LastAction)
	}

	snapshots, err := app.FindRecordsByFilter("software_inventory_snapshots", "target_id = 'srv-1'", "", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshots) != 1 {
		t.Fatalf("expected 1 snapshot record, got %d", len(snapshots))
	}
	if snapshots[0].GetString("component_key") != string(software.ComponentKeyDocker) {
		t.Fatalf("expected docker snapshot, got %q", snapshots[0].GetString("component_key"))
	}
	lastAction := decodeJSONObject(t, snapshots[0].Get("last_action_json"))
	if lastAction["result"] != "success" {
		t.Fatalf("expected snapshot last_action result success, got %#v", lastAction)
	}

	executor.detection.DetectedVersion = "28.0.0"
	executor.verifyDetail.DetectedVersion = "28.0.0"
	executor.verifyDetail.PackagedVersion = "28.0.0"
	_, err = svc.buildComputedComponents(context.Background(), cat, reg, software.TargetTypeServer, "srv-1", executor, nil, latestOps)
	if err != nil {
		t.Fatal(err)
	}
	snapshots, err = app.FindRecordsByFilter("software_inventory_snapshots", "target_id = 'srv-1'", "", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshots) != 1 {
		t.Fatalf("expected snapshot upsert to keep one record, got %d", len(snapshots))
	}
	if snapshots[0].GetString("detected_version") != "28.0.0" {
		t.Fatalf("expected updated detected version, got %q", snapshots[0].GetString("detected_version"))
	}
}

func decodeJSONObject(t *testing.T, value any) map[string]any {
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

func TestLastActionFromOperationMapsTerminalStatus(t *testing.T) {
	action := lastActionFromOperation(&OperationSummary{
		Action:         software.ActionReinstall,
		TerminalStatus: software.TerminalStatusFailed,
		UpdatedAt:      "2026-04-20 10:00:00.000Z",
	})
	if action == nil {
		t.Fatal("expected last action summary")
		return
	}
	if action.Action != string(software.ActionReinstall) {
		t.Fatalf("expected reinstall action, got %q", action.Action)
	}
	if action.Result != "failed" {
		t.Fatalf("expected failed result, got %q", action.Result)
	}
}

func TestLastActionFromOperationMapsAttentionRequired(t *testing.T) {
	action := lastActionFromOperation(&OperationSummary{
		Action:         software.ActionVerify,
		TerminalStatus: software.TerminalStatusAttentionRequired,
		UpdatedAt:      "2026-04-20 10:00:00.000Z",
	})
	if action == nil {
		t.Fatal("expected last action summary")
		return
	}
	if action.Result != "attention_required" {
		t.Fatalf("expected attention_required result, got %q", action.Result)
	}
}

func TestDeriveAvailableActions_InstalledReadinessOK(t *testing.T) {
	actions := deriveAvailableActions(
		[]software.Action{
			software.ActionInstall,
			software.ActionUpgrade,
			software.ActionVerify,
			software.ActionReinstall,
			software.ActionUninstall,
		},
		software.InstalledStateInstalled,
		software.TargetReadinessResult{OK: true},
		nil,
	)

	want := []software.Action{
		software.ActionUpgrade,
		software.ActionVerify,
		software.ActionReinstall,
		software.ActionUninstall,
	}
	if len(actions) != len(want) {
		t.Fatalf("available actions len = %d, want %d (%v)", len(actions), len(want), actions)
	}
	for i := range want {
		if actions[i] != want[i] {
			t.Fatalf("available action[%d] = %q, want %q", i, actions[i], want[i])
		}
	}
}

func TestDeriveAvailableActions_NotInstalledOnlyInstall(t *testing.T) {
	actions := deriveAvailableActions(
		[]software.Action{software.ActionInstall, software.ActionVerify, software.ActionUninstall},
		software.InstalledStateNotInstalled,
		software.TargetReadinessResult{OK: true},
		nil,
	)

	if len(actions) != 1 || actions[0] != software.ActionInstall {
		t.Fatalf("available actions = %v, want [install]", actions)
	}
}

func TestDeriveAvailableActions_PreflightBlocked(t *testing.T) {
	actions := deriveAvailableActions(
		[]software.Action{software.ActionInstall, software.ActionUpgrade, software.ActionVerify},
		software.InstalledStateInstalled,
		software.TargetReadinessResult{OK: false},
		nil,
	)

	if len(actions) != 0 {
		t.Fatalf("available actions = %v, want none", actions)
	}
}

func TestDeriveAvailableActions_InFlightOperation(t *testing.T) {
	actions := deriveAvailableActions(
		[]software.Action{software.ActionUpgrade, software.ActionVerify},
		software.InstalledStateInstalled,
		software.TargetReadinessResult{OK: true},
		&OperationSummary{TerminalStatus: software.TerminalStatusNone, Phase: software.OperationPhaseExecuting},
	)

	if len(actions) != 0 {
		t.Fatalf("available actions = %v, want none", actions)
	}
}

func TestDeriveAvailableActions_UnknownStateAllowsVerifyOnly(t *testing.T) {
	actions := deriveAvailableActions(
		[]software.Action{software.ActionInstall, software.ActionVerify, software.ActionUninstall},
		software.InstalledStateUnknown,
		software.TargetReadinessResult{OK: true},
		nil,
	)

	if len(actions) != 1 || actions[0] != software.ActionVerify {
		t.Fatalf("available actions = %v, want [verify]", actions)
	}
}
