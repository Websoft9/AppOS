package routes

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingsschema "github.com/websoft9/appos/backend/domain/config/sysconfig/schema"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/infra/egress"
	persistence "github.com/websoft9/appos/backend/infra/persistence"
	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
)

// sensitiveFields is the set of field names that are masked on GET and
// whose "***" placeholder is preserved on PATCH.
// Derived from catalog Sensitive flags; apiKey is added manually because
// it appears inside object-list items not modeled in the field schema.
var sensitiveFields = buildSensitiveFieldSet()

func buildSensitiveFieldSet() map[string]bool {
	m := map[string]bool{}
	for _, entry := range settingsschema.Entries() {
		for _, f := range entry.Fields {
			if f.Sensitive {
				m[f.ID] = true
			}
		}
	}
	m["apiKey"] = true
	return m
}

const defaultTunnelSSHPort = 2222

var iacDefaultBlacklist = settingsschema.DefaultGroup("files", "limits")["extensionBlacklist"]

// ─── Validation functions ──────────────────────────────────────────────────

func validateSpaceQuota(v map[string]any) map[string]string {
	errors := map[string]string{}

	maxSizeMB, err := parseIntWithDefault(v["maxSizeMB"], 10)
	if err != nil {
		errors["maxSizeMB"] = "must be an integer"
	} else if maxSizeMB < 1 {
		errors["maxSizeMB"] = "must be >= 1"
	} else {
		v["maxSizeMB"] = maxSizeMB
	}

	maxPerUser, err := parseIntWithDefault(v["maxPerUser"], 100)
	if err != nil {
		errors["maxPerUser"] = "must be an integer"
	} else if maxPerUser < 1 {
		errors["maxPerUser"] = "must be >= 1"
	} else {
		v["maxPerUser"] = maxPerUser
	}

	maxUploadFiles, err := parseIntWithDefault(v["maxUploadFiles"], 50)
	if err != nil {
		errors["maxUploadFiles"] = "must be an integer"
	} else if maxUploadFiles < 1 || maxUploadFiles > 200 {
		errors["maxUploadFiles"] = "must be between 1 and 200"
	} else {
		v["maxUploadFiles"] = maxUploadFiles
	}

	shareMaxMinutes, err := parseIntWithDefault(v["shareMaxMinutes"], 60)
	if err != nil {
		errors["shareMaxMinutes"] = "must be an integer"
	} else if shareMaxMinutes < 1 {
		errors["shareMaxMinutes"] = "must be >= 1"
	} else {
		v["shareMaxMinutes"] = shareMaxMinutes
	}

	shareDefaultMinutes, err := parseIntWithDefault(v["shareDefaultMinutes"], 30)
	if err != nil {
		errors["shareDefaultMinutes"] = "must be an integer"
	} else if shareDefaultMinutes < 1 {
		errors["shareDefaultMinutes"] = "must be >= 1"
	} else {
		v["shareDefaultMinutes"] = shareDefaultMinutes
	}

	if len(errors) == 0 && shareDefaultMinutes > shareMaxMinutes {
		errors["shareDefaultMinutes"] = "must be <= shareMaxMinutes"
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func parseIntWithDefault(raw any, defaultValue int) (int, error) {
	if raw == nil {
		return defaultValue, nil
	}

	switch n := raw.(type) {
	case float64:
		if math.Trunc(n) != n {
			return 0, fmt.Errorf("must be an integer")
		}
		return int(n), nil
	case int:
		return n, nil
	case int64:
		return int(n), nil
	case json.Number:
		i, err := n.Int64()
		if err != nil {
			return 0, fmt.Errorf("must be an integer")
		}
		return int(i), nil
	case string:
		s := strings.TrimSpace(n)
		if s == "" {
			return defaultValue, nil
		}
		i, err := strconv.Atoi(s)
		if err != nil {
			return 0, fmt.Errorf("must be an integer")
		}
		return i, nil
	default:
		return 0, fmt.Errorf("must be an integer")
	}
}

func parseFloatWithDefault(raw any, defaultValue float64) (float64, error) {
	if raw == nil {
		return defaultValue, nil
	}

	switch value := raw.(type) {
	case float64:
		return value, nil
	case float32:
		return float64(value), nil
	case int:
		return float64(value), nil
	case int64:
		return float64(value), nil
	case json.Number:
		parsed, err := value.Float64()
		if err != nil {
			return 0, fmt.Errorf("must be a number")
		}
		return parsed, nil
	case string:
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return defaultValue, nil
		}
		parsed, err := strconv.ParseFloat(trimmed, 64)
		if err != nil {
			return 0, fmt.Errorf("must be a number")
		}
		return parsed, nil
	default:
		return 0, fmt.Errorf("must be a number")
	}
}

func parseBoolWithDefault(raw any, defaultValue bool) (bool, error) {
	if raw == nil {
		return defaultValue, nil
	}

	switch value := raw.(type) {
	case bool:
		return value, nil
	case string:
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "":
			return defaultValue, nil
		case "true", "1", "yes", "on":
			return true, nil
		case "false", "0", "no", "off":
			return false, nil
		default:
			return false, fmt.Errorf("must be a boolean")
		}
	default:
		return false, fmt.Errorf("must be a boolean")
	}
}

