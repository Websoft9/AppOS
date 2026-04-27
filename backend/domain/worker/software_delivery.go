package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/software"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
	swexecutor "github.com/websoft9/appos/backend/domain/software/executor"
	swprojection "github.com/websoft9/appos/backend/domain/software/projection"
	"github.com/websoft9/appos/backend/infra/collections"
)

// ─── Task Type Constants ──────────────────────────────────

const (
	// TaskSoftwareInstall is the Asynq task type for a software install action.
	TaskSoftwareInstall = "software:install"
	// TaskSoftwareUpgrade is the Asynq task type for a software upgrade action.
	TaskSoftwareUpgrade = "software:upgrade"
	// TaskSoftwareStart is the Asynq task type for a software start action.
	TaskSoftwareStart = "software:start"
	// TaskSoftwareStop is the Asynq task type for a software stop action.
	TaskSoftwareStop = "software:stop"
	// TaskSoftwareRestart is the Asynq task type for a software restart action.
	TaskSoftwareRestart = "software:restart"
	// TaskSoftwareVerify is the Asynq task type for a software verify action.
	TaskSoftwareVerify = "software:verify"
	// TaskSoftwareReinstall is the Asynq task type for a software reinstall action.
	TaskSoftwareReinstall = "software:reinstall"
	// TaskSoftwareUninstall is the Asynq task type for a software uninstall action.
	TaskSoftwareUninstall = "software:uninstall"
)

// softwareTaskTypeByAction maps Action → Asynq task type name.
var softwareTaskTypeByAction = map[software.Action]string{
	software.ActionInstall:   TaskSoftwareInstall,
	software.ActionUpgrade:   TaskSoftwareUpgrade,
	software.ActionStart:     TaskSoftwareStart,
	software.ActionStop:      TaskSoftwareStop,
	software.ActionRestart:   TaskSoftwareRestart,
	software.ActionVerify:    TaskSoftwareVerify,
	software.ActionReinstall: TaskSoftwareReinstall,
	software.ActionUninstall: TaskSoftwareUninstall,
}

// ─── Payload ─────────────────────────────────────────────

// SoftwareActionPayload is the Asynq task payload for all software delivery actions.
type SoftwareActionPayload struct {
	OperationID  string                `json:"operation_id"`
	ServerID     string                `json:"server_id"`
	ComponentKey software.ComponentKey `json:"component_key"`
	Action       software.Action       `json:"action"`
	UserID       string                `json:"user_id"`
	UserEmail    string                `json:"user_email"`
}

var ErrSoftwareOperationInFlight = errors.New("software operation already in flight")
var ErrSoftwareComponentNotFound = errors.New("software component not found in server catalog")
var ErrSoftwareActionUnsupported = errors.New("software action unsupported for component")

// ─── Constructors ─────────────────────────────────────────

// NewSoftwareActionTask creates an Asynq task for a software delivery action.
// Returns an error if server_id, component_key, or action is empty.
func NewSoftwareActionTask(operationID, serverID string, componentKey software.ComponentKey, action software.Action, userID, userEmail string) (*asynq.Task, error) {
	if strings.TrimSpace(operationID) == "" {
		return nil, fmt.Errorf("operation_id is required")
	}
	if strings.TrimSpace(serverID) == "" {
		return nil, fmt.Errorf("server_id is required")
	}
	if strings.TrimSpace(string(componentKey)) == "" {
		return nil, fmt.Errorf("component_key is required")
	}
	if strings.TrimSpace(string(action)) == "" {
		return nil, fmt.Errorf("action is required")
	}
	taskType, ok := softwareTaskTypeByAction[action]
	if !ok {
		return nil, fmt.Errorf("unsupported software action: %q", action)
	}
	payload, err := json.Marshal(SoftwareActionPayload{
		OperationID:  operationID,
		ServerID:     serverID,
		ComponentKey: componentKey,
		Action:       action,
		UserID:       userID,
		UserEmail:    userEmail,
	})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(taskType, payload), nil
}

// EnqueueSoftwareAction creates and enqueues an Asynq task for a software delivery action.
// Returns an error if the client is nil or if task creation fails.
func EnqueueSoftwareAction(client *asynq.Client, operationID, serverID string, componentKey software.ComponentKey, action software.Action, userID, userEmail string) error {
	if client == nil {
		return fmt.Errorf("asynq client is not configured")
	}
	task, err := NewSoftwareActionTask(operationID, serverID, componentKey, action, userID, userEmail)
	if err != nil {
		return err
	}
	_, err = client.Enqueue(task, asynq.Queue("default"))
	return err
}

