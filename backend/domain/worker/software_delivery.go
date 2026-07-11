package worker

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/domain/software"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
	swexecutor "github.com/websoft9/appos/backend/domain/software/executor"
	swprojection "github.com/websoft9/appos/backend/domain/software/projection"
	"github.com/websoft9/appos/backend/infra/collections"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
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

var softwareActionTitleCaser = cases.Title(language.English)

var errSoftwareOperationTerminal = errors.New("software operation already terminal")

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
	AppOSBaseURL string                `json:"appos_base_url,omitempty"`
}

var ErrSoftwareOperationInFlight = errors.New("software operation already in flight")

const softwareOperationOrphanThreshold = 10 * time.Minute

// Keep the stored secret prefix stable so existing managed collectors do not
// need a token rotation when internal naming becomes collector-neutral.
const monitorCollectorTokenPrefix = "monitor-agent-token-"
const monitorWritePath = "/api/monitor/write"
const telegrafManagedVersion = "1.38.4"

type softwareOutputLogger interface {
	SetOutputLogger(func(string))
}

func applySoftwareActionTimeout(ctx context.Context, resolved software.ResolvedTemplate, action software.Action) (context.Context, context.CancelFunc, time.Duration) {
	timeout := resolved.ActionTimeouts.DurationFor(action)
	if timeout <= 0 {
		return ctx, func() {}, 0
	}
	wrappedCtx, cancel := context.WithTimeout(ctx, timeout)
	return wrappedCtx, cancel, timeout
}

var ErrSoftwareComponentNotFound = errors.New("software component not found in server catalog")
var ErrSoftwareActionUnsupported = errors.New("software action unsupported for component")

// ─── Constructors ─────────────────────────────────────────

// NewSoftwareActionTask creates an Asynq task for a software delivery action.
// Returns an error if server_id, component_key, or action is empty.
func NewSoftwareActionTask(operationID, serverID string, componentKey software.ComponentKey, action software.Action, userID, userEmail, apposBaseURL string) (*asynq.Task, error) {
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
		AppOSBaseURL: strings.TrimSpace(apposBaseURL),
	})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(taskType, payload), nil
}

// EnqueueSoftwareAction creates and enqueues an Asynq task for a software delivery action.
// Returns an error if the client is nil or if task creation fails.
func EnqueueSoftwareAction(client *asynq.Client, operationID, serverID string, componentKey software.ComponentKey, action software.Action, userID, userEmail, apposBaseURL string) error {
	if client == nil {
		return fmt.Errorf("asynq client is not configured")
	}
	task, err := NewSoftwareActionTask(operationID, serverID, componentKey, action, userID, userEmail, apposBaseURL)
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
	inFlight, err := findInFlightSoftwareOperation(app, serverID, string(componentKey))
	if err != nil {
		return nil, err
	}
	if inFlight != nil && !allowsConcurrentSoftwareAction(action, software.Action(inFlight.GetString("action"))) {
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
		if errors.Is(err, errSoftwareOperationTerminal) {
			return fmt.Errorf("%w: %v", asynq.SkipRetry, err)
		}
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
		if software.TerminalStatus(record.GetString("terminal_status")) != software.TerminalStatusNone {
			return nil, fmt.Errorf("%w: operation %q is already %s", errSoftwareOperationTerminal, payload.OperationID, record.GetString("terminal_status"))
		}
		return record, nil
	}

	inFlight, err := w.findInFlightSoftwareOperation(payload.ServerID, string(payload.ComponentKey))
	if err != nil {
		return nil, fmt.Errorf("check in-flight operation: %w", err)
	}
	if inFlight != nil && !allowsConcurrentSoftwareAction(payload.Action, software.Action(inFlight.GetString("action"))) {
		return nil, fmt.Errorf("operation already in flight for server %q component %q", payload.ServerID, payload.ComponentKey)
	}

	return w.createSoftwareOperation(payload)
}

