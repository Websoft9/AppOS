package egress

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	"golang.org/x/net/http/httpproxy"
	netproxy "golang.org/x/net/proxy"
)

type NetworkSettings struct {
	Source            string
	Enabled           bool
	Socks5ConnectorID string
	HTTPConnectorID   string
	HTTPSConnectorID  string
}

type ConsumerEnrollment struct {
	ConsumerKey string
	Mode        Mode
}

type RemoteShellServerOverride struct {
	ServerID string
	Mode     Mode
}

type ConsumerDefinitionView struct {
	Key          string   `json:"key"`
	Title        string   `json:"title"`
	Description  string   `json:"description,omitempty"`
	Location     string   `json:"location"`
	ModuleKey    string   `json:"moduleKey,omitempty"`
	Workload     string   `json:"workload"`
	Scope        string   `json:"scope"`
	Adapter      string   `json:"adapter"`
	TrafficClass string   `json:"trafficClass"`
	Support      string   `json:"support"`
	DefaultMode  string   `json:"defaultMode"`
	AllowedModes []string `json:"allowedModes"`
	Enrollable   bool     `json:"enrollable"`
	Tags         []string `json:"tags,omitempty"`
}

type Capability string

const (
	CapabilityNone     Capability = "no_proxy_capability"
	CapabilityExternal Capability = "external_proxy_available"
	CapabilitySelf     Capability = "self_proxy_available"

	publicOutboundHTTPPolicyKey = "outbound_http.global"
)

type WarningCode string

const (
	WarningCodeProxyUnavailable WarningCode = "proxy_unavailable"
)

type Warning struct {
	Code    WarningCode `json:"code"`
	Message string      `json:"message"`
}

type Decision struct {
	Definition  Definition `json:"-"`
	ConsumerKey string     `json:"consumerKey"`
	Mode        Mode       `json:"mode"`
	Capability  Capability `json:"capability"`
	UseProxy    bool       `json:"useProxy"`
	Warnings    []Warning  `json:"warnings,omitempty"`
	Reason      string     `json:"reason,omitempty"`
}

type EnvPlan struct {
	Decision Decision          `json:"decision"`
	Env      map[string]string `json:"-"`
}

type HTTPClientPlan struct {
	Decision Decision    `json:"decision"`
	Client   http.Client `json:"-"`
}

type EffectiveDialerMode string

const (
	EffectiveDialerModeDirect   EffectiveDialerMode = "direct"
	EffectiveDialerModeExternal EffectiveDialerMode = "external_proxy"
	EffectiveDialerModeSelf     EffectiveDialerMode = "self_proxy"
)

func DefaultNetworkSettingsMap() map[string]any {
	return map[string]any{
		"source":            "none",
		"enabled":           false,
		"socks5ConnectorId": "",
		"httpConnectorId":   "",
		"httpsConnectorId":  "",
	}
}

func DefaultConsumerSettingsMap() map[string]any {
	items, err := expandConsumerEnrollmentsToStored([]ConsumerEnrollment{
		{ConsumerKey: publicOutboundHTTPPolicyKey, Mode: ModeAlways},
		{ConsumerKey: "git.global", Mode: ModeAlways},
		{ConsumerKey: "remote_shell.global", Mode: ModeAlways},
	})
	if err != nil {
		return map[string]any{"items": []map[string]any{}, "serverOverrides": []map[string]any{}}
	}
	return map[string]any{"items": serializeEnrollments(items), "serverOverrides": []map[string]any{}}
}

func DefaultRemoteShellSettingsMap() map[string]any {
	return map[string]any{"items": []map[string]any{}}
}

