package monitor

func defaultStatusForReachabilityOutcome(outcome string) string {
	switch outcome {
	case "online":
		return StatusHealthy
	case "offline":
		return StatusUnreachable
	default:
		return StatusUnknown
	}
}

func defaultReasonForReachabilityOutcome(outcome string) string {
	switch outcome {
	case "online":
		return ""
	case "offline":
		return "endpoint is unreachable"
	default:
		return "reachability result is unknown"
	}
}

func defaultReasonCodeForReachabilityOutcome(outcome string) string {
	switch outcome {
	case "online":
		return ""
	case "offline":
		return "endpoint_unreachable"
	default:
		return "reachability_unknown"
	}
}

func defaultStatusForCredentialOutcome(outcome string) string {
	switch outcome {
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
	switch outcome {
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
	switch outcome {
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

func defaultStatusForAppHealthOutcome(outcome string) string {
	switch outcome {
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
	switch outcome {
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
	switch outcome {
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

func defaultStatusForRuntimeSummaryOutcome(outcome string) string {
	switch outcome {
	case StatusHealthy:
		return StatusHealthy
	case StatusDegraded:
		return StatusDegraded
	case "stopped":
		return StatusUnknown
	default:
		return StatusUnknown
	}
}

func defaultReasonForRuntimeSummaryOutcome(outcome string) string {
	switch outcome {
	case StatusHealthy:
		return ""
	case StatusDegraded:
		return "runtime degraded"
	case "stopped":
		return "runtime not running"
	default:
		return "runtime summary reported"
	}
}

func defaultReasonCodeForRuntimeSummaryOutcome(outcome string) string {
	switch outcome {
	case StatusHealthy:
		return ""
	case StatusDegraded:
		return "runtime_degraded"
	case "stopped":
		return "runtime_not_running"
	default:
		return "runtime_summary_unknown"
	}
}