// hasSoftwareOperationInFlight returns true when there is already a non-terminal operation
// for the given server + component combination.
func (w *Worker) findInFlightSoftwareOperation(serverID, componentKey string) (*core.Record, error) {
	return findInFlightSoftwareOperation(w.app, serverID, componentKey)
}

func allowsConcurrentSoftwareAction(nextAction, inFlightAction software.Action) bool {
	return nextAction == software.ActionInstall && inFlightAction == software.ActionVerify
}

// recoverOrphanedSoftwareOperations marks stale non-terminal software_operations records
// as failed. It is intentionally conservative: recently updated records may still have
// an Asynq task pending/running/retrying, so only old executing/verifying records are
// treated as true orphans.
func (w *Worker) recoverOrphanedSoftwareOperations() error {
	col, err := w.app.FindCollectionByNameOrId(collections.SoftwareOperations)
	if err != nil {
		return nil // collection not yet created; nothing to recover
	}

	records, err := w.app.FindRecordsByFilter(
		col,
		fmt.Sprintf("terminal_status = '%s'", escapePBFilterValue(string(software.TerminalStatusNone))),
		"-created",
		500,
		0,
	)
	if err != nil {
		return err
	}

	for _, record := range records {
		orphanedPhase := record.GetString("phase")
		if !isRecoverableSoftwareOrphanPhase(software.OperationPhase(orphanedPhase)) {
			continue
		}
		updatedAt := record.GetDateTime("updated").Time()
		if updatedAt.IsZero() || time.Since(updatedAt) < softwareOperationOrphanThreshold {
			continue
		}
		failureCode := orphanedPhaseToFailureCode(software.OperationPhase(orphanedPhase))
		record.Set("phase", string(software.OperationPhaseFailed))
		record.Set("terminal_status", string(software.TerminalStatusFailed))
		if orphanedPhase != "" {
			record.Set("failure_phase", orphanedPhase)
		}
		record.Set("failure_code", string(failureCode))
		record.Set("failure_reason", "operation orphaned after worker restart")
		appendSoftwareOperationEvent(record, "Operation marked failed because it was stale after worker restart.")
		if err := w.app.Save(record); err != nil {
			log.Printf("recover orphaned software operation %s: %v", record.Id, err)
		}
	}
	return nil
}

func isRecoverableSoftwareOrphanPhase(phase software.OperationPhase) bool {
	switch phase {
	case software.OperationPhaseAccepted,
		software.OperationPhasePreflight,
		software.OperationPhaseExecuting,
		software.OperationPhaseVerifying:
		return true
	default:
		return false
	}
}

func orphanedPhaseToFailureCode(phase software.OperationPhase) software.FailureCode {
	switch phase {
	case software.OperationPhaseAccepted:
		return software.FailureCodeEnqueueError
	case software.OperationPhasePreflight:
		return software.FailureCodePreflightError
	case software.OperationPhaseExecuting:
		return software.FailureCodeExecutionError
	case software.OperationPhaseVerifying:
		return software.FailureCodeVerificationError
	default:
		return software.FailureCodeExecutionError
	}
}

func findInFlightSoftwareOperation(app core.App, serverID, componentKey string) (*core.Record, error) {
	col, err := app.FindCollectionByNameOrId(collections.SoftwareOperations)
	if err != nil {
		return nil, nil // collection not yet created; allow operation
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
		return nil, err
	}
	if len(records) == 0 {
		return nil, nil
	}
	return records[0], nil
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
	record.Set("event_log", formatSoftwareOperationEvent(fmt.Sprintf("Accepted %s request for %s.", payload.Action, payload.ComponentKey)))
	if err := app.Save(record); err != nil {
		return nil, err
	}
	return record, nil
}

func formatSoftwareOperationEvent(message string) string {
	trimmed := strings.TrimSpace(message)
	if trimmed == "" {
		return ""
	}
	return fmt.Sprintf("%s · %s", time.Now().UTC().Format(time.RFC3339), trimmed)
}