func LoadNetworkSettings(app core.App) NetworkSettings {
	group, _ := sysconfig.GetGroup(app, "proxy", "network", DefaultNetworkSettingsMap())
	if group == nil {
		return NetworkSettings{}
	}
	source := strings.TrimSpace(sysconfig.String(group, "source", ""))
	enabled := sysconfig.Bool(group, "enabled", false)
	socks5ConnectorID := strings.TrimSpace(sysconfig.String(group, "socks5ConnectorId", ""))
	httpConnectorID := strings.TrimSpace(sysconfig.String(group, "httpConnectorId", ""))
	httpsConnectorID := strings.TrimSpace(sysconfig.String(group, "httpsConnectorId", ""))
	if source == "" {
		switch {
		case enabled || socks5ConnectorID != "" || httpConnectorID != "" || httpsConnectorID != "":
			source = "external"
		default:
			source = "none"
		}
	}
	return NetworkSettings{
		Source:            source,
		Enabled:           enabled,
		Socks5ConnectorID: socks5ConnectorID,
		HTTPConnectorID:   httpConnectorID,
		HTTPSConnectorID:  httpsConnectorID,
	}
}

func LoadConsumerEnrollments(app core.App) ([]ConsumerEnrollment, error) {
	group, err := sysconfig.GetGroup(app, "proxy", "policies", DefaultConsumerSettingsMap())
	if err != nil && group == nil {
		return nil, err
	}
	return normalizeConsumerEnrollments(group), nil
}

func LoadRemoteShellServerOverrides(app core.App) ([]RemoteShellServerOverride, error) {
	group, err := sysconfig.GetGroup(app, "proxy", "servers", DefaultRemoteShellSettingsMap())
	if err != nil && group == nil {
		return nil, err
	}
	return normalizeRemoteShellServerOverrides(group), nil
}

func SettingsEntryValue(app core.App) (map[string]any, error) {
	definitions, err := settingsDefinitions()
	if err != nil {
		return nil, err
	}
	enrollableDefinitions, err := enrollableDefinitions()
	if err != nil {
		return nil, err
	}
	items, loadErr := LoadConsumerEnrollments(app)
	if loadErr != nil && items == nil {
		return nil, loadErr
	}
	remoteShellOverrides, remoteShellErr := LoadRemoteShellServerOverrides(app)
	if remoteShellErr != nil && remoteShellOverrides == nil {
		return nil, remoteShellErr
	}
	items = filterEnrollments(enrollableDefinitions, items)
	items = compressConsumerEnrollmentsToPublic(items)
	return map[string]any{
		"items":           serializeEnrollments(items),
		"definitions":     serializeDefinitionViews(definitions),
		"serverOverrides": serializeRemoteShellServerOverrides(remoteShellOverrides),
	}, nil
}

func NormalizeConsumerSettingsValue(value map[string]any) map[string]any {
	normalized, err := PrepareConsumerSettingsValue(value)
	if err != nil {
		return map[string]any{"items": []map[string]any{}}
	}
	return normalized
}

func PrepareConsumerSettingsValue(value map[string]any) (map[string]any, error) {
	items, err := expandConsumerEnrollmentsToStored(normalizeConsumerEnrollments(value))
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"items": serializeEnrollments(items),
	}, nil
}

func NormalizeRemoteShellSettingsValue(value map[string]any) map[string]any {
	return map[string]any{
		"items": serializeRemoteShellServerOverrides(normalizeRemoteShellServerOverrides(value)),
	}
}

func ResolvePolicyMode(app core.App, consumerKey string) (Definition, Mode, error) {
	return resolvePolicySelection(app, consumerKey, true)
}

