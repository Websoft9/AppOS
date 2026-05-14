package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitorstore "github.com/websoft9/appos/backend/domain/monitor/status/store"
	"github.com/websoft9/appos/backend/domain/software"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
	swexecutor "github.com/websoft9/appos/backend/domain/software/executor"
	swprojection "github.com/websoft9/appos/backend/domain/software/projection"
	"github.com/websoft9/appos/backend/domain/worker"
	"github.com/websoft9/appos/backend/infra/collections"
)

const LocalTargetID = "appos-local"

type OperationSummary struct {
	Action         software.Action         `json:"action"`
	Phase          software.OperationPhase `json:"phase"`
	TerminalStatus software.TerminalStatus `json:"terminal_status"`
	FailurePhase   software.OperationPhase `json:"failure_phase,omitempty"`
	FailureCode    software.FailureCode    `json:"failure_code,omitempty"`
	FailureReason  string                  `json:"failure_reason,omitempty"`
	UpdatedAt      string                  `json:"updated_at"`
}

type ComputedComponent struct {
	Entry         software.CatalogEntry
	Resolved      software.ResolvedTemplate
	Summary       software.SoftwareComponentSummary
	Detail        software.SoftwareComponentDetail
	Preflight     software.TargetReadinessResult
	LastOperation *OperationSummary
}

type Service struct {
	app                   core.App
	queueClient           *asynq.Client
	serverExecutorFactory func(app core.App, serverID, userID string) (software.ComponentExecutor, error)
	localExecutorFactory  func(app core.App) (software.ComponentExecutor, error)
}

func New(app core.App, queueClient *asynq.Client) *Service {
	return &Service{
		app:         app,
		queueClient: queueClient,
		serverExecutorFactory: func(app core.App, serverID, userID string) (software.ComponentExecutor, error) {
			return swexecutor.NewSSHExecutor(app, serverID, userID)
		},
		localExecutorFactory: func(app core.App) (software.ComponentExecutor, error) {
			return swexecutor.NewLocalExecutor(app)
		},
	}
}

func (s *Service) ListServerComponents(ctx context.Context, serverID, userID string) ([]ComputedComponent, error) {
	cat, reg, err := loadCatalogAndRegistry(true)
	if err != nil {
		return nil, err
	}
	latestOps := s.loadLatestOperations(serverID)
	if items, ok := s.loadProjectedComponents(cat, reg, software.TargetTypeServer, serverID, latestOps); ok {
		return items, nil
	}
	executor, executorErr := s.serverExecutorFactory(s.app, serverID, userID)
	defer closeExecutor(executor)
	items, err := s.buildComputedComponents(ctx, cat, reg, software.TargetTypeServer, serverID, executor, executorErr, latestOps)
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Service) GetServerComponent(ctx context.Context, serverID, userID string, componentKey software.ComponentKey) (ComputedComponent, error) {
	cat, reg, err := loadCatalogAndRegistry(true)
	if err != nil {
		return ComputedComponent{}, err
	}
	latestOps := s.loadLatestOperations(serverID)
	if item, ok := s.loadProjectedComponent(cat, reg, software.TargetTypeServer, serverID, componentKey, latestOps); ok {
		if item.Detail.InstalledState == software.InstalledStateInstalled {
			return item, nil
		}
	}
	if items, ok := s.loadProjectedComponents(cat, reg, software.TargetTypeServer, serverID, latestOps); ok {
		for _, item := range items {
			if item.Entry.ComponentKey == componentKey {
				if item.Detail.InstalledState == software.InstalledStateInstalled {
					return item, nil
				}
				break
			}
		}
	}
	executor, executorErr := s.serverExecutorFactory(s.app, serverID, userID)
	defer closeExecutor(executor)
	for _, entry := range cat.Components {
		if entry.ComponentKey != componentKey {
			continue
		}
		entry = software.ApplyRuntimeBindings(s.app, entry)
		tpl, ok := reg.Templates[entry.TemplateRef]
		if !ok {
			return ComputedComponent{}, fmt.Errorf("template ref not found: %s", entry.TemplateRef)
		}
		resolved := swcatalog.ResolveTemplate(entry, tpl)
		computed := s.computeComponent(ctx, entry, resolved, serverID, executor, executorErr, latestOps[string(entry.ComponentKey)])
		if err := swprojection.UpsertInventorySnapshot(s.app, software.TargetTypeServer, serverID, snapshotFromComputed(computed)); err != nil {
			s.app.Logger().Error("failed to write software snapshot", "component", componentKey, "server", serverID, "error", err)
		}
		return computed, nil
	}
	return ComputedComponent{}, fmt.Errorf("component %q not found in server catalog", componentKey)
}

