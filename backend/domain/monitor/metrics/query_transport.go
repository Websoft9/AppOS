package metrics

import (
	"context"
	"fmt"
	"time"

	monitortsdb "github.com/websoft9/appos/backend/domain/monitor/metrics/tsdb"
)

func listNetworkInterfaces(ctx context.Context, service *monitortsdb.Service, targetType, targetID string, start, end time.Time) ([]string, error) {
	selector := fmt.Sprintf(`appos_host_network_rx_bytes_per_second{target_type="server",target_id=%q,network_interface!=""}`, targetID)
	if isNetdataPlatformTarget(targetType, targetID) {
		selector = fmt.Sprintf(`appos_platform_network_rx_bytes_per_second{target_type="platform",target_id=%q,network_interface!=""}`, targetID)
	}
	return service.ListNetworkInterfaces(ctx, selector, start, end)
}

func executeVMQueryRange(ctx context.Context, service *monitortsdb.Service, query string, start, end time.Time, step time.Duration) ([][]float64, error) {
	return service.ExecuteQueryRange(ctx, query, start, end, step)
}
