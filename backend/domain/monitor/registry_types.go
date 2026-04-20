package monitor

import "github.com/websoft9/appos/backend/domain/resource/instances"

const (
	CheckKindHeartbeat    = "heartbeat"
	CheckKindCredential   = "credential"
	CheckKindAppHealth    = "app_health"
	CheckKindRuntime      = "runtime_summary"
	CheckKindReachability = "reachability"
)

type ReachabilityTargetPolicy struct {
	RequireEndpoint bool              `json:"requireEndpoint,omitempty"`
	StatusMap       map[string]string `json:"statusMap,omitempty"`
	ReasonMap       map[string]string `json:"reasonMap,omitempty"`
	ReasonCodeMap   map[string]string `json:"reasonCodeMap,omitempty"`
}

type CredentialTargetPolicy struct {
	RequireCredential bool              `json:"requireCredential,omitempty"`
	StatusMap         map[string]string `json:"statusMap,omitempty"`
	ReasonMap         map[string]string `json:"reasonMap,omitempty"`
	ReasonCodeMap     map[string]string `json:"reasonCodeMap,omitempty"`
}

type HeartbeatTargetPolicy struct {
	StatusMap     map[string]string `json:"statusMap,omitempty"`
	ReasonMap     map[string]string `json:"reasonMap,omitempty"`
	ReasonCodeMap map[string]string `json:"reasonCodeMap,omitempty"`
}

type AppHealthTargetPolicy struct {
	StatusMap     map[string]string `json:"statusMap,omitempty"`
	ReasonMap     map[string]string `json:"reasonMap,omitempty"`
	ReasonCodeMap map[string]string `json:"reasonCodeMap,omitempty"`
}

type RuntimeSummaryTargetPolicy struct {
	StatusMap     map[string]string `json:"statusMap,omitempty"`
	ReasonMap     map[string]string `json:"reasonMap,omitempty"`
	ReasonCodeMap map[string]string `json:"reasonCodeMap,omitempty"`
}

type TargetCheckPolicies struct {
	Reachability *ReachabilityTargetPolicy   `json:"reachability,omitempty"`
	Credential   *CredentialTargetPolicy     `json:"credential,omitempty"`
	Heartbeat    *HeartbeatTargetPolicy      `json:"heartbeat,omitempty"`
	AppHealth    *AppHealthTargetPolicy      `json:"app_health,omitempty"`
	Runtime      *RuntimeSummaryTargetPolicy `json:"runtime_summary,omitempty"`
}

type TargetRegistryEntry struct {
	ID             string              `json:"id"`
	TargetType     string              `json:"targetType"`
	Kind           string              `json:"kind,omitempty"`
	TemplateIDs    []string            `json:"templateIds,omitempty"`
	SignalSources  []string            `json:"signalSources,omitempty"`
	EnabledChecks  []string            `json:"enabledChecks,omitempty"`
	StatusPriority map[string]int      `json:"statusPriority,omitempty"`
	Checks         TargetCheckPolicies `json:"checks,omitempty"`
}

type ResolvedInstanceTarget struct {
	Entry TargetRegistryEntry
	Item  *instances.Instance
}