func (s *Service) ListLocalComponents(ctx context.Context) ([]ComputedComponent, error) {
	cat, reg, err := loadCatalogAndRegistry(false)
	if err != nil {
		return nil, err
	}
	if items, ok := s.loadProjectedComponents(cat, reg, software.TargetTypeLocal, LocalTargetID, nil); ok {
		return items, nil
	}
	executor, executorErr := s.localExecutorFactory(s.app)
	return s.buildComputedComponents(ctx, cat, reg, software.TargetTypeLocal, LocalTargetID, executor, executorErr, nil)
}

func (s *Service) GetLocalComponent(ctx context.Context, componentKey software.ComponentKey) (ComputedComponent, error) {
	cat, reg, err := loadCatalogAndRegistry(false)
	if err != nil {
		return ComputedComponent{}, err
	}
	if item, ok := s.loadProjectedComponent(cat, reg, software.TargetTypeLocal, LocalTargetID, componentKey, nil); ok {
		return item, nil
	}
	items, err := s.ListLocalComponents(ctx)
	if err != nil {
		return ComputedComponent{}, err
	}
	for _, item := range items {
		if item.Entry.ComponentKey == componentKey {
			_ = swprojection.UpsertInventorySnapshot(s.app, software.TargetTypeLocal, LocalTargetID, snapshotFromComputed(item))
			return item, nil
		}
	}
	return ComputedComponent{}, fmt.Errorf("component %q not found in local catalog", componentKey)
}

func (s *Service) ListCapabilities(ctx context.Context, serverID string) ([]software.CapabilityStatus, error) {
	items, err := s.ListServerComponents(ctx, serverID, "")
	if err != nil {
		return nil, err
	}
	byKey := make(map[software.ComponentKey]ComputedComponent, len(items))
	for _, item := range items {
		byKey[item.Entry.ComponentKey] = item
	}
	resp := make([]software.CapabilityStatus, 0, len(software.CapabilityComponentMap))
	for capability, componentKey := range software.CapabilityComponentMap {
		status := software.CapabilityStatus{
			Capability:     capability,
			ComponentKey:   componentKey,
			InstalledState: software.InstalledStateUnknown,
			ReadinessResult: software.TargetReadinessResult{
				Issues: []string{},
			},
		}
		if item, ok := byKey[componentKey]; ok {
			status.InstalledState = item.Detail.InstalledState
			status.ReadinessResult = item.Preflight
			status.Ready = item.Detail.InstalledState == software.InstalledStateInstalled &&
				item.Detail.VerificationState == software.VerificationStateHealthy &&
				item.Preflight.OK
		}
		resp = append(resp, status)
	}
	return resp, nil
}

func (s *Service) GetCapabilityStatus(ctx context.Context, serverID string, capability software.Capability) (software.CapabilityStatus, error) {
	items, err := s.ListCapabilities(ctx, serverID)
	if err != nil {
		return software.CapabilityStatus{}, err
	}
	for _, item := range items {
		if item.Capability == capability {
			return item, nil
		}
	}
	return software.CapabilityStatus{}, fmt.Errorf("capability %q not found", capability)
}

