package deploy

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/pocketbase/pocketbase/core"
	"gopkg.in/yaml.v3"
)

const (
	SourceManualOps = "manualops"
	SourceGitOps    = "gitops"

	StatusQueued                     = "queued"
	StatusValidating                 = "validating"
	StatusPreparing                  = "preparing"
	StatusRunning                    = "running"
	StatusVerifying                  = "verifying"
	StatusSuccess                    = "success"
	StatusFailed                     = "failed"
	StatusRollingBack                = "rolling_back"
	StatusRolledBack                 = "rolled_back"
	StatusCancelled                  = "cancelled"
	StatusTimeout                    = "timeout"
	StatusManualInterventionRequired = "manual_intervention_required"

	AdapterManualCompose = "manual-compose"
	AdapterGitCompose    = "git-compose"
	MaxExecutionLogBytes = 64 * 1024
)

var activeExecutionStatuses = []string{
	StatusValidating,
	StatusPreparing,
	StatusRunning,
	StatusVerifying,
	StatusRollingBack,
}

type Event string

const (
	EventCreate                     Event = "create"
	EventQueueRejected              Event = "queue_rejected"
	EventValidationStarted          Event = "validation_started"
	EventValidationFailed           Event = "validation_failed"
	EventPreparationStarted         Event = "preparation_started"
	EventPreparationFailed          Event = "preparation_failed"
	EventExecutionStarted           Event = "execution_started"
	EventExecutionFailed            Event = "execution_failed"
	EventVerificationStarted        Event = "verification_started"
	EventVerificationFailed         Event = "verification_failed"
	EventDeploymentSucceeded        Event = "deployment_succeeded"
	EventRollbackStarted            Event = "rollback_started"
	EventRollbackSucceeded          Event = "rollback_succeeded"
	EventRollbackFailed             Event = "rollback_failed"
	EventCancelled                  Event = "cancelled"
	EventTimedOut                   Event = "timed_out"
	EventManualInterventionRequired Event = "manual_intervention_required"
)

type transitionDef struct {
	From []string
	To   string
}

var eventTransitions = map[Event]transitionDef{
	EventCreate: {
		From: []string{""},
		To:   StatusQueued,
	},
	EventQueueRejected: {
		From: []string{StatusQueued},
		To:   StatusFailed,
	},
	EventValidationStarted: {
		From: []string{StatusQueued},
		To:   StatusValidating,
	},
	EventValidationFailed: {
		From: []string{StatusValidating},
		To:   StatusFailed,
	},
	EventPreparationStarted: {
		From: []string{StatusValidating},
		To:   StatusPreparing,
	},
	EventPreparationFailed: {
		From: []string{StatusPreparing},
		To:   StatusFailed,
	},
	EventExecutionStarted: {
		From: []string{StatusPreparing},
		To:   StatusRunning,
	},
	EventExecutionFailed: {
		From: []string{StatusRunning},
		To:   StatusFailed,
	},
	EventVerificationStarted: {
		From: []string{StatusRunning},
		To:   StatusVerifying,
	},
	EventVerificationFailed: {
		From: []string{StatusVerifying},
		To:   StatusFailed,
	},
	EventDeploymentSucceeded: {
		From: []string{StatusVerifying},
		To:   StatusSuccess,
	},
	EventRollbackStarted: {
		From: []string{StatusFailed, StatusTimeout, StatusManualInterventionRequired},
		To:   StatusRollingBack,
	},
	EventRollbackSucceeded: {
		From: []string{StatusRollingBack},
		To:   StatusRolledBack,
	},
	EventRollbackFailed: {
		From: []string{StatusRollingBack},
		To:   StatusManualInterventionRequired,
	},
	EventCancelled: {
		From: []string{StatusQueued, StatusValidating, StatusPreparing, StatusRunning, StatusVerifying},
		To:   StatusCancelled,
	},
	EventTimedOut: {
		From: []string{StatusValidating, StatusPreparing, StatusRunning, StatusVerifying, StatusRollingBack},
		To:   StatusTimeout,
	},
	EventManualInterventionRequired: {
		From: []string{StatusFailed, StatusTimeout, StatusRollingBack},
		To:   StatusManualInterventionRequired,
	},
}

var allowedTransitions = buildAllowedTransitions(eventTransitions)

type TransitionOptions struct {
	ErrorSummary      string
	ClearErrorSummary bool
}

type DeploymentSpec struct {
	ServerID           string            `json:"server_id,omitempty"`
	Source             string            `json:"source"`
	Adapter            string            `json:"adapter"`
	ComposeProjectName string            `json:"compose_project_name"`
	ProjectDir         string            `json:"project_dir,omitempty"`
	RenderedCompose    string            `json:"rendered_compose"`
	Env                map[string]string `json:"env,omitempty"`
}

type ManualComposeRequest struct {
	ServerID    string `json:"server_id"`
	ProjectName string `json:"project_name"`
	Compose     string `json:"compose"`
}