// PrepareSoftwareOperation creates the accepted software operation synchronously so callers
// can return a stable operation_id to API clients before queue dispatch.
func PrepareSoftwareOperation(app core.App, serverID string, componentKey software.ComponentKey, action software.Action) (*core.Record, error) {
	if strings.TrimSpace(serverID) == "" {
		return nil, fmt.Errorf("server_id is required")
	}
	if strings.TrimSpace(string(componentKey)) == "" {
		return nil, fmt.Errorf("component_key is required")
	}
	if strings.TrimSpace(string(action)) == "" {
		return nil, fmt.Errorf("action is required")
	}
	if err := validateSoftwareActionSupport(componentKey, action); err != nil {
		return nil, err
	}
	inFlight, err := hasSoftwareOperationInFlight(app, serverID, string(componentKey))
	if err != nil {
		return nil, err
	}
	if inFlight {
		return nil, fmt.Errorf("%w for server %q component %q", ErrSoftwareOperationInFlight, serverID, componentKey)
	}
	return createSoftwareOperationRecord(app, SoftwareActionPayload{
		ServerID:     serverID,
		ComponentKey: componentKey,
		Action:       action,
	})
}

func validateSoftwareActionSupport(componentKey software.ComponentKey, action software.Action) error {
	cat, err := swcatalog.LoadServerCatalog()
	if err != nil {
		return fmt.Errorf("load server catalog: %w", err)
	}
	for _, entry := range cat.Components {
		if entry.ComponentKey != componentKey {
			continue
		}
		for _, supported := range entry.SupportedActions {
			if supported == action {
				return nil
			}
		}
		return fmt.Errorf("%w: component %q does not expose action %q", ErrSoftwareActionUnsupported, componentKey, action)
	}
	return fmt.Errorf("%w: component %q", ErrSoftwareComponentNotFound, componentKey)
}

// ─── Phase Ordering ───────────────────────────────────────

// softwarePhaseOrder maps each OperationPhase to its ordinal position in the execution sequence.
// Succeeded and Failed share the same ordinal (both are terminal).
var softwarePhaseOrder = map[software.OperationPhase]int{
	software.OperationPhaseAccepted:          0,
	software.OperationPhasePreflight:         1,
	software.OperationPhaseExecuting:         2,
	software.OperationPhaseVerifying:         3,
	software.OperationPhaseSucceeded:         4,
	software.OperationPhaseFailed:            4,
	software.OperationPhaseAttentionRequired: 4,
}

// isSoftwarePhaseForward returns true when transitioning from current → next is a forward move.
// Phase transitions must only go forward; regressing a phase is not permitted.
func isSoftwarePhaseForward(current, next software.OperationPhase) bool {
	c, cOk := softwarePhaseOrder[current]
	n, nOk := softwarePhaseOrder[next]
	return cOk && nOk && n > c
}

// ─── Executor Factory ─────────────────────────────────────

// softwareExecutorFactory resolves a ComponentExecutor for the given server and user.
// The default wires in the SSH-based executor; overridable in tests.
var softwareExecutorFactory = func(app core.App, serverID, userID string) (software.ComponentExecutor, error) {
	return swexecutor.NewSSHExecutor(app, serverID, userID)
}

// ─── Worker Handler ───────────────────────────────────────

// handleSoftwareAction is the shared Asynq handler for all software delivery action tasks.
// It implements the phase-step loop:
//
//	accepted → preflight → executing → verifying → succeeded/failed
func (w *Worker) handleSoftwareAction(ctx context.Context, t *asynq.Task) error {
	var payload SoftwareActionPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("parse software action payload: %w", err)
	}
	if payload.ServerID == "" || string(payload.ComponentKey) == "" {
		return fmt.Errorf("software action payload missing required fields")
	}

	// Check for an already-running operation on this component + server.
	// One active in-flight operation per component per server is enforced.
	opRecord, err := w.resolveSoftwareOperationRecord(payload)
	if err != nil {
		return fmt.Errorf("resolve software operation: %w", err)
	}

	// Execute the phase-step loop.
	w.runSoftwarePhaseLoop(ctx, opRecord, payload)
	return nil
}

