package service

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/software"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
	swprojection "github.com/websoft9/appos/backend/domain/software/projection"

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

func TestListServerComponentsUsesSnapshotsBeforeExecutor(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		fatal(t, err)
	}
	defer app.Cleanup()

	cat, reg, err := loadCatalogAndRegistry(true)
	if err != nil {
		fatal(t, err)
	}
	for _, entry := range cat.Components {
		tpl, ok := reg.Templates[entry.TemplateRef]
		if !ok {
			t.Fatalf("missing template %q", entry.TemplateRef)
		}
		resolved := swcatalog.ResolveTemplate(entry, tpl)
		computed := ComputedComponent{
			Entry:    entry,
			Resolved: resolved,
			Summary: software.SoftwareComponentSummary{
				ComponentKey:      entry.ComponentKey,
				Label:             entry.Label,
				TemplateKind:      resolved.TemplateKind,
				InstalledState:    software.InstalledStateInstalled,
				DetectedVersion:   "1.0.0",
				VerificationState: software.VerificationStateHealthy,
				AvailableActions:  []software.Action{software.ActionVerify},
			},
			Detail: software.SoftwareComponentDetail{
				SoftwareComponentSummary: software.SoftwareComponentSummary{
					ComponentKey:      entry.ComponentKey,
					Label:             entry.Label,
					TemplateKind:      resolved.TemplateKind,
					InstalledState:    software.InstalledStateInstalled,
					DetectedVersion:   "1.0.0",
					VerificationState: software.VerificationStateHealthy,
				},
				ServiceName: entry.ServiceName,
				BinaryPath:  entry.Binary,
				Preflight: &software.TargetReadinessResult{
					OK:              true,
					OSSupported:     true,
					PrivilegeOK:     true,
					NetworkOK:       true,
					DependencyReady: true,
					Issues:          []string{},
				},
				Verification: &software.SoftwareVerificationResult{
					State:     software.VerificationStateHealthy,
					CheckedAt: "2026-04-20T10:00:00Z",
					Details: map[string]any{
						"compose_available": true,
						"compose_version":   "2.27.0",
					},
				},
			},
			Preflight: software.TargetReadinessResult{
				OK:              true,
				OSSupported:     true,
				PrivilegeOK:     true,
				NetworkOK:       true,
				DependencyReady: true,
				Issues:          []string{},
			},
		}
		if err := swprojection.UpsertInventorySnapshot(app, software.TargetTypeServer, "srv-1", snapshotFromComputed(computed)); err != nil {
			fatal(t, err)
		}
	}

	executorCalled := false
	svc := &Service{
		app: app,
		serverExecutorFactory: func(app core.App, serverID, userID string) (software.ComponentExecutor, error) {
			executorCalled = true
			return nil, fmt.Errorf("executor should not be called when snapshots are complete")
		},
	}

	items, err := svc.ListServerComponents(context.Background(), "srv-1", "")
	if err != nil {
		fatal(t, err)
	}
	if executorCalled {
		t.Fatal("expected snapshot-backed list to skip executor creation")
	}
	if len(items) != len(cat.Components) {
		t.Fatalf("expected %d items from snapshots, got %d", len(cat.Components), len(items))
	}
	for _, item := range items {
		if item.Detail.Verification == nil {
			t.Fatalf("expected verification payload for %s", item.Entry.ComponentKey)
		}
	}
}

