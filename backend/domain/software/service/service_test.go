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
	detectState   software.InstalledState
	detectVersion string
	detectErr     error
	preflight     software.TargetReadinessResult
	preflightErr  error
	verifyDetail  software.SoftwareComponentDetail
	verifyErr     error
	installDetail software.SoftwareComponentDetail
	installErr    error
	upgradeDetail software.SoftwareComponentDetail
	upgradeErr    error
	repairDetail  software.SoftwareComponentDetail
	repairErr     error
}

func (f *fakeComponentExecutor) Detect(context.Context, string, software.ResolvedTemplate) (software.InstalledState, string, error) {
	return f.detectState, f.detectVersion, f.detectErr
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

func (f *fakeComponentExecutor) Verify(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return f.verifyDetail, f.verifyErr
}

func (f *fakeComponentExecutor) Repair(context.Context, string, software.ResolvedTemplate) (software.SoftwareComponentDetail, error) {
	return f.repairDetail, f.repairErr
}

func TestBuildComputedComponentsProjectsSnapshotRecord(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	svc := &Service{app: app}
	executor := &fakeComponentExecutor{
		detectState:   software.InstalledStateInstalled,
		detectVersion: "27.0.0",
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
		ComponentKey:   software.ComponentKeyDocker,
		TargetType:     software.TargetTypeServer,
		Label:          "Docker",
		TemplateRef:    "tpl-docker",
		Binary:         "docker",
		ServiceName:    "docker",
		DefaultActions: []software.Action{software.ActionInstall, software.ActionVerify},
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

	executor.detectVersion = "28.0.0"
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
		Action:         software.ActionRepair,
		TerminalStatus: software.TerminalStatusFailed,
		UpdatedAt:      "2026-04-20 10:00:00.000Z",
	})
	if action == nil {
		t.Fatal("expected last action summary")
	}
	if action.Action != string(software.ActionRepair) {
		t.Fatalf("expected repair action, got %q", action.Action)
	}
	if action.Result != "failed" {
		t.Fatalf("expected failed result, got %q", action.Result)
	}
}