func (w *Worker) resolveSoftwareOperationRecord(payload SoftwareActionPayload) (*core.Record, error) {
	if strings.TrimSpace(payload.OperationID) != "" {
		record, err := w.app.FindRecordById(collections.SoftwareOperations, payload.OperationID)
		if err != nil {
			return nil, fmt.Errorf("load operation %q: %w", payload.OperationID, err)
		}
		if record.GetString("server_id") != payload.ServerID ||
			record.GetString("component_key") != string(payload.ComponentKey) ||
			record.GetString("action") != string(payload.Action) {
			return nil, fmt.Errorf("operation %q does not match task payload", payload.OperationID)
		}
		return record, nil
	}

	inFlight, err := w.hasSoftwareOperationInFlight(payload.ServerID, string(payload.ComponentKey))
	if err != nil {
		return nil, fmt.Errorf("check in-flight operation: %w", err)
	}
	if inFlight {
		return nil, fmt.Errorf("operation already in flight for server %q component %q", payload.ServerID, payload.ComponentKey)
	}

	return w.createSoftwareOperation(payload)
}

// hasSoftwareOperationInFlight returns true when there is already a non-terminal operation
// for the given server + component combination.
func (w *Worker) hasSoftwareOperationInFlight(serverID, componentKey string) (bool, error) {
	return hasSoftwareOperationInFlight(w.app, serverID, componentKey)
}

func hasSoftwareOperationInFlight(app core.App, serverID, componentKey string) (bool, error) {
	col, err := app.FindCollectionByNameOrId(collections.SoftwareOperations)
	if err != nil {
		return false, nil // collection not yet created; allow operation
	}
	records, err := app.FindRecordsByFilter(
		col,
		fmt.Sprintf("server_id = '%s' && component_key = '%s' && terminal_status = '%s'",
			escapePBFilterValue(serverID),
			escapePBFilterValue(componentKey),
			escapePBFilterValue(string(software.TerminalStatusNone))),
		"-created",
		1,
		0,
	)
	if err != nil {
		return false, err
	}
	return len(records) > 0, nil
}

// createSoftwareOperation creates a new software_operations record in the accepted phase.
func (w *Worker) createSoftwareOperation(payload SoftwareActionPayload) (*core.Record, error) {
	return createSoftwareOperationRecord(w.app, payload)
}

func createSoftwareOperationRecord(app core.App, payload SoftwareActionPayload) (*core.Record, error) {
	col, err := app.FindCollectionByNameOrId(collections.SoftwareOperations)
	if err != nil {
		return nil, fmt.Errorf("software_operations collection not found: %w", err)
	}
	record := core.NewRecord(col)
	record.Set("server_id", payload.ServerID)
	record.Set("component_key", string(payload.ComponentKey))
	record.Set("action", string(payload.Action))
	record.Set("phase", string(software.OperationPhaseAccepted))
	record.Set("terminal_status", string(software.TerminalStatusNone))
	if err := app.Save(record); err != nil {
		return nil, err
	}
	return record, nil
}

// advanceSoftwarePhase updates the operation record to a new phase, if the transition is forward.
func (w *Worker) advanceSoftwarePhase(record *core.Record, phase software.OperationPhase) {
	current := software.OperationPhase(record.GetString("phase"))
	if !isSoftwarePhaseForward(current, phase) {
		log.Printf("software operation %s: ignoring non-forward phase transition %q → %q",
			record.Id, current, phase)
		return
	}
	record.Set("phase", string(phase))
	if err := w.app.Save(record); err != nil {
		log.Printf("software operation %s: advance phase to %q: %v", record.Id, phase, err)
	}
}

// failSoftwareOperation records a terminal failure on the operation.
func (w *Worker) failSoftwareOperation(record *core.Record, failurePhase software.OperationPhase, failureCode software.FailureCode, reason string) {
	record.Set("phase", string(software.OperationPhaseFailed))
	record.Set("terminal_status", string(software.TerminalStatusFailed))
	if failurePhase != "" {
		record.Set("failure_phase", string(failurePhase))
	}
	if failureCode != "" {
		record.Set("failure_code", string(failureCode))
	}
	record.Set("failure_reason", reason)
	if err := w.app.Save(record); err != nil {
		log.Printf("software operation %s: save failure state: %v", record.Id, err)
	}
}