func (s *Service) IsCapabilityReady(ctx context.Context, serverID string, capability software.Capability) (bool, error) {
	status, err := s.GetCapabilityStatus(ctx, serverID, capability)
	if err != nil {
		return false, err
	}
	return status.Ready, nil
}

func (s *Service) EnsureCapability(ctx context.Context, serverID string, capability software.Capability) (software.AsyncCommandResponse, error) {
	status, err := s.GetCapabilityStatus(ctx, serverID, capability)
	if err != nil {
		return software.AsyncCommandResponse{}, err
	}
	action := software.ActionInstall
	if status.InstalledState == software.InstalledStateInstalled {
		action = software.ActionReinstall
	}
	return s.enqueueCapabilityAction(ctx, serverID, capability, action)
}

func (s *Service) UpgradeCapability(ctx context.Context, serverID string, capability software.Capability) (software.AsyncCommandResponse, error) {
	return s.enqueueCapabilityAction(ctx, serverID, capability, software.ActionUpgrade)
}

func (s *Service) VerifyCapability(ctx context.Context, serverID string, capability software.Capability) (software.AsyncCommandResponse, error) {
	return s.enqueueCapabilityAction(ctx, serverID, capability, software.ActionVerify)
}

func (s *Service) enqueueCapabilityAction(_ context.Context, serverID string, capability software.Capability, action software.Action) (software.AsyncCommandResponse, error) {
	componentKey, ok := software.CapabilityComponentMap[capability]
	if !ok {
		return software.AsyncCommandResponse{}, fmt.Errorf("capability %q is not mapped to a managed component", capability)
	}
	if s.queueClient == nil {
		return software.AsyncCommandResponse{}, fmt.Errorf("background task queue is not configured")
	}
	record, err := worker.PrepareSoftwareOperation(s.app, serverID, componentKey, action)
	if err != nil {
		return software.AsyncCommandResponse{}, err
	}
	if err := worker.EnqueueSoftwareAction(s.queueClient, record.Id, serverID, componentKey, action, "", "", ""); err != nil {
		return software.AsyncCommandResponse{}, err
	}
	return software.AsyncCommandResponse{
		Accepted:    true,
		OperationID: record.Id,
		Phase:       software.OperationPhaseAccepted,
		Message:     fmt.Sprintf("%s accepted", action),
	}, nil
}

func (s *Service) loadLatestOperations(serverID string) map[string]*OperationSummary {
	latestOps := map[string]*OperationSummary{}
	col, err := s.app.FindCollectionByNameOrId(collections.SoftwareOperations)
	if err != nil {
		return latestOps
	}
	filter := "server_id = '" + escapeFilterValue(serverID) + "'"
	records, err := s.app.FindRecordsByFilter(col, filter, "-updated", 200, 0)
	if err != nil {
		return latestOps
	}
	for _, r := range records {
		key := r.GetString("component_key")
		if _, seen := latestOps[key]; seen {
			continue
		}
		latestOps[key] = &OperationSummary{
			Action:         software.Action(r.GetString("action")),
			Phase:          software.OperationPhase(r.GetString("phase")),
			TerminalStatus: software.TerminalStatus(r.GetString("terminal_status")),
			FailurePhase:   software.OperationPhase(r.GetString("failure_phase")),
			FailureCode:    software.FailureCode(r.GetString("failure_code")),
			FailureReason:  r.GetString("failure_reason"),
			UpdatedAt:      r.GetString("updated"),
		}
	}
	return latestOps
}

