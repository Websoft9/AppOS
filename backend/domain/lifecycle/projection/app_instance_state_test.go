package projection

import (
	"testing"

	"github.com/websoft9/appos/backend/domain/lifecycle/model"
)

func TestNormalizeRuntimeStatus(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want RuntimeStatus
	}{
		{name: "running", raw: "running", want: RuntimeStatusRunning},
		{name: "up string", raw: "Up 2 minutes", want: RuntimeStatusRunning},
		{name: "exited", raw: "exited", want: RuntimeStatusStopped},
		{name: "restarting", raw: "restarting", want: RuntimeStatusRestarting},
		{name: "starting", raw: "starting", want: RuntimeStatusStarting},
		{name: "dead", raw: "dead", want: RuntimeStatusError},
		{name: "empty", raw: "", want: RuntimeStatusUnknown},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormalizeRuntimeStatus(tt.raw); got != tt.want {
				t.Fatalf("expected %q, got %q", tt.want, got)
			}
		})
	}
}

func TestResolveRuntimeStatus(t *testing.T) {
	tests := []struct {
		name          string
		projection    model.AppInstanceProjection
		observed      RuntimeStatus
		liveRaw       string
		runtimeReason string
		want          RuntimeStatus
	}{
		{
			name: "live runtime wins",
			projection: model.AppInstanceProjection{
				LifecycleState: model.AppStateStopped,
				HealthSummary:  model.HealthStopped,
			},
			liveRaw: "restarting",
			want:    RuntimeStatusRestarting,
		},
		{
			name: "runtime reason without live data returns unknown",
			projection: model.AppInstanceProjection{
				LifecycleState: model.AppStateRunningHealthy,
				HealthSummary:  model.HealthHealthy,
			},
			observed:      RuntimeStatusPartial,
			runtimeReason: "server offline",
			want:          RuntimeStatusPartial,
		},
		{
			name: "projection fallback from degraded publication",
			projection: model.AppInstanceProjection{
				PublicationSummary: model.PublicationDegraded,
			},
			want: RuntimeStatusPartial,
		},
		{
			name: "projection fallback from stopped desired state",
			projection: model.AppInstanceProjection{
				DesiredState: model.DesiredStateStopped,
			},
			want: RuntimeStatusStopped,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ResolveRuntimeStatus(tt.projection, tt.observed, tt.liveRaw, tt.runtimeReason); got != tt.want {
				t.Fatalf("expected %q, got %q", tt.want, got)
			}
		})
	}
}

func TestNormalizeAndMergeObservedEvidence(t *testing.T) {
	if got := NormalizePublicationSummary("published", "degraded"); got != model.PublicationDegraded {
		t.Fatalf("expected degraded publication summary, got %q", got)
	}
	if got := NormalizeHealthSummary("unhealthy"); got != model.HealthDegraded {
		t.Fatalf("expected degraded health summary, got %q", got)
	}
	merged := MergeObservedEvidence(model.AppInstanceProjection{
		HealthSummary:      model.HealthUnknown,
		PublicationSummary: model.PublicationUnpublished,
	}, AppObservedEvidence{
		RuntimeStatus:      RuntimeStatusStopped,
		HealthSummary:      model.HealthDegraded,
		PublicationSummary: model.PublicationDegraded,
	})
	if merged.HealthSummary != model.HealthDegraded {
		t.Fatalf("expected merged degraded health, got %q", merged.HealthSummary)
	}
	if merged.PublicationSummary != model.PublicationDegraded {
		t.Fatalf("expected merged degraded publication, got %q", merged.PublicationSummary)
	}
}