func (w *Worker) failSoftwareOperationWithAudit(record *core.Record, payload SoftwareActionPayload, failurePhase software.OperationPhase, failureCode software.FailureCode, reason string) {
	w.failSoftwareOperation(record, failurePhase, failureCode, reason)
	w.writeSoftwareAudit(record, payload, "failed")
}

func (w *Worker) failSoftwareOperationAndRefreshSnapshot(ctx context.Context, record *core.Record, payload SoftwareActionPayload, failurePhase software.OperationPhase, failureCode software.FailureCode, reason string, entry software.CatalogEntry, resolved software.ResolvedTemplate, executor software.ComponentExecutor) {
	w.failSoftwareOperationWithAudit(record, payload, failurePhase, failureCode, reason)
	w.refreshSoftwareSnapshot(ctx, record, payload, entry, resolved, executor)
}

func (w *Worker) markSoftwareOperationAttentionRequired(record *core.Record, failurePhase software.OperationPhase, failureCode software.FailureCode, reason string) {
	record.Set("phase", string(software.OperationPhaseAttentionRequired))
	record.Set("terminal_status", string(software.TerminalStatusAttentionRequired))
	if failurePhase != "" {
		record.Set("failure_phase", string(failurePhase))
	}
	if failureCode != "" {
		record.Set("failure_code", string(failureCode))
	}
	record.Set("failure_reason", reason)
	if err := w.app.Save(record); err != nil {
		log.Printf("software operation %s: save attention_required state: %v", record.Id, err)
	}
}

func (w *Worker) markSoftwareOperationAttentionRequiredAndRefreshSnapshot(ctx context.Context, record *core.Record, payload SoftwareActionPayload, failurePhase software.OperationPhase, failureCode software.FailureCode, reason string, entry software.CatalogEntry, resolved software.ResolvedTemplate, executor software.ComponentExecutor) {
	w.markSoftwareOperationAttentionRequired(record, failurePhase, failureCode, reason)
	w.writeSoftwareAudit(record, payload, "attention_required")
	w.refreshSoftwareSnapshot(ctx, record, payload, entry, resolved, executor)
}

func classifyVerificationFailure(action software.Action, err error) software.FailureCode {
	if action == software.ActionUninstall {
		return software.FailureCodeUninstallTruthMismatch
	}
	if err != nil && err.Error() == "component is degraded" {
		return software.FailureCodeVerificationDegraded
	}
	return software.FailureCodeVerificationError
}

// succeedSoftwareOperation records a terminal success on the operation.
func (w *Worker) succeedSoftwareOperation(record *core.Record) {
	record.Set("phase", string(software.OperationPhaseSucceeded))
	record.Set("terminal_status", string(software.TerminalStatusSuccess))
	if err := w.app.Save(record); err != nil {
		log.Printf("software operation %s: save success state: %v", record.Id, err)
	}
}

func (w *Worker) succeedSoftwareOperationAndRefreshSnapshot(ctx context.Context, record *core.Record, payload SoftwareActionPayload, entry software.CatalogEntry, resolved software.ResolvedTemplate, executor software.ComponentExecutor) {
	w.succeedSoftwareOperation(record)
	w.writeSoftwareAudit(record, payload, "success")
	w.refreshSoftwareSnapshot(ctx, record, payload, entry, resolved, executor)
}

func (w *Worker) verifySoftwareActionOutcome(ctx context.Context, serverID string, action software.Action, resolved software.ResolvedTemplate, executor software.ComponentExecutor) error {
	switch action {
	case software.ActionInstall, software.ActionUpgrade, software.ActionStart, software.ActionRestart, software.ActionReinstall, software.ActionVerify:
		detail, err := executor.Verify(ctx, serverID, resolved)
		if err != nil {
			return err
		}
		if detail.VerificationState == software.VerificationStateDegraded {
			return fmt.Errorf("component is degraded")
		}
		return nil
	case software.ActionStop:
		detail, err := executor.Verify(ctx, serverID, resolved)
		if err != nil {
			return err
		}
		if detail.VerificationState == software.VerificationStateHealthy {
			return fmt.Errorf("component is still active")
		}
		return nil
	case software.ActionUninstall:
		installedState, _, err := executor.Detect(ctx, serverID, resolved)
		if err != nil {
			return err
		}
		if installedState == software.InstalledStateInstalled {
			return fmt.Errorf("component is still detected as installed")
		}
		return nil
	default:
		return fmt.Errorf("unsupported verification action: %q", action)
	}
}