func resolvePolicySelection(app core.App, consumerKey string, requireDirectUse bool) (Definition, Mode, error) {
	registry, err := DefaultRegistry()
	if err != nil {
		return Definition{}, ModeDisabled, err
	}
	var definition Definition
	if requireDirectUse {
		definition, err = registry.RequireDirectUse(consumerKey)
		if err != nil {
			return Definition{}, ModeDisabled, err
		}
	} else {
		definition, err = registry.Require(consumerKey)
		if err != nil {
			return Definition{}, ModeDisabled, err
		}
	}
	if !definition.Enrollable() {
		return definition, ModeDisabled, nil
	}
	items, err := LoadConsumerEnrollments(app)
	if err != nil {
		return definition, ModeDisabled, err
	}
	for _, key := range enrollmentLookupKeys(definition) {
		for _, item := range items {
			if item.ConsumerKey != key {
				continue
			}
			if definition.SupportsMode(item.Mode) {
				return definition, item.Mode, nil
			}
			return definition, ModeDisabled, nil
		}
	}
	return definition, ModeDisabled, nil
}

func ProxyEnvForConsumer(app core.App, consumerKey string) (map[string]string, error) {
	plan, err := BuildEnvPlan(app, consumerKey)
	if err != nil {
		return nil, err
	}
	return plan.Env, nil
}

func ResolveRemoteShellMode(app core.App, serverID string) (Mode, error) {
	serverID = strings.TrimSpace(serverID)
	if serverID != "" {
		overrides, err := LoadRemoteShellServerOverrides(app)
		if err != nil {
			return ModeDisabled, err
		}
		for _, item := range overrides {
			if item.ServerID == serverID {
				return item.Mode, nil
			}
		}
	}
	_, mode, err := resolvePolicySelection(app, "remote_shell.global", false)
	return mode, err
}

func ProxyEnv(app core.App) (map[string]string, error) {
	return buildProxyEnv(app, LoadNetworkSettings(app))
}

func NewHTTPClient(app core.App, consumerKey string, timeout time.Duration, skipTLSVerify bool) (http.Client, error) {
	plan, err := NewHTTPClientPlan(app, consumerKey, timeout, skipTLSVerify)
	if err != nil {
		return http.Client{}, err
	}
	return plan.Client, nil
}

func BuildEnvPlan(app core.App, consumerKey string) (EnvPlan, error) {
	definition, mode, err := resolvePolicySelection(app, consumerKey, true)
	if err != nil {
		return EnvPlan{}, err
	}
	if err := ensureAdapter(definition, AdapterEnv); err != nil {
		return EnvPlan{}, err
	}
	plan := EnvPlan{Decision: Decision{Definition: definition, ConsumerKey: definition.Key, Mode: mode, Capability: CapabilityNone}}
	if mode == ModeDisabled {
		return plan, nil
	}
	capability, env, err := resolveCapability(app)
	if err != nil {
		return EnvPlan{}, err
	}
	plan.Decision.Capability = capability
	if len(env) > 0 {
		plan.Decision.UseProxy = true
		plan.Env = env
		return plan, nil
	}
	plan.Decision.Warnings = append(plan.Decision.Warnings, proxyUnavailableWarning(definition, capability))
	plan.Decision.Reason = "configured always, but no usable env-capable proxy path is available"
	return plan, nil
}

func NewHTTPClientPlan(app core.App, consumerKey string, timeout time.Duration, skipTLSVerify bool) (HTTPClientPlan, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if skipTLSVerify {
		transport.TLSClientConfig = newSkipVerifyTLSConfig()
	}
	directTransport := transport.Clone()
	plan := HTTPClientPlan{Client: http.Client{Timeout: timeout, Transport: directTransport}}
	if app == nil {
		return plan, nil
	}
	definition, mode, err := resolvePolicySelection(app, consumerKey, true)
	if err != nil {
		return HTTPClientPlan{}, err
	}
	if err := ensureAdapter(definition, AdapterHTTPClient); err != nil {
		return HTTPClientPlan{}, err
	}
	plan.Decision = Decision{Definition: definition, ConsumerKey: definition.Key, Mode: mode, Capability: CapabilityNone}
	if mode == ModeDisabled {
		return plan, nil
	}
	capability, env, err := resolveCapability(app)
	if err != nil {
		return HTTPClientPlan{}, err
	}
	plan.Decision.Capability = capability
	if len(env) == 0 {
		plan.Decision.Warnings = append(plan.Decision.Warnings, proxyUnavailableWarning(definition, capability))
		plan.Decision.Reason = "configured always, but no usable http_client proxy path is available"
		return plan, nil
	}
	proxyTransport := transport.Clone()
	proxyTransport.ProxyConnectHeader = buildProxyConnectHeader(env)
	if dialContext := socks5DialContextFromEnv(env); dialContext != nil {
		proxyTransport.Proxy = nil
		proxyTransport.DialContext = dialContext
	} else if proxyFunc := proxyFuncFromEnv(env); proxyFunc != nil {
		proxyTransport.Proxy = proxyFunc
	}
	plan.Decision.UseProxy = true
	plan.Client = http.Client{Timeout: timeout, Transport: proxyTransport}
	return plan, nil
}

