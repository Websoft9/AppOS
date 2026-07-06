package schema

import (
	"encoding/json"
)

const (
	SectionSystem    = "system"
	SectionWorkspace = "workspace"

	SourceNative = "native"
	SourceCustom = "custom"
)

type FieldSchema struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Type      string `json:"type"`
	Sensitive bool   `json:"sensitive,omitempty"`
	HelpText  string `json:"helpText,omitempty"`
}

type ActionSchema struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	EntryID string `json:"entryId,omitempty"`
}

type EntrySchema struct {
	ID          string        `json:"id"`
	Title       string        `json:"title"`
	Description string        `json:"description,omitempty"`
	Section     string        `json:"section"`
	Source      string        `json:"source"`
	Fields      []FieldSchema `json:"fields"`
	Actions     []string      `json:"actions,omitempty"`

	PocketBaseGroup string `json:"-"`
	Module          string `json:"-"`
	Key             string `json:"-"`
}

type CustomSettingSeedRow struct {
	Module string
	Key    string
	Value  map[string]any
}

var actionCatalog = []ActionSchema{
	{ID: "test-email", Title: "Send Test Email", EntryID: "smtp"},
	{ID: "test-s3", Title: "Test S3 Connection", EntryID: "s3"},
}

var entryCatalog = []EntrySchema{
	{
		ID:      "basic",
		Title:   "Basic",
		Section: SectionSystem,
		Source:  SourceNative,
		Fields: []FieldSchema{
			{ID: "appName", Label: "App Name", Type: "string"},
			{ID: "appURL", Label: "App URL", Type: "url"},
		},
		PocketBaseGroup: "meta",
	},
	{
		ID:      "branding",
		Title:   "Branding",
		Section: SectionSystem,
		Source:  SourceCustom,
		Module:  "branding",
		Key:     "identity",
		Fields: []FieldSchema{
			{ID: "logoMediaId", Label: "Logo Media ID", Type: "string"},
			{ID: "logoUrl", Label: "Logo", Type: "url", HelpText: "Logo image URL. Leave empty to auto-generate one from the current name or wordmark."},
			{ID: "useLogoAsFavicon", Label: "Use Logo as Favicon", Type: "boolean"},
			{ID: "faviconMediaId", Label: "Favicon Media ID", Type: "string"},
			{ID: "faviconUrl", Label: "Favicon", Type: "url", HelpText: "Custom favicon image URL. Ignored when using the logo as favicon."},
			{ID: "wordmark", Label: "Wordmark", Type: "string", HelpText: "Text shown beside the logo in the sidebar."},
			{ID: "description", Label: "Description", Type: "string", HelpText: "Short tagline shown below the platform name in the sidebar."},
		},
	},
	{
		ID:          "smtp",
		Title:       "SMTP",
		Description: "Reference-only entry. Create and manage SMTP services from Resources > External Services.",
		Section:     SectionSystem,
		Source:      SourceNative,
		Actions:     []string{"test-email"},
		Fields: []FieldSchema{
			{ID: "enabled", Label: "Enable SMTP", Type: "boolean"},
			{ID: "host", Label: "Host", Type: "string"},
			{ID: "port", Label: "Port", Type: "integer"},
			{ID: "username", Label: "Username", Type: "string"},
			{ID: "password", Label: "Password", Type: "string", Sensitive: true},
			{ID: "authMethod", Label: "Auth Method", Type: "string"},
			{ID: "tls", Label: "TLS", Type: "boolean"},
			{ID: "localName", Label: "Local Name", Type: "string"},
		},
		PocketBaseGroup: "smtp",
	},
	{
		ID:      "s3",
		Title:   "S3 Storage",
		Section: SectionSystem,
		Source:  SourceNative,
		Actions: []string{"test-s3"},
		Fields: []FieldSchema{
			{ID: "enabled", Label: "Enable S3", Type: "boolean"},
			{ID: "bucket", Label: "Bucket", Type: "string"},
			{ID: "region", Label: "Region", Type: "string"},
			{ID: "endpoint", Label: "Endpoint", Type: "string"},
			{ID: "accessKey", Label: "Access Key", Type: "string"},
			{ID: "secret", Label: "Secret", Type: "string", Sensitive: true},
			{ID: "forcePathStyle", Label: "Force Path Style", Type: "boolean"},
		},
		PocketBaseGroup: "s3",
	},
	{
		ID:      "logs",
		Title:   "Logs",
		Section: SectionSystem,
		Source:  SourceNative,
		Fields: []FieldSchema{
			{ID: "maxDays", Label: "Max Days", Type: "integer"},
			{ID: "minLevel", Label: "Min Level", Type: "integer"},
			{ID: "logIP", Label: "Log IP", Type: "boolean"},
			{ID: "logAuthId", Label: "Log Auth ID", Type: "boolean"},
		},
		PocketBaseGroup: "logs",
	},
	{
		ID:      "secrets-policy",
		Title:   "Secrets",
		Section: SectionSystem,
		Source:  SourceCustom,
		Module:  "secrets",
		Key:     "policy",
		Fields: []FieldSchema{
			{ID: "revealDisabled", Label: "Disable Reveal", Type: "boolean"},
			{ID: "defaultAccessMode", Label: "Default Access Mode", Type: "string"},
			{ID: "clipboardClearSeconds", Label: "Clipboard Clear Seconds", Type: "integer"},
			{ID: "maxAgeDays", Label: "Max Age (days)", Type: "integer", HelpText: "Maximum lifetime of a secret in days. 0 means secrets never expire."},
			{ID: "warnBeforeExpiryDays", Label: "Expiry Warning (days)", Type: "integer", HelpText: "Show an expiry warning this many days before a secret expires. 0 disables the warning."},
		},
	},
	{
		ID:      "space-quota",
		Title:   "Space Quota",
		Section: SectionWorkspace,
		Source:  SourceCustom,
		Module:  "space",
		Key:     "quota",
		Fields: []FieldSchema{
			{ID: "maxSizeMB", Label: "Max Size MB", Type: "integer"},
			{ID: "maxPerUser", Label: "Max Per User", Type: "integer"},
			{ID: "maxUploadFiles", Label: "Max Upload Files", Type: "integer"},
			{ID: "shareMaxMinutes", Label: "Share Max Minutes", Type: "integer"},
			{ID: "shareDefaultMinutes", Label: "Share Default Minutes", Type: "integer"},
			{ID: "uploadAllowExts", Label: "Upload Allow Exts", Type: "string-list"},
			{ID: "uploadDenyExts", Label: "Upload Deny Exts", Type: "string-list"},
			{ID: "disallowedFolderNames", Label: "Disallowed Folder Names", Type: "string-list"},
		},
	},
	{
		ID:      "connect-terminal",
		Title:   "Connect Terminal",
		Section: SectionWorkspace,
		Source:  SourceCustom,
		Module:  "connect",
		Key:     "terminal",
		Fields: []FieldSchema{
			{ID: "idleTimeoutSeconds", Label: "Idle Timeout Seconds", Type: "integer", HelpText: "Disconnect idle terminal sessions after this many seconds."},
			{ID: "maxConnections", Label: "Max Connections", Type: "integer", HelpText: "0 means unlimited"},
		},
	},
	{
		ID:      "connect-sftp",
		Title:   "Connect SFTP",
		Section: SectionWorkspace,
		Source:  SourceCustom,
		Module:  "connect",
		Key:     "sftp",
		Fields: []FieldSchema{
			{ID: "maxUploadFiles", Label: "Max Upload Files", Type: "integer", HelpText: "Maximum number of files allowed in a single SFTP upload."},
		},
	},
	{
		ID:      "deploy-preflight",
		Title:   "Deploy Preflight",
		Section: SectionWorkspace,
		Source:  SourceCustom,
		Module:  "deploy",
		Key:     "preflight",
		Fields: []FieldSchema{
			{ID: "minFreeDiskGiB", Label: "Minimum Free Disk (GiB)", Type: "number", HelpText: "Free disk floor before deploy."},
		},
	},
	{
		ID:      "deploy-runtime",
		Title:   "Deploy Runtime",
		Section: SectionWorkspace,
		Source:  SourceCustom,
		Module:  "deploy",
		Key:     "runtime",
		Fields: []FieldSchema{
			{ID: "imagePullTimeoutSeconds", Label: "Image Pull Timeout Seconds", Type: "integer", HelpText: "Wait time for one image pull."},
			{ID: "composeUpTimeoutSeconds", Label: "Compose Up Timeout Seconds", Type: "integer", HelpText: "Wait time for docker compose up."},
			{ID: "healthCheckTimeoutSeconds", Label: "Health Check Timeout Seconds", Type: "integer", HelpText: "Wait time for health checks."},
			{ID: "runtimePullIdleHeartbeatSeconds", Label: "Runtime Pull Idle Heartbeat Seconds", Type: "integer", HelpText: "Idle time before pull heartbeat logs."},
		},
	},
	{
		ID:      "deploy-git-defaults",
		Title:   "Deploy Git Defaults",
		Section: SectionWorkspace,
		Source:  SourceCustom,
		Module:  "deploy",
		Key:     "git-defaults",
		Fields: []FieldSchema{
			{ID: "defaultRef", Label: "Default Ref", Type: "string", HelpText: "Fallback Git ref."},
			{ID: "defaultComposePath", Label: "Default Compose Path", Type: "string", HelpText: "Fallback compose path."},
		},
	},
	{
		ID:      "iac-files",
		Title:   "IaC Files",
		Section: SectionWorkspace,
		Source:  SourceCustom,
		Module:  "files",
		Key:     "limits",
		Fields: []FieldSchema{
			{ID: "maxSizeMB", Label: "Max File Size MB", Type: "integer", HelpText: "Maximum size allowed for a single IaC file upload or read."},
			{ID: "maxZipSizeMB", Label: "Max ZIP Size MB", Type: "integer", HelpText: "Maximum size allowed when importing IaC ZIP archives."},
			{ID: "extensionBlacklist", Label: "Extension Blacklist", Type: "string", HelpText: "Comma-separated file extensions blocked in the IaC workspace browser."},
		},
	},
	{
		ID:      "tunnel-port-range",
		Title:   "Tunnel",
		Section: SectionWorkspace,
		Source:  SourceCustom,
		Module:  "tunnel",
		Key:     "port_range",
		Fields: []FieldSchema{
			{ID: "start", Label: "Start Port", Type: "integer", HelpText: "Lowest port that can be assigned to a reverse tunnel session."},
			{ID: "end", Label: "End Port", Type: "integer", HelpText: "Highest port that can be assigned to a reverse tunnel session."},
		},
	},
	{
		ID:      "proxy-network",
		Title:   "Proxy",
		Section: SectionWorkspace,
		Source:  SourceCustom,
		Module:  "proxy",
		Key:     "network",
		Fields: []FieldSchema{
			{ID: "enabled", Label: "Enable Proxy", Type: "boolean", HelpText: "Enable workspace-wide outbound proxy resolution for AppOS network operations."},
			{ID: "socks5ConnectorId", Label: "SOCKS5 Proxy Service", Type: "relation", HelpText: "Service used for all outbound traffic when SOCKS5 is selected."},
			{ID: "httpConnectorId", Label: "HTTP Proxy Service", Type: "relation", HelpText: "Service used for HTTP proxy traffic when SOCKS5 is not selected."},
			{ID: "httpsConnectorId", Label: "HTTPS Proxy Service", Type: "relation", HelpText: "Service used for HTTPS proxy traffic when SOCKS5 is not selected."},
		},
	},
	{
		ID:      "proxy-policies",
		Title:   "Proxy Policies",
		Section: SectionWorkspace,
		Source:  SourceCustom,
		Module:  "proxy",
		Key:     "policies",
		Fields: []FieldSchema{
			{ID: "items", Label: "Policy Selections", Type: "object-list", HelpText: "Policy-domain mode selection rows."},
		},
	},
	{
		ID:      "proxy-remote-shell",
		Title:   "Remote Shell Proxy",
		Section: SectionWorkspace,
		Source:  SourceCustom,
		Module:  "proxy",
		Key:     "servers",
		Fields: []FieldSchema{
			{ID: "items", Label: "Server Overrides", Type: "object-list", HelpText: "Per-server remote shell proxy overrides that take precedence over the global remote shell policy."},
		},
	},
	{
		ID:          "docker-mirror",
		Title:       "Docker Mirrors",
		Description: "Speed up AppOS image pulls. Does not change server Docker settings.",
		Section:     SectionWorkspace,
		Source:      SourceCustom,
		Module:      "docker",
		Key:         "mirror",
		Fields: []FieldSchema{
			{ID: "mirrors", Label: "Pull Sources", Type: "string-list"},
			{ID: "allowInsecureRegistries", Label: "Allow Insecure Registries", Type: "boolean"},
		},
	},
	{
		ID:          "docker-registries",
		Title:       "Docker Registries",
		Description: "Reference-only entry. Create and manage registry connectors from Resources > Connectors.",
		Section:     SectionWorkspace,
		Source:      SourceCustom,
		Module:      "docker",
		Key:         "registries",
		Fields:      []FieldSchema{{ID: "items", Label: "Items", Type: "object-list"}},
	},
	{
		ID:      "topic-share",
		Title:   "Topic Share",
		Section: SectionWorkspace,
		Source:  SourceCustom,
		Module:  "topic",
		Key:     "share",
		Fields: []FieldSchema{
			{ID: "shareMaxMinutes", Label: "Share Max Minutes", Type: "integer"},
			{ID: "shareDefaultMinutes", Label: "Share Default Minutes", Type: "integer"},
		},
	},
	{
		ID:      "topic-comment-policy",
		Title:   "Topic Comment Policy",
		Section: SectionWorkspace,
		Source:  SourceCustom,
		Module:  "topic",
		Key:     "comment-policy",
		Fields: []FieldSchema{
			{ID: "allowGuestComments", Label: "Allow Guest Comments", Type: "boolean"},
			{ID: "defaultGuestName", Label: "Default Guest Name", Type: "string"},
			{ID: "maxGuestNameLength", Label: "Max Guest Name Length", Type: "integer"},
			{ID: "maxCommentBodyLength", Label: "Max Comment Body Length", Type: "integer"},
		},
	},
	{
		ID:      "topic-import-policy",
		Title:   "Topic Description Import",
		Section: SectionWorkspace,
		Source:  SourceCustom,
		Module:  "topic",
		Key:     "import-policy",
		Fields: []FieldSchema{
			{ID: "maxDescriptionImportKB", Label: "Max Description Import (KB)", Type: "integer", HelpText: "Maximum text file size in KB allowed when importing into a topic description."},
			{ID: "textOnly", Label: "Text-only Imports", Type: "boolean", HelpText: "Reject files that look binary when importing topic descriptions."},
		},
	},
	{
		ID:      "feeds-policy",
		Title:   "Feeds",
		Section: SectionWorkspace,
		Source:  SourceCustom,
		Module:  "feeds",
		Key:     "policy",
		Fields: []FieldSchema{
			{ID: "pollIntervalHours", Label: "Poll Interval (hours)", Type: "integer", HelpText: "Polling cadence for active feed sources. Range: 1 - 240 hours."},
			{ID: "failureBackoffMaxHours", Label: "Failure Backoff (hours)", Type: "integer", HelpText: "Maximum retry delay after consecutive polling failures. Intermediate tiers are derived automatically."},
			{ID: "perSourceRetentionCap", Label: "Per Source Retention Cap", Type: "integer", HelpText: "Maximum stored feed articles per source before cleanup trims older items. Range: 20 - 1000."},
			{ID: "globalRetentionCap", Label: "Global Retention Cap", Type: "integer", HelpText: "Maximum stored feed articles across all sources before global cleanup trims older items. Range: 5000 - 50000."},
		},
	},
	{
		ID:      "monitor-scheduling",
		Title:   "Monitor Scheduling",
		Section: SectionSystem,
		Source:  SourceCustom,
		Module:  "monitor",
		Key:     "scheduling",
		Fields: []FieldSchema{
			{ID: "reachabilityIntervalMinutes", Label: "Reachability Interval Minutes", Type: "integer"},
			{ID: "metricsFreshnessIntervalMinutes", Label: "Metrics Freshness Interval Minutes", Type: "integer"},
			{ID: "controlReachabilityIntervalMinutes", Label: "Control Reachability Interval Minutes", Type: "integer"},
			{ID: "runtimeSnapshotIntervalMinutes", Label: "Runtime Snapshot Interval Minutes", Type: "integer"},
			{ID: "credentialSweepIntervalMinutes", Label: "Credential Sweep Interval Minutes", Type: "integer"},
			{ID: "appHealthIntervalMinutes", Label: "App Health Interval Minutes", Type: "integer"},
			{ID: "factsPullIntervalMinutes", Label: "Facts Pull Interval Minutes", Type: "integer"},
		},
	},
	{
		ID:      "monitor-policy",
		Title:   "Monitor Policy",
		Section: SectionSystem,
		Source:  SourceCustom,
		Module:  "monitor",
		Key:     "policy",
		Fields: []FieldSchema{
			{ID: "reachabilityProbeTimeoutMs", Label: "Reachability Probe Timeout Ms", Type: "integer"},
			{ID: "metricsFreshnessLookbackSeconds", Label: "Metrics Freshness Lookback Seconds", Type: "integer"},
			{ID: "metricsStaleSeconds", Label: "Metrics Stale Seconds", Type: "integer"},
			{ID: "metricsMissingSeconds", Label: "Metrics Missing Seconds", Type: "integer"},
			{ID: "controlProbeTimeoutSeconds", Label: "Control Probe Timeout Seconds", Type: "integer"},
			{ID: "factsPullTimeoutSeconds", Label: "Facts Pull Timeout Seconds", Type: "integer"},
			{ID: "runtimePullTimeoutSeconds", Label: "Runtime Pull Timeout Seconds", Type: "integer"},
			{ID: "factsPullConcurrency", Label: "Facts Pull Concurrency", Type: "integer"},
			{ID: "runtimePullConcurrency", Label: "Runtime Pull Concurrency", Type: "integer"},
		},
	},
	{
		ID:      "monitor-platform-self-observation",
		Title:   "Platform Self-Observation",
		Section: SectionSystem,
		Source:  SourceCustom,
		Module:  "monitor",
		Key:     "platform-self-observation",
		Fields: []FieldSchema{
			{ID: "platformObserverIntervalSeconds", Label: "Platform Observer Interval Seconds", Type: "integer", HelpText: "Cadence for AppOS-local self-observation writes."},
			{ID: "platformSchedulerStaleThresholdSeconds", Label: "Platform Scheduler Stale Threshold Seconds", Type: "integer", HelpText: "Mark the scheduler degraded when its latest tick is older than this threshold."},
			{ID: "enableHostTelemetry", Label: "Enable Host Telemetry", Type: "boolean", HelpText: "Collect AppOS-local host telemetry when runtime capability is available."},
			{ID: "enableContainerTelemetry", Label: "Enable Container Telemetry", Type: "boolean", HelpText: "Collect AppOS-local container telemetry when runtime capability is available."},
		},
	},
	{
		ID:      "monitor-managed-collector-policy",
		Title:   "Managed Collector Policy",
		Section: SectionSystem,
		Source:  SourceCustom,
		Module:  "monitor",
		Key:     "managed-collector-policy",
		Fields: []FieldSchema{
			{ID: "collectionIntervalSeconds", Label: "Collection Interval Seconds", Type: "integer", HelpText: "Cadence for managed monitor-agent metric collection on remote servers."},
			{ID: "flushIntervalSeconds", Label: "Flush Interval Seconds", Type: "integer", HelpText: "Cadence for batched writes from monitor-agent to AppOS."},
			{ID: "metricBatchSize", Label: "Metric Batch Size", Type: "integer", HelpText: "Maximum metrics sent in a single write batch."},
			{ID: "metricBufferLimit", Label: "Metric Buffer Limit", Type: "integer", HelpText: "Maximum buffered metrics retained before backpressure and drops."},
			{ID: "collectionJitterSeconds", Label: "Collection Jitter Seconds", Type: "integer", HelpText: "Randomized collection delay used to avoid synchronized bursts."},
			{ID: "flushJitterSeconds", Label: "Flush Jitter Seconds", Type: "integer", HelpText: "Randomized flush delay used to smooth write bursts toward AppOS."},
		},
	},
}