// runSoftwarePhaseLoop implements the phase-step loop for a single software delivery operation.
func (w *Worker) runSoftwarePhaseLoop(ctx context.Context, record *core.Record, payload SoftwareActionPayload) {
	serverID := payload.ServerID
	componentKey := payload.ComponentKey
	action := payload.Action

	// ── Phase: Preflight ─────────────────────────────────
	w.advanceSoftwarePhase(record, software.OperationPhasePreflight)

	cat, err := swcatalog.LoadServerCatalog()
	if err != nil {
		w.failSoftwareOperationWithAudit(record, payload, software.OperationPhasePreflight, software.FailureCodePreflightError, fmt.Sprintf("load catalog: %v", err))
		return
	}
	reg, err := swcatalog.LoadTemplateRegistry()
	if err != nil {
		w.failSoftwareOperationWithAudit(record, payload, software.OperationPhasePreflight, software.FailureCodePreflightError, fmt.Sprintf("load template registry: %v", err))
		return
	}

	var entry software.CatalogEntry
	for _, e := range cat.Components {
		if e.ComponentKey == componentKey {
			entry = e
			break
		}
	}
	if string(entry.ComponentKey) == "" {
		w.failSoftwareOperationWithAudit(record, payload, software.OperationPhasePreflight, software.FailureCodePreflightError, fmt.Sprintf("component %q not found in catalog", componentKey))
		return
	}

	tpl, ok := reg.Templates[entry.TemplateRef]
	if !ok {
		w.failSoftwareOperationWithAudit(record, payload, software.OperationPhasePreflight, software.FailureCodePreflightError, fmt.Sprintf("template_ref %q not in registry", entry.TemplateRef))
		return
	}

	resolved := swcatalog.ResolveTemplate(entry, tpl)

	executor, exErr := softwareExecutorFactory(w.app, serverID, payload.UserID)
	if exErr != nil {
		w.failSoftwareOperationWithAudit(record, payload, software.OperationPhasePreflight, software.FailureCodePreflightError, fmt.Sprintf("create executor: %v", exErr))
		return
	}

	readiness, err := executor.RunPreflight(ctx, serverID, resolved)
	if err != nil {
		w.failSoftwareOperationAndRefreshSnapshot(ctx, record, payload, software.OperationPhasePreflight, software.FailureCodePreflightError, fmt.Sprintf("run preflight: %v", err), entry, resolved, executor)
		return
	}
	if !readiness.OK {
		w.failSoftwareOperationAndRefreshSnapshot(ctx, record, payload, software.OperationPhasePreflight, software.FailureCodePreflightBlocked, fmt.Sprintf("preflight failed: %v", readiness.Issues), entry, resolved, executor)
		return
	}

	// ── Phase: Executing ─────────────────────────────────
	w.advanceSoftwarePhase(record, software.OperationPhaseExecuting)

	switch action {
	case software.ActionInstall:
		_, err = executor.Install(ctx, serverID, resolved)
	case software.ActionUpgrade:
		_, err = executor.Upgrade(ctx, serverID, resolved)
	case software.ActionStart:
		_, err = executor.Start(ctx, serverID, resolved)
	case software.ActionStop:
		_, err = executor.Stop(ctx, serverID, resolved)
	case software.ActionRestart:
		_, err = executor.Restart(ctx, serverID, resolved)
	case software.ActionUninstall:
		_, err = executor.Uninstall(ctx, serverID, resolved)
	case software.ActionVerify:
		err = nil
	case software.ActionReinstall:
		_, err = executor.Reinstall(ctx, serverID, resolved)
	default:
		w.failSoftwareOperationWithAudit(record, payload, software.OperationPhaseExecuting, software.FailureCodeExecutionError, fmt.Sprintf("unsupported action: %q", action))
		return
	}

	if err != nil {
		w.failSoftwareOperationAndRefreshSnapshot(ctx, record, payload, software.OperationPhaseExecuting, software.FailureCodeExecutionError, fmt.Sprintf("execute %q: %v", action, err), entry, resolved, executor)
		return
	}

	// ── Phase: Verifying ─────────────────────────────────
	w.advanceSoftwarePhase(record, software.OperationPhaseVerifying)

	if err := w.verifySoftwareActionOutcome(ctx, serverID, action, resolved, executor); err != nil {
		w.markSoftwareOperationAttentionRequiredAndRefreshSnapshot(ctx, record, payload, software.OperationPhaseVerifying, classifyVerificationFailure(action, err), fmt.Sprintf("post-action verification failed: %v", err), entry, resolved, executor)
		return
	}

	// ── Phase: Succeeded ─────────────────────────────────
	w.succeedSoftwareOperationAndRefreshSnapshot(ctx, record, payload, entry, resolved, executor)
}

