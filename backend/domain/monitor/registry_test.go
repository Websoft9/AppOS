package monitor

import (
	"testing"

	"github.com/websoft9/appos/backend/domain/resource/instances"
)

func TestResolveInstanceTargetMatchesRegistryOverlay(t *testing.T) {
	item := instances.RestoreInstance(instances.Snapshot{
		ID:           "inst-1",
		Name:         "redis-primary",
		Kind:         instances.KindRedis,
		TemplateID:   "generic-redis",
		Endpoint:     "127.0.0.1:6379",
		CredentialID: "secret-1",
	})

	target, ok, err := ResolveInstanceTarget(item)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected redis instance to resolve into monitoring target registry")
	}
	if target.Entry.ID != "resource-redis-generic" {
		t.Fatalf("expected redis registry entry, got %q", target.Entry.ID)
	}
	if !target.SupportsCheck(CheckKindReachability) {
		t.Fatal("expected redis registry entry to support reachability")
	}
	if !target.SupportsCheck(CheckKindCredential) {
		t.Fatal("expected redis registry entry to support credential")
	}
	if got := target.ReachabilityStatusFor("offline"); got != StatusUnreachable {
		t.Fatalf("expected offline reachability to map to unreachable, got %q", got)
	}
	if got := target.ReachabilityReasonFor("offline", ""); got != "endpoint is unreachable" {
		t.Fatalf("expected offline reachability reason from registry, got %q", got)
	}
	if got := target.ReachabilityReasonCodeFor("offline", ""); got != "endpoint_unreachable" {
		t.Fatalf("expected offline reachability reason code from registry, got %q", got)
	}
	if got := target.CredentialStatusFor("auth_failed"); got != StatusCredentialInvalid {
		t.Fatalf("expected auth_failed credential outcome to map to credential_invalid, got %q", got)
	}
	if got := target.CredentialReasonFor("auth_failed", ""); got != "credential validation failed" {
		t.Fatalf("expected auth_failed credential reason from registry, got %q", got)
	}
	if got := target.CredentialReasonCodeFor("auth_failed", ""); got != "credential_auth_failed" {
		t.Fatalf("expected auth_failed credential reason code from registry, got %q", got)
	}
	if got := target.StatusPriorityFor(StatusCredentialInvalid); got != 5 {
		t.Fatalf("expected credential_invalid priority 5, got %d", got)
	}
	eligible, reason := target.EligibleForReachability()
	if !eligible {
		t.Fatalf("expected redis instance to be eligible for reachability, got %q", reason)
	}
	eligible, reason = target.EligibleForCredential()
	if !eligible {
		t.Fatalf("expected redis instance to be eligible for credential, got %q", reason)
	}
}

