package software

import "testing"

func TestResolveComponentHealthRunningNonReportingComponent(t *testing.T) {
	service, connection, reasons := ResolveComponentHealth(HealthResolutionEvidence{
		InstalledState:    InstalledStateInstalled,
		VerificationState: VerificationStateHealthy,
	})
	if service != ServiceStatusRunning {
		t.Fatalf("expected running service, got %q", service)
	}
	if connection != AppOSConnectionNotApplicable {
		t.Fatalf("expected not_applicable connection, got %q", connection)
	}
	if len(reasons) == 0 {
		t.Fatal("expected health reasons")
	}
}

func TestResolveComponentHealthStoppedReportingComponent(t *testing.T) {
	service, connection, _ := ResolveComponentHealth(HealthResolutionEvidence{
		InstalledState:    InstalledStateInstalled,
		VerificationState: VerificationStateDegraded,
		ReportingExpected: true,
		Verification: &SoftwareVerificationResult{Details: map[string]any{
			"runtime_active": false,
		}},
	})
	if service != ServiceStatusStopped {
		t.Fatalf("expected stopped service, got %q", service)
	}
	if connection != AppOSConnectionNotConnected {
		t.Fatalf("expected not_connected connection, got %q", connection)
	}
}

func TestResolveComponentHealthReportingAuthFailedBeforeFreshMetrics(t *testing.T) {
	_, connection, _ := ResolveComponentHealth(HealthResolutionEvidence{
		InstalledState:        InstalledStateInstalled,
		VerificationState:     VerificationStateHealthy,
		ReportingExpected:     true,
		MetricsFreshnessState: "fresh",
		Verification: &SoftwareVerificationResult{Details: map[string]any{
			"remote_write_username_matches": false,
			"remote_write_password_present": true,
		}},
	})
	if connection != AppOSConnectionAuthFailed {
		t.Fatalf("expected auth_failed before metrics freshness, got %q", connection)
	}
}

func TestResolveComponentHealthReportingFreshnessStates(t *testing.T) {
	cases := []struct {
		state string
		want  AppOSConnectionStatus
	}{
		{state: "fresh", want: AppOSConnectionConnected},
		{state: "stale", want: AppOSConnectionStale},
		{state: "missing", want: AppOSConnectionNotConnected},
		{state: "unknown", want: AppOSConnectionUnknown},
	}
	for _, c := range cases {
		_, got, _ := ResolveComponentHealth(HealthResolutionEvidence{
			InstalledState:               InstalledStateInstalled,
			VerificationState:            VerificationStateHealthy,
			ReportingExpected:            true,
			HasMonitorConnectionEvidence: true,
			MetricsFreshnessState:        c.state,
			Verification: &SoftwareVerificationResult{Details: map[string]any{
				"remote_write_config_present":      true,
				"remote_write_enabled":             true,
				"remote_write_destination_present": true,
				"remote_write_username_matches":    true,
				"remote_write_password_present":    true,
			}},
		})
		if got != c.want {
			t.Fatalf("freshness %q: got %q, want %q", c.state, got, c.want)
		}
	}
}