var customSettingDefaults = map[string]map[string]any{
	"branding/identity": {
		"logoMediaId":      "",
		"logoUrl":          "",
		"wordmark":         "appos",
		"description":      "Application Platform",
		"useLogoAsFavicon": false,
		"faviconMediaId":   "",
		"faviconUrl":       "",
	},
	"space/quota": {
		"maxSizeMB":             10,
		"maxPerUser":            100,
		"shareMaxMinutes":       60,
		"shareDefaultMinutes":   30,
		"maxUploadFiles":        50,
		"disallowedFolderNames": []string{},
	},
	"proxy/network": {
		"source": "none", "enabled": false, "socks5ConnectorId": "", "httpConnectorId": "", "httpsConnectorId": "",
	},
	"proxy/policies": defaultProxyConsumerSettingsMap(),
	"proxy/servers":  map[string]any{"items": []any{}},
	"docker/mirror": {
		"mirrors": []any{}, "allowInsecureRegistries": false,
	},
	"docker/registries": {"items": []any{}},
	"connect/sftp":      {"maxUploadFiles": 10},
	"connect/terminal":  {"idleTimeoutSeconds": 1800, "maxConnections": 0},
	"files/limits": {
		"maxSizeMB":          10,
		"maxZipSizeMB":       50,
		"extensionBlacklist": ".exe,.dll,.so,.bin,.deb,.rpm,.apk,.msi,.dmg,.pkg",
	},
	"tunnel/port_range": {"start": 40000, "end": 49999},
	"secrets/policy": {
		"revealDisabled":        false,
		"defaultAccessMode":     "use_only",
		"clipboardClearSeconds": 0,
	},
	"deploy/preflight": {"minFreeDiskGiB": 1.0},
	"deploy/runtime": {
		"imagePullTimeoutSeconds":         180,
		"composeUpTimeoutSeconds":         600,
		"healthCheckTimeoutSeconds":       120,
		"runtimePullIdleHeartbeatSeconds": 20,
	},
	"deploy/git-defaults": {
		"defaultRef":         "main",
		"defaultComposePath": "docker-compose.yml",
	},
	"topic/share": {
		"shareMaxMinutes":     60,
		"shareDefaultMinutes": 30,
	},
	"topic/comment-policy": {
		"allowGuestComments":   true,
		"defaultGuestName":     "Guest",
		"maxGuestNameLength":   100,
		"maxCommentBodyLength": 10000,
	},
	"topic/import-policy": {
		"maxDescriptionImportKB": 2,
		"textOnly":               true,
	},
	"monitor/scheduling": {
		"reachabilityIntervalMinutes":        1,
		"metricsFreshnessIntervalMinutes":    1,
		"controlReachabilityIntervalMinutes": 1,
		"runtimeSnapshotIntervalMinutes":     1,
		"credentialSweepIntervalMinutes":     5,
		"appHealthIntervalMinutes":           1,
		"factsPullIntervalMinutes":           15,
	},
	"monitor/policy": {
		"reachabilityProbeTimeoutMs":      1500,
		"metricsFreshnessLookbackSeconds": 300,
		"metricsStaleSeconds":             90,
		"metricsMissingSeconds":           180,
		"controlProbeTimeoutSeconds":      5,
		"factsPullTimeoutSeconds":         20,
		"runtimePullTimeoutSeconds":       20,
		"factsPullConcurrency":            5,
		"runtimePullConcurrency":          5,
	},
	"monitor/platform-self-observation": {
		"platformObserverIntervalSeconds":        30,
		"platformSchedulerStaleThresholdSeconds": 10,
		"enableHostTelemetry":                    false,
		"enableContainerTelemetry":               false,
	},
	"monitor/managed-collector-policy": {
		"collectionIntervalSeconds": 10,
		"flushIntervalSeconds":      10,
		"metricBatchSize":           1000,
		"metricBufferLimit":         5000,
		"collectionJitterSeconds":   1,
		"flushJitterSeconds":        1,
	},
	"feeds/policy": {
		"pollIntervalHours":      3,
		"failureBackoffMaxHours": 24,
		"perSourceRetentionCap":  100,
		"globalRetentionCap":     10000,
	},
}