func TestResolveObservedEvidence(t *testing.T) {
	tests := []struct {
		name                    string
		primaryPublicationState string
		primaryHealthState      string
		summary                 map[string]any
		wantRuntime             RuntimeStatus
		wantHealth              model.HealthSummary
		wantPublication         model.PublicationSummary
	}{
		{
			name:                    "primary degraded publication outranks broader published summary",
			primaryPublicationState: "published",
			primaryHealthState:      "degraded",
			summary: map[string]any{
				"publication_summary": "published",
				"runtime_status":      "running",
				"health_summary":      "healthy",
			},
			wantRuntime:     RuntimeStatusRunning,
			wantHealth:      model.HealthHealthy,
			wantPublication: model.PublicationDegraded,
		},
		{
			name: "monitor summary fills missing exposure evidence",
			primaryPublicationState: "",
			primaryHealthState:      "",
			summary: map[string]any{
				"publication_summary": "published",
				"runtime_status":      "restarting",
				"health_summary":      "unhealthy",
			},
			wantRuntime:     RuntimeStatusRestarting,
			wantHealth:      model.HealthDegraded,
			wantPublication: model.PublicationPublished,
		},
		{
			name:            "monitor offline infers stopped evidence without summary",
			wantRuntime:     RuntimeStatusStopped,
			wantHealth:      model.HealthStopped,
			wantPublication: "",
		},
	}

	monitorStatuses := map[string]string{
		"primary degraded publication outranks broader published summary": "healthy",
		"monitor summary fills missing exposure evidence":                 "degraded",
		"monitor offline infers stopped evidence without summary":         "offline",
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveObservedEvidence(tt.primaryPublicationState, tt.primaryHealthState, monitorStatuses[tt.name], "", tt.summary)
			if got.RuntimeStatus != tt.wantRuntime {
				t.Fatalf("expected runtime %q, got %q", tt.wantRuntime, got.RuntimeStatus)
			}
			if got.HealthSummary != tt.wantHealth {
				t.Fatalf("expected health %q, got %q", tt.wantHealth, got.HealthSummary)
			}
			if got.PublicationSummary != tt.wantPublication {
				t.Fatalf("expected publication %q, got %q", tt.wantPublication, got.PublicationSummary)
			}
		})
	}
}

func TestProjectionActivityFromPipeline(t *testing.T) {
	tests := []struct {
		name            string
		current         model.AppInstanceProjection
		currentPipeline map[string]any
		wantAction      model.OperationType
		wantStatus      ActivityStatus
	}{
		{
			name: "active pipeline yields queued activity",
			currentPipeline: map[string]any{
				"status":        "active",
				"current_phase": "executing",
				"selector": map[string]any{
					"operation_type": string(model.OperationTypeUpgrade),
				},
			},
			wantAction: model.OperationTypeUpgrade,
			wantStatus: ActivityStatusQueued,
		},
		{
			name: "completed pipeline with retained phase does not stay queued",
			currentPipeline: map[string]any{
				"status":        "completed",
				"current_phase": "executing",
				"selector": map[string]any{
					"operation_type": string(model.OperationTypeUpgrade),
				},
			},
			wantAction: model.OperationTypeUpgrade,
			wantStatus: ActivityStatusIdle,
		},
		{
			name: "missing status still uses phase as legacy fallback",
			currentPipeline: map[string]any{
				"current_phase": "executing",
				"selector": map[string]any{
					"operation_type": string(model.OperationTypeUpgrade),
				},
			},
			wantAction: model.OperationTypeUpgrade,
			wantStatus: ActivityStatusQueued,
		},
		{
			name: "installing projection without selector falls back to install",
			current: model.AppInstanceProjection{
				LifecycleState: model.AppStateInstalling,
			},
			currentPipeline: map[string]any{},
			wantAction:      model.OperationTypeInstall,
			wantStatus:      ActivityStatusQueued,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ProjectionActivityFromPipeline(tt.current, tt.currentPipeline)
			if got.Action != tt.wantAction {
				t.Fatalf("expected action %q, got %q", tt.wantAction, got.Action)
			}
			if got.Status != tt.wantStatus {
				t.Fatalf("expected status %q, got %q", tt.wantStatus, got.Status)
			}
			if tt.currentPipeline != nil {
				wantPhase := ""
				if raw, ok := tt.currentPipeline["current_phase"]; ok {
					wantPhase = raw.(string)
				}
				if got.CurrentPhase != wantPhase {
					t.Fatalf("expected phase %q, got %q", wantPhase, got.CurrentPhase)
				}
			}
		})
	}
}

