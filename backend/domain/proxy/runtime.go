package proxy

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	proxyinfra "github.com/websoft9/appos/backend/infra/proxy"
	netproxy "golang.org/x/net/proxy"
	"golang.org/x/net/http/httpproxy"
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
	Mode        proxyinfra.Mode
}

type RemoteShellServerOverride struct {
	ServerID string
	Mode     proxyinfra.Mode
}

type ConsumerDefinitionView struct {
	Key          string   `json:"key"`
	Title        string   `json:"title"`
	Description  string   `json:"description,omitempty"`
	Location     string   `json:"location"`
	ModuleKey    string   `json:"moduleKey,omitempty"`
	Scope        string   `json:"scope"`
	Adapter      string   `json:"adapter"`
	TrafficClass string   `json:"trafficClass"`
	Support      string   `json:"support"`
	DefaultMode  string   `json:"defaultMode"`
	AllowedModes []string `json:"allowedModes"`
	Enrollable   bool     `json:"enrollable"`
	Tags         []string `json:"tags,omitempty"`
}

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
	items := make([]map[string]any, 0)
	definitions, err := directUseDefinitions()
	if err == nil {
		for _, definition := range definitions {
			if !definition.Enrollable() {
				continue
			}
			items = append(items, map[string]any{
				"consumerKey": definition.Key,
				"mode":        string(definition.DefaultMode),
			})
		}
	}
	return map[string]any{"items": items}
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
	enrollableDefinitions, err := directUseDefinitions()
	if err != nil {
		return nil, err
	}
	items, loadErr := LoadConsumerEnrollments(app)
	if loadErr != nil && items == nil {
		return nil, loadErr
	}
	items = filterEnrollments(enrollableDefinitions, items)
	return map[string]any{
		"items":       serializeEnrollments(items),
		"definitions": serializeDefinitionViews(definitions),
	}, nil
}

func NormalizeConsumerSettingsValue(value map[string]any) map[string]any {
	return map[string]any{
		"items": serializeEnrollments(normalizeConsumerEnrollments(value)),
	}
}

func NormalizeRemoteShellSettingsValue(value map[string]any) map[string]any {
	return map[string]any{
		"items": serializeRemoteShellServerOverrides(normalizeRemoteShellServerOverrides(value)),
	}
}

func ResolvePolicyMode(app core.App, consumerKey string) (proxyinfra.Definition, proxyinfra.Mode, error) {
	registry, err := DefaultRegistry()
	if err != nil {
		return proxyinfra.Definition{}, proxyinfra.ModeDisabled, err
	}
	definition, err := registry.RequireDirectUse(consumerKey)
	if err != nil {
		return proxyinfra.Definition{}, proxyinfra.ModeDisabled, err
	}
	if !definition.Enrollable() {
		return definition, proxyinfra.ModeDisabled, nil
	}
	network := LoadNetworkSettings(app)
	if !proxySourceActive(network.Source) {
		return definition, proxyinfra.ModeDisabled, nil
	}
	items, err := LoadConsumerEnrollments(app)
	if err != nil {
		return definition, proxyinfra.ModeDisabled, err
	}
	for _, item := range items {
		if item.ConsumerKey != definition.Key {
			continue
		}
		if definition.SupportsMode(item.Mode) {
			return definition, item.Mode, nil
		}
		return definition, proxyinfra.ModeDisabled, nil
	}
	return definition, proxyinfra.ModeDisabled, nil
}

func ProxyEnvForConsumer(app core.App, consumerKey string) (map[string]string, error) {
	_, mode, err := ResolvePolicyMode(app, consumerKey)
	if err != nil {
		return nil, err
	}
	if mode == proxyinfra.ModeDisabled {
		return nil, nil
	}
	return ProxyEnv(app)
}

func ResolveRemoteShellMode(app core.App, serverID string) (proxyinfra.Mode, error) {
	serverID = strings.TrimSpace(serverID)
	if serverID != "" {
		overrides, err := LoadRemoteShellServerOverrides(app)
		if err != nil {
			return proxyinfra.ModeDisabled, err
		}
		for _, item := range overrides {
			if item.ServerID == serverID {
				return item.Mode, nil
			}
		}
	}
	_, mode, err := ResolvePolicyMode(app, "remote_shell.global")
	return mode, err
}

func ProxyEnvForRemoteShellServer(app core.App, serverID string) (map[string]string, error) {
	mode, err := ResolveRemoteShellMode(app, serverID)
	if err != nil {
		return nil, err
	}
	if mode == proxyinfra.ModeDisabled {
		return nil, nil
	}
	return ProxyEnv(app)
}

func ProxyEnv(app core.App) (map[string]string, error) {
	return buildProxyEnv(app, LoadNetworkSettings(app))
}

func NewHTTPClient(app core.App, consumerKey string, timeout time.Duration, skipTLSVerify bool) (http.Client, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if skipTLSVerify {
		// #nosec G402 -- caller explicitly opts into skipping TLS verification for trusted/self-hosted endpoints.
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	directTransport := transport.Clone()
	if app == nil {
		return http.Client{Timeout: timeout, Transport: directTransport}, nil
	}
	_, mode, err := ResolvePolicyMode(app, consumerKey)
	if err != nil {
		return http.Client{}, err
	}
	if mode == proxyinfra.ModeDisabled {
		return http.Client{Timeout: timeout, Transport: directTransport}, nil
	}
	env, err := buildProxyEnv(app, LoadNetworkSettings(app))
	if err != nil || len(env) == 0 {
		return http.Client{Timeout: timeout, Transport: directTransport}, err
	}
	proxyTransport := transport.Clone()
	if dialContext := socks5DialContextFromEnv(env); dialContext != nil {
		proxyTransport.Proxy = nil
		proxyTransport.DialContext = dialContext
	} else if proxyFunc := proxyFuncFromEnv(env); proxyFunc != nil {
		proxyTransport.Proxy = proxyFunc
	}
	return http.Client{Timeout: timeout, Transport: proxyTransport}, nil
}

func ValidateConsumerEnrollment(definition proxyinfra.Definition, item ConsumerEnrollment) error {
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

func directUseDefinitions() ([]proxyinfra.Definition, error) {
	registry, err := DefaultRegistry()
	if err != nil {
		return nil, err
	}
	return registry.DirectUse(), nil
}

func settingsDefinitions() ([]proxyinfra.Definition, error) {
	registry, err := DefaultRegistry()
	if err != nil {
		return nil, err
	}
	return registry.DirectUse(), nil
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

func proxySourceActive(source string) bool {
	switch strings.TrimSpace(source) {
	case "external", "self":
		return true
	default:
		return false
	}
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
		mode := proxyinfra.Mode(strings.TrimSpace(sysconfig.String(item, "mode", "")))
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
		mode := proxyinfra.Mode(strings.TrimSpace(sysconfig.String(item, "mode", "")))
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

func serializeDefinitionViews(definitions []proxyinfra.Definition) []ConsumerDefinitionView {
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

func filterEnrollments(definitions []proxyinfra.Definition, items []ConsumerEnrollment) []ConsumerEnrollment {
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

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