func Actions() []ActionSchema {
	out := make([]ActionSchema, len(actionCatalog))
	copy(out, actionCatalog)
	return out
}

func Entries() []EntrySchema {
	out := make([]EntrySchema, 0, len(entryCatalog))
	for _, entry := range entryCatalog {
		clone := entry
		clone.Fields = append([]FieldSchema(nil), entry.Fields...)
		clone.Actions = append([]string(nil), entry.Actions...)
		out = append(out, clone)
	}
	return out
}

func FindEntry(id string) (EntrySchema, bool) {
	for _, entry := range entryCatalog {
		if entry.ID == id {
			clone := entry
			clone.Fields = append([]FieldSchema(nil), entry.Fields...)
			clone.Actions = append([]string(nil), entry.Actions...)
			return clone, true
		}
	}
	return EntrySchema{}, false
}

func DefaultGroup(module, key string) map[string]any {
	return cloneMap(customSettingDefaults[module+"/"+key])
}

func SeedRows() []CustomSettingSeedRow {
	out := make([]CustomSettingSeedRow, 0, len(entryCatalog))
	for _, entry := range entryCatalog {
		if entry.Source != SourceCustom {
			continue
		}
		out = append(out, CustomSettingSeedRow{
			Module: entry.Module,
			Key:    entry.Key,
			Value:  DefaultGroup(entry.Module, entry.Key),
		})
	}
	return out
}

func cloneMap(input map[string]any) map[string]any {
	if input == nil {
		return map[string]any{}
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]any{}
	}
	if out == nil {
		return map[string]any{}
	}
	return out
}

func defaultProxyConsumerSettingsMap() map[string]any {
	return map[string]any{"items": []map[string]any{}}
}
