package monitor

import "strings"

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

func (e TargetRegistryEntry) RuntimeStatusFor(outcome string) string {
	policy := e.Checks.Runtime
	if policy == nil {
		return defaultStatusForRuntimeSummaryOutcome(outcome)
	}
	return statusForOutcome(policy.StatusMap, outcome, defaultStatusForRuntimeSummaryOutcome)
}

func (e TargetRegistryEntry) RuntimeReasonFor(outcome string, fallback string) string {
	policy := e.Checks.Runtime
	if policy == nil {
		return reasonForOutcome(nil, outcome, fallback, defaultReasonForRuntimeSummaryOutcome)
	}
	return reasonForOutcome(policy.ReasonMap, outcome, fallback, defaultReasonForRuntimeSummaryOutcome)
}

func (e TargetRegistryEntry) RuntimeReasonCodeFor(outcome string, fallback string) string {
	policy := e.Checks.Runtime
	if policy == nil {
		return reasonCodeForOutcome(nil, outcome, fallback, defaultReasonCodeForRuntimeSummaryOutcome)
	}
	return reasonCodeForOutcome(policy.ReasonCodeMap, outcome, fallback, defaultReasonCodeForRuntimeSummaryOutcome)
}

func (e TargetRegistryEntry) StatusPriorityFor(status string) int {
	return StatusPriorityWithMap(status, e.StatusPriority)
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

func RuntimeSummaryOutcomeFromRuntimeState(runtimeState string) string {
	switch strings.TrimSpace(strings.ToLower(runtimeState)) {
	case "running", "healthy":
		return StatusHealthy
	case "degraded", "restarting":
		return StatusDegraded
	case "stopped", "stopping", "exited":
		return "stopped"
	default:
		return StatusUnknown
	}
}