func TestGetServerComponentUsesSingleSnapshotBeforeExecutor(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		fatal(t, err)
	}
	defer app.Cleanup()

	cat, reg, err := loadCatalogAndRegistry(true)
	if err != nil {
		fatal(t, err)
	}
	var dockerEntry software.CatalogEntry
	found := false
	for _, entry := range cat.Components {
		if entry.ComponentKey == software.ComponentKeyDocker {
			dockerEntry = entry
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected docker entry in server catalog")
	}
	tpl, ok := reg.Templates[dockerEntry.TemplateRef]
	if !ok {
		t.Fatalf("missing template %q", dockerEntry.TemplateRef)
	}
	resolved := swcatalog.ResolveTemplate(dockerEntry, tpl)
	computed := ComputedComponent{
		Entry:    dockerEntry,
		Resolved: resolved,
		Summary: software.SoftwareComponentSummary{
			ComponentKey:      dockerEntry.ComponentKey,
			Label:             dockerEntry.Label,
			TemplateKind:      resolved.TemplateKind,
			InstalledState:    software.InstalledStateInstalled,
			DetectedVersion:   "27.0.1",
			VerificationState: software.VerificationStateHealthy,
			AvailableActions:  []software.Action{software.ActionVerify, software.ActionUpgrade},
		},
		Detail: software.SoftwareComponentDetail{
			SoftwareComponentSummary: software.SoftwareComponentSummary{
				ComponentKey:      dockerEntry.ComponentKey,
				Label:             dockerEntry.Label,
				TemplateKind:      resolved.TemplateKind,
				InstalledState:    software.InstalledStateInstalled,
				DetectedVersion:   "27.0.1",
				VerificationState: software.VerificationStateHealthy,
			},
			ServiceName: dockerEntry.ServiceName,
			BinaryPath:  dockerEntry.Binary,
			Preflight: &software.TargetReadinessResult{
				OK:              true,
				OSSupported:     true,
				PrivilegeOK:     true,
				NetworkOK:       true,
				DependencyReady: true,
				Issues:          []string{},
			},
			Verification: &software.SoftwareVerificationResult{
				State:     software.VerificationStateHealthy,
				CheckedAt: "2026-04-20T10:00:00Z",
				Details: map[string]any{
					"compose_available": true,
					"compose_version":   "2.27.0",
				},
			},
		},
		Preflight: software.TargetReadinessResult{
			OK:              true,
			OSSupported:     true,
			PrivilegeOK:     true,
			NetworkOK:       true,
			DependencyReady: true,
			Issues:          []string{},
		},
	}
	if err := swprojection.UpsertInventorySnapshot(app, software.TargetTypeServer, "srv-1", snapshotFromComputed(computed)); err != nil {
		fatal(t, err)
	}

	executorCalled := false
	svc := &Service{
		app: app,
		serverExecutorFactory: func(app core.App, serverID, userID string) (software.ComponentExecutor, error) {
			executorCalled = true
			return nil, fmt.Errorf("executor should not be called when component snapshot exists")
		},
	}

	item, err := svc.GetServerComponent(context.Background(), "srv-1", "", software.ComponentKeyDocker)
	if err != nil {
		fatal(t, err)
	}
	if executorCalled {
		t.Fatal("expected snapshot-backed get to skip executor creation")
	}
	if item.Entry.ComponentKey != software.ComponentKeyDocker {
		t.Fatalf("expected docker component, got %q", item.Entry.ComponentKey)
	}
	if item.Detail.Verification == nil {
		t.Fatal("expected verification payload from snapshot-backed get")
	}
	if got := item.Detail.Verification.Details["compose_version"]; got != "2.27.0" {
		t.Fatalf("expected compose_version from snapshot, got %#v", got)
	}
}

func TestGetServerComponentPersistsLiveResultForSubsequentReads(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		fatal(t, err)
	}
	defer app.Cleanup()

	executorCalls := 0
	svc := &Service{
		app: app,
		serverExecutorFactory: func(app core.App, serverID, userID string) (software.ComponentExecutor, error) {
			executorCalls++
			return &fakeComponentExecutor{
				detection: software.DetectionResult{
					InstalledState:  software.InstalledStateInstalled,
					DetectedVersion: "27.0.1",
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
						DetectedVersion:   "27.0.1",
						VerificationState: software.VerificationStateHealthy,
					},
					ServiceName: "docker.service",
					Verification: &software.SoftwareVerificationResult{
						State:     software.VerificationStateHealthy,
						CheckedAt: "2026-04-20T10:00:00Z",
						Details: map[string]any{
							"compose_available": true,
							"compose_version":   "2.27.0",
						},
					},
				},
			}, nil
		},
	}

	first, err := svc.GetServerComponent(context.Background(), "srv-1", "", software.ComponentKeyDocker)
	if err != nil {
		fatal(t, err)
	}
	if executorCalls != 1 {
		t.Fatalf("expected first read to build executor once, got %d", executorCalls)
	}
	if first.Detail.Verification == nil {
		t.Fatal("expected verification payload on first live get")
	}

	second, err := svc.GetServerComponent(context.Background(), "srv-1", "", software.ComponentKeyDocker)
	if err != nil {
		fatal(t, err)
	}
	if executorCalls != 1 {
		t.Fatalf("expected second read to reuse snapshot without new executor, got %d calls", executorCalls)
	}
	if second.Detail.Verification == nil {
		t.Fatal("expected verification payload on second snapshot-backed get")
	}
	if got := second.Detail.Verification.Details["compose_version"]; got != "2.27.0" {
		t.Fatalf("expected compose_version from persisted snapshot, got %#v", got)
	}
}

