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
