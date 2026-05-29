package routes

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	"github.com/websoft9/appos/backend/domain/secrets"
)

func doSettingsRoute(t *testing.T, te *testEnv, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	RegisterSettings(&core.ServeEvent{App: te.app, Router: r})

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}

	req := httptest.NewRequest(method, url, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	if authenticated {
		req.Header.Set("Authorization", te.token)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestSettingsSchemaIncludesUnifiedEntries(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := doSettingsRoute(t, te, http.MethodGet, "/api/settings/schema", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string][]map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	entries := body["entries"]
	if len(entries) == 0 {
		t.Fatal("expected schema entries")
	}

	var foundSystem bool
	var foundWorkspace bool
	for _, entry := range entries {
		id, _ := entry["id"].(string)
		section, _ := entry["section"].(string)
		source, _ := entry["source"].(string)
		description, _ := entry["description"].(string)
		switch id {
		case "smtp":
			foundSystem = section == "system" && source == "native"
			if !strings.Contains(description, "Resources > Connectors") {
				t.Fatalf("expected smtp schema entry description to reference connectors, got %q", description)
			}
		case "space-quota":
			foundWorkspace = section == "workspace" && source == "custom"
		case "docker-registries":
			if !strings.Contains(description, "Resources > Connectors") {
				t.Fatalf("expected docker-registries schema entry description to reference connectors, got %q", description)
			}
		case "iac-files":
			if section != "workspace" || source != "custom" {
				t.Fatalf("expected iac-files schema entry with workspace/custom metadata, got section=%s source=%s", section, source)
			}
		}
	}

	if !foundSystem {
		t.Fatal("expected smtp schema entry with system/native metadata")
	}
	if !foundWorkspace {
		t.Fatal("expected space-quota schema entry with workspace/custom metadata")
	}
}

func TestSettingsSchemaPreservesCatalogOrder(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := doSettingsRoute(t, te, http.MethodGet, "/api/settings/schema", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string][]map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	entries := body["entries"]
	if len(entries) < 8 {
		t.Fatalf("expected representative schema entries, got %d", len(entries))
	}

	ids := make([]string, 0, len(entries))
	for _, entry := range entries {
		id, _ := entry["id"].(string)
		ids = append(ids, id)
	}

	expectedPrefix := []string{
		"basic",
		"smtp",
		"s3",
		"logs",
		"secrets-policy",
		"space-quota",
		"connect-terminal",
		"connect-sftp",
	}
	for idx, want := range expectedPrefix {
		if ids[idx] != want {
			t.Fatalf("expected schema order %v, got %v", expectedPrefix, ids[:len(expectedPrefix)])
		}
	}
}

func TestSettingsEntriesListIncludesRepresentativeValues(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := doSettingsRoute(t, te, http.MethodGet, "/api/settings/entries", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string][]map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	items := body["items"]
	if len(items) == 0 {
		t.Fatal("expected entry payloads")
	}

	var foundIacFiles bool
	var foundTunnel bool
	var foundSecrets bool
	var foundProxy bool
	var foundMonitorScheduling bool
	var foundMonitorPolicy bool
	var foundMonitorPlatformSelfObservation bool
	var foundMonitorManagedCollectorPolicy bool
	var foundFeedsPolicy bool
	var foundTopicCommentPolicy bool
	var foundTopicImportPolicy bool
	for _, item := range items {
		id, _ := item["id"].(string)
		value, _ := item["value"].(map[string]any)
		switch id {
		case "iac-files":
			foundIacFiles = value != nil && int(value["maxSizeMB"].(float64)) == 10 && int(value["maxZipSizeMB"].(float64)) == 50
		case "tunnel-port-range":
			foundTunnel = value != nil && int(value["start"].(float64)) == 40000 && int(value["end"].(float64)) == 49999
		case "proxy-network":
			foundProxy = value != nil && value["enabled"] == false && value["httpConnectorId"] == "" && value["httpsConnectorId"] == ""
		case "secrets-policy":
			foundSecrets = value != nil && value["defaultAccessMode"] == string(secrets.AccessModeUseOnly)
		case "monitor-scheduling":
			foundMonitorScheduling = value != nil && int(value["factsPullIntervalMinutes"].(float64)) == 15
		case "monitor-policy":
			foundMonitorPolicy = value != nil && int(value["metricsMissingSeconds"].(float64)) == 180
		case "monitor-platform-self-observation":
			foundMonitorPlatformSelfObservation = value != nil && int(value["platformObserverIntervalSeconds"].(float64)) == 30
		case "monitor-managed-collector-policy":
			foundMonitorManagedCollectorPolicy = value != nil && int(value["collectionIntervalSeconds"].(float64)) == 10
		case "feeds-policy":
			foundFeedsPolicy = value != nil && int(value["pollIntervalHours"].(float64)) == 3 && int(value["perSourceRetentionCap"].(float64)) == 100 && int(value["globalRetentionCap"].(float64)) == 10000
		case "topic-comment-policy":
			foundTopicCommentPolicy = value != nil && value["allowGuestComments"] == true && value["defaultGuestName"] == "Guest" && int(value["maxGuestNameLength"].(float64)) == 100 && int(value["maxCommentBodyLength"].(float64)) == 10000
		case "topic-import-policy":
			foundTopicImportPolicy = value != nil && int(value["maxDescriptionImportKB"].(float64)) == 2 && value["textOnly"] == true
		}
	}

	if !foundIacFiles {
		t.Fatal("expected iac-files fallback value")
	}
	if !foundTunnel {
		t.Fatal("expected tunnel-port-range fallback value")
	}
	if !foundProxy {
		t.Fatal("expected proxy-network fallback value")
	}
	if !foundSecrets {
		t.Fatal("expected secrets-policy fallback value")
	}
	if !foundMonitorScheduling {
		t.Fatal("expected monitor-scheduling fallback value")
	}
	if !foundMonitorPolicy {
		t.Fatal("expected monitor-policy fallback value")
	}
	if !foundMonitorPlatformSelfObservation {
		t.Fatal("expected monitor-platform-self-observation fallback value")
	}
	if !foundMonitorManagedCollectorPolicy {
		t.Fatal("expected monitor-managed-collector-policy fallback value")
	}
	if !foundFeedsPolicy {
		t.Fatal("expected feeds-policy fallback value")
	}
	if !foundTopicCommentPolicy {
		t.Fatal("expected topic-comment-policy fallback value")
	}
	if !foundTopicImportPolicy {
		t.Fatal("expected topic-import-policy fallback value")
	}
}

func TestSettingsEntryPatchValidation(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	badMode := `{"defaultAccessMode":"invalid"}`
	rec := doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/secrets-policy", badMode, true)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for invalid secrets policy, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "defaultAccessMode") {
		t.Fatalf("expected defaultAccessMode error, got %s", rec.Body.String())
	}

	badRange := `{"start":50000,"end":40000}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/tunnel-port-range", badRange, true)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for descending range, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "must be greater than start") {
		t.Fatalf("expected tunnel validation error, got %s", rec.Body.String())
	}

	badIacFiles := `{"maxSizeMB":0,"maxZipSizeMB":-1}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/iac-files", badIacFiles, true)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for invalid iac-files limits, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "maxSizeMB") {
		t.Fatalf("expected iac-files validation error, got %s", rec.Body.String())
	}

	badProxy := `{"enabled":true,"httpConnectorId":"missing-id","httpsConnectorId":""}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/proxy-network", badProxy, true)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for invalid proxy-network, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "httpConnectorId") {
		t.Fatalf("expected proxy-network validation error, got %s", rec.Body.String())
	}

	badMonitorPolicy := `{"metricsFreshnessLookbackSeconds":120,"metricsStaleSeconds":90,"metricsMissingSeconds":90}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/monitor-policy", badMonitorPolicy, true)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for invalid monitor-policy, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "metricsMissingSeconds") {
		t.Fatalf("expected monitor-policy validation error, got %s", rec.Body.String())
	}

	badMonitorPlatformSelfObservation := `{"platformObserverIntervalSeconds":100,"platformSchedulerStaleThresholdSeconds":200,"enableHostTelemetry":"not-bool"}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/monitor-platform-self-observation", badMonitorPlatformSelfObservation, true)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for invalid monitor-platform-self-observation, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "enableHostTelemetry") {
		t.Fatalf("expected monitor-platform-self-observation validation error, got %s", rec.Body.String())
	}

	badMonitorManagedCollectorPolicy := `{"collectionIntervalSeconds":10,"flushIntervalSeconds":10,"metricBatchSize":2000,"metricBufferLimit":1000,"collectionJitterSeconds":11,"flushJitterSeconds":1}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/monitor-managed-collector-policy", badMonitorManagedCollectorPolicy, true)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for invalid monitor-managed-collector-policy, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "metricBufferLimit") {
		t.Fatalf("expected monitor-managed-collector-policy validation error, got %s", rec.Body.String())
	}

	badFeedsPolicy := `{"pollIntervalHours":241,"failureBackoffMaxHours":2,"perSourceRetentionCap":10,"globalRetentionCap":1000}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/feeds-policy", badFeedsPolicy, true)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for invalid feeds-policy, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "pollIntervalHours") || !strings.Contains(rec.Body.String(), "failureBackoffMaxHours") {
		t.Fatalf("expected feeds-policy validation error, got %s", rec.Body.String())
	}

	badTopicCommentPolicy := `{"allowGuestComments":"maybe","defaultGuestName":"","maxGuestNameLength":0,"maxCommentBodyLength":0}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/topic-comment-policy", badTopicCommentPolicy, true)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for invalid topic-comment-policy, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "allowGuestComments") || !strings.Contains(rec.Body.String(), "defaultGuestName") {
		t.Fatalf("expected topic-comment-policy validation error, got %s", rec.Body.String())
	}

	badTopicImportPolicy := `{"maxDescriptionImportKB":0,"textOnly":"sometimes"}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/topic-import-policy", badTopicImportPolicy, true)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for invalid topic-import-policy, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "maxDescriptionImportKB") || !strings.Contains(rec.Body.String(), "textOnly") {
		t.Fatalf("expected topic-import-policy validation error, got %s", rec.Body.String())
	}
}

func TestSettingsEntryPatchPersistsUnifiedValues(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	basicBody := `{"appName":"Unified AppOS","appURL":"https://unified.test"}`
	rec := doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/basic", basicBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for basic entry patch, got %d: %s", rec.Code, rec.Body.String())
	}

	basicGet := doSettingsRoute(t, te, http.MethodGet, "/api/settings/entries/basic", "", true)
	if basicGet.Code != http.StatusOK {
		t.Fatalf("expected 200 for basic entry get, got %d: %s", basicGet.Code, basicGet.Body.String())
	}
	if !strings.Contains(basicGet.Body.String(), "Unified AppOS") {
		t.Fatalf("expected updated basic entry payload, got %s", basicGet.Body.String())
	}

	policyBody := `{"revealDisabled":true,"defaultAccessMode":"reveal_allowed","clipboardClearSeconds":45}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/secrets-policy", policyBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for secrets-policy patch, got %d: %s", rec.Code, rec.Body.String())
	}

	storedPolicy, err := sysconfig.GetGroup(te.app, "secrets", "policy", nil)
	if err != nil {
		t.Fatalf("expected stored policy, got error: %v", err)
	}
	normalized := secrets.NormalizePolicy(storedPolicy)
	if normalized.DefaultAccessMode != secrets.AccessModeRevealAllowed || !normalized.RevealDisabled || normalized.ClipboardClearSeconds != 45 {
		t.Fatalf("unexpected persisted unified secrets policy: %#v", normalized)
	}

	tunnelBody := `{"start":41000,"end":41999}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/tunnel-port-range", tunnelBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for tunnel entry patch, got %d: %s", rec.Code, rec.Body.String())
	}

	storedTunnel, err := sysconfig.GetGroup(te.app, "tunnel", "port_range", nil)
	if err != nil {
		t.Fatalf("expected stored tunnel port range, got error: %v", err)
	}
	if got := sysconfig.Int(storedTunnel, "start", 0); got != 41000 {
		t.Fatalf("expected start 41000, got %d", got)
	}
	if got := sysconfig.Int(storedTunnel, "end", 0); got != 41999 {
		t.Fatalf("expected end 41999, got %d", got)
	}

	iacBody := `{"maxSizeMB":25,"maxZipSizeMB":100,"extensionBlacklist":".exe,.bin"}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/iac-files", iacBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for iac-files patch, got %d: %s", rec.Code, rec.Body.String())
	}

	storedIacFiles, err := sysconfig.GetGroup(te.app, "files", "limits", nil)
	if err != nil {
		t.Fatalf("expected stored iac-files limits, got error: %v", err)
	}
	if got := sysconfig.Int(storedIacFiles, "maxSizeMB", 0); got != 25 {
		t.Fatalf("expected maxSizeMB 25, got %d", got)
	}
	if got := sysconfig.Int(storedIacFiles, "maxZipSizeMB", 0); got != 100 {
		t.Fatalf("expected maxZipSizeMB 100, got %d", got)
	}
	if got := sysconfig.String(storedIacFiles, "extensionBlacklist", ""); got != ".exe,.bin" {
		t.Fatalf("expected extensionBlacklist .exe,.bin, got %q", got)
	}

	proxyConnector := createDockerRouteConnector(t, te, connectors.SaveInput{
		Name:       "Proxy",
		Kind:       connectors.KindProxy,
		TemplateID: "generic-proxy",
		Endpoint:   "http://proxy.example.com:3128",
		Config:     map[string]any{"protocol": "http"},
	})
	proxyBody := `{"enabled":true,"httpConnectorId":"` + proxyConnector.Id + `","httpsConnectorId":""}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/proxy-network", proxyBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for proxy-network patch, got %d: %s", rec.Code, rec.Body.String())
	}
	storedProxy, err := sysconfig.GetGroup(te.app, "proxy", "network", nil)
	if err != nil {
		t.Fatalf("expected stored proxy-network, got error: %v", err)
	}
	if got, ok := storedProxy["enabled"].(bool); !ok || !got {
		t.Fatalf("expected enabled=true, got %#v", storedProxy["enabled"])
	}
	if got := sysconfig.String(storedProxy, "httpConnectorId", ""); got != proxyConnector.Id {
		t.Fatalf("expected httpConnectorId %q, got %q", proxyConnector.Id, got)
	}

	monitorSchedulingBody := `{"reachabilityIntervalMinutes":2,"metricsFreshnessIntervalMinutes":3,"controlReachabilityIntervalMinutes":4,"runtimeSnapshotIntervalMinutes":5,"credentialSweepIntervalMinutes":6,"appHealthIntervalMinutes":7,"factsPullIntervalMinutes":8}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/monitor-scheduling", monitorSchedulingBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for monitor-scheduling patch, got %d: %s", rec.Code, rec.Body.String())
	}
	storedMonitorScheduling, err := sysconfig.GetGroup(te.app, "monitor", "scheduling", nil)
	if err != nil {
		t.Fatalf("expected stored monitor scheduling, got error: %v", err)
	}
	if got := sysconfig.Int(storedMonitorScheduling, "factsPullIntervalMinutes", 0); got != 8 {
		t.Fatalf("expected factsPullIntervalMinutes 8, got %d", got)
	}

	monitorPolicyBody := `{"metricsFreshnessLookbackSeconds":600,"metricsStaleSeconds":120,"metricsMissingSeconds":240,"controlProbeTimeoutSeconds":10,"factsPullTimeoutSeconds":30,"runtimePullTimeoutSeconds":40,"factsPullConcurrency":6,"runtimePullConcurrency":7}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/monitor-policy", monitorPolicyBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for monitor-policy patch, got %d: %s", rec.Code, rec.Body.String())
	}
	storedMonitorPolicy, err := sysconfig.GetGroup(te.app, "monitor", "policy", nil)
	if err != nil {
		t.Fatalf("expected stored monitor policy, got error: %v", err)
	}
	if got := sysconfig.Int(storedMonitorPolicy, "metricsMissingSeconds", 0); got != 240 {
		t.Fatalf("expected metricsMissingSeconds 240, got %d", got)
	}

	monitorPlatformSelfObservationBody := `{"platformObserverIntervalSeconds":30,"platformSchedulerStaleThresholdSeconds":20,"enableHostTelemetry":true,"enableContainerTelemetry":true}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/monitor-platform-self-observation", monitorPlatformSelfObservationBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for monitor-platform-self-observation patch, got %d: %s", rec.Code, rec.Body.String())
	}
	storedMonitorPlatformSelfObservation, err := sysconfig.GetGroup(te.app, "monitor", "platform-self-observation", nil)
	if err != nil {
		t.Fatalf("expected stored monitor platform self observation, got error: %v", err)
	}
	if got := sysconfig.Int(storedMonitorPlatformSelfObservation, "platformSchedulerStaleThresholdSeconds", 0); got != 20 {
		t.Fatalf("expected platformSchedulerStaleThresholdSeconds 20, got %d", got)
	}
	if got, ok := storedMonitorPlatformSelfObservation["enableHostTelemetry"].(bool); !ok || !got {
		t.Fatalf("expected enableHostTelemetry true, got %#v", storedMonitorPlatformSelfObservation["enableHostTelemetry"])
	}

	monitorManagedCollectorPolicyBody := `{"collectionIntervalSeconds":15,"flushIntervalSeconds":20,"metricBatchSize":1500,"metricBufferLimit":6000,"collectionJitterSeconds":2,"flushJitterSeconds":3}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/monitor-managed-collector-policy", monitorManagedCollectorPolicyBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for monitor-managed-collector-policy patch, got %d: %s", rec.Code, rec.Body.String())
	}
	storedMonitorManagedCollectorPolicy, err := sysconfig.GetGroup(te.app, "monitor", "managed-collector-policy", nil)
	if err != nil {
		t.Fatalf("expected stored monitor managed collector policy, got error: %v", err)
	}
	if got := sysconfig.Int(storedMonitorManagedCollectorPolicy, "metricBufferLimit", 0); got != 6000 {
		t.Fatalf("expected metricBufferLimit 6000, got %d", got)
	}

	feedsPolicyBody := `{"pollIntervalHours":6,"failureBackoffMaxHours":36,"perSourceRetentionCap":800,"globalRetentionCap":45000}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/feeds-policy", feedsPolicyBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for feeds-policy patch, got %d: %s", rec.Code, rec.Body.String())
	}
	storedFeedsPolicy, err := sysconfig.GetGroup(te.app, "feeds", "policy", nil)
	if err != nil {
		t.Fatalf("expected stored feeds policy, got error: %v", err)
	}
	if got := sysconfig.Int(storedFeedsPolicy, "pollIntervalHours", 0); got != 6 {
		t.Fatalf("expected pollIntervalHours 6, got %d", got)
	}
	if got := sysconfig.Int(storedFeedsPolicy, "perSourceRetentionCap", 0); got != 800 {
		t.Fatalf("expected perSourceRetentionCap 800, got %d", got)
	}
	if got := sysconfig.Int(storedFeedsPolicy, "globalRetentionCap", 0); got != 45000 {
		t.Fatalf("expected globalRetentionCap 45000, got %d", got)
	}

	topicCommentPolicyBody := `{"allowGuestComments":false,"defaultGuestName":"Visitor","maxGuestNameLength":64,"maxCommentBodyLength":4096}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/topic-comment-policy", topicCommentPolicyBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for topic-comment-policy patch, got %d: %s", rec.Code, rec.Body.String())
	}
	storedTopicCommentPolicy, err := sysconfig.GetGroup(te.app, "topic", "comment-policy", nil)
	if err != nil {
		t.Fatalf("expected stored topic comment policy, got error: %v", err)
	}
	if got, ok := storedTopicCommentPolicy["allowGuestComments"].(bool); !ok || got {
		t.Fatalf("expected allowGuestComments=false, got %#v", storedTopicCommentPolicy["allowGuestComments"])
	}
	if got := sysconfig.String(storedTopicCommentPolicy, "defaultGuestName", ""); got != "Visitor" {
		t.Fatalf("expected defaultGuestName Visitor, got %q", got)
	}
	if got := sysconfig.Int(storedTopicCommentPolicy, "maxGuestNameLength", 0); got != 64 {
		t.Fatalf("expected maxGuestNameLength 64, got %d", got)
	}
	if got := sysconfig.Int(storedTopicCommentPolicy, "maxCommentBodyLength", 0); got != 4096 {
		t.Fatalf("expected maxCommentBodyLength 4096, got %d", got)
	}

	topicImportPolicyBody := `{"maxDescriptionImportKB":2048,"textOnly":false}`
	rec = doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/topic-import-policy", topicImportPolicyBody, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for topic-import-policy patch, got %d: %s", rec.Code, rec.Body.String())
	}
	storedTopicImportPolicy, err := sysconfig.GetGroup(te.app, "topic", "import-policy", nil)
	if err != nil {
		t.Fatalf("expected stored topic import policy, got error: %v", err)
	}
	if got := sysconfig.Int(storedTopicImportPolicy, "maxDescriptionImportKB", 0); got != 2048 {
		t.Fatalf("expected maxDescriptionImportKB 2048, got %d", got)
	}
	if got, ok := storedTopicImportPolicy["textOnly"].(bool); !ok || got {
		t.Fatalf("expected textOnly=false, got %#v", storedTopicImportPolicy["textOnly"])
	}
}

func TestConnectorManagedSettingsEntriesRejectPatch(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	for _, entryID := range []string{"smtp", "docker-registries"} {
		rec := doSettingsRoute(t, te, http.MethodPatch, "/api/settings/entries/"+entryID, `{}`, true)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for %s patch, got %d: %s", entryID, rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "connector-managed") {
			t.Fatalf("expected connector-managed message for %s, got %s", entryID, rec.Body.String())
		}
	}
}

func TestSecretsRevealDisabledByPolicy(t *testing.T) {
	te := newSecretsTestEnv(t)
	defer te.cleanup()

	if err := sysconfig.SetGroup(te.app, "secrets", "policy", map[string]any{
		"revealDisabled":        true,
		"defaultAccessMode":     "use_only",
		"clipboardClearSeconds": 0,
	}); err != nil {
		t.Fatal(err)
	}

	col, err := te.app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", "policy-blocked-secret")
	rec.Set("template_id", "single_value")
	rec.Set("scope", "global")
	rec.Set("access_mode", "reveal_allowed")
	rec.Set("status", "active")
	rec.Set("created_by", "u1")
	enc, err := secrets.EncryptPayload(map[string]any{"value": "hello"})
	if err != nil {
		t.Fatal(err)
	}
	rec.Set("payload_encrypted", enc)
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}

	res := doSecretsRoute(t, te, http.MethodGet, "/api/secrets/"+rec.Id+"/reveal", "", true, false)
	if res.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "Secret reveal is disabled by administrator") {
		t.Fatalf("expected admin-disabled message, got %s", res.Body.String())
	}
}