func validateConnectTerminal(v map[string]any) map[string]string {
	errors := map[string]string{}

	idleTimeoutSeconds, err := parseIntWithDefault(v["idleTimeoutSeconds"], 1800)
	if err != nil {
		errors["idleTimeoutSeconds"] = "must be an integer"
	} else if idleTimeoutSeconds < 60 {
		errors["idleTimeoutSeconds"] = "must be >= 60"
	} else {
		v["idleTimeoutSeconds"] = idleTimeoutSeconds
	}

	maxConnections, err := parseIntWithDefault(v["maxConnections"], 0)
	if err != nil {
		errors["maxConnections"] = "must be an integer"
	} else if maxConnections < 0 {
		errors["maxConnections"] = "must be >= 0"
	} else {
		v["maxConnections"] = maxConnections
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateTunnelPortRange(v map[string]any) map[string]string {
	errors := map[string]string{}

	start, err := parseIntWithDefault(v["start"], tunnelcore.DefaultPortRangeStart)
	if err != nil {
		errors["start"] = "must be an integer"
	} else if start < 1 || start > 65535 {
		errors["start"] = "must be between 1 and 65535"
	} else {
		v["start"] = start
	}

	end, err := parseIntWithDefault(v["end"], tunnelcore.DefaultPortRangeEnd)
	if err != nil {
		errors["end"] = "must be an integer"
	} else if end < 1 || end > 65535 {
		errors["end"] = "must be between 1 and 65535"
	} else {
		v["end"] = end
	}

	if len(errors) == 0 {
		if start >= end {
			errors["end"] = "must be greater than start"
		}
		if start <= defaultTunnelSSHPort && defaultTunnelSSHPort <= end {
			errors["start"] = "range must not include tunnel SSH port 2222"
			errors["end"] = "range must not include tunnel SSH port 2222"
		}
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateDeployPreflight(v map[string]any) map[string]string {
	errors := map[string]string{}

	minFreeDiskGiB, err := parseFloatWithDefault(v["minFreeDiskGiB"], 1)
	if err != nil {
		errors["minFreeDiskGiB"] = "must be a number"
	} else if minFreeDiskGiB < 0.5 {
		errors["minFreeDiskGiB"] = "must be >= 0.5"
	} else if minFreeDiskGiB > 1024 {
		errors["minFreeDiskGiB"] = "must be <= 1024"
	} else {
		v["minFreeDiskGiB"] = minFreeDiskGiB
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateDeployRuntime(v map[string]any) map[string]string {
	errors := map[string]string{}

	fields := []struct {
		key          string
		defaultValue int
	}{
		{key: "imagePullTimeoutSeconds", defaultValue: 180},
		{key: "composeUpTimeoutSeconds", defaultValue: 600},
		{key: "healthCheckTimeoutSeconds", defaultValue: 120},
		{key: "runtimePullIdleHeartbeatSeconds", defaultValue: 20},
	}

	for _, field := range fields {
		value, err := parseIntWithDefault(v[field.key], field.defaultValue)
		if err != nil {
			errors[field.key] = "must be an integer"
			continue
		}
		if value < 1 {
			errors[field.key] = "must be >= 1"
			continue
		}
		v[field.key] = value
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateDeployGitDefaults(v map[string]any) map[string]string {
	errors := map[string]string{}

	for key, defaultValue := range map[string]string{
		"defaultRef":         "main",
		"defaultComposePath": "docker-compose.yml",
	} {
		raw, ok := v[key]
		if !ok || raw == nil {
			v[key] = defaultValue
			continue
		}
		text, ok := raw.(string)
		if !ok {
			errors[key] = "must be a string"
			continue
		}
		text = strings.TrimSpace(text)
		if text == "" {
			errors[key] = "must not be empty"
			continue
		}
		v[key] = text
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateIacFiles(v map[string]any) map[string]string {
	errors := map[string]string{}

	maxSizeMB, err := parseIntWithDefault(v["maxSizeMB"], 10)
	if err != nil {
		errors["maxSizeMB"] = "must be an integer"
	} else if maxSizeMB < 1 {
		errors["maxSizeMB"] = "must be >= 1"
	} else {
		v["maxSizeMB"] = maxSizeMB
	}

	maxZipSizeMB, err := parseIntWithDefault(v["maxZipSizeMB"], 50)
	if err != nil {
		errors["maxZipSizeMB"] = "must be an integer"
	} else if maxZipSizeMB < 1 {
		errors["maxZipSizeMB"] = "must be >= 1"
	} else {
		v["maxZipSizeMB"] = maxZipSizeMB
	}

	if len(errors) == 0 && maxZipSizeMB < maxSizeMB {
		errors["maxZipSizeMB"] = "must be >= maxSizeMB"
	}

	if raw, ok := v["extensionBlacklist"]; !ok || raw == nil {
		v["extensionBlacklist"] = iacDefaultBlacklist
	} else if text, ok := raw.(string); ok {
		v["extensionBlacklist"] = strings.TrimSpace(text)
	} else {
		errors["extensionBlacklist"] = "must be a string"
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateConnectSftp(v map[string]any) map[string]string {
	errors := map[string]string{}

	maxUploadFiles, err := parseIntWithDefault(v["maxUploadFiles"], 10)
	if err != nil {
		errors["maxUploadFiles"] = "must be an integer"
	} else if maxUploadFiles < 1 {
		errors["maxUploadFiles"] = "must be >= 1"
	} else {
		v["maxUploadFiles"] = maxUploadFiles
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateBranding(v map[string]any) map[string]string {
	logoMediaID, _ := v["logoMediaId"].(string)
	v["logoMediaId"] = strings.TrimSpace(logoMediaID)

	logoURL, _ := v["logoUrl"].(string)
	v["logoUrl"] = strings.TrimSpace(logoURL)

	wordmark, _ := v["wordmark"].(string)
	wordmark = strings.TrimSpace(wordmark)
	if wordmark == "" {
		wordmark = "appos"
	}
	v["wordmark"] = wordmark

	useLogoAsFavicon, err := parseBoolWithDefault(v["useLogoAsFavicon"], true)
	if err != nil {
		return map[string]string{"useLogoAsFavicon": "must be a boolean"}
	}
	v["useLogoAsFavicon"] = useLogoAsFavicon

	faviconMediaID, _ := v["faviconMediaId"].(string)
	v["faviconMediaId"] = strings.TrimSpace(faviconMediaID)

	faviconURL, _ := v["faviconUrl"].(string)
	v["faviconUrl"] = strings.TrimSpace(faviconURL)

	return nil
}

func validateProxyNetwork(app core.App, v map[string]any) map[string]string {
	errors := map[string]string{}

	source := strings.ToLower(strings.TrimSpace(sysconfig.String(v, "source", "none")))
	switch source {
	case "", "none":
		source = "none"
	case "external", "self":
	default:
		errors["source"] = "must be one of none, external, or self"
	}
	v["source"] = source

	enabled, err := parseBoolWithDefault(v["enabled"], false)
	if err != nil {
		errors["enabled"] = "must be a boolean"
	} else {
		v["enabled"] = enabled
	}

	socks5ConnectorID := strings.TrimSpace(sysconfig.String(v, "socks5ConnectorId", ""))
	httpConnectorID := strings.TrimSpace(sysconfig.String(v, "httpConnectorId", ""))
	httpsConnectorID := strings.TrimSpace(sysconfig.String(v, "httpsConnectorId", ""))
	v["socks5ConnectorId"] = socks5ConnectorID
	v["httpConnectorId"] = httpConnectorID
	v["httpsConnectorId"] = httpsConnectorID

	repo := persistence.NewConnectorRepository(app)
	validateProxyConnectorID := func(field, connectorID string) {
		if connectorID == "" {
			return
		}
		item, getErr := repo.Get(connectorID)
		if getErr != nil {
			errors[field] = "must reference an existing proxy connector"
			return
		}
		if item.Kind() != connectors.KindProxy {
			errors[field] = "must reference a proxy connector"
		}
	}
	validateProxyConnectorID("socks5ConnectorId", socks5ConnectorID)
	validateProxyConnectorID("httpConnectorId", httpConnectorID)
	validateProxyConnectorID("httpsConnectorId", httpsConnectorID)

	if len(errors) == 0 && enabled && socks5ConnectorID == "" && httpConnectorID == "" && httpsConnectorID == "" {
		errors["socks5ConnectorId"] = "select at least one proxy option when proxy is enabled"
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateProxyConsumers(app core.App, v map[string]any) map[string]string {
	rawItems, ok := v["items"]
	if !ok || rawItems == nil {
		v["items"] = []map[string]any{}
	} else {
		list, ok := rawItems.([]any)
		if !ok {
			return map[string]string{"items": "must be a list of proxy policy settings"}
		}

		items := make([]egress.ConsumerEnrollment, 0, len(list))
		for idx, rawItem := range list {
			item, ok := rawItem.(map[string]any)
			if !ok {
				return map[string]string{"items": fmt.Sprintf("item %d must be an object", idx+1)}
			}
			consumerKey := strings.TrimSpace(sysconfig.String(item, "consumerKey", ""))
			if consumerKey == "" {
				return map[string]string{"items": fmt.Sprintf("item %d requires consumerKey", idx+1)}
			}
			mode := egress.Mode(strings.TrimSpace(sysconfig.String(item, "mode", "")))
			if mode == "" {
				return map[string]string{"items": fmt.Sprintf("policy %q requires mode", consumerKey)}
			}
			items = append(items, egress.ConsumerEnrollment{ConsumerKey: consumerKey, Mode: mode})
		}

		normalized, err := egress.PrepareConsumerSettingsValue(map[string]any{"items": itemsToMaps(items)})
		if err != nil {
			return map[string]string{"items": err.Error()}
		}
		v["items"] = normalized["items"]
	}

	serverOverridesPayload := map[string]any{"items": []map[string]any{}}
	if rawServerOverrides, ok := v["serverOverrides"]; ok {
		serverOverridesPayload["items"] = rawServerOverrides
	}
	if errors := validateProxyRemoteShellServers(app, serverOverridesPayload); errors != nil {
		message := errors["items"]
		if message == "" {
			message = "invalid remote shell overrides"
		}
		return map[string]string{"serverOverrides": message}
	}
	v["serverOverrides"] = serverOverridesPayload["items"]
	return nil
}

func validateProxyRemoteShellServers(app core.App, v map[string]any) map[string]string {
	rawItems, ok := v["items"]
	if !ok || rawItems == nil {
		v["items"] = []map[string]any{}
		return nil
	}
	list, ok := rawItems.([]any)
	if !ok {
		typed, typedOK := rawItems.([]map[string]any)
		if !typedOK {
			return map[string]string{"items": "must be a list of remote shell proxy overrides"}
		}
		list = make([]any, 0, len(typed))
		for _, item := range typed {
			list = append(list, item)
		}
	}
	seen := map[string]struct{}{}
	items := make([]map[string]any, 0, len(list))
	for idx, rawItem := range list {
		item, ok := rawItem.(map[string]any)
		if !ok {
			return map[string]string{"items": fmt.Sprintf("item %d must be an object", idx+1)}
		}
		serverID := strings.TrimSpace(sysconfig.String(item, "serverId", ""))
		if serverID == "" {
			return map[string]string{"items": fmt.Sprintf("item %d requires serverId", idx+1)}
		}
		if _, exists := seen[serverID]; exists {
			return map[string]string{"items": fmt.Sprintf("server %q is duplicated", serverID)}
		}
		seen[serverID] = struct{}{}
		if _, err := app.FindRecordById("servers", serverID); err != nil {
			return map[string]string{"items": fmt.Sprintf("server %q does not exist", serverID)}
		}
		mode := egress.Mode(strings.TrimSpace(sysconfig.String(item, "mode", "")))
		if mode != egress.ModeDisabled && mode != egress.ModeAlways {
			return map[string]string{"items": fmt.Sprintf("server %q has invalid mode", serverID)}
		}
		items = append(items, map[string]any{"serverId": serverID, "mode": string(mode)})
	}
	v["items"] = egress.NormalizeRemoteShellSettingsValue(map[string]any{"items": items})["items"]
	return nil
}

func itemsToMaps(items []egress.ConsumerEnrollment) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, map[string]any{
			"consumerKey": item.ConsumerKey,
			"mode":        string(item.Mode),
		})
	}
	return out
}

func validateMonitorScheduling(v map[string]any) map[string]string {
	errors := map[string]string{}
	for _, field := range []string{
		"reachabilityIntervalMinutes",
		"metricsFreshnessIntervalMinutes",
		"controlReachabilityIntervalMinutes",
		"runtimeSnapshotIntervalMinutes",
		"credentialSweepIntervalMinutes",
		"appHealthIntervalMinutes",
		"factsPullIntervalMinutes",
	} {
		value, err := parseIntWithDefault(v[field], 1)
		if err != nil {
			errors[field] = "must be an integer"
		} else if value < 1 {
			errors[field] = "must be >= 1"
		} else {
			v[field] = value
		}
	}
	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateMonitorPolicy(v map[string]any) map[string]string {
	errors := map[string]string{}
	lookback, err := parseIntWithDefault(v["metricsFreshnessLookbackSeconds"], 300)
	if err != nil {
		errors["metricsFreshnessLookbackSeconds"] = "must be an integer"
	} else if lookback < 1 {
		errors["metricsFreshnessLookbackSeconds"] = "must be >= 1"
	} else {
		v["metricsFreshnessLookbackSeconds"] = lookback
	}

	stale, err := parseIntWithDefault(v["metricsStaleSeconds"], 90)
	if err != nil {
		errors["metricsStaleSeconds"] = "must be an integer"
	} else if stale < 30 {
		errors["metricsStaleSeconds"] = "must be >= 30"
	} else {
		v["metricsStaleSeconds"] = stale
	}

	missing, err := parseIntWithDefault(v["metricsMissingSeconds"], 180)
	if err != nil {
		errors["metricsMissingSeconds"] = "must be an integer"
	} else if missing < 31 {
		errors["metricsMissingSeconds"] = "must be >= 31"
	} else {
		v["metricsMissingSeconds"] = missing
	}

	reachabilityProbeTimeoutMs, err := parseIntWithDefault(v["reachabilityProbeTimeoutMs"], 1500)
	if err != nil {
		errors["reachabilityProbeTimeoutMs"] = "must be an integer"
	} else if reachabilityProbeTimeoutMs < 100 || reachabilityProbeTimeoutMs > 300000 {
		errors["reachabilityProbeTimeoutMs"] = "must be between 100 and 300000"
	} else {
		v["reachabilityProbeTimeoutMs"] = reachabilityProbeTimeoutMs
	}

	for _, field := range []string{"controlProbeTimeoutSeconds", "factsPullTimeoutSeconds", "runtimePullTimeoutSeconds"} {
		value, err := parseIntWithDefault(v[field], 1)
		if err != nil {
			errors[field] = "must be an integer"
		} else if value < 1 || value > 300 {
			errors[field] = "must be between 1 and 300"
		} else {
			v[field] = value
		}
	}

	for _, field := range []string{"factsPullConcurrency", "runtimePullConcurrency"} {
		value, err := parseIntWithDefault(v[field], 1)
		if err != nil {
			errors[field] = "must be an integer"
		} else if value < 1 || value > 50 {
			errors[field] = "must be between 1 and 50"
		} else {
			v[field] = value
		}
	}

	if len(errors) == 0 {
		if missing <= stale {
			errors["metricsMissingSeconds"] = "must be greater than metricsStaleSeconds"
		}
		if lookback < missing {
			errors["metricsFreshnessLookbackSeconds"] = "must be >= metricsMissingSeconds"
		}
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateMonitorPlatformSelfObservation(app core.App, v map[string]any) map[string]string {
	errors := map[string]string{}

	observerInterval, err := parseIntWithDefault(v["platformObserverIntervalSeconds"], 30)
	if err != nil {
		errors["platformObserverIntervalSeconds"] = "must be an integer"
	} else if observerInterval < 5 || observerInterval > 300 {
		errors["platformObserverIntervalSeconds"] = "must be between 5 and 300"
	} else {
		v["platformObserverIntervalSeconds"] = observerInterval
	}

	schedulerThreshold, err := parseIntWithDefault(v["platformSchedulerStaleThresholdSeconds"], 10)
	if err != nil {
		errors["platformSchedulerStaleThresholdSeconds"] = "must be an integer"
	} else if schedulerThreshold < 5 || schedulerThreshold > 300 {
		errors["platformSchedulerStaleThresholdSeconds"] = "must be between 5 and 300"
	} else {
		v["platformSchedulerStaleThresholdSeconds"] = schedulerThreshold
	}

	for _, field := range []string{"enableHostTelemetry", "enableContainerTelemetry"} {
		value, err := parseBoolWithDefault(v[field], false)
		if err != nil {
			errors[field] = "must be a boolean"
		} else {
			v[field] = value
		}
	}

	policyGroup, _ := sysconfig.GetGroup(app, monitor.SettingsModule, monitor.PolicySettingsKey, settingsschema.DefaultGroup(monitor.SettingsModule, monitor.PolicySettingsKey))
	metricsStale := sysconfig.Int(policyGroup, "metricsStaleSeconds", 90)
	metricsMissing := sysconfig.Int(policyGroup, "metricsMissingSeconds", 180)

	if len(errors) == 0 {
		if schedulerThreshold >= metricsMissing {
			errors["platformSchedulerStaleThresholdSeconds"] = "must be less than metricsMissingSeconds"
		}
		if metricsStale < observerInterval*2 {
			errors["platformObserverIntervalSeconds"] = "must allow metricsStaleSeconds >= 2x observer interval"
		}
		if metricsMissing < observerInterval*3 {
			errors["platformObserverIntervalSeconds"] = "must allow metricsMissingSeconds >= 3x observer interval"
		}
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateMonitorManagedCollectorPolicy(v map[string]any) map[string]string {
	errors := map[string]string{}

	collectionIntervalSeconds, err := parseIntWithDefault(v["collectionIntervalSeconds"], 10)
	if err != nil {
		errors["collectionIntervalSeconds"] = "must be an integer"
	} else if collectionIntervalSeconds < 5 || collectionIntervalSeconds > 300 {
		errors["collectionIntervalSeconds"] = "must be between 5 and 300"
	} else {
		v["collectionIntervalSeconds"] = collectionIntervalSeconds
	}

	flushIntervalSeconds, err := parseIntWithDefault(v["flushIntervalSeconds"], 10)
	if err != nil {
		errors["flushIntervalSeconds"] = "must be an integer"
	} else if flushIntervalSeconds < 5 || flushIntervalSeconds > 300 {
		errors["flushIntervalSeconds"] = "must be between 5 and 300"
	} else {
		v["flushIntervalSeconds"] = flushIntervalSeconds
	}

	metricBatchSize, err := parseIntWithDefault(v["metricBatchSize"], 1000)
	if err != nil {
		errors["metricBatchSize"] = "must be an integer"
	} else if metricBatchSize < 1 || metricBatchSize > 10000 {
		errors["metricBatchSize"] = "must be between 1 and 10000"
	} else {
		v["metricBatchSize"] = metricBatchSize
	}

	metricBufferLimit, err := parseIntWithDefault(v["metricBufferLimit"], 5000)
	if err != nil {
		errors["metricBufferLimit"] = "must be an integer"
	} else if metricBufferLimit < 1 || metricBufferLimit > 50000 {
		errors["metricBufferLimit"] = "must be between 1 and 50000"
	} else {
		v["metricBufferLimit"] = metricBufferLimit
	}

	collectionJitterSeconds, err := parseIntWithDefault(v["collectionJitterSeconds"], 1)
	if err != nil {
		errors["collectionJitterSeconds"] = "must be an integer"
	} else if collectionJitterSeconds < 0 || collectionJitterSeconds > 300 {
		errors["collectionJitterSeconds"] = "must be between 0 and 300"
	} else {
		v["collectionJitterSeconds"] = collectionJitterSeconds
	}

	flushJitterSeconds, err := parseIntWithDefault(v["flushJitterSeconds"], 1)
	if err != nil {
		errors["flushJitterSeconds"] = "must be an integer"
	} else if flushJitterSeconds < 0 || flushJitterSeconds > 300 {
		errors["flushJitterSeconds"] = "must be between 0 and 300"
	} else {
		v["flushJitterSeconds"] = flushJitterSeconds
	}

	if len(errors) == 0 {
		if metricBufferLimit < metricBatchSize {
			errors["metricBufferLimit"] = "must be >= metricBatchSize"
		}
		if collectionJitterSeconds > collectionIntervalSeconds {
			errors["collectionJitterSeconds"] = "must be <= collectionIntervalSeconds"
		}
		if flushJitterSeconds > flushIntervalSeconds {
			errors["flushJitterSeconds"] = "must be <= flushIntervalSeconds"
		}
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateFeedsPolicy(v map[string]any) map[string]string {
	errors := map[string]string{}

	pollIntervalHours, err := parseIntWithDefault(v["pollIntervalHours"], 3)
	if err != nil {
		errors["pollIntervalHours"] = "must be an integer"
	} else if pollIntervalHours < 1 || pollIntervalHours > 240 {
		errors["pollIntervalHours"] = "must be between 1 and 240"
	} else {
		v["pollIntervalHours"] = pollIntervalHours
	}

	failureBackoffMaxHours, err := parseIntWithDefault(v["failureBackoffMaxHours"], 24)
	if err != nil {
		errors["failureBackoffMaxHours"] = "must be an integer"
	} else if failureBackoffMaxHours < 4 || failureBackoffMaxHours > 336 {
		errors["failureBackoffMaxHours"] = "must be between 4 and 336"
	} else {
		v["failureBackoffMaxHours"] = failureBackoffMaxHours
	}

	perSourceRetentionCap, err := parseIntWithDefault(v["perSourceRetentionCap"], 100)
	if err != nil {
		errors["perSourceRetentionCap"] = "must be an integer"
	} else if perSourceRetentionCap < 20 || perSourceRetentionCap > 1000 {
		errors["perSourceRetentionCap"] = "must be between 20 and 1000"
	} else {
		v["perSourceRetentionCap"] = perSourceRetentionCap
	}

	globalRetentionCap, err := parseIntWithDefault(v["globalRetentionCap"], 10000)
	if err != nil {
		errors["globalRetentionCap"] = "must be an integer"
	} else if globalRetentionCap < 5000 || globalRetentionCap > 50000 {
		errors["globalRetentionCap"] = "must be between 5000 and 50000"
	} else {
		v["globalRetentionCap"] = globalRetentionCap
	}

	if len(errors) == 0 {
		if globalRetentionCap < perSourceRetentionCap {
			errors["globalRetentionCap"] = "must be >= perSourceRetentionCap"
		}
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateTopicCommentPolicy(v map[string]any) map[string]string {
	errors := map[string]string{}

	allowGuestComments, err := parseBoolWithDefault(v["allowGuestComments"], true)
	if err != nil {
		errors["allowGuestComments"] = "must be a boolean"
	} else {
		v["allowGuestComments"] = allowGuestComments
	}

	defaultGuestName := strings.TrimSpace(sysconfig.String(v, "defaultGuestName", "Guest"))
	if defaultGuestName == "" {
		errors["defaultGuestName"] = "must not be empty"
	} else {
		v["defaultGuestName"] = defaultGuestName
	}

	maxGuestNameLength, err := parseIntWithDefault(v["maxGuestNameLength"], 100)
	if err != nil {
		errors["maxGuestNameLength"] = "must be an integer"
	} else if maxGuestNameLength < 1 || maxGuestNameLength > 500 {
		errors["maxGuestNameLength"] = "must be between 1 and 500"
	} else {
		v["maxGuestNameLength"] = maxGuestNameLength
	}

	maxCommentBodyLength, err := parseIntWithDefault(v["maxCommentBodyLength"], 10000)
	if err != nil {
		errors["maxCommentBodyLength"] = "must be an integer"
	} else if maxCommentBodyLength < 1 || maxCommentBodyLength > 100000 {
		errors["maxCommentBodyLength"] = "must be between 1 and 100000"
	} else {
		v["maxCommentBodyLength"] = maxCommentBodyLength
	}

	if len(errors) == 0 && len([]rune(defaultGuestName)) > maxGuestNameLength {
		errors["defaultGuestName"] = "must be within maxGuestNameLength"
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

func validateTopicImportPolicy(v map[string]any) map[string]string {
	errors := map[string]string{}

	maxDescriptionImportKB, err := parseIntWithDefault(v["maxDescriptionImportKB"], 2)
	if err != nil && v["maxDescriptionImportKB"] == nil && v["maxDescriptionImportBytes"] != nil {
		legacyBytes, legacyErr := parseIntWithDefault(v["maxDescriptionImportBytes"], 2*1024)
		if legacyErr == nil {
			maxDescriptionImportKB = legacyBytes / 1024
			if legacyBytes%1024 != 0 {
				maxDescriptionImportKB++
			}
			err = nil
		}
	}
	if err != nil {
		errors["maxDescriptionImportKB"] = "must be an integer"
	} else if maxDescriptionImportKB < 1 || maxDescriptionImportKB > 10*1024 {
		errors["maxDescriptionImportKB"] = "must be between 1 and 10240"
	} else {
		delete(v, "maxDescriptionImportBytes")
		v["maxDescriptionImportKB"] = maxDescriptionImportKB
	}

	textOnly, err := parseBoolWithDefault(v["textOnly"], true)
	if err != nil {
		errors["textOnly"] = "must be a boolean"
	} else {
		v["textOnly"] = textOnly
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

// ─── Defaults ──────────────────────────────────────────────────────────────

// fallbackForKey returns the code-level fallback for a given (module, key) pair.
func fallbackForKey(module, key string) map[string]any {
	fallback := settingsschema.DefaultGroup(module, key)
	if len(fallback) != 0 {
		return fallback
	}
	return map[string]any{}
}

// ─── Mask helpers ──────────────────────────────────────────────────────────

// maskValue masks sensitive string fields in a group value map.
// It also walks an "items" array (if present) and masks sensitive fields in each item.
// Exception: secretRef pointer values (prefixed "secretRef:") are returned as-is so
// the UI can distinguish a bound secret reference from a masked plaintext value.
func maskValue(v map[string]any) map[string]any {
	out := make(map[string]any, len(v))
	for k, val := range v {
		if k == "items" {
			out[k] = maskItems(val)
		} else if sensitiveFields[k] {
			if s, ok := val.(string); ok && s != "" {
				if secrets.IsSecretRef(s) {
					// Preserve secretRef pointer — not sensitive; needed by UI.
					out[k] = s
				} else {
					out[k] = "***"
				}
			} else {
				out[k] = val
			}
		} else {
			out[k] = val
		}
	}
	return out
}

// maskItems masks sensitive fields inside each element of an items array.
func maskItems(raw any) any {
	arr, ok := raw.([]any)
	if !ok {
		return raw
	}
	out := make([]any, len(arr))
	for i, item := range arr {
		if m, ok := item.(map[string]any); ok {
			out[i] = maskValue(m)
		} else {
			out[i] = item
		}
	}
	return out
}

// ─── Preserve-"***" helpers ────────────────────────────────────────────────

// preserveSensitive overwrites "***" placeholder values in incoming with the
// corresponding stored values from existing.
// Returns the merged map (modifies incoming in-place and returns it).
func preserveSensitive(incoming, existing map[string]any) map[string]any {
	if incoming == nil {
		return incoming
	}
	for k, v := range incoming {
		if k == "items" {
			incoming[k] = preserveItemsSensitive(v, existing["items"])
		} else if sensitiveFields[k] {
			if s, ok := v.(string); ok && s == "***" {
				// Keep existing value (may itself be "***" if never set — acceptable).
				if ev, ok := existing[k]; ok {
					incoming[k] = ev
				}
			}
		}
	}
	return incoming
}

// preserveItemsSensitive merges "***" sentinels in incoming items array with
// stored values from existing items array.
//
// Matching strategy: for each incoming item, first try to find an existing item
// whose non-sensitive fields all match (handles delete/reorder). Falls back to
// positional matching when no field-based match is found.
func preserveItemsSensitive(rawIncoming, rawExisting any) any {
	inArr, ok := rawIncoming.([]any)
	if !ok {
		return rawIncoming
	}
	exArr, _ := rawExisting.([]any)
	out := make([]any, len(inArr))
	for i, item := range inArr {
		inItem, ok := item.(map[string]any)
		if !ok {
			out[i] = item
			continue
		}
		exItem := findMatchingItem(inItem, exArr, i)
		out[i] = preserveSensitive(inItem, exItem)
	}
	return out
}

// findMatchingItem finds the best existing item to resolve "***" placeholders.
// Prefers a match by non-sensitive fields; falls back to positional index.
func findMatchingItem(incoming map[string]any, exArr []any, posHint int) map[string]any {
	for _, ex := range exArr {
		exItem, ok := ex.(map[string]any)
		if !ok {
			continue
		}
		if nonSensitiveFieldsMatch(incoming, exItem) {
			return exItem
		}
	}
	if posHint < len(exArr) {
		if exItem, ok := exArr[posHint].(map[string]any); ok {
			return exItem
		}
	}
	return map[string]any{}
}

// nonSensitiveFieldsMatch returns true when every non-sensitive field in
// incoming matches the corresponding field in existing.
func nonSensitiveFieldsMatch(incoming, existing map[string]any) bool {
	matched := 0
	for k, v := range incoming {
		if sensitiveFields[k] || k == "items" {
			continue
		}
		ev, ok := existing[k]
		if !ok || fmt.Sprint(v) != fmt.Sprint(ev) {
			return false
		}
		matched++
	}
	return matched > 0
}