func (s *Service) buildComputedComponents(
	ctx context.Context,
	cat software.ComponentCatalog,
	reg software.TemplateRegistry,
	targetType software.TargetType,
	targetID string,
	executor software.ComponentExecutor,
	executorErr error,
	latestOps map[string]*OperationSummary,
) ([]ComputedComponent, error) {
	items := make([]ComputedComponent, 0, len(cat.Components))
	for _, entry := range cat.Components {
		entry = software.ApplyRuntimeBindings(s.app, entry)
		tpl, ok := reg.Templates[entry.TemplateRef]
		if !ok {
			return nil, fmt.Errorf("template ref not found: %s", entry.TemplateRef)
		}
		resolved := swcatalog.ResolveTemplate(entry, tpl)
		computed := s.computeComponent(ctx, entry, resolved, targetID, executor, executorErr, latestOps[string(entry.ComponentKey)])
		if err := swprojection.UpsertInventorySnapshot(s.app, targetType, targetID, snapshotFromComputed(computed)); err != nil {
			s.app.Logger().Error("failed to write software snapshot", "component", entry.ComponentKey, "target", targetID, "error", err)
		}
		items = append(items, computed)
	}
	return items, nil
}

func (s *Service) computeComponent(
	ctx context.Context,
	entry software.CatalogEntry,
	resolved software.ResolvedTemplate,
	targetID string,
	executor software.ComponentExecutor,
	executorErr error,
	lastOp *OperationSummary,
) ComputedComponent {
	summary := software.SoftwareComponentSummary{
		ComponentKey:      entry.ComponentKey,
		Label:             entry.Label,
		TemplateKind:      resolved.TemplateKind,
		InstalledState:    software.InstalledStateUnknown,
		VerificationState: software.VerificationStateUnknown,
		AvailableActions:  []software.Action{},
	}
	detail := software.SoftwareComponentDetail{
		SoftwareComponentSummary: summary,
		ServiceName:              entry.ServiceName,
		BinaryPath:               entry.Binary,
	}
	var preflight software.TargetReadinessResult
	if lastAction := lastActionFromOperation(lastOp); lastAction != nil {
		summary.LastAction = lastAction
		detail.LastAction = lastAction
	}

	if executorErr != nil {
		preflight.Issues = []string{}
		preflight.OK = false
		preflight.Issues = append(preflight.Issues, "executor_unavailable: "+executorErr.Error())
		summary.AvailableActions = deriveAvailableActions(entry.SupportedActions, summary.InstalledState, preflight, lastOp)
		detail.Preflight = &preflight
		s.applyHealthProjection(entry.TargetType, targetID, entry, lastOp, &summary, &detail)
		detail.SoftwareComponentSummary = summary
		return ComputedComponent{Entry: entry, Resolved: resolved, Summary: summary, Detail: detail, Preflight: preflight, LastOperation: lastOp}
	}

	detection, detectErr := executor.Detect(ctx, targetID, resolved)
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

	// Skip preflight for already-installed components.
	// Preflight checks install eligibility (OS baseline, root, network reachability).
	// The network probe (curl --max-time 5) adds up to 5s of latency per status read
	// for no benefit: the install action is never available for installed components,
	// and lifecycle ops (upgrade, restart) enforce their own preconditions at run time.
	if detectErr != nil || detection.InstalledState != software.InstalledStateInstalled {
		pf, pfErr := executor.RunPreflight(ctx, targetID, resolved)
		if pfErr != nil {
			preflight = software.TargetReadinessResult{Issues: []string{"preflight_error: " + pfErr.Error()}}
		} else {
			preflight = pf
		}
	} else {
		preflight = software.TargetReadinessResult{
			OK:               true,
			OSSupported:      true,
			PrivilegeOK:      true,
			NetworkOK:        true,
			DependencyReady:  true,
			ServiceManagerOK: true,
			PackageManagerOK: true,
			Issues:           []string{},
		}
	}
	detail.Preflight = &preflight

	verifiedDetail, verifyErr := executor.Verify(ctx, targetID, resolved)
	verification := verifiedDetail.Verification
	if verification == nil {
		verification = &software.SoftwareVerificationResult{State: software.VerificationStateUnknown}
	}
	if verifyErr == nil {
		if verifiedDetail.InstalledState != "" {
			summary.InstalledState = verifiedDetail.InstalledState
			detail.InstalledState = verifiedDetail.InstalledState
		}
		if verifiedDetail.DetectedVersion != "" {
			summary.DetectedVersion = verifiedDetail.DetectedVersion
			detail.DetectedVersion = verifiedDetail.DetectedVersion
		}
		summary.VerificationState = verifiedDetail.VerificationState
		detail.VerificationState = verifiedDetail.VerificationState
		detail.ServiceName = verifiedDetail.ServiceName
		verification.State = verifiedDetail.VerificationState
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
	summary.AvailableActions = deriveAvailableActions(entry.SupportedActions, detail.InstalledState, preflight, lastOp)
	s.applyHealthProjection(entry.TargetType, targetID, entry, lastOp, &summary, &detail)
	detail.SoftwareComponentSummary = summary

	return ComputedComponent{Entry: entry, Resolved: resolved, Summary: summary, Detail: detail, Preflight: preflight, LastOperation: lastOp}
}

func (s *Service) applyHealthProjection(
	targetType software.TargetType,
	targetID string,
	entry software.CatalogEntry,
	lastOp *OperationSummary,
	summary *software.SoftwareComponentSummary,
	detail *software.SoftwareComponentDetail,
) {
	reportingExpected := entry.ComponentKey == software.ComponentKeyMonitorAgent && targetType == software.TargetTypeServer
	metricsFreshnessState, hasMonitorEvidence := s.monitorMetricsFreshness(targetType, targetID, reportingExpected)
	terminal := software.TerminalStatus("")
	if lastOp != nil {
		terminal = lastOp.TerminalStatus
	}
	serviceStatus, apposConnection, reasons := software.ResolveComponentHealth(software.HealthResolutionEvidence{
		ComponentKey:                 entry.ComponentKey,
		InstalledState:               detail.InstalledState,
		VerificationState:            detail.VerificationState,
		Verification:                 detail.Verification,
		LastOperationTerminalStatus:  terminal,
		ReportingExpected:            reportingExpected,
		MetricsFreshnessState:        metricsFreshnessState,
		HasMonitorConnectionEvidence: hasMonitorEvidence,
	})
	summary.ServiceStatus = serviceStatus
	summary.AppOSConnection = apposConnection
	summary.HealthReasons = reasons
	detail.ServiceStatus = serviceStatus
	detail.AppOSConnection = apposConnection
	detail.HealthReasons = reasons
}

func (s *Service) monitorMetricsFreshness(targetType software.TargetType, targetID string, reportingExpected bool) (string, bool) {
	if !reportingExpected || targetType != software.TargetTypeServer || strings.TrimSpace(targetID) == "" {
		return "", false
	}
	record, err := s.app.FindFirstRecordByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": monitor.TargetTypeServer, "targetID": strings.TrimSpace(targetID)},
	)
	if err != nil || record == nil {
		return "", false
	}
	summary, err := monitorstore.SummaryFromRecord(record)
	if err != nil {
		return "", true
	}
	return strings.TrimSpace(fmt.Sprint(summary["metrics_freshness_state"])), true
}

