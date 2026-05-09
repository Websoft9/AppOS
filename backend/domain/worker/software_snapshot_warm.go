package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/websoft9/appos/backend/domain/software"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
	swprojection "github.com/websoft9/appos/backend/domain/software/projection"
	"github.com/websoft9/appos/backend/infra/collections"
)

const TaskSoftwareWarmSnapshot = "software:warm-snapshot"

var softwareSnapshotWarmCooldown = 10 * time.Minute

type SoftwareSnapshotWarmPayload struct {
	ServerID      string                  `json:"server_id"`
	UserID        string                  `json:"user_id"`
	ComponentKeys []software.ComponentKey `json:"component_keys"`
}

func NewSoftwareSnapshotWarmTask(serverID, userID string, componentKeys []software.ComponentKey) (*asynq.Task, error) {
	if strings.TrimSpace(serverID) == "" {
		return nil, fmt.Errorf("server_id is required")
	}
	if len(componentKeys) == 0 {
		return nil, fmt.Errorf("component_keys are required")
	}
	payload, err := json.Marshal(SoftwareSnapshotWarmPayload{
		ServerID:      strings.TrimSpace(serverID),
		UserID:        strings.TrimSpace(userID),
		ComponentKeys: componentKeys,
	})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskSoftwareWarmSnapshot, payload), nil
}

func EnqueueSoftwareSnapshotWarm(client *asynq.Client, serverID, userID string, componentKeys []software.ComponentKey) error {
	if client == nil {
		return fmt.Errorf("asynq client is not configured")
	}
	task, err := NewSoftwareSnapshotWarmTask(serverID, userID, componentKeys)
	if err != nil {
		return err
	}
	_, err = client.Enqueue(task, asynq.Queue("low"))
	return err
}

func (w *Worker) handleSoftwareSnapshotWarm(ctx context.Context, t *asynq.Task) error {
	var payload SoftwareSnapshotWarmPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("parse software snapshot warm payload: %w", err)
	}
	if strings.TrimSpace(payload.ServerID) == "" || len(payload.ComponentKeys) == 0 {
		return fmt.Errorf("software snapshot warm payload missing required fields")
	}

	cat, err := swcatalog.LoadServerCatalog()
	if err != nil {
		return fmt.Errorf("load server catalog: %w", err)
	}
	reg, err := swcatalog.LoadTemplateRegistry()
	if err != nil {
		return fmt.Errorf("load template registry: %w", err)
	}
	var executor software.ComponentExecutor
	executorReady := false

	for _, componentKey := range payload.ComponentKeys {
		if !w.shouldWarmSoftwareSnapshot(payload.ServerID, componentKey, softwareSnapshotWarmCooldown) {
			continue
		}
		if !executorReady {
			executor, err = softwareExecutorFactory(w.app, payload.ServerID, payload.UserID)
			if err != nil {
				log.Printf("software snapshot warm: create executor for server %s: %v", payload.ServerID, err)
				return nil
			}
			executorReady = true
		}
		entry, resolved, ok := warmableSoftwareComponent(cat, reg, componentKey)
		if !ok {
			log.Printf("software snapshot warm: component %s not found in catalog", componentKey)
			continue
		}
		resolved = applyServerExecutionBindings(w.app, payload.ServerID, "", resolved)
		w.upsertWarmSoftwareSnapshot(ctx, payload.ServerID, entry, resolved, executor)
	}
	return nil
}

func (w *Worker) shouldWarmSoftwareSnapshot(serverID string, componentKey software.ComponentKey, cooldown time.Duration) bool {
	record, err := w.app.FindFirstRecordByFilter(
		collections.SoftwareInventorySnapshots,
		"target_type = {:targetType} && target_id = {:targetID} && component_key = {:componentKey}",
		map[string]any{
			"targetType":   string(software.TargetTypeServer),
			"targetID":     strings.TrimSpace(serverID),
			"componentKey": string(componentKey),
		},
	)
	if err != nil || record == nil {
		return true
	}
	updatedAt := record.GetDateTime("updated").Time()
	if updatedAt.IsZero() {
		return true
	}
	return time.Since(updatedAt.UTC()) >= cooldown
}

