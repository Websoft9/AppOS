package monitor

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"
	"sync"

	"github.com/websoft9/appos/backend/domain/resource/instances"
)

const (
	CheckKindHeartbeat  = "heartbeat"
	CheckKindCredential = "credential"
	CheckKindAppHealth  = "app_health"
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

type TargetCheckPolicies struct {
	Reachability *ReachabilityTargetPolicy `json:"reachability,omitempty"`
	Credential   *CredentialTargetPolicy   `json:"credential,omitempty"`
	Heartbeat    *HeartbeatTargetPolicy    `json:"heartbeat,omitempty"`
	AppHealth    *AppHealthTargetPolicy    `json:"app_health,omitempty"`
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

//go:embed all:targets
var embeddedTargetRegistryFiles embed.FS

var (
	targetRegistryOnce    sync.Once
	targetRegistryErr     error
	targetRegistryEntries []TargetRegistryEntry
)

func MonitoringTargetRegistry() ([]TargetRegistryEntry, error) {
	if err := ensureTargetRegistryLoaded(); err != nil {
		return nil, err
	}
	result := make([]TargetRegistryEntry, len(targetRegistryEntries))
	copy(result, targetRegistryEntries)
	return result, nil
}

func ResolveInstanceTarget(item *instances.Instance) (ResolvedInstanceTarget, bool, error) {
	entry, ok, err := ResolveTargetRegistryEntry(TargetTypeResource, item.Kind(), item.TemplateID())
	if err != nil || !ok {
		return ResolvedInstanceTarget{}, ok, err
	}
	return ResolvedInstanceTarget{Entry: entry, Item: item}, true, nil
}

func ResolveTargetRegistryEntry(targetType, kind, templateID string) (TargetRegistryEntry, bool, error) {
	entries, err := MonitoringTargetRegistry()
	if err != nil {
		return TargetRegistryEntry{}, false, err
	}

	targetType = strings.TrimSpace(strings.ToLower(targetType))
	kind = strings.TrimSpace(strings.ToLower(kind))
	templateID = instances.NormalizeTemplateID(templateID)
	for _, entry := range entries {
		if entry.TargetType != targetType {
			continue
		}
		if entry.Kind != "" && entry.Kind != kind {
			continue
		}
		if len(entry.TemplateIDs) > 0 {
			if templateID == "" || !containsNormalized(entry.TemplateIDs, templateID) {
				continue
			}
		}
		return entry, true, nil
	}

	return TargetRegistryEntry{}, false, nil
}

func (r ResolvedInstanceTarget) SupportsCheck(checkKind string) bool {
	return containsNormalized(r.Entry.EnabledChecks, checkKind)
}

func (r ResolvedInstanceTarget) EligibleForReachability() (bool, string) {
	if !r.SupportsCheck(CheckKindReachability) {
		return false, "reachability check is not enabled"
	}
	policy := r.Entry.Checks.Reachability
	if policy != nil && policy.RequireEndpoint && strings.TrimSpace(r.Item.Endpoint()) == "" {
		return false, "instance endpoint is empty"
	}
	return true, ""
}

func (r ResolvedInstanceTarget) EligibleForCredential() (bool, string) {
	if !r.SupportsCheck(CheckKindCredential) {
		return false, "credential check is not enabled"
	}
	policy := r.Entry.Checks.Credential
	if policy != nil && policy.RequireCredential && strings.TrimSpace(r.Item.CredentialID()) == "" {
		return false, "instance credential is empty"
	}
	return true, ""
}

func (r ResolvedInstanceTarget) ReachabilityStatusFor(outcome string) string {
	policy := r.Entry.Checks.Reachability
	if policy == nil {
		return defaultStatusForReachabilityOutcome(outcome)
	}
	return statusForOutcome(policy.StatusMap, outcome, defaultStatusForReachabilityOutcome)
}

func (r ResolvedInstanceTarget) ReachabilityReasonFor(outcome string, fallback string) string {
	policy := r.Entry.Checks.Reachability
	if policy == nil {
		return reasonForOutcome(nil, outcome, fallback, defaultReasonForReachabilityOutcome)
	}
	return reasonForOutcome(policy.ReasonMap, outcome, fallback, defaultReasonForReachabilityOutcome)
}

func (r ResolvedInstanceTarget) ReachabilityReasonCodeFor(outcome string, fallback string) string {
	policy := r.Entry.Checks.Reachability
	if policy == nil {
		return reasonCodeForOutcome(nil, outcome, fallback, defaultReasonCodeForReachabilityOutcome)
	}
	return reasonCodeForOutcome(policy.ReasonCodeMap, outcome, fallback, defaultReasonCodeForReachabilityOutcome)
}

func (r ResolvedInstanceTarget) CredentialStatusFor(outcome string) string {
	policy := r.Entry.Checks.Credential
	if policy == nil {
		return defaultStatusForCredentialOutcome(outcome)
	}
	return statusForOutcome(policy.StatusMap, outcome, defaultStatusForCredentialOutcome)
}

func (r ResolvedInstanceTarget) CredentialReasonFor(outcome string, fallback string) string {
	policy := r.Entry.Checks.Credential
	if policy == nil {
		return reasonForOutcome(nil, outcome, fallback, defaultReasonForCredentialOutcome)
	}
	return reasonForOutcome(policy.ReasonMap, outcome, fallback, defaultReasonForCredentialOutcome)
}

func (r ResolvedInstanceTarget) CredentialReasonCodeFor(outcome string, fallback string) string {
	policy := r.Entry.Checks.Credential
	if policy == nil {
		return reasonCodeForOutcome(nil, outcome, fallback, defaultReasonCodeForCredentialOutcome)
	}
	return reasonCodeForOutcome(policy.ReasonCodeMap, outcome, fallback, defaultReasonCodeForCredentialOutcome)
}

func (r ResolvedInstanceTarget) StatusPriorityFor(status string) int {
	return r.Entry.StatusPriorityFor(status)
}

func (e TargetRegistryEntry) HeartbeatStatusFor(outcome string) string {
	policy := e.Checks.Heartbeat
	if policy == nil {
		return defaultStatusForHeartbeatOutcome(outcome)
	}
	return statusForOutcome(policy.StatusMap, outcome, defaultStatusForHeartbeatOutcome)
}

func (e TargetRegistryEntry) HeartbeatReasonFor(outcome string, fallback string) string {
	policy := e.Checks.Heartbeat
	if policy == nil {
		return reasonForOutcome(nil, outcome, fallback, defaultReasonForHeartbeatOutcome)
	}
	return reasonForOutcome(policy.ReasonMap, outcome, fallback, defaultReasonForHeartbeatOutcome)
}

func (e TargetRegistryEntry) HeartbeatReasonCodeFor(outcome string, fallback string) string {
	policy := e.Checks.Heartbeat
	if policy == nil {
		return reasonCodeForOutcome(nil, outcome, fallback, defaultReasonCodeForHeartbeatOutcome)
	}
	return reasonCodeForOutcome(policy.ReasonCodeMap, outcome, fallback, defaultReasonCodeForHeartbeatOutcome)
}

func (e TargetRegistryEntry) AppHealthStatusFor(outcome string) string {
	policy := e.Checks.AppHealth
	if policy == nil {
		return defaultStatusForAppHealthOutcome(outcome)
	}
	return statusForOutcome(policy.StatusMap, outcome, defaultStatusForAppHealthOutcome)
}

func (e TargetRegistryEntry) AppHealthReasonFor(outcome string, fallback string) string {
	policy := e.Checks.AppHealth
	if policy == nil {
		return reasonForOutcome(nil, outcome, fallback, defaultReasonForAppHealthOutcome)
	}
	return reasonForOutcome(policy.ReasonMap, outcome, fallback, defaultReasonForAppHealthOutcome)
}

func (e TargetRegistryEntry) AppHealthReasonCodeFor(outcome string, fallback string) string {
	policy := e.Checks.AppHealth
	if policy == nil {
		return reasonCodeForOutcome(nil, outcome, fallback, defaultReasonCodeForAppHealthOutcome)
	}
	return reasonCodeForOutcome(policy.ReasonCodeMap, outcome, fallback, defaultReasonCodeForAppHealthOutcome)
}

func (e TargetRegistryEntry) StatusPriorityFor(status string) int {
	return statusPriorityWithMap(status, e.StatusPriority)
}

func ResolveAppBaselineTarget() TargetRegistryEntry {
	entry, ok, err := ResolveTargetRegistryEntry(TargetTypeApp, "", "")
	if err != nil || !ok {
		return TargetRegistryEntry{}
	}
	return entry
}

func AppHealthOutcomeFromRuntimeState(runtimeState string) string {
	switch strings.TrimSpace(strings.ToLower(runtimeState)) {
	case "running", "healthy":
		return StatusHealthy
	case "degraded", "restarting", "error", "failed":
		return StatusDegraded
	case "stopped", "stopping", "exited":
		return StatusOffline
	default:
		return StatusUnknown
	}
}

func ensureTargetRegistryLoaded() error {
	targetRegistryOnce.Do(func() {
		targetRegistryErr = loadTargetRegistry()
	})
	return targetRegistryErr
}

func loadTargetRegistry() error {
	entries, err := fs.ReadDir(embeddedTargetRegistryFiles, "targets")
	if err != nil {
		return fmt.Errorf("read monitoring target registry: %w", err)
	}

	loaded := make([]TargetRegistryEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
			continue
		}

		filePath := path.Join("targets", entry.Name())
		content, err := embeddedTargetRegistryFiles.ReadFile(filePath)
		if err != nil {
			return fmt.Errorf("read monitoring target registry file %s: %w", filePath, err)
		}

		var fileEntries []TargetRegistryEntry
		if err := json.Unmarshal(content, &fileEntries); err != nil {
			return fmt.Errorf("parse monitoring target registry file %s: %w", filePath, err)
		}
		for _, item := range fileEntries {
			normalized, err := normalizeTargetRegistryEntry(item)
			if err != nil {
				return fmt.Errorf("invalid monitoring target registry file %s: %w", filePath, err)
			}
			loaded = append(loaded, normalized)
		}
	}

	sort.Slice(loaded, func(i, j int) bool {
		return loaded[i].ID < loaded[j].ID
	})
	targetRegistryEntries = loaded
	return nil
}

func normalizeTargetRegistryEntry(entry TargetRegistryEntry) (TargetRegistryEntry, error) {
	entry.ID = strings.TrimSpace(entry.ID)
	entry.TargetType = strings.TrimSpace(strings.ToLower(entry.TargetType))
	entry.Kind = strings.TrimSpace(strings.ToLower(entry.Kind))
	entry.SignalSources = normalizeStringSlice(entry.SignalSources)
	entry.EnabledChecks = normalizeStringSlice(entry.EnabledChecks)
	entry.TemplateIDs = normalizeTemplateIDs(entry.TemplateIDs)
	entry.StatusPriority = normalizeStatusPriorityMap(entry.StatusPriority)
	if entry.Checks.Reachability != nil {
		entry.Checks.Reachability.StatusMap = normalizeStatusMap(entry.Checks.Reachability.StatusMap)
		entry.Checks.Reachability.ReasonMap = normalizeReasonMap(entry.Checks.Reachability.ReasonMap)
		entry.Checks.Reachability.ReasonCodeMap = normalizeReasonMap(entry.Checks.Reachability.ReasonCodeMap)
	}
	if entry.Checks.Credential != nil {
		entry.Checks.Credential.StatusMap = normalizeStatusMap(entry.Checks.Credential.StatusMap)
		entry.Checks.Credential.ReasonMap = normalizeReasonMap(entry.Checks.Credential.ReasonMap)
		entry.Checks.Credential.ReasonCodeMap = normalizeReasonMap(entry.Checks.Credential.ReasonCodeMap)
	}
	if entry.Checks.Heartbeat != nil {
		entry.Checks.Heartbeat.StatusMap = normalizeStatusMap(entry.Checks.Heartbeat.StatusMap)
		entry.Checks.Heartbeat.ReasonMap = normalizeReasonMap(entry.Checks.Heartbeat.ReasonMap)
		entry.Checks.Heartbeat.ReasonCodeMap = normalizeReasonMap(entry.Checks.Heartbeat.ReasonCodeMap)
	}
	if entry.Checks.AppHealth != nil {
		entry.Checks.AppHealth.StatusMap = normalizeStatusMap(entry.Checks.AppHealth.StatusMap)
		entry.Checks.AppHealth.ReasonMap = normalizeReasonMap(entry.Checks.AppHealth.ReasonMap)
		entry.Checks.AppHealth.ReasonCodeMap = normalizeReasonMap(entry.Checks.AppHealth.ReasonCodeMap)
	}
	if entry.ID == "" {
		return TargetRegistryEntry{}, fmt.Errorf("registry entry id is required")
	}
	if entry.TargetType == "" {
		return TargetRegistryEntry{}, fmt.Errorf("registry entry %q targetType is required", entry.ID)
	}
	return entry, nil
}

func normalizeStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(strings.ToLower(value))
		if trimmed == "" {
			continue
		}
		if containsNormalized(result, trimmed) {
			continue
		}
		result = append(result, trimmed)
	}
	return result
}