func (s *Service) loadProjectedComponents(
	cat software.ComponentCatalog,
	reg software.TemplateRegistry,
	targetType software.TargetType,
	targetID string,
	latestOps map[string]*OperationSummary,
) ([]ComputedComponent, bool) {
	filter := "target_type = '" + escapeFilterValue(string(targetType)) + "' && target_id = '" + escapeFilterValue(strings.TrimSpace(targetID)) + "'"
	records, err := s.app.FindRecordsByFilter(collections.SoftwareInventorySnapshots, filter, "", len(cat.Components)+10, 0)
	if err != nil || len(records) < len(cat.Components) {
		return nil, false
	}
	byKey := make(map[string]*core.Record, len(records))
	for _, record := range records {
		byKey[record.GetString("component_key")] = record
	}

	items := make([]ComputedComponent, 0, len(cat.Components))
	for _, entry := range cat.Components {
		record := byKey[string(entry.ComponentKey)]
		if record == nil {
			return nil, false
		}
		item, ok := projectedComponentFromRecord(s.app, entry, reg, record, latestOps)
		if !ok {
			return nil, false
		}
		items = append(items, item)
	}
	return items, true
}

func (s *Service) loadProjectedComponent(
	cat software.ComponentCatalog,
	reg software.TemplateRegistry,
	targetType software.TargetType,
	targetID string,
	componentKey software.ComponentKey,
	latestOps map[string]*OperationSummary,
) (ComputedComponent, bool) {
	record, err := s.app.FindFirstRecordByFilter(
		collections.SoftwareInventorySnapshots,
		"target_type = {:targetType} && target_id = {:targetID} && component_key = {:componentKey}",
		map[string]any{
			"targetType":   string(targetType),
			"targetID":     strings.TrimSpace(targetID),
			"componentKey": string(componentKey),
		},
	)
	if err != nil || record == nil {
		return ComputedComponent{}, false
	}
	for _, entry := range cat.Components {
		if entry.ComponentKey != componentKey {
			continue
		}
		item, ok := projectedComponentFromRecord(s.app, entry, reg, record, latestOps)
		if !ok {
			return ComputedComponent{}, false
		}
		return item, true
	}
	return ComputedComponent{}, false
}

