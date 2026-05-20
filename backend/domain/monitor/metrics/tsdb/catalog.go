package tsdb

import "fmt"

type SeriesDefinition struct {
	Unit       string
	BuildQuery func(targetType, targetID string) string
}

const AllNetworkInterfaces = "all"

func SelectorDefinition(metric string, unit string) SeriesDefinition {
	return SeriesDefinition{
		Unit: unit,
		BuildQuery: func(targetType, targetID string) string {
			return SelectorQuery(metric, targetType, targetID)
		},
	}
}

func SelectorQuery(metric string, targetType string, targetID string) string {
	return fmt.Sprintf(`%s{target_type=%q,target_id=%q}`, metric, targetType, targetID)
}

func ScalePoints(points [][]float64, multiplier float64) [][]float64 {
	scaled := make([][]float64, 0, len(points))
	for _, point := range points {
		if len(point) < 2 {
			continue
		}
		scaled = append(scaled, []float64{point[0], point[1] * multiplier})
	}
	return scaled
}

func ServerSeriesDefinitions() map[string]SeriesDefinition {
	return map[string]SeriesDefinition{
		"cpu":             SelectorDefinition("appos_host_cpu_usage", "percent"),
		"memory":          SelectorDefinition("appos_host_memory_bytes", "bytes"),
		"disk":            SelectorDefinition("appos_host_disk_read_bytes_per_second", "bytes/s"),
		"disk_usage":      SelectorDefinition("appos_host_disk_usage_bytes", "percent"),
		"network":         SelectorDefinition("appos_host_network_rx_bytes_per_second", "bytes/s"),
		"network_traffic": SelectorDefinition("appos_host_network_rx_bytes_per_second", "bytes"),
	}
}

func PlatformSeriesDefinitions(platformTargetAppOSCore string) map[string]SeriesDefinition {
	return map[string]SeriesDefinition{
		"cpu":             SelectorDefinition("appos_platform_cpu_percent", "percent"),
		"memory":          SelectorDefinition("appos_platform_memory_bytes", "bytes"),
		"disk":            SelectorDefinition("appos_host_disk_read_bytes_per_second", "bytes/s"),
		"disk_usage":      SelectorDefinition("appos_host_disk_usage_bytes", "percent"),
		"network":         SelectorDefinition("appos_host_network_rx_bytes_per_second", "bytes/s"),
		"network_traffic": SelectorDefinition("appos_host_network_rx_bytes_per_second", "bytes"),
	}
}

func BuildNetworkQueries(targetID, selectedInterface string) (string, string, map[string]string) {
	selected := selectedInterface
	if selected == "" {
		selected = AllNetworkInterfaces
	}
	receivedQuery := fmt.Sprintf(`sum(appos_host_network_rx_bytes_per_second{target_type="server",target_id=%q,network_interface=""})`, targetID)
	sentQuery := fmt.Sprintf(`sum(appos_host_network_tx_bytes_per_second{target_type="server",target_id=%q,network_interface=""})`, targetID)
	metadata := map[string]string(nil)
	if selected != AllNetworkInterfaces {
		receivedQuery = fmt.Sprintf(`sum(appos_host_network_rx_bytes_per_second{target_type="server",target_id=%q,network_interface=%q})`, targetID, selected)
		sentQuery = fmt.Sprintf(`sum(appos_host_network_tx_bytes_per_second{target_type="server",target_id=%q,network_interface=%q})`, targetID, selected)
		metadata = map[string]string{"network_interface": selected}
	}
	return receivedQuery, sentQuery, metadata
}