func NewTunnelHTTPClientPlan(app core.App, consumerKey string, timeout time.Duration, skipTLSVerify bool) (HTTPClientPlan, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if skipTLSVerify {
		transport.TLSClientConfig = newSkipVerifyTLSConfig()
	}
	directTransport := transport.Clone()
	plan := HTTPClientPlan{Client: http.Client{Timeout: timeout, Transport: directTransport}}
	if app == nil {
		return plan, nil
	}
	decision, dialerMode, env, err := resolveTunnelDecision(app, consumerKey, AdapterHTTPClient)
	if err != nil {
		return HTTPClientPlan{}, err
	}
	plan.Decision = decision
	if decision.Mode == ModeDisabled {
		return plan, nil
	}
	if dialerMode == EffectiveDialerModeExternal {
		proxyTransport := transport.Clone()
		proxyTransport.ProxyConnectHeader = buildProxyConnectHeader(env)
		if dialContext := socks5DialContextFromEnv(env); dialContext != nil {
			proxyTransport.Proxy = nil
			proxyTransport.DialContext = dialContext
		} else if proxyFunc := proxyFuncFromEnv(env); proxyFunc != nil {
			proxyTransport.Proxy = proxyFunc
		}
		plan.Client = http.Client{Timeout: timeout, Transport: proxyTransport}
	}
	return plan, nil
}

func WarningMessages(warnings []Warning) []string {
	if len(warnings) == 0 {
		return nil
	}
	items := make([]string, 0, len(warnings))
	for _, warning := range warnings {
		if strings.TrimSpace(warning.Message) == "" {
			continue
		}
		items = append(items, warning.Message)
	}
	return items
}

func resolveTunnelDecision(app core.App, consumerKey string, expected Adapter) (Decision, EffectiveDialerMode, map[string]string, error) {
	definition, mode, err := resolvePolicySelection(app, consumerKey, true)
	if err != nil {
		return Decision{}, EffectiveDialerModeDirect, nil, err
	}
	if err := ensureAdapter(definition, expected); err != nil {
		return Decision{}, EffectiveDialerModeDirect, nil, err
	}
	decision := Decision{Definition: definition, ConsumerKey: definition.Key, Mode: mode, Capability: CapabilityNone}
	if mode == ModeDisabled {
		return decision, EffectiveDialerModeDirect, nil, nil
	}
	network := LoadNetworkSettings(app)
	switch strings.TrimSpace(network.Source) {
	case "external":
		env, envErr := buildProxyEnv(app, network)
		if envErr != nil {
			return Decision{}, EffectiveDialerModeDirect, nil, envErr
		}
		decision.Capability = CapabilityExternal
		if len(env) == 0 {
			decision.Capability = CapabilityNone
			decision.Warnings = append(decision.Warnings, proxyUnavailableWarning(definition, decision.Capability))
			decision.Reason = "configured always, but no usable external tunnel proxy path is available"
			return decision, EffectiveDialerModeDirect, nil, nil
		}
		decision.UseProxy = true
		return decision, EffectiveDialerModeExternal, env, nil
	case "self":
		decision.Capability = CapabilitySelf
		decision.Reason = "self-managed AppOS tunnel egress uses AppOS-side direct dialing"
		return decision, EffectiveDialerModeSelf, nil, nil
	default:
		decision.Warnings = append(decision.Warnings, proxyUnavailableWarning(definition, CapabilityNone))
		decision.Reason = "configured always, but no tunnel proxy capability is available"
		return decision, EffectiveDialerModeDirect, nil, nil
	}
}