func TestResolveEffectiveStateReason(t *testing.T) {
	tests := []struct {
		name          string
		current       model.AppInstanceProjection
		effective     model.AppInstanceProjection
		evidence      AppObservedEvidence
		activity      AppProjectionActivity
		runtimeStatus RuntimeStatus
		runtimeReason string
		want          string
	}{
		{
			name:     "queued activity overrides stale completion reason",
			current:  model.AppInstanceProjection{StateReason: "operation completed"},
			activity: AppProjectionActivity{Action: model.OperationTypeUpgrade, Status: ActivityStatusQueued},
			want:     "upgrade in progress",
		},
		{
			name:          "runtime reason becomes effective reason when runtime is unavailable",
			current:       model.AppInstanceProjection{StateReason: "seeded"},
			effective:     model.AppInstanceProjection{LifecycleState: model.AppStateRunningHealthy},
			runtimeStatus: RuntimeStatusUnknown,
			runtimeReason: "Server is unreachable.",
			want:          "Server is unreachable.",
		},
		{
			name:          "degraded runtime gets structured reason",
			current:       model.AppInstanceProjection{StateReason: "operation completed"},
			effective:     model.AppInstanceProjection{LifecycleState: model.AppStateRunningDegraded, HealthSummary: model.HealthDegraded},
			evidence:      AppObservedEvidence{HealthSummary: model.HealthDegraded},
			runtimeStatus: RuntimeStatusRestarting,
			want:          "runtime restarting",
		},
		{
			name:          "desired stopped gets explicit reason",
			current:       model.AppInstanceProjection{StateReason: "old reason"},
			effective:     model.AppInstanceProjection{LifecycleState: model.AppStateStopped, DesiredState: model.DesiredStateStopped},
			runtimeStatus: RuntimeStatusStopped,
			want:          "desired state stopped",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveEffectiveStateReason(tt.current, tt.effective, tt.evidence, tt.activity, tt.runtimeStatus, tt.runtimeReason)
			if got != tt.want {
				t.Fatalf("expected reason %q, got %q", tt.want, got)
			}
		})
	}
}

func TestResolveInstanceState(t *testing.T) {
	tests := []struct {
		name          string
		effective     model.AppInstanceProjection
		activity      AppProjectionActivity
		runtimeStatus RuntimeStatus
		runtimeReason string
		want          InstanceState
	}{
		{
			name:          "queued uninstall becomes uninstalling",
			activity:      AppProjectionActivity{Action: model.OperationTypeUninstall, Status: ActivityStatusQueued},
			runtimeStatus: RuntimeStatusUnknown,
			want:          InstanceStateUninstalling,
		},
		{
			name:          "registered becomes unknown",
			effective:     model.AppInstanceProjection{LifecycleState: model.AppStateRegistered},
			runtimeStatus: RuntimeStatusUnknown,
			want:          InstanceStateUnknown,
		},
		{
			name:          "healthy runtime becomes running",
			effective:     model.AppInstanceProjection{LifecycleState: model.AppStateRunningHealthy},
			runtimeStatus: RuntimeStatusRunning,
			want:          InstanceStateRunning,
		},
		{
			name:          "maintenance maps to updating",
			effective:     model.AppInstanceProjection{LifecycleState: model.AppStateMaintenance},
			runtimeStatus: RuntimeStatusRunning,
			want:          InstanceStateUpdating,
		},
		{
			name:          "attention required preserved",
			effective:     model.AppInstanceProjection{LifecycleState: model.AppStateAttentionRequired},
			runtimeStatus: RuntimeStatusError,
			want:          InstanceStateAttentionRequired,
		},
		{
			name:          "runtime unavailable becomes unknown",
			effective:     model.AppInstanceProjection{LifecycleState: model.AppStateRunningHealthy},
			runtimeStatus: RuntimeStatusUnknown,
			runtimeReason: "Server is unreachable.",
			want:          InstanceStateUnknown,
		},
		{
			name:          "desired stopped plus runtime unavailable stays stopped",
			effective:     model.AppInstanceProjection{LifecycleState: model.AppStateStopped, DesiredState: model.DesiredStateStopped},
			runtimeStatus: RuntimeStatusUnknown,
			runtimeReason: "Server is unreachable.",
			want:          InstanceStateStopped,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveInstanceState(tt.effective, tt.activity, tt.runtimeStatus, tt.runtimeReason)
			if got != tt.want {
				t.Fatalf("expected instance_state %q, got %q", tt.want, got)
			}
		})
	}
}