func appendSoftwareOperationEvent(record *core.Record, message string) {
	entry := formatSoftwareOperationEvent(message)
	if entry == "" {
		return
	}
	current := strings.TrimSpace(record.GetString("event_log"))
	if current == "" {
		record.Set("event_log", entry)
		return
	}
	lines := append(strings.Split(current, "\n"), entry)
	if len(lines) > 80 {
		lines = lines[len(lines)-80:]
	}
	record.Set("event_log", strings.Join(lines, "\n"))
}

func (w *Worker) logSoftwareOperationEvent(record *core.Record, message string) {
	appendSoftwareOperationEvent(record, message)
	if err := w.app.Save(record); err != nil {
		log.Printf("software operation %s: save event log: %v", record.Id, err)
	}
}

func describeSoftwareExecutionPlan(action software.Action, resolved software.ResolvedTemplate) []string {
	plan := []string{}
	switch action {
	case software.ActionInstall:
		plan = append(plan, describeSoftwareStep("Install", resolved.Install.Strategy, resolved.Install.PackageName, resolved.Install.PackageNames, resolved.Install.ScriptPath, resolved.Install.ScriptURL, resolved.Verify.ServiceName))
	case software.ActionUpgrade:
		plan = append(plan, describeSoftwareStep("Upgrade/Fix", resolved.Upgrade.Strategy, resolved.Upgrade.PackageName, resolved.Upgrade.PackageNames, resolved.Upgrade.ScriptPath, resolved.Upgrade.ScriptURL, resolved.Verify.ServiceName))
	case software.ActionReinstall:
		if resolved.Reinstall.Strategy == "reinstall" {
			plan = append(plan, "Reinstall delegates to the install workflow.")
			plan = append(plan, describeSoftwareStep("Install", resolved.Install.Strategy, resolved.Install.PackageName, resolved.Install.PackageNames, resolved.Install.ScriptPath, resolved.Install.ScriptURL, resolved.Verify.ServiceName))
		} else {
			plan = append(plan, describeSoftwareStep("Reinstall", resolved.Reinstall.Strategy, "", nil, "", "", resolved.Verify.ServiceName))
		}
	case software.ActionUninstall:
		plan = append(plan, describeSoftwareStep("Uninstall", resolved.Uninstall.Strategy, resolved.Uninstall.PackageName, resolved.Uninstall.PackageNames, resolved.Uninstall.ScriptPath, resolved.Uninstall.ScriptURL, resolved.Verify.ServiceName))
	case software.ActionStart, software.ActionStop, software.ActionRestart:
		if strings.TrimSpace(resolved.Verify.ServiceName) != "" {
			plan = append(plan, fmt.Sprintf("%s service %s via systemd.", softwareActionTitleCaser.String(string(action)), resolved.Verify.ServiceName))
		} else {
			plan = append(plan, fmt.Sprintf("Run %s action.", action))
		}
	case software.ActionVerify:
		plan = append(plan, fmt.Sprintf("Verify runtime state for %s.", resolved.ComponentKey))
	}
	filtered := plan[:0]
	for _, item := range plan {
		if strings.TrimSpace(item) != "" {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func describeSoftwareStep(label, strategy, packageName string, packageNames []string, scriptPath, scriptURL, serviceName string) string {
	strategy = strings.TrimSpace(strategy)
	switch strategy {
	case "package":
		name := strings.TrimSpace(packageName)
		if name == "" && len(packageNames) > 0 {
			name = strings.Join(packageNames, ", ")
		}
		if name == "" {
			name = "configured package set"
		}
		return fmt.Sprintf("%s via package manager for %s.", label, name)
	case "script":
		source := strings.TrimSpace(scriptPath)
		if source == "" {
			source = strings.TrimSpace(scriptURL)
		}
		if source == "" {
			source = "managed script"
		}
		return fmt.Sprintf("%s via script %s.", label, source)
	case "reinstall":
		return fmt.Sprintf("%s via reinstall delegation.", label)
	case "":
		if strings.TrimSpace(serviceName) != "" {
			return fmt.Sprintf("%s for service %s.", label, serviceName)
		}
		return fmt.Sprintf("%s requested.", label)
	default:
		return fmt.Sprintf("%s using %s strategy.", label, strategy)
	}
}

func monitorCollectorTokenSecretName(serverID string) string {
	return monitorCollectorTokenPrefix + strings.TrimSpace(serverID)
}

func getOrIssueSoftwareMonitorCollectorToken(app core.App, serverID string) (string, error) {
	name := monitorCollectorTokenSecretName(serverID)
	secret, err := secrets.FindSystemSecretByNameAndType(app, name, "token")
	if err == nil && secret != nil {
		value, readErr := secrets.ReadSystemSingleValue(secret)
		if readErr != nil {
			return "", readErr
		}
		if strings.TrimSpace(value) != "" {
			return value, nil
		}
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	_, err = secrets.UpsertSystemSingleValue(app, secret, name, "token", token)
	if err != nil {
		return "", err
	}
	return token, nil
}

func buildSoftwareMonitorWriteURL(app core.App, payload SoftwareActionPayload) (string, error) {
	_ = app
	baseURL := software.NormalizeAppOSBaseURL(payload.AppOSBaseURL)
	if baseURL == "" {
		return "", fmt.Errorf("AppOS callback URL is required to configure monitor output")
	}
	return baseURL + monitorWritePath, nil
}

func buildSoftwareTelegrafConfig(settings monitor.ManagedCollectorPolicySettings, serverID string, outputURL string, username string, password string) (string, error) {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return "", fmt.Errorf("server id is required")
	}
	outputURL = strings.TrimSpace(outputURL)
	if outputURL == "" {
		return "", fmt.Errorf("telegraf output url is required")
	}
	username = strings.TrimSpace(username)
	if username == "" {
		return "", fmt.Errorf("telegraf output username is required")
	}
	password = strings.TrimSpace(password)
	if password == "" {
		return "", fmt.Errorf("telegraf output password is required")
	}
	return strings.Join([]string{
		"# Managed by AppOS. Changes may be overwritten by Components telegraf actions.",
		"[global_tags]",
		fmt.Sprintf("  appos_server_id = %q", serverID),
		"",
		"[agent]",
		fmt.Sprintf("  interval = %q", settings.CollectionInterval.String()),
		"  round_interval = true",
		fmt.Sprintf("  metric_batch_size = %d", settings.MetricBatchSize),
		fmt.Sprintf("  metric_buffer_limit = %d", settings.MetricBufferLimit),
		fmt.Sprintf("  collection_jitter = %q", settings.CollectionJitter.String()),
		fmt.Sprintf("  flush_interval = %q", settings.FlushInterval.String()),
		fmt.Sprintf("  flush_jitter = %q", settings.FlushJitter.String()),
		"  precision = \"1s\"",
		"  omit_hostname = false",
		"",
		"[[inputs.cpu]]",
		"  percpu = false",
		"  totalcpu = true",
		"  collect_cpu_time = true",
		"  report_active = true",
		"",
		"[[inputs.mem]]",
		"",
		"[[inputs.system]]",
		"",
		"[[inputs.disk]]",
		"  ignore_fs = [\"tmpfs\", \"devtmpfs\", \"devfs\", \"iso9660\", \"overlay\", \"aufs\", \"squashfs\"]",
		"",
		"[[inputs.diskio]]",
		"",
		"[[inputs.net]]",
		"",
		"[[inputs.docker]]",
		"  gather_services = false",
		"  source_tag = true",
		"  container_state_include = [\"running\"]",
		"  docker_label_include = [\"com.docker.compose.project\", \"com.docker.compose.service\"]",
		"",
		"[[outputs.http]]",
		fmt.Sprintf("  url = %q", outputURL),
		"  method = \"POST\"",
		fmt.Sprintf("  username = %q", username),
		fmt.Sprintf("  password = %q", password),
		"  data_format = \"influx\"",
		"  non_retryable_statuscodes = [400, 401, 403, 413]",
		"",
	}, "\n"), nil
}

func mergeSoftwareRuntimeEnv(current map[string]string, injected map[string]string) map[string]string {
	if len(current) == 0 && len(injected) == 0 {
		return nil
	}
	next := make(map[string]string, len(current)+len(injected))
	for key, value := range current {
		next[key] = value
	}
	for key, value := range injected {
		next[key] = value
	}
	return next
}

func appendUniqueServiceName(current []string, value string) []string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return current
	}
	for _, existing := range current {
		if existing == trimmed {
			return current
		}
	}
	return append(current, trimmed)
}

func loadSoftwareSnapshotServiceName(app core.App, serverID string, componentKey software.ComponentKey) (string, error) {
	col, err := app.FindCollectionByNameOrId(collections.SoftwareInventorySnapshots)
	if err != nil {
		return "", nil
	}
	records, err := app.FindRecordsByFilter(
		col,
		fmt.Sprintf(
			"target_type = '%s' && target_id = '%s' && component_key = '%s'",
			escapePBFilterValue(string(software.TargetTypeServer)),
			escapePBFilterValue(strings.TrimSpace(serverID)),
			escapePBFilterValue(string(componentKey)),
		),
		"-updated",
		1,
		0,
	)
	if err != nil || len(records) == 0 {
		return "", err
	}
	return strings.TrimSpace(records[0].GetString("service_name")), nil
}

func injectScriptSystemdRuntimeEnv(
	resolved software.ResolvedTemplate,
	legacyServiceNames []string,
) (software.ResolvedTemplate, []string) {
	serviceName := strings.TrimSpace(resolved.Verify.ServiceName)
	if serviceName == "" {
		return resolved, nil
	}

	env := map[string]string{
		"APPOS_SERVICE": serviceName,
	}
	if len(legacyServiceNames) > 0 {
		env["APPOS_LEGACY_SERVICE_NAMES"] = strings.Join(legacyServiceNames, "\n")
	}

	if resolved.Install.Strategy == "script" {
		resolved.Install.Env = mergeSoftwareRuntimeEnv(resolved.Install.Env, env)
	}
	if resolved.Upgrade.Strategy == "script" {
		resolved.Upgrade.Env = mergeSoftwareRuntimeEnv(resolved.Upgrade.Env, env)
	}
	if resolved.Uninstall.Strategy == "script" {
		resolved.Uninstall.Env = mergeSoftwareRuntimeEnv(resolved.Uninstall.Env, env)
	}

	if len(legacyServiceNames) == 0 {
		return resolved, nil
	}
	return resolved, []string{
		fmt.Sprintf(
			"Legacy systemd units scheduled for cleanup before switching to %s: %s.",
			serviceName,
			strings.Join(legacyServiceNames, ", "),
		),
	}
}

func prepareSoftwareRuntimeTemplate(app core.App, payload SoftwareActionPayload, resolved software.ResolvedTemplate) (software.ResolvedTemplate, []string, error) {
	var notes []string
	legacyServiceNames := []string{}
	cat, err := swcatalog.LoadServerCatalog()
	if err != nil {
		return resolved, nil, err
	}
	for _, entry := range cat.Components {
		if entry.ComponentKey != payload.ComponentKey {
			continue
		}
		for _, legacyName := range entry.LegacyServiceNames {
			legacyServiceNames = appendUniqueServiceName(legacyServiceNames, legacyName)
		}
		break
	}
	if previousServiceName, err := loadSoftwareSnapshotServiceName(app, payload.ServerID, payload.ComponentKey); err != nil {
		return resolved, nil, err
	} else if previousServiceName != "" && previousServiceName != strings.TrimSpace(resolved.Verify.ServiceName) {
		legacyServiceNames = appendUniqueServiceName(legacyServiceNames, previousServiceName)
	}
	resolved, serviceNotes := injectScriptSystemdRuntimeEnv(resolved, legacyServiceNames)
	notes = append(notes, serviceNotes...)

	switch payload.ComponentKey {
	case software.ComponentKeyTelegraf:
		outputURL, err := buildSoftwareMonitorWriteURL(app, payload)
		if err != nil {
			return resolved, nil, err
		}
		collectorToken, err := getOrIssueSoftwareMonitorCollectorToken(app, payload.ServerID)
		if err != nil {
			return resolved, nil, err
		}
		collectorSettings := monitor.LoadManagedCollectorPolicySettings(app)
		config, err := buildSoftwareTelegrafConfig(collectorSettings, payload.ServerID, outputURL, payload.ServerID, collectorToken)
		if err != nil {
			return resolved, nil, err
		}
		env := map[string]string{
			"APPOS_TELEGRAF_VERSION":    telegrafManagedVersion,
			"APPOS_TELEGRAF_CONFIG_B64": base64.StdEncoding.EncodeToString([]byte(config)),
		}
		resolved.Install.Env = mergeSoftwareRuntimeEnv(resolved.Install.Env, env)
		resolved.Upgrade.Env = mergeSoftwareRuntimeEnv(resolved.Upgrade.Env, env)
		notes = append(notes, fmt.Sprintf("Configure Telegraf write endpoint %s.", outputURL))
	}
	return resolved, notes, nil
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
	appendSoftwareOperationEvent(record, fmt.Sprintf("Phase moved to %s.", phase))
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
	appendSoftwareOperationEvent(record, fmt.Sprintf("Failed during %s: %s", failurePhase, reason))
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
	appendSoftwareOperationEvent(record, fmt.Sprintf("Attention required after %s: %s", failurePhase, reason))
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
	if isSoftwareActionTimeout(err) {
		return software.FailureCodeVerificationTimeout
	}
	if action == software.ActionUninstall {
		return software.FailureCodeUninstallTruthMismatch
	}
	if err != nil && err.Error() == "component is degraded" {
		return software.FailureCodeVerificationDegraded
	}
	return software.FailureCodeVerificationError
}

func isSoftwareActionTimeout(err error) bool {
	return errors.Is(err, context.DeadlineExceeded)
}

func timeoutPolicyForAction(resolved software.ResolvedTemplate, action software.Action) software.TimeoutPolicyResult {
	return resolved.ActionTimeoutPolicy.ResultFor(action)
}

func (w *Worker) handleSoftwareActionTimeout(ctx context.Context, record *core.Record, payload SoftwareActionPayload, failurePhase software.OperationPhase, failureCode software.FailureCode, reason string, entry software.CatalogEntry, resolved software.ResolvedTemplate, executor software.ComponentExecutor) {
	if timeoutPolicyForAction(resolved, payload.Action) == software.TimeoutPolicyFailed {
		w.failSoftwareOperationAndRefreshSnapshot(ctx, record, payload, failurePhase, failureCode, reason, entry, resolved, executor)
		return
	}
	w.markSoftwareOperationAttentionRequiredAndRefreshSnapshot(ctx, record, payload, failurePhase, failureCode, reason, entry, resolved, executor)
}

// succeedSoftwareOperation records a terminal success on the operation.
func (w *Worker) succeedSoftwareOperation(record *core.Record) {
	record.Set("phase", string(software.OperationPhaseSucceeded))
	record.Set("terminal_status", string(software.TerminalStatusSuccess))
	record.Set("failure_phase", "")
	record.Set("failure_code", "")
	record.Set("failure_reason", "")
	appendSoftwareOperationEvent(record, "Operation completed successfully.")
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
		detection, err := executor.Detect(ctx, serverID, resolved)
		if err != nil {
			return err
		}
		if detection.InstalledState == software.InstalledStateInstalled {
			return fmt.Errorf("component is still detected as installed")
		}
		return nil
	default:
		return fmt.Errorf("unsupported verification action: %q", action)
	}
}

