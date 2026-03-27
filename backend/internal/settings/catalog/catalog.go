package catalog

import (
	"encoding/json"
)

const (
	SectionSystem    = "system"
	SectionWorkspace = "workspace"

	SourcePocketBase = "pocketbase"
	SourceApp        = "app_settings"
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
	ID      string        `json:"id"`
	Title   string        `json:"title"`
	Section string        `json:"section"`
	Source  string        `json:"source"`
	Fields  []FieldSchema `json:"fields"`
	Actions []string      `json:"actions,omitempty"`

	PocketBaseGroup string `json:"-"`
	Module          string `json:"-"`
	Key             string `json:"-"`
}

type AppSettingSeedRow struct {
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
		Source:  SourcePocketBase,
		Fields: []FieldSchema{
			{ID: "appName", Label: "App Name", Type: "string"},
			{ID: "appURL", Label: "App URL", Type: "url"},
		},
		PocketBaseGroup: "meta",
	},
	{
		ID:      "smtp",
		Title:   "SMTP",
		Section: SectionSystem,
		Source:  SourcePocketBase,
		Actions: []string{"test-email"},
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
		Source:  SourcePocketBase,
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
		Source:  SourcePocketBase,
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
		Source:  SourceApp,
		Module:  "secrets",
		Key:     "policy",
		Fields: []FieldSchema{
			{ID: "revealDisabled", Label: "Disable Reveal", Type: "boolean"},
			{ID: "defaultAccessMode", Label: "Default Access Mode", Type: "string"},
			{ID: "clipboardClearSeconds", Label: "Clipboard Clear Seconds", Type: "integer"},
		},
	},
	{
		ID:      "space-quota",
		Title:   "Space Quota",
		Section: SectionWorkspace,
		Source:  SourceApp,
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
		Source:  SourceApp,
		Module:  "connect",
		Key:     "terminal",
		Fields: []FieldSchema{
			{ID: "idleTimeoutSeconds", Label: "Idle Timeout Seconds", Type: "integer"},
			{ID: "maxConnections", Label: "Max Connections", Type: "integer", HelpText: "0 means unlimited"},
		},
	},
	{
		ID:      "deploy-preflight",
		Title:   "Deploy Preflight",
		Section: SectionWorkspace,
		Source:  SourceApp,
		Module:  "deploy",
		Key:     "preflight",
		Fields: []FieldSchema{
			{ID: "minFreeDiskBytes", Label: "Min Free Disk Bytes", Type: "integer"},
		},
	},
	{
		ID:      "iac-files",
		Title:   "IaC Files",
		Section: SectionWorkspace,
		Source:  SourceApp,
		Module:  "files",
		Key:     "limits",
		Fields: []FieldSchema{
			{ID: "maxSizeMB", Label: "Max File Size MB", Type: "integer"},
			{ID: "maxZipSizeMB", Label: "Max ZIP Size MB", Type: "integer"},
			{ID: "extensionBlacklist", Label: "Extension Blacklist", Type: "string"},
		},
	},
	{
		ID:      "tunnel-port-range",
		Title:   "Tunnel",
		Section: SectionWorkspace,
		Source:  SourceApp,
		Module:  "tunnel",
		Key:     "port_range",
		Fields: []FieldSchema{
			{ID: "start", Label: "Start", Type: "integer"},
			{ID: "end", Label: "End", Type: "integer"},
		},
	},
	{
		ID:      "proxy-network",
		Title:   "Proxy",
		Section: SectionWorkspace,
		Source:  SourceApp,
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
		Section: SectionWorkspace,
		Source:  SourceApp,
		Module:  "docker",
		Key:     "mirror",
		Fields: []FieldSchema{
			{ID: "mirrors", Label: "Mirrors", Type: "string-list"},
			{ID: "insecureRegistries", Label: "Insecure Registries", Type: "string-list"},
		},
	},
	{
		ID:      "docker-registries",
		Title:   "Docker Registries",
		Section: SectionWorkspace,
		Source:  SourceApp,
		Module:  "docker",
		Key:     "registries",
		Fields:  []FieldSchema{{ID: "items", Label: "Items", Type: "object-list"}},
	},
	{
		ID:      "llm-providers",
		Title:   "LLM Providers",
		Section: SectionWorkspace,
		Source:  SourceApp,
		Module:  "llm",
		Key:     "providers",
		Fields:  []FieldSchema{{ID: "items", Label: "Items", Type: "object-list"}},
	},
}

var appSettingDefaults = map[string]map[string]any{
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
		"mirrors": []any{}, "insecureRegistries": []any{},
	},
	"docker/registries": {"items": []any{}},
	"llm/providers":     {"items": []any{}},
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
	return cloneMap(appSettingDefaults[module+"/"+key])
}

func SeedRows() []AppSettingSeedRow {
	keys := []struct {
		module string
		key    string
	}{
		{module: "space", key: "quota"},
		{module: "proxy", key: "network"},
		{module: "docker", key: "mirror"},
		{module: "docker", key: "registries"},
		{module: "llm", key: "providers"},
		{module: "connect", key: "sftp"},
		{module: "connect", key: "terminal"},
		{module: "files", key: "limits"},
		{module: "tunnel", key: "port_range"},
		{module: "secrets", key: "policy"},
		{module: "deploy", key: "preflight"},
	}
	out := make([]AppSettingSeedRow, 0, len(keys))
	for _, item := range keys {
		out = append(out, AppSettingSeedRow{
			Module: item.module,
			Key:    item.key,
			Value:  DefaultGroup(item.module, item.key),
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
	var output map[string]any
	if err := json.Unmarshal(raw, &output); err != nil {
		return map[string]any{}
	}
	if output == nil {
		return map[string]any{}
	}
	return output
}