func projectedComponentFromRecord(
	app core.App,
	entry software.CatalogEntry,
	reg software.TemplateRegistry,
	record *core.Record,
	latestOps map[string]*OperationSummary,
) (ComputedComponent, bool) {
	entry = software.ApplyRuntimeBindings(app, entry)
	tpl, ok := reg.Templates[entry.TemplateRef]
	if !ok {
		return ComputedComponent{}, false
	}
	resolved := swcatalog.ResolveTemplate(entry, tpl)
	preflight, ok := decodeSnapshotJSON[software.TargetReadinessResult](record.Get("preflight_json"))
	if !ok {
		preflight = &software.TargetReadinessResult{Issues: []string{}}
	}
	verification, _ := decodeSnapshotJSON[software.SoftwareVerificationResult](record.Get("verification_json"))
	lastAction, _ := decodeSnapshotJSON[software.SoftwareDeliveryLastAction](record.Get("last_action_json"))
	var lastOp *OperationSummary
	if latestOps != nil {
		lastOp = latestOps[string(entry.ComponentKey)]
	}
	summary := software.SoftwareComponentSummary{
		ComponentKey:      entry.ComponentKey,
		Label:             entry.Label,
		TemplateKind:      resolved.TemplateKind,
		InstalledState:    software.InstalledState(record.GetString("installed_state")),
		DetectedVersion:   record.GetString("detected_version"),
		PackagedVersion:   record.GetString("packaged_version"),
		VerificationState: software.VerificationState(record.GetString("verification_state")),
		LastAction:        lastAction,
	}
	detail := software.SoftwareComponentDetail{
		SoftwareComponentSummary: summary,
		ServiceName:              record.GetString("service_name"),
		BinaryPath:               record.GetString("binary_path"),
		Preflight:                preflight,
		Verification:             verification,
	}
	detail.InstalledState = summary.InstalledState
	detail.DetectedVersion = summary.DetectedVersion
	detail.PackagedVersion = summary.PackagedVersion
	detail.VerificationState = summary.VerificationState
	detail.LastAction = lastAction
	preflightValue := software.TargetReadinessResult{Issues: []string{}}
	if preflight != nil {
		preflightValue = *preflight
		if preflightValue.Issues == nil {
			preflightValue.Issues = []string{}
		}
	}
	summary.AvailableActions = deriveAvailableActions(entry.SupportedActions, detail.InstalledState, preflightValue, lastOp)
	service := Service{app: app}
	service.applyHealthProjection(entry.TargetType, record.GetString("target_id"), entry, lastOp, &summary, &detail)
	detail.SoftwareComponentSummary = summary
	return ComputedComponent{
		Entry:         entry,
		Resolved:      resolved,
		Summary:       summary,
		Detail:        detail,
		Preflight:     preflightValue,
		LastOperation: lastOp,
	}, true
}