// runSoftwarePhaseLoop implements the phase-step loop for a single software delivery operation.
func (w *Worker) runSoftwarePhaseLoop(ctx context.Context, record *core.Record, payload SoftwareActionPayload) {
	// Safety net: if any downstream code panics, mark the operation as failed rather
	// than leaving the record permanently in-flight.
	defer func() {
		if r := recover(); r != nil {
			log.Printf("software operation %s: caught panic: %v", record.Id, r)
			if software.TerminalStatus(record.GetString("terminal_status")) == software.TerminalStatusNone {
				record.Set("phase", string(software.OperationPhaseFailed))
				record.Set("terminal_status", string(software.TerminalStatusFailed))
				record.Set("failure_reason", fmt.Sprintf("internal panic: %v", r))
				appendSoftwareOperationEvent(record, fmt.Sprintf("Internal panic: %v", r))
				if err := w.app.Save(record); err != nil {
					log.Printf("software operation %s: save panic failure state: %v", record.Id, err)
				}
			}
		}
	}()

	serverID := payload.ServerID
	componentKey := payload.ComponentKey
	action := payload.Action
	w.logSoftwareOperationEvent(record, fmt.Sprintf("Preparing %s workflow for %s.", action, componentKey))

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

	entry = software.ApplyRuntimeBindings(w.app, entry)
	resolved := swcatalog.ResolveTemplate(entry, tpl)
	resolved, runtimeNotes, runtimeBindErr := prepareSoftwareRuntimeTemplate(w.app, payload, resolved)
	if runtimeBindErr != nil {
		w.failSoftwareOperationWithAudit(record, payload, software.OperationPhasePreflight, software.FailureCodePreflightError, fmt.Sprintf("configure runtime binding: %v", runtimeBindErr))
		return
	}
	for _, step := range describeSoftwareExecutionPlan(action, resolved) {
		w.logSoftwareOperationEvent(record, step)
	}
	for _, note := range runtimeNotes {
		w.logSoftwareOperationEvent(record, note)
	}

	actionCtx, cancelActionTimeout, actionTimeout := applySoftwareActionTimeout(ctx, resolved, action)
	defer cancelActionTimeout()
	if actionTimeout > 0 {
		w.logSoftwareOperationEvent(record, fmt.Sprintf("Action timeout set to %s.", actionTimeout))
	}
	go w.softwareActionHeartbeat(actionCtx, record, fmt.Sprintf("%s action still running", action))

	executor, exErr := softwareExecutorFactory(w.app, serverID, payload.UserID)
	if exErr != nil {
		w.failSoftwareOperationWithAudit(record, payload, software.OperationPhasePreflight, software.FailureCodePreflightError, fmt.Sprintf("create executor: %v", exErr))
		return
	}
	if logger, ok := executor.(softwareOutputLogger); ok {
		logger.SetOutputLogger(func(line string) {
			w.logSoftwareOperationEvent(record, line)
		})
	}

	readiness, err := executor.RunPreflight(actionCtx, serverID, resolved)
	if err != nil {
		w.failSoftwareOperationAndRefreshSnapshot(ctx, record, payload, software.OperationPhasePreflight, software.FailureCodePreflightError, fmt.Sprintf("run preflight: %v", err), entry, resolved, executor)
		return
	}
	if !readiness.OK {
		w.failSoftwareOperationAndRefreshSnapshot(ctx, record, payload, software.OperationPhasePreflight, software.FailureCodePreflightBlocked, fmt.Sprintf("preflight failed: %v", readiness.Issues), entry, resolved, executor)
		return
	}
	w.logSoftwareOperationEvent(record, "Preflight checks passed.")

	// ── Phase: Executing ─────────────────────────────────
	w.advanceSoftwarePhase(record, software.OperationPhaseExecuting)
	w.logSoftwareOperationEvent(record, fmt.Sprintf("Running %s action.", action))

	switch action {
	case software.ActionInstall:
		_, err = executor.Install(actionCtx, serverID, resolved)
	case software.ActionUpgrade:
		_, err = executor.Upgrade(actionCtx, serverID, resolved)
	case software.ActionStart:
		_, err = executor.Start(actionCtx, serverID, resolved)
	case software.ActionStop:
		_, err = executor.Stop(actionCtx, serverID, resolved)
	case software.ActionRestart:
		_, err = executor.Restart(actionCtx, serverID, resolved)
	case software.ActionUninstall:
		_, err = executor.Uninstall(actionCtx, serverID, resolved)
	case software.ActionVerify:
		err = nil
	case software.ActionReinstall:
		_, err = executor.Reinstall(actionCtx, serverID, resolved)
	default:
		w.failSoftwareOperationWithAudit(record, payload, software.OperationPhaseExecuting, software.FailureCodeExecutionError, fmt.Sprintf("unsupported action: %q", action))
		return
	}

	if err != nil {
		if isSoftwareActionTimeout(err) {
			w.handleSoftwareActionTimeout(ctx, record, payload, software.OperationPhaseExecuting, software.FailureCodeExecutionTimeout, fmt.Sprintf("execute %q timed out: %v", action, err), entry, resolved, executor)
			return
		}
		w.failSoftwareOperationAndRefreshSnapshot(ctx, record, payload, software.OperationPhaseExecuting, software.FailureCodeExecutionError, fmt.Sprintf("execute %q: %v", action, err), entry, resolved, executor)
		return
	}
	w.logSoftwareOperationEvent(record, "Execution step completed.")

	// ── Phase: Verifying ─────────────────────────────────
	w.advanceSoftwarePhase(record, software.OperationPhaseVerifying)
	w.logSoftwareOperationEvent(record, "Running post-action verification.")

	if err := w.verifySoftwareActionOutcome(actionCtx, serverID, action, resolved, executor); err != nil {
		if isSoftwareActionTimeout(err) {
			w.handleSoftwareActionTimeout(ctx, record, payload, software.OperationPhaseVerifying, classifyVerificationFailure(action, err), fmt.Sprintf("post-action verification timed out: %v", err), entry, resolved, executor)
			return
		}
		w.markSoftwareOperationAttentionRequiredAndRefreshSnapshot(ctx, record, payload, software.OperationPhaseVerifying, classifyVerificationFailure(action, err), fmt.Sprintf("post-action verification failed: %v", err), entry, resolved, executor)
		return
	}
	w.logSoftwareOperationEvent(record, "Verification passed.")

	// ── Phase: Succeeded ─────────────────────────────────
	w.succeedSoftwareOperationAndRefreshSnapshot(ctx, record, payload, entry, resolved, executor)
}

