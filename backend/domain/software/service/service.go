package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/core"
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
	executor, executorErr := s.serverExecutorFactory(s.app, serverID, userID)
	items, err := s.buildComputedComponents(ctx, cat, reg, software.TargetTypeServer, serverID, executor, executorErr, latestOps)
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Service) GetServerComponent(ctx context.Context, serverID, userID string, componentKey software.ComponentKey) (ComputedComponent, error) {
	items, err := s.ListServerComponents(ctx, serverID, userID)
	if err != nil {
		return ComputedComponent{}, err
	}
	for _, item := range items {
		if item.Entry.ComponentKey == componentKey {
			return item, nil
		}
	}
	return ComputedComponent{}, fmt.Errorf("component %q not found in server catalog", componentKey)
}

func (s *Service) ListLocalComponents(ctx context.Context) ([]ComputedComponent, error) {
	cat, reg, err := loadCatalogAndRegistry(false)
	if err != nil {
		return nil, err
	}
	executor, executorErr := s.localExecutorFactory(s.app)
	return s.buildComputedComponents(ctx, cat, reg, software.TargetTypeLocal, LocalTargetID, executor, executorErr, nil)
}

func (s *Service) GetLocalComponent(ctx context.Context, componentKey software.ComponentKey) (ComputedComponent, error) {
	items, err := s.ListLocalComponents(ctx)
	if err != nil {
		return ComputedComponent{}, err
	}
	for _, item := range items {
		if item.Entry.ComponentKey == componentKey {
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
	if err := worker.EnqueueSoftwareAction(s.queueClient, record.Id, serverID, componentKey, action, "", ""); err != nil {
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
		tpl, ok := reg.Templates[entry.TemplateRef]
		if !ok {
			return nil, fmt.Errorf("template ref not found: %s", entry.TemplateRef)
		}
		resolved := swcatalog.ResolveTemplate(entry, tpl)
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
		preflight := software.TargetReadinessResult{Issues: []string{}}
		var lastOp *OperationSummary
		if latestOps != nil {
			lastOp = latestOps[string(entry.ComponentKey)]
			if lastAction := lastActionFromOperation(lastOp); lastAction != nil {
				summary.LastAction = lastAction
				detail.LastAction = lastAction
			}
		}

		if executorErr != nil {
			preflight.OK = false
			preflight.Issues = append(preflight.Issues, "executor_unavailable: "+executorErr.Error())
			detail.Preflight = &preflight
			computed := ComputedComponent{Entry: entry, Resolved: resolved, Summary: summary, Detail: detail, Preflight: preflight, LastOperation: lastOp}
			_ = swprojection.UpsertInventorySnapshot(s.app, targetType, targetID, snapshotFromComputed(computed))
			items = append(items, computed)
			continue
		}

		detectedState, detectedVersion, detectErr := executor.Detect(ctx, targetID, resolved)
		if detectErr == nil {
			summary.InstalledState = detectedState
			summary.DetectedVersion = detectedVersion
			detail.InstalledState = detectedState
			detail.DetectedVersion = detectedVersion
		}

		preflight, err := executor.RunPreflight(ctx, targetID, resolved)
		if err != nil {
			preflight = software.TargetReadinessResult{Issues: []string{"preflight_error: " + err.Error()}}
		}
		detail.Preflight = &preflight

		verifiedDetail, verifyErr := executor.Verify(ctx, targetID, resolved)
		verification := &software.SoftwareVerificationResult{
			State: software.VerificationStateUnknown,
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
		detail.SoftwareComponentSummary = summary

		computed := ComputedComponent{Entry: entry, Resolved: resolved, Summary: summary, Detail: detail, Preflight: preflight, LastOperation: lastOp}
		_ = swprojection.UpsertInventorySnapshot(s.app, targetType, targetID, snapshotFromComputed(computed))
		items = append(items, computed)
	}
	return items, nil
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

var _ software.CapabilityQuerier = (*Service)(nil)
var _ software.CapabilityCommander = (*Service)(nil)

func IsOperationInFlightError(err error) bool {
	return errors.Is(err, worker.ErrSoftwareOperationInFlight)
}
