package checks

import (
	"errors"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitorstatus "github.com/websoft9/appos/backend/domain/monitor/status"
	"github.com/websoft9/appos/backend/domain/resource/instances"
)

func RunInstanceReachabilitySweep(app core.App, repo instances.Repository, now time.Time) error {
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
		eligible, _ := target.EligibleForReachability()
		if !eligible {
			continue
		}
		result := ProbeInstanceReachability(item)
		if err := projectInstanceReachability(app, target, result, now); err != nil {
			sweepErrors = append(sweepErrors, err)
		}
	}
	return errors.Join(sweepErrors...)
}

func projectInstanceReachability(app core.App, target monitor.ResolvedInstanceTarget, result ReachabilityResult, now time.Time) error {
	status := target.ReachabilityStatusFor(result.Status)
	reason := target.ReachabilityReasonFor(result.Status, result.Reason)
	summary := monitorstatus.LoadResourceCheckSummary(app, monitor.TargetTypeResource, target.Item.ID(), monitor.CheckKindReachability, target.Entry.ID, target.Item.Kind(), target.Item.TemplateID(), target.Item.Endpoint())
	summary["probe_protocol"] = result.Protocol
	summary["host"] = result.Host
	summary["port"] = result.Port
	monitorstatus.ApplyReasonCode(summary, target.ReachabilityReasonCodeFor(result.Status, ""))
	if result.LatencyMS > 0 {
		summary["latency_ms"] = result.LatencyMS
	} else {
		delete(summary, "latency_ms")
	}
	return monitorstatus.ProjectResourceCheckLatestStatus(
		app,
		monitor.TargetTypeResource,
		target.Item.ID(),
		monitorstatus.ResourceDisplayName(target.Item),
		monitor.SignalSourceAppOS,
		monitor.CheckKindReachability,
		status,
		reason,
		summary,
		target.Entry.StatusPriority,
		now,
	)
}
