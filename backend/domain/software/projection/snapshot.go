package projection

import (
	"encoding/json"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/software"
	"github.com/websoft9/appos/backend/infra/collections"
)

type Snapshot struct {
	ComponentKey      software.ComponentKey
	Label             string
	TemplateKind      software.TemplateKind
	InstalledState    software.InstalledState
	DetectedVersion   string
	PackagedVersion   string
	VerificationState software.VerificationState
	ServiceName       string
	BinaryPath        string
	Preflight         *software.TargetReadinessResult
	Verification      *software.SoftwareVerificationResult
	LastAction        *software.SoftwareDeliveryLastAction
}

func UpsertInventorySnapshot(app core.App, targetType software.TargetType, targetID string, snapshot Snapshot) error {
	col, err := app.FindCollectionByNameOrId(collections.SoftwareInventorySnapshots)
	if err != nil {
		return err
	}

	record, err := app.FindFirstRecordByFilter(
		collections.SoftwareInventorySnapshots,
		"target_type = {:targetType} && target_id = {:targetID} && component_key = {:componentKey}",
		map[string]any{
			"targetType":   string(targetType),
			"targetID":     strings.TrimSpace(targetID),
			"componentKey": string(snapshot.ComponentKey),
		},
	)
	if err != nil {
		record = core.NewRecord(col)
	}

	record.Set("target_type", string(targetType))
	record.Set("target_id", strings.TrimSpace(targetID))
	record.Set("component_key", string(snapshot.ComponentKey))
	record.Set("label", snapshot.Label)
	record.Set("template_kind", string(snapshot.TemplateKind))
	record.Set("installed_state", string(snapshot.InstalledState))
	record.Set("detected_version", snapshot.DetectedVersion)
	record.Set("packaged_version", snapshot.PackagedVersion)
	record.Set("verification_state", string(snapshot.VerificationState))
	record.Set("service_name", snapshot.ServiceName)
	record.Set("binary_path", snapshot.BinaryPath)
	record.Set("preflight_json", mustJSONMap(snapshot.Preflight))
	record.Set("verification_json", mustJSONMap(snapshot.Verification))
	record.Set("last_action_json", mustJSONMap(snapshot.LastAction))

	return app.Save(record)
}

func mustJSONMap(value any) any {
	if value == nil {
		return nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil
	}
	return decoded
}
