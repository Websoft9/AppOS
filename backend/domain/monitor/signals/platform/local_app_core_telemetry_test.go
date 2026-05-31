package platform

import (
	"testing"
	"time"
)

func TestBuildLocalAppCoreMetricPointsIncludesDiskAndNetworkRates(t *testing.T) {
	now := time.Date(2026, 5, 23, 12, 0, 30, 0, time.UTC)
	points := buildLocalAppCoreMetricPoints(now, localAppCoreSnapshot{
		MemoryUsedBytes:  1024,
		MemoryAvailBytes: 2048,
		DiskUsedBytes:    2048,
		DiskFreeBytes:    4096,
		DiskReadBytes:    9000,
		DiskWriteBytes:   12000,
		NetworkCounters: map[string]localNetworkCounters{
			"eth0": {RxBytes: 6000, TxBytes: 9000},
		},
	}, localAppCoreTelemetryState{
		ObservedAt:     now.Add(-30 * time.Second),
		DiskReadBytes:  3000,
		DiskWriteBytes: 6000,
		NetworkCounters: map[string]localNetworkCounters{
			"eth0": {RxBytes: 3000, TxBytes: 4500},
		},
	})

	seen := map[string]bool{}
	for _, point := range points {
		seen[point.Series] = true
		if point.Labels["target_type"] != "platform" || point.Labels["target_id"] != PlatformTargetAppOSCore {
			t.Fatalf("unexpected labels for %+v", point)
		}
	}
	for _, series := range []string{
		"appos_platform_disk_usage_bytes",
		"appos_platform_disk_free_bytes",
		"appos_platform_disk_read_bytes_per_second",
		"appos_platform_disk_write_bytes_per_second",
		"appos_platform_network_rx_bytes_per_second",
		"appos_platform_network_tx_bytes_per_second",
	} {
		if !seen[series] {
			t.Fatalf("expected %s in %+v", series, points)
		}
	}
}