func TestResolveTargetRegistryEntryMatchesServerAndAppBaselines(t *testing.T) {
	serverEntry, ok, err := ResolveTargetRegistryEntry(TargetTypeServer, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected server baseline target registry entry")
	}
	if serverEntry.ID != "server-heartbeat-default" {
		t.Fatalf("expected server baseline registry entry, got %q", serverEntry.ID)
	}
	if !containsNormalized(serverEntry.EnabledChecks, CheckKindHeartbeat) {
		t.Fatalf("expected heartbeat check for server baseline, got %+v", serverEntry.EnabledChecks)
	}
	if !containsNormalized(serverEntry.SignalSources, SignalSourceAgent) {
		t.Fatalf("expected agent signal source for server baseline, got %+v", serverEntry.SignalSources)
	}
	if serverEntry.Checks.Heartbeat == nil || serverEntry.Checks.Heartbeat.StatusMap["offline"] != StatusOffline {
		t.Fatalf("expected server heartbeat status map, got %+v", serverEntry.Checks.Heartbeat)
	}
	if got := serverEntry.StatusPriorityFor(StatusOffline); got != 2 {
		t.Fatalf("expected server offline priority 2, got %d", got)
	}
	if got := serverEntry.HeartbeatStatusFor(HeartbeatStateStale); got != StatusUnknown {
		t.Fatalf("expected stale heartbeat to map to unknown, got %q", got)
	}
	if got := serverEntry.HeartbeatReasonFor(HeartbeatStateOffline, ""); got != "heartbeat missing" {
		t.Fatalf("expected offline heartbeat reason from registry, got %q", got)
	}
	if got := serverEntry.HeartbeatReasonCodeFor(HeartbeatStateOffline, ""); got != "heartbeat_missing" {
		t.Fatalf("expected offline heartbeat reason code from registry, got %q", got)
	}

	appEntry, ok, err := ResolveTargetRegistryEntry(TargetTypeApp, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected app baseline target registry entry")
	}
	if appEntry.ID != "app-health-default" {
		t.Fatalf("expected app baseline registry entry, got %q", appEntry.ID)
	}
	if !containsNormalized(appEntry.EnabledChecks, CheckKindAppHealth) {
		t.Fatalf("expected app_health check for app baseline, got %+v", appEntry.EnabledChecks)
	}
	if !containsNormalized(appEntry.SignalSources, SignalSourceSelf) {
		t.Fatalf("expected appos_self signal source for app baseline, got %+v", appEntry.SignalSources)
	}
	if appEntry.Checks.AppHealth == nil || appEntry.Checks.AppHealth.StatusMap["degraded"] != StatusDegraded {
		t.Fatalf("expected app health status map, got %+v", appEntry.Checks.AppHealth)
	}
	if got := appEntry.AppHealthStatusFor(StatusOffline); got != StatusOffline {
		t.Fatalf("expected app offline health to stay offline, got %q", got)
	}
	if got := appEntry.AppHealthReasonFor(StatusOffline, ""); got != "app is not running" {
		t.Fatalf("expected app offline reason from registry, got %q", got)
	}
	if got := appEntry.AppHealthReasonCodeFor(StatusOffline, ""); got != "app_not_running" {
		t.Fatalf("expected app offline reason code from registry, got %q", got)
	}
	if got := appEntry.AppHealthReasonFor(StatusDegraded, "runtime says degraded"); got != "runtime says degraded" {
		t.Fatalf("expected explicit fallback reason to win, got %q", got)
	}
	if got := appEntry.AppHealthReasonCodeFor(StatusDegraded, "custom_code"); got != "custom_code" {
		t.Fatalf("expected explicit fallback reason code to win, got %q", got)
	}
	if got := AppHealthOutcomeFromRuntimeState("restarting"); got != StatusDegraded {
		t.Fatalf("expected restarting runtime to map to degraded outcome, got %q", got)
	}
	if got := AppHealthOutcomeFromRuntimeState("stopped"); got != StatusOffline {
		t.Fatalf("expected stopped runtime to map to offline outcome, got %q", got)
	}
}

func TestResolveInstanceTargetSkipsKindsOutsideRegistry(t *testing.T) {
	item := instances.RestoreInstance(instances.Snapshot{
		ID:         "inst-2",
		Name:       "s3-primary",
		Kind:       instances.KindS3,
		TemplateID: "generic-s3",
		Endpoint:   "https://s3.example.com",
	})

	_, ok, err := ResolveInstanceTarget(item)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected s3 instance to remain outside the initial monitoring registry")
	}
}

func TestResolvedInstanceTargetReachabilityRequiresEndpoint(t *testing.T) {
	item := instances.RestoreInstance(instances.Snapshot{
		ID:         "inst-3",
		Name:       "redis-secondary",
		Kind:       instances.KindRedis,
		TemplateID: "generic-redis",
	})

	target, ok, err := ResolveInstanceTarget(item)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected redis instance to resolve into monitoring target registry")
	}
	eligible, reason := target.EligibleForReachability()
	if eligible {
		t.Fatal("expected empty-endpoint redis instance to be ineligible for reachability")
	}
	if reason != "instance endpoint is empty" {
		t.Fatalf("unexpected ineligible reason %q", reason)
	}
	eligible, reason = target.EligibleForCredential()
	if eligible {
		t.Fatal("expected missing-credential redis instance to be ineligible for credential checks")
	}
	if reason != "instance credential is empty" {
		t.Fatalf("unexpected credential ineligible reason %q", reason)
	}
}
