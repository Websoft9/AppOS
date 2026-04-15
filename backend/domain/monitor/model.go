package monitor

import "time"

const (
	TargetTypeServer    = "server"
	TargetTypeApp       = "app"
	TargetTypeContainer = "container"
	TargetTypeResource  = "resource"
	TargetTypePlatform  = "platform"
)

const (
	StatusHealthy           = "healthy"
	StatusDegraded          = "degraded"
	StatusOffline           = "offline"
	StatusUnreachable       = "unreachable"
	StatusCredentialInvalid = "credential_invalid"
	StatusUnknown           = "unknown"
)

const (
	SignalSourceAgent     = "agent"
	SignalSourceAppOS     = "appos_active_check"
	SignalSourceSelf      = "appos_self"
	SignalSourceInventory = "appos_inventory"
	HeartbeatStateFresh   = "fresh"
	HeartbeatStateStale   = "stale"
	HeartbeatStateOffline = "offline"
)

const (
	AgentTokenSecretType   = "token"
	AgentTokenSecretPrefix = "monitor-agent-token-"
)

const (
	ExpectedHeartbeatInterval = 30 * time.Second
	StaleHeartbeatThreshold   = 90 * time.Second
	OfflineHeartbeatThreshold = 180 * time.Second
	MetricsBatchLimit         = 200
	RuntimeStatusBatchLimit   = 100
)

const EnvVictoriaMetricsURL = "TSDB_ADDR"

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
}

type MetricSeriesResponse struct {
	TargetType                 string         `json:"targetType"`
	TargetID                   string         `json:"targetId"`
	Window                     string         `json:"window"`
	Series                     []MetricSeries `json:"series"`
	AvailableNetworkInterfaces []string       `json:"availableNetworkInterfaces,omitempty"`
	SelectedNetworkInterface   string         `json:"selectedNetworkInterface,omitempty"`
}

type LatestStatusUpsert struct {
	TargetType              string
	TargetID                string
	DisplayName             string
	Status                  string
	Reason                  string
	SignalSource            string
	LastTransitionAt        time.Time
	LastSuccessAt           *time.Time
	LastFailureAt           *time.Time
	LastCheckedAt           *time.Time
	LastReportedAt          *time.Time
	ConsecutiveFailures     *int
	Summary                 map[string]any
	PreserveStrongerFailure bool
}

type OverviewItem struct {
	TargetType       string         `json:"targetType,omitempty"`
	TargetID         string         `json:"targetId"`
	DisplayName      string         `json:"displayName"`
	Status           string         `json:"status"`
	Reason           any            `json:"reason"`
	LastTransitionAt string         `json:"lastTransitionAt"`
	DetailHref       string         `json:"detailHref,omitempty"`
	Summary          map[string]any `json:"summary,omitempty"`
}

type OverviewResponse struct {
	Counts         map[string]int `json:"counts"`
	UnhealthyItems []OverviewItem `json:"unhealthyItems"`
	PlatformItems  []OverviewItem `json:"platformItems"`
}

type HeartbeatProjection struct {
	Status         string
	Reason         string
	HeartbeatState string
	ObservedAt     time.Time
}

type TargetStatusResponse struct {
	HasData             bool           `json:"hasData"`
	TargetType          string         `json:"targetType"`
	TargetID            string         `json:"targetId"`
	DisplayName         string         `json:"displayName"`
	Status              string         `json:"status"`
	Reason              any            `json:"reason"`
	SignalSource        string         `json:"signalSource"`
	LastTransitionAt    string         `json:"lastTransitionAt"`
	LastSuccessAt       any            `json:"lastSuccessAt"`
	LastFailureAt       any            `json:"lastFailureAt"`
	LastCheckedAt       any            `json:"lastCheckedAt"`
	LastReportedAt      any            `json:"lastReportedAt"`
	ConsecutiveFailures int            `json:"consecutiveFailures"`
	Summary             map[string]any `json:"summary,omitempty"`
}