func enrollmentLookupKeys(definition Definition) []string {
	keys := []string{definition.Key}
	if definition.Scope == ScopeAction && strings.TrimSpace(definition.ModuleKey) != "" {
		keys = append(keys, definition.ModuleKey)
	}
	return keys
}

func ensureAdapter(definition Definition, expected Adapter) error {
	if definition.Adapter == expected {
		return nil
	}
	return fmt.Errorf("proxy consumer %q uses adapter %q, not %q", definition.Key, definition.Adapter, expected)
}

func ValidateConsumerEnrollment(definition Definition, item ConsumerEnrollment) error {
	if item.ConsumerKey != definition.Key {
		return fmt.Errorf("consumer key mismatch: %s", item.ConsumerKey)
	}
	if !definition.Enrollable() {
		return fmt.Errorf("proxy consumer %q is bypass-only and cannot be enrolled", definition.Key)
	}
	if !definition.SupportsMode(item.Mode) {
		return fmt.Errorf("proxy consumer %q does not support mode %q", definition.Key, item.Mode)
	}
	return nil
}

func enrollableDefinitions() ([]Definition, error) {
	registry, err := DefaultRegistry()
	if err != nil {
		return nil, err
	}
	return registry.Enrollable(), nil
}

func settingsDefinitions() ([]Definition, error) {
	return publicPolicyDefinitions(), nil
}

func publicPolicyDefinitions() []Definition {
	return []Definition{
		{
			Key:            publicOutboundHTTPPolicyKey,
			Title:          "Outbound HTTP",
			Description:    "AppOS web APIs, AI requests, and download traffic.",
			Location:       LocationLocal,
			Scope:          ScopeModule,
			AllowDirectUse: false,
			Adapter:        AdapterHTTPClient,
			TrafficClass:   TrafficClassPublicEgress,
			Support:        SupportProxyCapable,
			DefaultMode:    ModeAlways,
			Tags:           []string{"http", "download", "local", "policy"},
		},
		{
			Key:            "git.global",
			Title:          "Git",
			Description:    "Git clone, fetch, and remote inspection workflows.",
			Location:       LocationLocal,
			Scope:          ScopeModule,
			AllowDirectUse: false,
			Adapter:        AdapterEnv,
			TrafficClass:   TrafficClassPublicEgress,
			Support:        SupportProxyCapable,
			DefaultMode:    ModeAlways,
			Tags:           []string{"git", "local", "policy", "subprocess"},
		},
		{
			Key:            "remote_shell.global",
			Title:          "Remote Shell",
			Description:    "Remote shell commands and reverse-tunnel shell egress.",
			Location:       LocationRemote,
			Scope:          ScopeModule,
			AllowDirectUse: false,
			Adapter:        AdapterEnv,
			TrafficClass:   TrafficClassPublicEgress,
			Support:        SupportProxyCapable,
			DefaultMode:    ModeAlways,
			Tags:           []string{"remote", "shell", "policy"},
		},
	}
}

func publicPolicyStorageKeys(policyKey string) []string {
	switch strings.TrimSpace(policyKey) {
	case publicOutboundHTTPPolicyKey:
		return []string{"http.global", "download.global"}
	case "git.global":
		return []string{"git.global"}
	case "remote_shell.global":
		return []string{"remote_shell.global"}
	default:
		return nil
	}
}

