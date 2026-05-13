package checks

import (
	"errors"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitorstatus "github.com/websoft9/appos/backend/domain/monitor/status"
	"github.com/websoft9/appos/backend/domain/resource/instances"
	"github.com/websoft9/appos/backend/domain/secrets"
)

type CredentialCheckResult struct {
	Status             string
	Reason             string
	Action             string
	CredentialTemplate string
	ObservedValueKey   string
}

func RunInstanceCredentialSweep(app core.App, repo instances.Repository, now time.Time) error {
	items, err := instances.List(repo, nil)
	if err != nil {
		return err
	}
	var sweepErrors []error
	for _, item := range items {
		target, ok, err := monitor.ResolveInstanceTarget(item)
		if err != nil {
			sweepErrors = append(sweepErrors, err)
			continue
		}
		if !ok {
			continue
		}
		eligible, _ := target.EligibleForCredential()
		if !eligible {
			continue
		}
		result := CheckInstanceCredential(app, target)
		if err := projectInstanceCredential(app, target, result, now); err != nil {
			sweepErrors = append(sweepErrors, err)
		}
	}
	return errors.Join(sweepErrors...)
}

func CheckInstanceCredential(app core.App, target monitor.ResolvedInstanceTarget) CredentialCheckResult {
	item := target.Item
	if strings.TrimSpace(item.CredentialID()) == "" {
		return CredentialCheckResult{Status: target.CredentialStatusFor("auth_failed"), Reason: target.CredentialReasonFor("auth_failed", "instance credential is empty")}
	}

	resolved, err := secrets.Resolve(app, item.CredentialID(), "system")
	if err != nil {
		return CredentialCheckResult{Status: target.CredentialStatusFor("auth_failed"), Reason: target.CredentialReasonFor("auth_failed", err.Error())}
	}

	switch strings.TrimSpace(item.Kind()) {
	case instances.KindRedis:
		return checkRedisInstanceCredential(target, resolved)
	default:
		return CredentialCheckResult{Status: target.CredentialStatusFor("unknown"), Reason: target.CredentialReasonFor("unknown", "credential check is not implemented for this resource kind")}
	}
}

func projectInstanceCredential(app core.App, target monitor.ResolvedInstanceTarget, result CredentialCheckResult, now time.Time) error {
	item := target.Item
	summary := monitorstatus.LoadResourceCheckSummary(app, monitor.TargetTypeResource, item.ID(), monitor.CheckKindCredential, target.Entry.ID, item.Kind(), item.TemplateID(), item.Endpoint())
	summary["credential_id"] = item.CredentialID()
	monitorstatus.ApplyReasonCode(summary, target.CredentialReasonCodeFor(summaryCredentialOutcome(result.Status), ""))
	if result.Action != "" {
		summary["credential_action"] = result.Action
	}
	if result.CredentialTemplate != "" {
		summary["credential_template"] = result.CredentialTemplate
	}
	if result.ObservedValueKey != "" {
		summary["credential_value_key"] = result.ObservedValueKey
	}
	return monitorstatus.ProjectResourceCheckLatestStatus(
		app,
		monitor.TargetTypeResource,
		item.ID(),
		monitorstatus.ResourceDisplayName(item),
		monitor.SignalSourceAppOS,
		monitor.CheckKindCredential,
		result.Status,
		result.Reason,
		summary,
		target.Entry.StatusPriority,
		now,
	)
}