func TestGetServerComponentRecomputesNotInstalledSnapshot(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		fatal(t, err)
	}
	defer app.Cleanup()

	stale := ComputedComponent{
		Entry: software.CatalogEntry{
			ComponentKey: software.ComponentKeyDocker,
			TargetType:   software.TargetTypeServer,
			Label:        "Docker",
			TemplateRef:  "docker-ce-package",
		},
		Summary: software.SoftwareComponentSummary{
			ComponentKey:      software.ComponentKeyDocker,
			TemplateKind:      software.TemplateKindPackage,
			InstalledState:    software.InstalledStateNotInstalled,
			VerificationState: software.VerificationStateDegraded,
			AvailableActions:  []software.Action{},
		},
		Detail: software.SoftwareComponentDetail{
			SoftwareComponentSummary: software.SoftwareComponentSummary{
				ComponentKey:      software.ComponentKeyDocker,
				TemplateKind:      software.TemplateKindPackage,
				InstalledState:    software.InstalledStateNotInstalled,
				VerificationState: software.VerificationStateDegraded,
				AvailableActions:  []software.Action{},
			},
			Preflight: &software.TargetReadinessResult{
				OK:              false,
				OSSupported:     true,
				PrivilegeOK:     true,
				NetworkOK:       false,
				DependencyReady: true,
				Issues:          []string{"network_required: no outbound internet connectivity"},
			},
		},
		Preflight: software.TargetReadinessResult{
			OK:              false,
			OSSupported:     true,
			PrivilegeOK:     true,
			NetworkOK:       false,
			DependencyReady: true,
			Issues:          []string{"network_required: no outbound internet connectivity"},
		},
	}
	if err := swprojection.UpsertInventorySnapshot(app, software.TargetTypeServer, "srv-1", snapshotFromComputed(stale)); err != nil {
		fatal(t, err)
	}

	executorCalls := 0
	svc := &Service{
		app: app,
		serverExecutorFactory: func(app core.App, serverID, userID string) (software.ComponentExecutor, error) {
			executorCalls++
			return &fakeComponentExecutor{
				detection: software.DetectionResult{InstalledState: software.InstalledStateNotInstalled},
				preflight: software.TargetReadinessResult{
					OK:              true,
					OSSupported:     true,
					PrivilegeOK:     true,
					NetworkOK:       true,
					DependencyReady: true,
					Issues:          []string{},
				},
				verifyErr: fmt.Errorf("component is not installed"),
			}, nil
		},
	}

	item, err := svc.GetServerComponent(context.Background(), "srv-1", "", software.ComponentKeyDocker)
	if err != nil {
		fatal(t, err)
	}
	if executorCalls != 1 {
		t.Fatalf("expected stale not-installed snapshot to trigger live recompute, got %d executor calls", executorCalls)
	}
	if len(item.Detail.AvailableActions) != 2 || item.Detail.AvailableActions[0] != software.ActionInstall || item.Detail.AvailableActions[1] != software.ActionVerify {
		t.Fatalf("expected refreshed actions [install verify], got %v", item.Detail.AvailableActions)
	}
	if item.Detail.Preflight == nil || !item.Detail.Preflight.NetworkOK {
		t.Fatalf("expected refreshed preflight to report network OK, got %#v", item.Detail.Preflight)
	}
}

func fatal(t *testing.T, err error) {
	t.Helper()
	t.Fatal(err)
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

func TestDeriveAvailableActions_NotInstalledAllowsInstallAndVerify(t *testing.T) {
	actions := deriveAvailableActions(
		[]software.Action{software.ActionInstall, software.ActionVerify, software.ActionUninstall},
		software.InstalledStateNotInstalled,
		software.TargetReadinessResult{OK: true},
		nil,
	)

	want := []software.Action{software.ActionInstall, software.ActionVerify}
	if len(actions) != len(want) {
		t.Fatalf("available actions len = %d, want %d (%v)", len(actions), len(want), actions)
	}
	for i := range want {
		if actions[i] != want[i] {
			t.Fatalf("available action[%d] = %q, want %q", i, actions[i], want[i])
		}
	}
}

func TestDeriveAvailableActions_NotInstalledAllowsInstallAndVerifyWhenPreflightBlocked(t *testing.T) {
	actions := deriveAvailableActions(
		[]software.Action{software.ActionInstall, software.ActionVerify, software.ActionUninstall},
		software.InstalledStateNotInstalled,
		software.TargetReadinessResult{OK: false},
		nil,
	)

	want := []software.Action{software.ActionInstall, software.ActionVerify}
	if len(actions) != len(want) {
		t.Fatalf("available actions len = %d, want %d (%v)", len(actions), len(want), actions)
	}
	for i := range want {
		if actions[i] != want[i] {
			t.Fatalf("available action[%d] = %q, want %q", i, actions[i], want[i])
		}
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

	want := []software.Action{software.ActionUpgrade, software.ActionVerify}
	if len(actions) != len(want) {
		t.Fatalf("available actions len = %d, want %d (%v)", len(actions), len(want), actions)
	}
	for i := range want {
		if actions[i] != want[i] {
			t.Fatalf("available action[%d] = %q, want %q", i, actions[i], want[i])
		}
	}
}

func TestDeriveAvailableActions_UnknownStateAllowsVerifyOnly(t *testing.T) {
	actions := deriveAvailableActions(
		[]software.Action{software.ActionInstall, software.ActionVerify, software.ActionUninstall},
		software.InstalledStateUnknown,
		software.TargetReadinessResult{OK: false},
		nil,
	)

	if len(actions) != 1 || actions[0] != software.ActionVerify {
		t.Fatalf("available actions = %v, want [verify]", actions)
	}
}
