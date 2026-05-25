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
		ID:          "smtp",
		Title:       "SMTP",
		Description: "Reference-only entry. Create and manage SMTP connectors from Resources > Connectors.",
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
			{ID: "minFreeDiskBytes", Label: "Min Free Disk Bytes", Type: "integer", HelpText: "Block installation when available disk falls below this threshold."},
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
			{ID: "httpProxy", Label: "HTTP Proxy", Type: "string"},
			{ID: "httpsProxy", Label: "HTTPS Proxy", Type: "string"},
			{ID: "noProxy", Label: "No Proxy", Type: "string"},
			{ID: "username", Label: "Username", Type: "string"},
			{ID: "password", Label: "Password", Type: "string", Sensitive: true},
		},
	},
	{
		ID:      "docker-mirror",
		Title:   "Docker Mirrors",
			Description: "Speed up AppOS image pulls. Does not change server Docker settings.",
		Section: SectionWorkspace,
		Source:  SourceCustom,
		Module:  "docker",
		Key:     "mirror",
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
	"space/quota": {
		"maxSizeMB":             10,
		"maxPerUser":            100,
		"shareMaxMinutes":       60,
		"shareDefaultMinutes":   30,
		"maxUploadFiles":        50,
		"disallowedFolderNames": []string{},
	},
	"proxy/network": {
		"httpProxy": "", "httpsProxy": "", "noProxy": "", "username": "", "password": "",
	},
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
	"deploy/preflight": {"minFreeDiskBytes": 512 * 1024 * 1024},
	"topic/share": {
		"shareMaxMinutes":     60,
		"shareDefaultMinutes": 30,
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