func decodeSnapshotJSON[T any](value any) (*T, bool) {
	if value == nil {
		return nil, false
	}
	raw, err := json.Marshal(value)
	if err != nil || string(raw) == "null" {
		return nil, false
	}
	var decoded T
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, false
	}
	return &decoded, true
}

func deriveAvailableActions(
	supported []software.Action,
	installedState software.InstalledState,
	preflight software.TargetReadinessResult,
	lastOp *OperationSummary,
) []software.Action {
	available := make([]software.Action, 0, len(supported))
	for _, action := range supported {
		if !isActionAvailable(action, installedState, preflight.OK) {
			continue
		}
		available = append(available, action)
	}
	return available
}

func isActionAvailable(action software.Action, installedState software.InstalledState, readinessOK bool) bool {
	switch installedState {
	case software.InstalledStateInstalled:
		switch action {
		case software.ActionInstall:
			return false
		case software.ActionStop,
			software.ActionRestart:
			return true
		case software.ActionUpgrade,
			software.ActionStart,
			software.ActionVerify,
			software.ActionReinstall,
			software.ActionUninstall:
			return readinessOK
		default:
			return readinessOK
		}
	case software.InstalledStateNotInstalled:
		switch action {
		case software.ActionInstall, software.ActionVerify:
			return true
		default:
			return false
		}
	default:
		return action == software.ActionVerify
	}
}

func snapshotFromComputed(item ComputedComponent) swprojection.Snapshot {
	return swprojection.Snapshot{
		ComponentKey:      item.Entry.ComponentKey,
		Label:             item.Entry.Label,
		TemplateKind:      item.Summary.TemplateKind,
		InstalledState:    item.Detail.InstalledState,
		DetectedVersion:   item.Detail.DetectedVersion,
		PackagedVersion:   item.Detail.PackagedVersion,
		VerificationState: item.Detail.VerificationState,
		ServiceName:       item.Detail.ServiceName,
		BinaryPath:        item.Detail.BinaryPath,
		Preflight:         item.Detail.Preflight,
		Verification:      item.Detail.Verification,
		LastAction:        item.Detail.LastAction,
	}
}

func loadCatalogAndRegistry(serverCatalog bool) (software.ComponentCatalog, software.TemplateRegistry, error) {
	reg, err := swcatalog.LoadTemplateRegistry()
	if err != nil {
		return software.ComponentCatalog{}, software.TemplateRegistry{}, err
	}
	var cat software.ComponentCatalog
	if serverCatalog {
		cat, err = swcatalog.LoadServerCatalog()
	} else {
		cat, err = swcatalog.LoadLocalCatalog()
	}
	if err != nil {
		return software.ComponentCatalog{}, software.TemplateRegistry{}, err
	}
	return cat, reg, nil
}

func lastActionFromOperation(op *OperationSummary) *software.SoftwareDeliveryLastAction {
	if op == nil {
		return nil
	}
	result := "pending"
	switch op.TerminalStatus {
	case software.TerminalStatusSuccess:
		result = "success"
	case software.TerminalStatusFailed:
		result = "failed"
	case software.TerminalStatusAttentionRequired:
		result = "attention_required"
	}
	return &software.SoftwareDeliveryLastAction{
		Action: string(op.Action),
		Result: result,
		At:     op.UpdatedAt,
	}
}

func escapeFilterValue(v string) string {
	return strings.ReplaceAll(v, "'", "\\'")
}

// closeExecutor releases any resources held by the executor (e.g. an SSH connection).
// It is a no-op if the executor does not implement io.Closer.
func closeExecutor(executor software.ComponentExecutor) {
	if c, ok := executor.(io.Closer); ok {
		_ = c.Close()
	}
}

var _ software.CapabilityQuerier = (*Service)(nil)
var _ software.CapabilityCommander = (*Service)(nil)

func IsOperationInFlightError(err error) bool {
	return errors.Is(err, worker.ErrSoftwareOperationInFlight)
}