func TestResolveEffectiveAppProjectionFromSources(t *testing.T) {
	current := model.AppInstanceProjection{
		LifecycleState:     model.AppStateRunningHealthy,
		HealthSummary:      model.HealthHealthy,
		PublicationSummary: model.PublicationPublished,
		DesiredState:       model.DesiredStateRunning,
		CurrentReleaseID:   "rel-1",
	}

	tests := []struct {
		name         string
		current      model.AppInstanceProjection
		sources      AppProjectionSources
		wantState    model.AppLifecycleState
		wantRuntime  RuntimeStatus
		wantHealth   model.HealthSummary
		wantPub      model.PublicationSummary
		wantReason   string
		wantInstance InstanceState
	}{
		{
			name:    "raw sources preserve degraded primary exposure over broader monitor success",
			current: current,
			sources: AppProjectionSources{
				PrimaryExposurePublicationState: "published",
				PrimaryExposureHealthState:      "degraded",
				MonitorSummary: map[string]any{
					"runtime_status":      "running",
					"health_summary":      "healthy",
					"publication_summary": "published",
				},
			},
			wantState:    model.AppStateRunningDegraded,
			wantRuntime:  RuntimeStatusRunning,
			wantHealth:   model.HealthHealthy,
			wantPub:      model.PublicationDegraded,
			wantReason:   "publication degraded",
			wantInstance: InstanceStateDegraded,
		},
		{
			name:    "runtime unavailable becomes unknown external state",
			current: current,
			sources: AppProjectionSources{
				RuntimeReason: "Server is unreachable.",
			},
			wantState:    model.AppStateRunningHealthy,
			wantRuntime:  RuntimeStatusUnknown,
			wantHealth:   model.HealthHealthy,
			wantPub:      model.PublicationPublished,
			wantReason:   "Server is unreachable.",
			wantInstance: InstanceStateUnknown,
		},
		{
			name: "desired stopped plus runtime unavailable stays stopped externally",
			current: func() model.AppInstanceProjection {
				current := current
				current.LifecycleState = model.AppStateStopped
				current.DesiredState = model.DesiredStateStopped
				current.HealthSummary = model.HealthStopped
				return current
			}(),
			sources: AppProjectionSources{
				RuntimeReason: "Server is unreachable.",
			},
			wantState:    model.AppStateStopped,
			wantRuntime:  RuntimeStatusUnknown,
			wantHealth:   model.HealthStopped,
			wantPub:      model.PublicationPublished,
			wantReason:   "Server is unreachable.",
			wantInstance: InstanceStateStopped,
		},
		{
			name:    "current pipeline source forces updating while live runtime wins",
			current: current,
			sources: AppProjectionSources{
				CurrentPipeline: map[string]any{
					"status":        "active",
					"current_phase": "executing",
					"selector": map[string]any{
						"operation_type": string(model.OperationTypeUpgrade),
					},
				},
				MonitorSummary: map[string]any{
					"runtime_status": "restarting",
					"health_summary": "degraded",
				},
				LiveRuntimeStatus: "Up 1 minute",
			},
			wantState:    model.AppStateUpdating,
			wantRuntime:  RuntimeStatusRunning,
			wantHealth:   model.HealthDegraded,
			wantPub:      model.PublicationPublished,
			wantReason:   "upgrade in progress",
			wantInstance: InstanceStateUpdating,
		},
		{
			name:    "monitor degraded reason fills mixed-evidence gap without summary",
			current: current,
			sources: AppProjectionSources{
				MonitorStatus: "degraded",
				MonitorReason: "health check timeout",
			},
			wantState:    model.AppStateRunningDegraded,
			wantRuntime:  RuntimeStatusRunning,
			wantHealth:   model.HealthDegraded,
			wantPub:      model.PublicationPublished,
			wantReason:   "health check timeout",
			wantInstance: InstanceStateDegraded,
		},
		{
			name:    "monitor offline without summary projects stopped",
			current: current,
			sources: AppProjectionSources{
				MonitorStatus: "offline",
				MonitorReason: "app is not running",
			},
			wantState:    model.AppStateStopped,
			wantRuntime:  RuntimeStatusStopped,
			wantHealth:   model.HealthStopped,
			wantPub:      model.PublicationPublished,
			wantReason:   "app is not running",
			wantInstance: InstanceStateStopped,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveEffectiveAppProjectionFromSources(tt.current, tt.sources)
			if got.Projection.LifecycleState != tt.wantState {
				t.Fatalf("expected lifecycle %q, got %q", tt.wantState, got.Projection.LifecycleState)
			}
			if got.RuntimeStatus != tt.wantRuntime {
				t.Fatalf("expected runtime %q, got %q", tt.wantRuntime, got.RuntimeStatus)
			}
			if got.Projection.HealthSummary != tt.wantHealth {
				t.Fatalf("expected health %q, got %q", tt.wantHealth, got.Projection.HealthSummary)
			}
			if got.Projection.PublicationSummary != tt.wantPub {
				t.Fatalf("expected publication %q, got %q", tt.wantPub, got.Projection.PublicationSummary)
			}
			if got.Projection.StateReason != tt.wantReason {
				t.Fatalf("expected state reason %q, got %q", tt.wantReason, got.Projection.StateReason)
			}
			if got.InstanceState != tt.wantInstance {
				t.Fatalf("expected instance_state %q, got %q", tt.wantInstance, got.InstanceState)
			}
		})
	}
}

