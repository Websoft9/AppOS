package metrics

import monitortsdb "github.com/websoft9/appos/backend/domain/monitor/metrics/tsdb"

type metricSeriesDefinition = monitortsdb.SeriesDefinition

const allNetworkInterfaces = monitortsdb.AllNetworkInterfaces

// Local copies of monitor target-type constants. The API accepts plain strings;
// these are used only as map keys and comparison values within this package.
const (
	targetTypeServer   = "server"
	targetTypeApp      = "app"
	targetTypePlatform = "platform"

	platformTargetAppOSCore = "appos-core"
)

var allowedSeriesQueries = map[string]map[string]metricSeriesDefinition{
	targetTypeServer: monitortsdb.ServerSeriesDefinitions(),
	targetTypeApp: {
		"cpu":    monitortsdb.SelectorDefinition("appos_container_cpu_usage", "percent"),
		"memory": monitortsdb.SelectorDefinition("appos_container_memory_bytes", "bytes"),
	},
	targetTypePlatform: monitortsdb.PlatformSeriesDefinitions(platformTargetAppOSCore),
}