func normalizeTemplateIDs(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		normalized := instances.NormalizeTemplateID(value)
		if normalized == "" || containsNormalized(result, normalized) {
			continue
		}
		result = append(result, normalized)
	}
	return result
}

func normalizeStatusMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		normalizedKey := strings.TrimSpace(strings.ToLower(key))
		normalizedValue := strings.TrimSpace(strings.ToLower(value))
		if normalizedKey == "" || normalizedValue == "" {
			continue
		}
		result[normalizedKey] = normalizedValue
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func normalizeReasonMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		normalizedKey := strings.TrimSpace(strings.ToLower(key))
		normalizedValue := strings.TrimSpace(value)
		if normalizedKey == "" || normalizedValue == "" {
			continue
		}
		result[normalizedKey] = normalizedValue
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func normalizeStatusPriorityMap(values map[string]int) map[string]int {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]int, len(values))
	for key, value := range values {
		normalizedKey := strings.TrimSpace(strings.ToLower(key))
		if normalizedKey == "" {
			continue
		}
		result[normalizedKey] = value
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func statusForOutcome(statusMap map[string]string, outcome string, fallback func(string) string) string {
	normalizedOutcome := strings.TrimSpace(strings.ToLower(outcome))
	if normalizedOutcome != "" {
		if mapped, ok := statusMap[normalizedOutcome]; ok && mapped != "" {
			return mapped
		}
	}
	return fallback(normalizedOutcome)
}

func reasonForOutcome(reasonMap map[string]string, outcome string, fallback string, defaultReason func(string) string) string {
	trimmedFallback := strings.TrimSpace(fallback)
	if trimmedFallback != "" {
		return trimmedFallback
	}
	normalizedOutcome := strings.TrimSpace(strings.ToLower(outcome))
	if normalizedOutcome != "" {
		if mapped, ok := reasonMap[normalizedOutcome]; ok && strings.TrimSpace(mapped) != "" {
			return strings.TrimSpace(mapped)
		}
	}
	return defaultReason(normalizedOutcome)
}

func reasonCodeForOutcome(codeMap map[string]string, outcome string, fallback string, defaultCode func(string) string) string {
	trimmedFallback := strings.TrimSpace(strings.ToLower(fallback))
	if trimmedFallback != "" {
		return trimmedFallback
	}
	normalizedOutcome := strings.TrimSpace(strings.ToLower(outcome))
	if normalizedOutcome != "" {
		if mapped, ok := codeMap[normalizedOutcome]; ok && strings.TrimSpace(mapped) != "" {
			return strings.TrimSpace(strings.ToLower(mapped))
		}
	}
	return defaultCode(normalizedOutcome)
}

func defaultStatusForReachabilityOutcome(outcome string) string {
	switch strings.TrimSpace(strings.ToLower(outcome)) {
	case "online":
		return StatusHealthy
	case "offline":
		return StatusUnreachable
	default:
		return StatusUnknown
	}
}

func defaultReasonForReachabilityOutcome(outcome string) string {
	switch strings.TrimSpace(strings.ToLower(outcome)) {
	case "online":
		return ""
	case "offline":
		return "endpoint is unreachable"
	default:
		return "reachability result is unknown"
	}
}

func defaultReasonCodeForReachabilityOutcome(outcome string) string {
	switch strings.TrimSpace(strings.ToLower(outcome)) {
	case "online":
		return ""
	case "offline":
		return "endpoint_unreachable"
	default:
		return "reachability_unknown"
	}
}

func defaultStatusForCredentialOutcome(outcome string) string {
	switch strings.TrimSpace(strings.ToLower(outcome)) {
	case "success":
		return StatusHealthy
	case "auth_failed":
		return StatusCredentialInvalid
	case "unreachable":
		return StatusUnreachable
	default:
		return StatusUnknown
	}
}

func defaultReasonForCredentialOutcome(outcome string) string {
	switch strings.TrimSpace(strings.ToLower(outcome)) {
	case "success":
		return ""
	case "auth_failed":
		return "credential validation failed"
	case "unreachable":
		return "credential target is unreachable"
	default:
		return "credential validation result is unknown"
	}
}

func defaultReasonCodeForCredentialOutcome(outcome string) string {
	switch strings.TrimSpace(strings.ToLower(outcome)) {
	case "success":
		return ""
	case "auth_failed":
		return "credential_auth_failed"
	case "unreachable":
		return "credential_target_unreachable"
	default:
		return "credential_check_unknown"
	}
}

func defaultStatusForHeartbeatOutcome(outcome string) string {
	switch strings.TrimSpace(strings.ToLower(outcome)) {
	case HeartbeatStateFresh:
		return StatusHealthy
	case HeartbeatStateStale:
		return StatusUnknown
	case HeartbeatStateOffline:
		return StatusOffline
	default:
		return StatusUnknown
	}
}

func defaultReasonForHeartbeatOutcome(outcome string) string {
	switch strings.TrimSpace(strings.ToLower(outcome)) {
	case HeartbeatStateFresh:
		return ""
	case HeartbeatStateStale:
		return "heartbeat stale"
	case HeartbeatStateOffline:
		return "heartbeat missing"
	default:
		return "heartbeat state is unknown"
	}
}

func defaultReasonCodeForHeartbeatOutcome(outcome string) string {
	switch strings.TrimSpace(strings.ToLower(outcome)) {
	case HeartbeatStateFresh:
		return ""
	case HeartbeatStateStale:
		return "heartbeat_stale"
	case HeartbeatStateOffline:
		return "heartbeat_missing"
	default:
		return "heartbeat_unknown"
	}
}

func defaultStatusForAppHealthOutcome(outcome string) string {
	switch strings.TrimSpace(strings.ToLower(outcome)) {
	case StatusHealthy:
		return StatusHealthy
	case StatusDegraded:
		return StatusDegraded
	case StatusOffline:
		return StatusOffline
	default:
		return StatusUnknown
	}
}

func defaultReasonForAppHealthOutcome(outcome string) string {
	switch strings.TrimSpace(strings.ToLower(outcome)) {
	case StatusHealthy:
		return ""
	case StatusDegraded:
		return "app runtime unhealthy"
	case StatusOffline:
		return "app is not running"
	default:
		return "app monitoring has not reported yet"
	}
}

func defaultReasonCodeForAppHealthOutcome(outcome string) string {
	switch strings.TrimSpace(strings.ToLower(outcome)) {
	case StatusHealthy:
		return ""
	case StatusDegraded:
		return "app_runtime_unhealthy"
	case StatusOffline:
		return "app_not_running"
	default:
		return "app_monitoring_pending"
	}
}

func containsNormalized(values []string, expected string) bool {
	expected = strings.TrimSpace(strings.ToLower(expected))
	for _, value := range values {
		if strings.TrimSpace(strings.ToLower(value)) == expected {
			return true
		}
	}
	return false
}