func canonicalPublicPolicyKey(consumerKey string) string {
	switch strings.TrimSpace(consumerKey) {
	case publicOutboundHTTPPolicyKey, "http.global", "http.general", "http.ai", "download.global", "download.general":
		return publicOutboundHTTPPolicyKey
	case "git.global", "git.general":
		return "git.global"
	case "remote_shell.global", "remote_shell.env", "remote_shell.tunnel_http", "remote_shell.tunnel_dialer":
		return "remote_shell.global"
	default:
		return ""
	}
}

func publicPolicyDefinitionMap() map[string]Definition {
	definitions := publicPolicyDefinitions()
	items := make(map[string]Definition, len(definitions))
	for _, definition := range definitions {
		items[definition.Key] = definition
	}
	return items
}

func compressConsumerEnrollmentsToPublic(items []ConsumerEnrollment) []ConsumerEnrollment {
	definitions := publicPolicyDefinitions()
	if len(definitions) == 0 {
		return nil
	}
	out := make([]ConsumerEnrollment, 0, len(definitions))
	for _, definition := range definitions {
		out = append(out, ConsumerEnrollment{
			ConsumerKey: definition.Key,
			Mode:        resolveCompressedPolicyMode(definition.Key, definition.DefaultMode, items),
		})
	}
	return out
}

func resolveCompressedPolicyMode(policyKey string, defaultMode Mode, items []ConsumerEnrollment) Mode {
	mode := defaultMode
	seenExplicit := false
	for _, item := range items {
		if canonicalPublicPolicyKey(item.ConsumerKey) != policyKey {
			continue
		}
		seenExplicit = true
		if item.Mode == ModeAlways {
			return ModeAlways
		}
		mode = item.Mode
	}
	if seenExplicit {
		return mode
	}
	return defaultMode
}

func expandConsumerEnrollmentsToStored(items []ConsumerEnrollment) ([]ConsumerEnrollment, error) {
	definitions := publicPolicyDefinitionMap()
	canonicalItems := make([]ConsumerEnrollment, 0, len(items))
	seen := map[string]struct{}{}
	for _, item := range items {
		canonicalKey := canonicalPublicPolicyKey(item.ConsumerKey)
		if canonicalKey == "" {
			return nil, fmt.Errorf("policy %q is not a valid proxy policy", item.ConsumerKey)
		}
		if _, exists := seen[canonicalKey]; exists {
			return nil, fmt.Errorf("policy %q is duplicated", canonicalKey)
		}
		definition := definitions[canonicalKey]
		if !definition.SupportsMode(item.Mode) {
			return nil, fmt.Errorf("proxy policy %q does not support mode %q", canonicalKey, item.Mode)
		}
		seen[canonicalKey] = struct{}{}
		canonicalItems = append(canonicalItems, ConsumerEnrollment{ConsumerKey: canonicalKey, Mode: item.Mode})
	}

	out := make([]ConsumerEnrollment, 0, len(canonicalItems)*2)
	for _, item := range canonicalItems {
		for _, storageKey := range publicPolicyStorageKeys(item.ConsumerKey) {
			out = append(out, ConsumerEnrollment{ConsumerKey: storageKey, Mode: item.Mode})
		}
	}
	return out, nil
}

func buildProxyEnv(app core.App, network NetworkSettings) (map[string]string, error) {
	if network.Source != "external" || !network.Enabled {
		return nil, nil
	}
	return connectors.BuildProxyEnvWith(
		newConnectorRepository(app),
		connectors.NewSecretResolver(app),
		network.Enabled,
		network.Socks5ConnectorID,
		network.HTTPConnectorID,
		network.HTTPSConnectorID,
	)
}

func resolveCapability(app core.App) (Capability, map[string]string, error) {
	network := LoadNetworkSettings(app)
	switch strings.TrimSpace(network.Source) {
	case "external":
		env, err := buildProxyEnv(app, network)
		if err != nil {
			return CapabilityNone, nil, err
		}
		if len(env) == 0 {
			return CapabilityNone, nil, nil
		}
		return CapabilityExternal, env, nil
	case "self":
		return CapabilitySelf, nil, nil
	default:
		return CapabilityNone, nil, nil
	}
}