func warmableSoftwareComponent(
	cat software.ComponentCatalog,
	reg software.TemplateRegistry,
	componentKey software.ComponentKey,
) (software.CatalogEntry, software.ResolvedTemplate, bool) {
	for _, entry := range cat.Components {
		if entry.ComponentKey != componentKey {
			continue
		}
		tpl, ok := reg.Templates[entry.TemplateRef]
		if !ok {
			return software.CatalogEntry{}, software.ResolvedTemplate{}, false
		}
		return entry, swcatalog.ResolveTemplate(entry, tpl), true
	}
	return software.CatalogEntry{}, software.ResolvedTemplate{}, false
}

func (w *Worker) upsertWarmSoftwareSnapshot(
	ctx context.Context,
	serverID string,
	entry software.CatalogEntry,
	resolved software.ResolvedTemplate,
	executor software.ComponentExecutor,
) {
	summary := software.SoftwareComponentSummary{
		ComponentKey:      entry.ComponentKey,
		Label:             entry.Label,
		TemplateKind:      resolved.TemplateKind,
		InstalledState:    software.InstalledStateUnknown,
		VerificationState: software.VerificationStateUnknown,
		AvailableActions:  entry.SupportedActions,
	}
	detail := software.SoftwareComponentDetail{
		SoftwareComponentSummary: summary,
		ServiceName:              entry.ServiceName,
		BinaryPath:               entry.Binary,
	}

	detection, detectErr := executor.Detect(ctx, serverID, resolved)
	if detectErr == nil {
		summary.InstalledState = detection.InstalledState
		summary.DetectedVersion = detection.DetectedVersion
		summary.InstallSource = detection.InstallSource
		summary.SourceEvidence = detection.SourceEvidence
		detail.InstalledState = detection.InstalledState
		detail.DetectedVersion = detection.DetectedVersion
		detail.InstallSource = detection.InstallSource
		detail.SourceEvidence = detection.SourceEvidence
	}

	preflight, err := executor.RunPreflight(ctx, serverID, resolved)
	if err != nil {
		preflight = software.TargetReadinessResult{Issues: []string{"preflight_error: " + err.Error()}}
	}
	detail.Preflight = &preflight

	verification := &software.SoftwareVerificationResult{State: software.VerificationStateUnknown}
	verifiedDetail, verifyErr := executor.Verify(ctx, serverID, resolved)
	if verifyErr == nil {
		if verifiedDetail.InstalledState != "" {
			summary.InstalledState = verifiedDetail.InstalledState
			detail.InstalledState = verifiedDetail.InstalledState
		}
		if verifiedDetail.DetectedVersion != "" {
			summary.DetectedVersion = verifiedDetail.DetectedVersion
			detail.DetectedVersion = verifiedDetail.DetectedVersion
		}
		summary.PackagedVersion = verifiedDetail.PackagedVersion
		detail.PackagedVersion = verifiedDetail.PackagedVersion
		if verifiedDetail.VerificationState != "" {
			summary.VerificationState = verifiedDetail.VerificationState
			detail.VerificationState = verifiedDetail.VerificationState
		}
		if strings.TrimSpace(verifiedDetail.ServiceName) != "" {
			detail.ServiceName = verifiedDetail.ServiceName
		}
		if verifiedDetail.Verification != nil {
			verification = verifiedDetail.Verification
		}
		verification.State = summary.VerificationState
		if verification.Reason == "" && verifiedDetail.VerificationState == software.VerificationStateDegraded {
			verification.Reason = "service verification returned degraded state"
		}
	} else {
		verification.Reason = verifyErr.Error()
		if detectErr == nil && detection.InstalledState == software.InstalledStateNotInstalled {
			verification.Reason = "component is not installed"
		}
	}
	if verification.CheckedAt == "" {
		verification.CheckedAt = time.Now().UTC().Format(time.RFC3339)
	}
	detail.Verification = verification
	detail.SoftwareComponentSummary = summary

	if err := swprojection.UpsertInventorySnapshot(w.app, software.TargetTypeServer, serverID, swprojection.Snapshot{
		ComponentKey:      entry.ComponentKey,
		Label:             entry.Label,
		TemplateKind:      detail.TemplateKind,
		InstalledState:    detail.InstalledState,
		DetectedVersion:   detail.DetectedVersion,
		PackagedVersion:   detail.PackagedVersion,
		VerificationState: detail.VerificationState,
		ServiceName:       detail.ServiceName,
		BinaryPath:        detail.BinaryPath,
		Preflight:         detail.Preflight,
		Verification:      detail.Verification,
		LastAction:        detail.LastAction,
	}); err != nil {
		log.Printf("software snapshot warm: upsert snapshot for %s/%s: %v", serverID, entry.ComponentKey, err)
	}
}