func TestDecideAppLifecycleState(t *testing.T) {
	tests := []struct {
		name  string
		input AppStateDecisionInput
		want  model.AppLifecycleState
	}{
		{
			name: "queued install for new app",
			input: AppStateDecisionInput{
				ActivityAction: model.OperationTypeInstall,
				ActivityStatus: ActivityStatusQueued,
			},
			want: model.AppStateInstalling,
		},
		{
			name: "queued recover",
			input: AppStateDecisionInput{
				ExistingApp:    true,
				ActivityAction: model.OperationTypeRecover,
				ActivityStatus: ActivityStatusQueued,
			},
			want: model.AppStateRecovering,
		},
		{
			name: "successful stop",
			input: AppStateDecisionInput{
				ActivityAction: model.OperationTypeStop,
				ActivityStatus: ActivityStatusSucceeded,
			},
			want: model.AppStateStopped,
		},
		{
			name: "successful healthy runtime",
			input: AppStateDecisionInput{
				ActivityAction:     model.OperationTypeUpgrade,
				ActivityStatus:     ActivityStatusSucceeded,
				RuntimeStatus:      RuntimeStatusRunning,
				HealthSummary:      model.HealthHealthy,
				PublicationSummary: model.PublicationPublished,
			},
			want: model.AppStateRunningHealthy,
		},
		{
			name: "successful degraded runtime",
			input: AppStateDecisionInput{
				ActivityAction: model.OperationTypeUpgrade,
				ActivityStatus: ActivityStatusSucceeded,
				RuntimeStatus:  RuntimeStatusRestarting,
				HealthSummary:  model.HealthDegraded,
			},
			want: model.AppStateRunningDegraded,
		},
		{
			name: "successful publish with degraded publication keeps degraded lifecycle",
			input: AppStateDecisionInput{
				Current: model.AppInstanceProjection{
					LifecycleState: model.AppStateRunningDegraded,
				},
				ActivityAction:     model.OperationTypePublish,
				ActivityStatus:     ActivityStatusSucceeded,
				PublicationSummary: model.PublicationDegraded,
			},
			want: model.AppStateRunningDegraded,
		},
		{
			name: "observed starting runtime on existing app becomes updating",
			input: AppStateDecisionInput{
				ExistingApp:   true,
				RuntimeStatus: RuntimeStatusStarting,
			},
			want: model.AppStateUpdating,
		},
		{
			name: "observed starting runtime on new app becomes installing",
			input: AppStateDecisionInput{
				RuntimeStatus: RuntimeStatusStarting,
			},
			want: model.AppStateInstalling,
		},
		{
			name: "failed operation",
			input: AppStateDecisionInput{
				ActivityAction: model.OperationTypeUpgrade,
				ActivityStatus: ActivityStatusFailed,
			},
			want: model.AppStateAttentionRequired,
		},
		{
			name: "cancelled first install without release",
			input: AppStateDecisionInput{
				ActivityAction: model.OperationTypeInstall,
				ActivityStatus: ActivityStatusCancelled,
			},
			want: model.AppStateRegistered,
		},
		{
			name: "observed stopped runtime",
			input: AppStateDecisionInput{
				DesiredState:  model.DesiredStateStopped,
				RuntimeStatus: RuntimeStatusStopped,
			},
			want: model.AppStateStopped,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := DecideAppLifecycleState(tt.input); got != tt.want {
				t.Fatalf("expected %q, got %q", tt.want, got)
			}
		})
	}
}