type GitComposeRequest struct {
	ServerID        string `json:"server_id"`
	ProjectName     string `json:"project_name"`
	RepositoryURL   string `json:"repository_url"`
	Ref             string `json:"ref"`
	ComposePath     string `json:"compose_path"`
	RawURL          string `json:"raw_url"`
	AuthHeaderName  string `json:"auth_header_name"`
	AuthHeaderValue string `json:"auth_header_value"`
}

func StatusValues() []string {
	return []string{
		StatusQueued,
		StatusValidating,
		StatusPreparing,
		StatusRunning,
		StatusVerifying,
		StatusSuccess,
		StatusFailed,
		StatusRollingBack,
		StatusRolledBack,
		StatusCancelled,
		StatusTimeout,
		StatusManualInterventionRequired,
	}
}

func ActiveExecutionStatuses() []string {
	return append([]string(nil), activeExecutionStatuses...)
}

func IsActiveExecutionStatus(status string) bool {
	for _, candidate := range activeExecutionStatuses {
		if candidate == status {
			return true
		}
	}
	return false
}

func ValidateManualCompose(raw string) error {
	if strings.TrimSpace(raw) == "" {
		return fmt.Errorf("compose is required")
	}

	var doc map[string]any
	if err := yaml.Unmarshal([]byte(raw), &doc); err != nil {
		return fmt.Errorf("invalid compose yaml: %w", err)
	}

	services, ok := doc["services"]
	if !ok {
		return fmt.Errorf("compose must contain services")
	}

	serviceMap, ok := services.(map[string]any)
	if !ok || len(serviceMap) == 0 {
		return fmt.Errorf("compose services must be a non-empty map")
	}

	return nil
}

func CanTransition(from, to string) bool {
	if from == to {
		return true
	}
	transitions, ok := allowedTransitions[from]
	if !ok {
		return false
	}
	return transitions[to]
}

func ApplyEvent(current string, event Event) (string, error) {
	transition, ok := eventTransitions[event]
	if !ok {
		return "", fmt.Errorf("unknown deployment event: %s", event)
	}
	for _, candidate := range transition.From {
		if candidate == current {
			return transition.To, nil
		}
	}
	return "", fmt.Errorf("illegal deployment event %s from %s", event, current)
}

func FailureEventForStatus(status string) (Event, error) {
	switch status {
	case StatusQueued:
		return EventQueueRejected, nil
	case StatusValidating:
		return EventValidationFailed, nil
	case StatusPreparing:
		return EventPreparationFailed, nil
	case StatusRunning:
		return EventExecutionFailed, nil
	case StatusVerifying:
		return EventVerificationFailed, nil
	case StatusRollingBack:
		return EventRollbackFailed, nil
	default:
		return "", fmt.Errorf("no failure event defined for status %s", status)
	}
}

func IsTerminalStatus(status string) bool {
	switch status {
	case StatusSuccess, StatusFailed, StatusRolledBack, StatusCancelled, StatusTimeout, StatusManualInterventionRequired:
		return true
	default:
		return false
	}
}

func ApplyEventToRecord(app core.App, record *core.Record, event Event, opts TransitionOptions) error {
	current := record.GetString("status")
	next, err := ApplyEvent(current, event)
	if err != nil {
		return err
	}
	record.Set("status", next)
	if opts.ClearErrorSummary {
		record.Set("error_summary", "")
	}
	if opts.ErrorSummary != "" {
		record.Set("error_summary", opts.ErrorSummary)
	}
	now := time.Now()
	if next == StatusRunning && record.GetDateTime("started_at").IsZero() {
		record.Set("started_at", now)
	}
	if IsTerminalStatus(next) {
		record.Set("finished_at", now)
	}
	return app.Save(record)
}

func buildAllowedTransitions(events map[Event]transitionDef) map[string]map[string]bool {
	transitions := map[string]map[string]bool{}
	for _, transition := range events {
		for _, from := range transition.From {
			if transitions[from] == nil {
				transitions[from] = map[string]bool{}
			}
			transitions[from][transition.To] = true
		}
	}
	return transitions
}

func NormalizeProjectName(input string) string {
	input = strings.TrimSpace(strings.ToLower(input))
	if input == "" {
		return "appos-deploy"
	}

	var b strings.Builder
	lastDash := false
	for _, r := range input {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			lastDash = false
		case r == '-' || r == '_' || unicode.IsSpace(r):
			if !lastDash && b.Len() > 0 {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}

	result := strings.Trim(b.String(), "-")
	if result == "" {
		return "appos-deploy"
	}
	return result
}

func SpecToMap(spec DeploymentSpec) map[string]any {
	data, err := json.Marshal(spec)
	if err != nil {
		return map[string]any{}
	}
	result := map[string]any{}
	if err := json.Unmarshal(data, &result); err != nil {
		return map[string]any{}
	}
	return result
}
