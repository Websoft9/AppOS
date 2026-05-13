package checks

import (
	"context"
	"errors"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor/metrics"
	monitorstatus "github.com/websoft9/appos/backend/domain/monitor/status"
	"github.com/websoft9/appos/backend/domain/resource/servers"
)

func RunServerMetricsFreshnessSweep(app core.App, now time.Time) error {
	items, err := servers.ListManagedServers(app)
	if err != nil {
		return err
	}
	var sweepErrors []error
	ctx := context.Background()
	for _, server := range items {
		if server == nil || server.ID == "" {
			continue
		}
		observation, err := metrics.QueryServerMetricsFreshness(ctx, server.ID, now)
		var projection monitorstatus.MetricsFreshnessProjection
		if err != nil {
			projection = monitorstatus.MetricsFreshnessUnknown(err.Error())
			sweepErrors = append(sweepErrors, err)
		} else {
			projection = monitorstatus.EvaluateMetricsFreshness(observation.ObservedAt, observation.HasSample, now)
		}
		displayName := server.Name
		if displayName == "" {
			displayName = server.ID
		}
		if err := monitorstatus.ProjectMetricsFreshnessLatestStatus(app, server.ID, displayName, projection, now); err != nil {
			sweepErrors = append(sweepErrors, err)
		}
	}
	return errors.Join(sweepErrors...)
}
