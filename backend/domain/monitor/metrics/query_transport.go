package metrics

import (
	"context"
	"time"

	monitortsdb "github.com/websoft9/appos/backend/domain/monitor/metrics/tsdb"
)

func listNetworkInterfaces(ctx context.Context, service *monitortsdb.Service, targetID string, start, end time.Time) ([]string, error) {
	return service.ListNetworkInterfaces(ctx, targetID, start, end)
}

func executeVMQueryRange(ctx context.Context, service *monitortsdb.Service, query string, start, end time.Time, step time.Duration) ([][]float64, error) {
	return service.ExecuteQueryRange(ctx, query, start, end, step)
}
