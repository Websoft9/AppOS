package metrics

import "time"

const (
	MetricsBatchLimit     = 200
	EnvVictoriaMetricsURL = "TSDB_ADDR"
)

type MetricPoint struct {
	Series     string
	Value      float64
	Labels     map[string]string
	ObservedAt time.Time
}

type MetricSeries struct {
	Name     string                `json:"name"`
	Unit     string                `json:"unit"`
	Points   [][]float64           `json:"points,omitempty"`
	Segments []MetricSeriesSegment `json:"segments,omitempty"`
	Metadata map[string]string     `json:"metadata,omitempty"`
}

type MetricSeriesSegment struct {
	Name   string      `json:"name"`
	Points [][]float64 `json:"points"`
}

type MetricSeriesQueryOptions struct {
	NetworkInterface string
	StartAt          *time.Time
	EndAt            *time.Time
}

type MetricSeriesResponse struct {
	TargetType                 string         `json:"targetType"`
	TargetID                   string         `json:"targetId"`
	Window                     string         `json:"window"`
	RangeStartAt               string         `json:"rangeStartAt,omitempty"`
	RangeEndAt                 string         `json:"rangeEndAt,omitempty"`
	StepSeconds                int            `json:"stepSeconds,omitempty"`
	Series                     []MetricSeries `json:"series"`
	AvailableNetworkInterfaces []string       `json:"availableNetworkInterfaces,omitempty"`
	SelectedNetworkInterface   string         `json:"selectedNetworkInterface,omitempty"`
}

type MetricLatestResponse struct {
	TargetType                 string         `json:"targetType"`
	TargetID                   string         `json:"targetId"`
	CadenceSeconds             int            `json:"cadenceSeconds,omitempty"`
	Series                     []MetricSeries `json:"series"`
	AvailableNetworkInterfaces []string       `json:"availableNetworkInterfaces,omitempty"`
	SelectedNetworkInterface   string         `json:"selectedNetworkInterface,omitempty"`
}

type ContainerTelemetryTarget struct {
	ID   string
	Name string
}

type ContainerTelemetryLatest struct {
	CPUPercent               *float64 `json:"cpuPercent,omitempty"`
	MemoryUsageBytes         *float64 `json:"memoryUsageBytes,omitempty"`
	MemoryLimitBytes         *float64 `json:"memoryLimitBytes,omitempty"`
	NetworkRxBytesPerSecond  *float64 `json:"networkRxBytesPerSecond,omitempty"`
	NetworkTxBytesPerSecond  *float64 `json:"networkTxBytesPerSecond,omitempty"`
	BlockReadBytesPerSecond  *float64 `json:"blockReadBytesPerSecond,omitempty"`
	BlockWriteBytesPerSecond *float64 `json:"blockWriteBytesPerSecond,omitempty"`
}

type ContainerTelemetryFreshness struct {
	State      string `json:"state"`
	ObservedAt string `json:"observedAt,omitempty"`
}

type ContainerTelemetryItem struct {
	ContainerID    string                      `json:"containerId"`
	ContainerName  string                      `json:"containerName,omitempty"`
	ComposeProject string                      `json:"composeProject,omitempty"`
	ComposeService string                      `json:"composeService,omitempty"`
	Latest         ContainerTelemetryLatest    `json:"latest"`
	Freshness      ContainerTelemetryFreshness `json:"freshness"`
	Series         []MetricSeries              `json:"series,omitempty"`
}

type ContainerTelemetryResponse struct {
	ServerID     string                   `json:"serverId"`
	Window       string                   `json:"window"`
	RangeStartAt string                   `json:"rangeStartAt,omitempty"`
	RangeEndAt   string                   `json:"rangeEndAt,omitempty"`
	StepSeconds  int                      `json:"stepSeconds,omitempty"`
	Items        []ContainerTelemetryItem `json:"items"`
}