func (w *Worker) softwareActionHeartbeat(ctx context.Context, record *core.Record, message string) {
	if w == nil || w.app == nil || record == nil {
		return
	}
	policy := loadDeployRuntimePolicy(w.app)
	interval := policy.OperationHeartbeat
	if interval < time.Second {
		interval = 20 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.logSoftwareOperationEvent(record, message)
		}
	}
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

	detection, detectErr := executor.Detect(ctx, payload.ServerID, resolved)
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

	preflight, err := executor.RunPreflight(ctx, payload.ServerID, resolved)
	if err != nil {
		preflight = software.TargetReadinessResult{Issues: []string{"preflight_error: " + err.Error()}}
	}
	detail.Preflight = &preflight

	verification := &software.SoftwareVerificationResult{State: software.VerificationStateUnknown}
	verifiedDetail, verifyErr := executor.Verify(ctx, payload.ServerID, resolved)
	if verifyErr == nil {
		if verifiedDetail.Verification != nil {
			verification = verifiedDetail.Verification
		}
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
			if strings.TrimSpace(verification.Reason) == "" {
				verification.Reason = "service verification returned degraded state"
			}
		}
	} else {
		verification.Reason = verifyErr.Error()
		if detectErr == nil && detection.InstalledState == software.InstalledStateNotInstalled {
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