func proxyUnavailableWarning(definition Definition, capability Capability) Warning {
	message := fmt.Sprintf("Proxy consumer %q is configured for always, but AppOS has no usable proxy capability for adapter %q. Continuing direct.", definition.Key, definition.Adapter)
	if capability == CapabilitySelf {
		message = fmt.Sprintf("Proxy consumer %q is configured for always, but source=self does not provide a usable proxy path for adapter %q. Continuing direct.", definition.Key, definition.Adapter)
	}
	return Warning{Code: WarningCodeProxyUnavailable, Message: message}
}

func normalizeConsumerEnrollments(group map[string]any) []ConsumerEnrollment {
	if group == nil {
		return nil
	}
	rawItems, ok := group["items"]
	if !ok || rawItems == nil {
		return nil
	}
	list, ok := rawItems.([]any)
	if !ok {
		typed, typedOK := rawItems.([]map[string]any)
		if !typedOK {
			return nil
		}
		list = make([]any, 0, len(typed))
		for _, item := range typed {
			list = append(list, item)
		}
	}
	items := make([]ConsumerEnrollment, 0, len(list))
	seen := map[string]struct{}{}
	for _, rawItem := range list {
		item, ok := rawItem.(map[string]any)
		if !ok {
			continue
		}
		consumerKey := strings.TrimSpace(sysconfig.String(item, "consumerKey", ""))
		mode := Mode(strings.TrimSpace(sysconfig.String(item, "mode", "")))
		if consumerKey == "" || mode == "" {
			continue
		}
		if _, exists := seen[consumerKey]; exists {
			continue
		}
		seen[consumerKey] = struct{}{}
		items = append(items, ConsumerEnrollment{ConsumerKey: consumerKey, Mode: mode})
	}
	return items
}

func normalizeRemoteShellServerOverrides(group map[string]any) []RemoteShellServerOverride {
	if group == nil {
		return nil
	}
	rawItems, ok := group["items"]
	if !ok || rawItems == nil {
		return nil
	}
	list, ok := rawItems.([]any)
	if !ok {
		typed, typedOK := rawItems.([]map[string]any)
		if !typedOK {
			return nil
		}
		list = make([]any, 0, len(typed))
		for _, item := range typed {
			list = append(list, item)
		}
	}
	items := make([]RemoteShellServerOverride, 0, len(list))
	seen := map[string]struct{}{}
	for _, rawItem := range list {
		item, ok := rawItem.(map[string]any)
		if !ok {
			continue
		}
		serverID := strings.TrimSpace(sysconfig.String(item, "serverId", ""))
		mode := Mode(strings.TrimSpace(sysconfig.String(item, "mode", "")))
		if serverID == "" || mode == "" {
			continue
		}
		if _, exists := seen[serverID]; exists {
			continue
		}
		seen[serverID] = struct{}{}
		items = append(items, RemoteShellServerOverride{ServerID: serverID, Mode: mode})
	}
	return items
}

func serializeEnrollments(items []ConsumerEnrollment) []map[string]any {
	if len(items) == 0 {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, map[string]any{
			"consumerKey": item.ConsumerKey,
			"mode":        string(item.Mode),
		})
	}
	return out
}

func serializeRemoteShellServerOverrides(items []RemoteShellServerOverride) []map[string]any {
	if len(items) == 0 {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, map[string]any{
			"serverId": item.ServerID,
			"mode":     string(item.Mode),
		})
	}
	return out
}

