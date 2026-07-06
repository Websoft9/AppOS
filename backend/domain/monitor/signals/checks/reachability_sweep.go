package checks

import (
	"errors"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitorstatus "github.com/websoft9/appos/backend/domain/monitor/status"
	"github.com/websoft9/appos/backend/domain/resource/instances"
)

var defaultInstanceReachabilityPriority = map[string]int{
	monitor.StatusCredentialInvalid: 5,
	monitor.StatusUnreachable:       4,
	monitor.StatusDegraded:          3,
	monitor.StatusOffline:           2,
	monitor.StatusUnknown:           1,
	monitor.StatusHealthy:           0,
}

func RunInstanceReachabilitySweep(app core.App, repo instances.Repository, now time.Time) error {
	items, err := instances.List(repo, nil)
	if err != nil {
		return err
	}
	var sweepErrors []error
	for _, item := range items {
		if strings.TrimSpace(item.Endpoint()) == "" {
			continue
		}
		result := ProbeInstanceReachability(item)
		if err := ProjectInstanceReachability(app, item, result, now); err != nil {
			sweepErrors = append(sweepErrors, err)
		}
	}
	return errors.Join(sweepErrors...)
}

func ProjectInstanceReachability(app core.App, item *instances.Instance, result ReachabilityResult, now time.Time) error {
	if app == nil || item == nil {
		return nil
	}
	target, ok, err := monitor.ResolveInstanceTarget(item)
	if err != nil {
		return err
	}
	if !ok {
		return projectInstanceReachabilityDefault(app, item, result, now)
	}
	eligible, _ := target.EligibleForReachability()
	if !eligible {
		return projectInstanceReachabilityDefault(app, item, result, now)
	}
	return projectInstanceReachability(app, target, result, now)
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

func projectInstanceReachabilityDefault(app core.App, item *instances.Instance, result ReachabilityResult, now time.Time) error {
	status := monitor.StatusUnknown
	reason := result.Reason
	reasonCode := ""
	switch result.Status {
	case "online":
		status = monitor.StatusHealthy
		reason = ""
	case "offline":
		status = monitor.StatusUnreachable
		if strings.TrimSpace(reason) == "" {
			reason = "endpoint is unreachable"
		}
		reasonCode = "endpoint_unreachable"
	default:
		if strings.TrimSpace(reason) == "" {
			reason = "reachability result is unknown"
		}
		reasonCode = "reachability_unknown"
	}
	summary := monitorstatus.LoadResourceCheckSummary(app, monitor.TargetTypeResource, item.ID(), monitor.CheckKindReachability, "", item.Kind(), item.TemplateID(), item.Endpoint())
	summary["probe_protocol"] = result.Protocol
	summary["host"] = result.Host
	summary["port"] = result.Port
	monitorstatus.ApplyReasonCode(summary, reasonCode)
	if result.LatencyMS > 0 {
		summary["latency_ms"] = result.LatencyMS
	} else {
		delete(summary, "latency_ms")
	}
	return monitorstatus.ProjectResourceCheckLatestStatus(
		app,
		monitor.TargetTypeResource,
		item.ID(),
		monitorstatus.ResourceDisplayName(item),
		monitor.SignalSourceAppOS,
		monitor.CheckKindReachability,
		status,
		reason,
		summary,
		defaultInstanceReachabilityPriority,
		now,
	)
}
