package monitor

import (
	"time"
)

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
	StatusCredentialInvalid = "credential_invalid" // #nosec G101 -- symbolic monitor status, not a credential
	StatusUnknown           = "unknown"
)

const (
	SignalSourceNetdata     = "netdata"
	SignalSourceAppOS       = "appos_active_check"
	SignalSourceSelf        = "appos_self"
	SignalSourceInventory   = "appos_inventory"
	MetricsFreshnessFresh   = "fresh"
	MetricsFreshnessStale   = "stale"
	MetricsFreshnessMissing = "missing"
	MetricsFreshnessUnknown = "unknown"
)

const (
	MetricsStaleThreshold   = 90 * time.Second
	MetricsMissingThreshold = 180 * time.Second
)

type CanonicalSignalEvent struct {
	TargetType              string
	TargetID                string
	DisplayName             string
	Status                  string
	Reason                  string
	SignalSource            string
	ObservedAt              time.Time
	LastSuccessAt           *time.Time
	LastFailureAt           *time.Time
	LastCheckedAt           *time.Time
	LastReportedAt          *time.Time
	ConsecutiveFailures     *int
	Summary                 map[string]any
	StatusPriorityMap       map[string]int
	PreserveStrongerFailure bool
}