func TestResolveEffectiveAppProjection(t *testing.T) {
	nowCurrent := model.AppInstanceProjection{
		LifecycleState:     model.AppStateRunningHealthy,
		HealthSummary:      model.HealthHealthy,
		PublicationSummary: model.PublicationPublished,
		DesiredState:       model.DesiredStateRunning,
	}

	tests := []struct {
		name          string
		current       model.AppInstanceProjection
		evidence      AppObservedEvidence
		activity      AppProjectionActivity
		liveRaw       string
		runtimeReason string
		wantState     model.AppLifecycleState
		wantRuntime   RuntimeStatus
		wantReason    string
		wantInstance  InstanceState
	}{
		{
			name:         "observed degraded evidence changes lifecycle",
			current:      nowCurrent,
			evidence:     AppObservedEvidence{RuntimeStatus: RuntimeStatusRestarting, HealthSummary: model.HealthDegraded, PublicationSummary: model.PublicationDegraded},
			wantState:    model.AppStateRunningDegraded,
			wantRuntime:  RuntimeStatusRestarting,
			wantReason:   "runtime restarting",
			wantInstance: InstanceStateDegraded,
		},
		{
			name: "current pipeline activity forces updating",
			current: func() model.AppInstanceProjection {
				current := nowCurrent
				current.CurrentReleaseID = "rel-1"
				return current
			}(),
			activity:     AppProjectionActivity{Action: model.OperationTypeUpgrade, Status: ActivityStatusQueued},
			wantState:    model.AppStateUpdating,
			wantRuntime:  RuntimeStatusRunning,
			wantReason:   "upgrade in progress",
			wantInstance: InstanceStateUpdating,
		},
		{
			name:         "live runtime wins over observed",
			current:      nowCurrent,
			evidence:     AppObservedEvidence{RuntimeStatus: RuntimeStatusPartial, HealthSummary: model.HealthDegraded},
			liveRaw:      "Up 2 minutes",
			wantState:    model.AppStateRunningDegraded,
			wantRuntime:  RuntimeStatusRunning,
			wantReason:   "health degraded",
			wantInstance: InstanceStateDegraded,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveEffectiveAppProjection(tt.current, tt.evidence, tt.activity, tt.liveRaw, tt.runtimeReason)
			if got.Projection.LifecycleState != tt.wantState {
				t.Fatalf("expected lifecycle %q, got %q", tt.wantState, got.Projection.LifecycleState)
			}
			if got.RuntimeStatus != tt.wantRuntime {
				t.Fatalf("expected runtime %q, got %q", tt.wantRuntime, got.RuntimeStatus)
			}
			if got.Projection.StateReason != tt.wantReason {
				t.Fatalf("expected state reason %q, got %q", tt.wantReason, got.Projection.StateReason)
			}
			if got.InstanceState != tt.wantInstance {
				t.Fatalf("expected instance_state %q, got %q", tt.wantInstance, got.InstanceState)
			}
		})
	}
}