func serializeDefinitionViews(definitions []Definition) []ConsumerDefinitionView {
	out := make([]ConsumerDefinitionView, 0, len(definitions))
	for _, definition := range definitions {
		allowedModes := definition.AllowedModes()
		serializedModes := make([]string, 0, len(allowedModes))
		for _, mode := range allowedModes {
			serializedModes = append(serializedModes, string(mode))
		}
		out = append(out, ConsumerDefinitionView{
			Key:          definition.Key,
			Title:        definition.Title,
			Description:  definition.Description,
			Location:     string(definition.Location),
			ModuleKey:    definition.ModuleKey,
			Workload:     string(definition.Workload),
			Scope:        string(definition.Scope),
			Adapter:      string(definition.Adapter),
			TrafficClass: string(definition.TrafficClass),
			Support:      string(definition.Support),
			DefaultMode:  string(definition.DefaultMode),
			AllowedModes: serializedModes,
			Enrollable:   definition.Enrollable(),
			Tags:         append([]string(nil), definition.Tags...),
		})
	}
	return out
}

func filterEnrollments(definitions []Definition, items []ConsumerEnrollment) []ConsumerEnrollment {
	if len(definitions) == 0 || len(items) == 0 {
		return items
	}
	allowed := make(map[string]struct{}, len(definitions))
	for _, definition := range definitions {
		allowed[definition.Key] = struct{}{}
	}
	filtered := make([]ConsumerEnrollment, 0, len(items))
	for _, item := range items {
		if _, ok := allowed[item.ConsumerKey]; ok {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func socks5DialContextFromEnv(proxyEnv map[string]string) func(ctx context.Context, network, address string) (net.Conn, error) {
	proxyAddress := firstNonEmptyString(
		proxyEnv["ALL_PROXY"],
		proxyEnv["all_proxy"],
		proxyEnv["HTTP_PROXY"],
		proxyEnv["http_proxy"],
		proxyEnv["HTTPS_PROXY"],
		proxyEnv["https_proxy"],
	)
	if proxyAddress == "" {
		return nil
	}
	proxyURL, err := url.Parse(proxyAddress)
	if err != nil {
		return nil
	}
	if proxyURL.Scheme != "socks5" && proxyURL.Scheme != "socks5h" {
		return nil
	}
	dialer, err := netproxy.FromURL(proxyURL, netproxy.Direct)
	if err != nil {
		return nil
	}
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		return dialer.Dial(network, address)
	}
}

func proxyFuncFromEnv(proxyEnv map[string]string) func(*http.Request) (*url.URL, error) {
	if len(proxyEnv) == 0 {
		return http.ProxyFromEnvironment
	}
	httpProxy := firstNonEmptyString(proxyEnv["HTTP_PROXY"], proxyEnv["http_proxy"], proxyEnv["ALL_PROXY"], proxyEnv["all_proxy"])
	httpsProxy := firstNonEmptyString(proxyEnv["HTTPS_PROXY"], proxyEnv["https_proxy"], proxyEnv["ALL_PROXY"], proxyEnv["all_proxy"])
	noProxy := firstNonEmptyString(proxyEnv["NO_PROXY"], proxyEnv["no_proxy"])
	proxyFunc := (&httpproxy.Config{HTTPProxy: httpProxy, HTTPSProxy: httpsProxy, NoProxy: noProxy}).ProxyFunc()
	return func(req *http.Request) (*url.URL, error) {
		proxyURL, err := proxyFunc(req.URL)
		if err != nil || proxyURL == nil {
			return nil, err
		}
		return proxyURL, nil
	}
}

func buildProxyConnectHeader(proxyEnv map[string]string) http.Header {
	headerValue := firstNonEmptyString(
		proxyEnv["APPOS_HTTPS_PROXY_AUTHORIZATION"],
		proxyEnv["APPOS_HTTP_PROXY_AUTHORIZATION"],
		proxyEnv["APPOS_PROXY_AUTHORIZATION"],
	)
	if strings.TrimSpace(headerValue) == "" {
		return nil
	}
	headers := make(http.Header)
	headers.Set("Proxy-Authorization", strings.TrimSpace(headerValue))
	return headers
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}
