package software

import (
	"fmt"
	"strings"
)

type HealthResolutionEvidence struct {
	ComponentKey                 ComponentKey
	InstalledState               InstalledState
	VerificationState            VerificationState
	Verification                 *SoftwareVerificationResult
	LastOperationTerminalStatus  TerminalStatus
	ReportingExpected            bool
	MetricsFreshnessState        string
	MetricsReasonCode            string
	HasMonitorConnectionEvidence bool
}

func ResolveComponentHealth(e HealthResolutionEvidence) (ServiceStatus, AppOSConnectionStatus, []string) {
	reasons := []string{}
	serviceStatus := resolveServiceStatus(e, &reasons)
	connectionStatus := resolveAppOSConnection(e, serviceStatus, &reasons)
	return serviceStatus, connectionStatus, reasons
}

func resolveServiceStatus(e HealthResolutionEvidence, reasons *[]string) ServiceStatus {
	if e.InstalledState == InstalledStateNotInstalled {
		*reasons = append(*reasons, "installed_state:not_installed")
		return ServiceStatusNotInstalled
	}

	if e.LastOperationTerminalStatus == TerminalStatusFailed || e.LastOperationTerminalStatus == TerminalStatusAttentionRequired {
		*reasons = append(*reasons, fmt.Sprintf("last_operation:%s", e.LastOperationTerminalStatus))
		return ServiceStatusNeedsAttention
	}

	if e.InstalledState == InstalledStateInstalled {
		switch e.VerificationState {
		case VerificationStateHealthy:
			*reasons = append(*reasons, "verification_state:healthy")
			return ServiceStatusRunning
		case VerificationStateDegraded:
			if serviceInactive(e.Verification) {
				*reasons = append(*reasons, "service:stopped")
				return ServiceStatusStopped
			}
			*reasons = append(*reasons, "verification_state:degraded")
			return ServiceStatusNeedsAttention
		default:
			*reasons = append(*reasons, "verification_state:unknown")
			return ServiceStatusInstalled
		}
	}

	*reasons = append(*reasons, "installed_state:unknown")
	return ServiceStatusUnknown
}

func resolveAppOSConnection(e HealthResolutionEvidence, serviceStatus ServiceStatus, reasons *[]string) AppOSConnectionStatus {
	if !e.ReportingExpected {
		*reasons = append(*reasons, "appos_connection:not_applicable")
		return AppOSConnectionNotApplicable
	}

	if serviceStatus == ServiceStatusNotInstalled {
		*reasons = append(*reasons, "appos_connection:unknown_not_installed")
		return AppOSConnectionUnknown
	}

	if serviceStatus == ServiceStatusStopped {
		*reasons = append(*reasons, "appos_connection:not_connected_service_stopped")
		return AppOSConnectionNotConnected
	}

	if verificationBool(e.Verification, "remote_write_username_matches") == boolFalse || verificationBool(e.Verification, "remote_write_password_present") == boolFalse {
		*reasons = append(*reasons, "appos_connection:auth_failed")
		return AppOSConnectionAuthFailed
	}

	for _, key := range []string{"remote_write_config_present", "remote_write_enabled", "remote_write_destination_present"} {
		if verificationBool(e.Verification, key) == boolFalse {
			*reasons = append(*reasons, "appos_connection:misconfigured")
			return AppOSConnectionMisconfigured
		}
	}

	switch strings.TrimSpace(strings.ToLower(e.MetricsFreshnessState)) {
	case "fresh":
		*reasons = append(*reasons, "metrics_freshness:fresh")
		return AppOSConnectionConnected
	case "stale":
		*reasons = append(*reasons, "metrics_freshness:stale")
		return AppOSConnectionStale
	case "missing":
		*reasons = append(*reasons, "metrics_freshness:missing")
		return AppOSConnectionNotConnected
	case "unknown":
		*reasons = append(*reasons, "metrics_freshness:unknown")
		return AppOSConnectionUnknown
	}

	if e.HasMonitorConnectionEvidence {
		*reasons = append(*reasons, "appos_connection:unknown_monitor_summary")
		return AppOSConnectionUnknown
	}

	*reasons = append(*reasons, "appos_connection:not_connected_no_sample")
	return AppOSConnectionNotConnected
}

func serviceInactive(verification *SoftwareVerificationResult) bool {
	if verification == nil {
		return false
	}
	if verificationBool(verification, "runtime_active") == boolFalse {
		return true
	}
	reason := strings.ToLower(verification.Reason)
	return strings.Contains(reason, "stopped") || strings.Contains(reason, "inactive") || strings.Contains(reason, "not running")
}

type boolState int

const (
	boolUnknown boolState = iota
	boolFalse
	boolTrue
)

func verificationBool(verification *SoftwareVerificationResult, key string) boolState {
	if verification == nil || verification.Details == nil {
		return boolUnknown
	}
	value, ok := verification.Details[key]
	if !ok {
		return boolUnknown
	}
	switch typed := value.(type) {
	case bool:
		if typed {
			return boolTrue
		}
		return boolFalse
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "true", "yes", "1":
			return boolTrue
		case "false", "no", "0":
			return boolFalse
		}
	}
	return boolUnknown
}