func (w *Worker) refreshSoftwareSnapshot(ctx context.Context, record *core.Record, payload SoftwareActionPayload, entry software.CatalogEntry, resolved software.ResolvedTemplate, executor software.ComponentExecutor) {
	if executor == nil {
		return
	}

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

	detectedState, detectedVersion, detectErr := executor.Detect(ctx, payload.ServerID, resolved)
	if detectErr == nil {
		summary.InstalledState = detectedState
		summary.DetectedVersion = detectedVersion
		detail.InstalledState = detectedState
		detail.DetectedVersion = detectedVersion
	}

	preflight, err := executor.RunPreflight(ctx, payload.ServerID, resolved)
	if err != nil {
		preflight = software.TargetReadinessResult{Issues: []string{"preflight_error: " + err.Error()}}
	}
	detail.Preflight = &preflight

	verification := &software.SoftwareVerificationResult{State: software.VerificationStateUnknown}
	verifiedDetail, verifyErr := executor.Verify(ctx, payload.ServerID, resolved)
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
		verification.State = summary.VerificationState
		if verifiedDetail.VerificationState == software.VerificationStateDegraded {
			verification.Reason = "service verification returned degraded state"
		}
	} else {
		verification.Reason = verifyErr.Error()
		if detectErr == nil && detectedState == software.InstalledStateNotInstalled {
			verification.Reason = "component is not installed"
		}
	}
	detail.Verification = verification
	detail.LastAction = &software.SoftwareDeliveryLastAction{
		Action: string(payload.Action),
		Result: terminalActionResult(software.TerminalStatus(record.GetString("terminal_status"))),
		At:     record.GetString("updated"),
	}
	summary.LastAction = detail.LastAction
	detail.SoftwareComponentSummary = summary

	_ = swprojection.UpsertInventorySnapshot(w.app, software.TargetTypeServer, payload.ServerID, swprojection.Snapshot{
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
	})
}

func terminalActionResult(status software.TerminalStatus) string {
	if status == software.TerminalStatusSuccess {
		return "success"
	}
	if status == software.TerminalStatusFailed {
		return "failed"
	}
	if status == software.TerminalStatusAttentionRequired {
		return "attention_required"
	}
	return "pending"
}

// writeSoftwareAudit writes an audit record for a completed software delivery operation.
// Audit records always use the server.software.{action} action names from model constants.
// The audit record is always written after the terminal state is persisted.
func (w *Worker) writeSoftwareAudit(record *core.Record, payload SoftwareActionPayload, result string) {
	auditActions := map[software.Action]string{
		software.ActionInstall:   software.AuditActionInstall,
		software.ActionUpgrade:   software.AuditActionUpgrade,
		software.ActionStart:     software.AuditActionStart,
		software.ActionStop:      software.AuditActionStop,
		software.ActionRestart:   software.AuditActionRestart,
		software.ActionVerify:    software.AuditActionVerify,
		software.ActionReinstall: software.AuditActionReinstall,
		software.ActionUninstall: software.AuditActionUninstall,
	}
	auditAction, ok := auditActions[payload.Action]
	if !ok {
		log.Printf("software operation %s: unknown action %q for audit", record.Id, payload.Action)
		return
	}

	userID := strings.TrimSpace(payload.UserID)
	if userID == "" {
		userID = "unknown"
	}

	if err := func() error {
		audit.Write(w.app, audit.Entry{
			UserID:       userID,
			UserEmail:    payload.UserEmail,
			Action:       auditAction,
			ResourceType: "server_component",
			ResourceID:   string(payload.ComponentKey),
			ResourceName: string(payload.ComponentKey),
			Status:       result,
			Detail: map[string]any{
				"operation_id":  record.Id,
				"component_key": string(payload.ComponentKey),
				"action":        string(payload.Action),
				"server_id":     payload.ServerID,
			},
		})
		return nil
	}(); err != nil {
		log.Printf("software operation %s: write audit: %v", record.Id, err)
	}
}
