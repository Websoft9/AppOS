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
	RuntimeStatusBatchLimit   = 100
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
