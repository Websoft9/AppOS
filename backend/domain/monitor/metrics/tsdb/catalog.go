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
		"cpu": {
			Unit: "percent",
			BuildQuery: func(_ string, targetID string) string {
				return fmt.Sprintf(`100 - netdata_system_cpu_percentage_average{instance=%q,dimension="idle"}`, targetID)
			},
		},
		"memory": {
			Unit: "bytes",
			BuildQuery: func(_ string, targetID string) string {
				return fmt.Sprintf(`netdata_system_ram_MiB_average{instance=%q,dimension="used"} * 1048576`, targetID)
			},
		},
		"disk": {
			Unit: "bytes/s",
			BuildQuery: func(_ string, targetID string) string {
				return fmt.Sprintf(`sum(netdata_system_io_KiB_persec_average{instance=%q,dimension=~"reads|writes"}) * 1024`, targetID)
			},
		},
		"disk_usage": {
			Unit: "percent",
			BuildQuery: func(_ string, targetID string) string {
				return fmt.Sprintf(`100 * sum(netdata_disk_space_GiB_average{instance=%q,family="/",dimension="used"}) / sum(netdata_disk_space_GiB_average{instance=%q,family="/",dimension=~"avail|used|reserved_for_root"})`, targetID, targetID)
			},
		},
		"network": {
			Unit: "bytes/s",
			BuildQuery: func(_ string, targetID string) string {
				return fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension=~"received|sent"}) * 125`, targetID)
			},
		},
		"network_traffic": {
			Unit: "GB",
			BuildQuery: func(_ string, targetID string) string {
				return fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension=~"received|sent"}) * 125`, targetID)
			},
		},
	}
}

func PlatformSeriesDefinitions(platformTargetAppOSCore string) map[string]SeriesDefinition {
	return map[string]SeriesDefinition{
		"cpu": {
			Unit: "percent",
			BuildQuery: func(targetType, targetID string) string {
				if targetID == platformTargetAppOSCore {
					return fmt.Sprintf(`100 - netdata_system_cpu_percentage_average{instance=%q,dimension="idle"}`, platformTargetAppOSCore)
				}
				return SelectorQuery("appos_platform_cpu_percent", targetType, targetID)
			},
		},
		"memory": {
			Unit: "bytes",
			BuildQuery: func(targetType, targetID string) string {
				if targetID == platformTargetAppOSCore {
					return fmt.Sprintf(`netdata_system_ram_MiB_average{instance=%q,dimension="used"} * 1048576`, platformTargetAppOSCore)
				}
				return SelectorQuery("appos_platform_memory_bytes", targetType, targetID)
			},
		},
		"disk": {
			Unit: "bytes/s",
			BuildQuery: func(_ string, targetID string) string {
				if targetID == platformTargetAppOSCore {
					return fmt.Sprintf(`sum(netdata_system_io_KiB_persec_average{instance=%q,dimension=~"reads|writes"}) * 1024`, platformTargetAppOSCore)
				}
				return ""
			},
		},
		"disk_usage": {
			Unit: "percent",
			BuildQuery: func(_ string, targetID string) string {
				if targetID == platformTargetAppOSCore {
					return fmt.Sprintf(`100 * sum(netdata_disk_space_GiB_average{instance=%q,family="/",dimension="used"}) / sum(netdata_disk_space_GiB_average{instance=%q,family="/",dimension=~"avail|used|reserved_for_root"})`, platformTargetAppOSCore, platformTargetAppOSCore)
				}
				return ""
			},
		},
		"network": {
			Unit: "bytes/s",
			BuildQuery: func(_ string, targetID string) string {
				if targetID == platformTargetAppOSCore {
					return fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension=~"received|sent"}) * 125`, platformTargetAppOSCore)
				}
				return ""
			},
		},
		"network_traffic": {
			Unit: "GB",
			BuildQuery: func(_ string, targetID string) string {
				if targetID == platformTargetAppOSCore {
					return fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension=~"received|sent"}) * 125`, platformTargetAppOSCore)
				}
				return ""
			},
		},
	}
}

func BuildNetworkQueries(targetID, selectedInterface string) (string, string, map[string]string) {
	selected := selectedInterface
	if selected == "" {
		selected = AllNetworkInterfaces
	}
	receivedQuery := fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension="received"}) * 125`, targetID)
	sentQuery := fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension="sent"}) * 125`, targetID)
	metadata := map[string]string(nil)
	if selected != AllNetworkInterfaces {
		receivedQuery = fmt.Sprintf(`sum(netdata_net_net_kilobits_persec_average{instance=%q,device=%q,dimension="received"}) * 125`, targetID, selected)
		sentQuery = fmt.Sprintf(`sum(netdata_net_net_kilobits_persec_average{instance=%q,device=%q,dimension="sent"}) * 125`, targetID, selected)
		metadata = map[string]string{"network_interface": selected}
	}
	return receivedQuery, sentQuery, metadata
}
