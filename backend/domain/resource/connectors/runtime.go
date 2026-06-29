package connectors

import (
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/secrets"
)

type ResolvedSecret struct {
	TemplateID string
	Payload    map[string]any
}

type SMTPConfig struct {
	ConnectorID string
	Name        string
	TemplateID  string
	Endpoint    string
	Host        string
	Port        int
	Username    string
	Password    string
	FromAddress string
	AuthScheme  string
	LocalName   string
	TLS         bool
	ImplicitTLS bool
}

type RegistryConfig struct {
	ConnectorID string
	Name        string
	TemplateID  string
	Endpoint    string
	Host        string
	Username    string
	Password    string
	Namespace   string
	Insecure    bool
	AuthScheme  string
}

type ProxyConfig struct {
	ConnectorID string
	Name        string
	TemplateID  string
	Endpoint    string
	Scheme      string
	Host        string
	Port        int
	Username    string
	Password    string
	NoProxy     string
	AuthScheme  string
}

type SecretResolver func(secretID string) (*ResolvedSecret, error)

type SecretResolvePort interface {
	Resolve(secretID string) (*ResolvedSecret, error)
}

type secretResolverFunc func(secretID string) (*ResolvedSecret, error)

func (fn secretResolverFunc) Resolve(secretID string) (*ResolvedSecret, error) {
	return fn(secretID)
}

func ResolveSecret(app core.App, secretID string) (*ResolvedSecret, error) {
	secretID = strings.TrimSpace(secretID)
	if secretID == "" {
		return nil, nil
	}

	resolved, err := secrets.Resolve(app, secretID, "system")
	if err != nil {
		return nil, err
	}

	return &ResolvedSecret{
		TemplateID: resolved.TemplateID,
		Payload:    resolved.Payload,
	}, nil
}

func NewSecretResolver(app core.App) SecretResolvePort {
	return secretResolverFunc(func(secretID string) (*ResolvedSecret, error) {
		return ResolveSecret(app, secretID)
	})
}

func LoadSMTPWith(repo Repository, secrets SecretResolvePort) (*SMTPConfig, error) {
	items, err := repo.ListByKind(KindSMTP)
	if err != nil {
		return nil, err
	}
	item, err := selectDefaultConnector(items, KindSMTP)
	if err != nil {
		return nil, err
	}
	return smtpConfigFromConnector(secrets, item)
}

func ListRegistryWith(repo Repository, secrets SecretResolvePort) ([]RegistryConfig, error) {
	items, err := repo.ListByKind(KindRegistry)
	if err != nil {
		return nil, err
	}

	result := make([]RegistryConfig, 0, len(items))
	for _, item := range items {
		cfg, err := registryConfigFromConnector(secrets, item)
		if err != nil {
			return nil, err
		}
		result = append(result, *cfg)
	}
	return result, nil
}

func LoadProxyByIDWith(repo Repository, secrets SecretResolvePort, connectorID string) (*ProxyConfig, error) {
	connectorID = strings.TrimSpace(connectorID)
	if connectorID == "" {
		return nil, &RuntimeConfigError{Kind: KindProxy, Reason: RuntimeReasonNoConnectorConfigured}
	}
	item, err := repo.Get(connectorID)
	if err != nil {
		return nil, err
	}
	if item.Kind() != KindProxy {
		return nil, fmt.Errorf("connector %q is not a proxy connector", connectorID)
	}
	return proxyConfigFromConnector(secrets, item)
}

func BuildProxyEnvWith(repo Repository, secrets SecretResolvePort, enabled bool, socks5ConnectorID, httpConnectorID, httpsConnectorID string) (map[string]string, error) {
	if !enabled {
		return nil, nil
	}
	socks5ConnectorID = strings.TrimSpace(socks5ConnectorID)
	httpConnectorID = strings.TrimSpace(httpConnectorID)
	httpsConnectorID = strings.TrimSpace(httpsConnectorID)
	if socks5ConnectorID == "" && httpConnectorID == "" && httpsConnectorID == "" {
		return nil, nil
	}

	loaded := map[string]*ProxyConfig{}
	load := func(connectorID string) (*ProxyConfig, error) {
		if connectorID == "" {
			return nil, nil
		}
		if cfg, ok := loaded[connectorID]; ok {
			return cfg, nil
		}
		cfg, err := LoadProxyByIDWith(repo, secrets, connectorID)
		if err != nil {
			return nil, err
		}
		loaded[connectorID] = cfg
		return cfg, nil
	}

	if socks5ConnectorID != "" {
		socks5Cfg, err := load(socks5ConnectorID)
		if err != nil {
			return nil, err
		}
		if socks5Cfg == nil {
			return nil, nil
		}
		socks5Proxy := ProxyURLWithCredentials(socks5Cfg.Endpoint, socks5Cfg.Username, socks5Cfg.Password)
		if socks5Proxy == "" {
			return nil, nil
		}
		env := map[string]string{
			"ALL_PROXY":   socks5Proxy,
			"all_proxy":   socks5Proxy,
			"HTTP_PROXY":  socks5Proxy,
			"http_proxy":  socks5Proxy,
			"HTTPS_PROXY": socks5Proxy,
			"https_proxy": socks5Proxy,
		}
		noProxy := mergeNoProxyValues(socks5Cfg)
		if noProxy != "" {
			env["NO_PROXY"] = noProxy
			env["no_proxy"] = noProxy
		}
		return env, nil
	}

	httpCfg, err := load(httpConnectorID)
	if err != nil {
		return nil, err
	}
	httpsCfg, err := load(httpsConnectorID)
	if err != nil {
		return nil, err
	}

	env := map[string]string{}
	if httpCfg != nil {
		httpProxy := ProxyURLWithCredentials(httpCfg.Endpoint, httpCfg.Username, httpCfg.Password)
		if httpProxy != "" {
			env["HTTP_PROXY"] = httpProxy
			env["http_proxy"] = httpProxy
		}
	}
	if httpsCfg != nil {
		httpsProxy := ProxyURLWithCredentials(httpsCfg.Endpoint, httpsCfg.Username, httpsCfg.Password)
		if httpsProxy != "" {
			env["HTTPS_PROXY"] = httpsProxy
			env["https_proxy"] = httpsProxy
		}
	}
	noProxy := mergeNoProxyValues(httpCfg, httpsCfg)
	if noProxy != "" {
		env["NO_PROXY"] = noProxy
		env["no_proxy"] = noProxy
	}
	if len(env) == 0 {
		return nil, nil
	}
	return env, nil
}

func selectDefaultConnector(items []*Connector, kind string) (*Connector, error) {
	if len(items) == 0 {
		return nil, &RuntimeConfigError{Kind: kind, Reason: RuntimeReasonNoConnectorConfigured}
	}
	return earliestCreatedConnector(items), nil
}

func earliestCreatedConnector(items []*Connector) *Connector {
	if len(items) == 0 {
		return nil
	}
	candidates := append([]*Connector(nil), items...)
	sort.SliceStable(candidates, func(i, j int) bool {
		leftCreated := strings.TrimSpace(candidates[i].Created())
		rightCreated := strings.TrimSpace(candidates[j].Created())
		switch {
		case leftCreated == "" && rightCreated != "":
			return false
		case leftCreated != "" && rightCreated == "":
			return true
		case leftCreated != rightCreated:
			return leftCreated < rightCreated
		}

		leftName := strings.TrimSpace(candidates[i].Name())
		rightName := strings.TrimSpace(candidates[j].Name())
		if leftName != rightName {
			return leftName < rightName
		}
		return candidates[i].ID() < candidates[j].ID()
	})
	return candidates[0]
}

func smtpConfigFromConnector(secrets SecretResolvePort, connector *Connector) (*SMTPConfig, error) {
	endpoint := strings.TrimSpace(connector.Endpoint())
	host, port, scheme, err := parseEndpoint(endpoint, "smtp", 587, "smtp", "smtps")
	if err != nil {
		return nil, fmt.Errorf("smtp connector %q: %w", connector.Name(), err)
	}

	implicitTLS := strings.EqualFold(scheme, "smtps") || port == 465

	secret, err := secrets.Resolve(connector.CredentialID())
	if err != nil {
		return nil, fmt.Errorf("smtp connector %q credential: %w", connector.Name(), err)
	}

	config := connector.Config()
	result := &SMTPConfig{
		ConnectorID: connector.ID(),
		Name:        connector.Name(),
		TemplateID:  connector.TemplateID(),
		Endpoint:    endpoint,
		Host:        host,
		Port:        port,
		Username:    stringValue(config, "username", "user"),
		FromAddress: stringValue(config, "fromAddress"),
		AuthScheme:  connector.AuthScheme(),
		LocalName:   stringValue(config, "localName", "local_name"),
		TLS:         boolValueOrDefault(config, !implicitTLS, "tls"),
		ImplicitTLS: implicitTLS,
	}
	if secret != nil {
		result.Password = stringValue(secret.Payload, "password", "value", "api_key")
	}
	if result.FromAddress == "" {
		result.FromAddress = stringValue(config, "from", "sender", "senderAddress")
	}
	return result, nil
}

func registryConfigFromConnector(secrets SecretResolvePort, connector *Connector) (*RegistryConfig, error) {
	endpoint := strings.TrimSpace(connector.Endpoint())
	host, _, _, err := parseEndpoint(endpoint, "https", 443, "http", "https")
	if err != nil {
		return nil, fmt.Errorf("registry connector %q: %w", connector.Name(), err)
	}

	secret, err := secrets.Resolve(connector.CredentialID())
	if err != nil {
		return nil, fmt.Errorf("registry connector %q credential: %w", connector.Name(), err)
	}

	config := connector.Config()
	result := &RegistryConfig{
		ConnectorID: connector.ID(),
		Name:        connector.Name(),
		TemplateID:  connector.TemplateID(),
		Endpoint:    endpoint,
		Host:        host,
		Username:    stringValue(config, "username", "user"),
		Namespace:   stringValue(config, "namespace", "project"),
		Insecure:    boolValue(config, "insecure"),
		AuthScheme:  connector.AuthScheme(),
	}
	if secret != nil {
		result.Password = stringValue(secret.Payload, "password", "value", "api_key")
	}
	return result, nil
}

func proxyConfigFromConnector(secrets SecretResolvePort, connector *Connector) (*ProxyConfig, error) {
	endpoint := strings.TrimSpace(connector.Endpoint())
	defaultScheme := stringValue(connector.Config(), "protocol")
	if defaultScheme == "" {
		defaultScheme = "http"
	}
	host, port, scheme, err := parseEndpoint(endpoint, defaultScheme, 8080, "http", "https", "socks5")
	if err != nil {
		return nil, fmt.Errorf("proxy connector %q: %w", connector.Name(), err)
	}

	secret, err := secrets.Resolve(connector.CredentialID())
	if err != nil {
		return nil, fmt.Errorf("proxy connector %q credential: %w", connector.Name(), err)
	}

	config := connector.Config()
	result := &ProxyConfig{
		ConnectorID: connector.ID(),
		Name:        connector.Name(),
		TemplateID:  connector.TemplateID(),
		Endpoint:    endpoint,
		Scheme:      scheme,
		Host:        host,
		Port:        port,
		Username:    stringValue(config, "username", "user"),
		NoProxy:     strings.TrimSpace(stringValue(config, "no_proxy", "noProxy")),
		AuthScheme:  connector.AuthScheme(),
	}
	if secret != nil {
		result.Password = stringValue(secret.Payload, "password", "value", "api_key")
	}
	return result, nil
}

func ProxyURLWithCredentials(rawValue, username, password string) string {
	rawValue = strings.TrimSpace(rawValue)
	if rawValue == "" {
		return ""
	}
	parsed, err := url.Parse(rawValue)
	if err != nil {
		return rawValue
	}
	if parsed.User != nil || strings.TrimSpace(username) == "" {
		return rawValue
	}
	parsed.User = url.UserPassword(strings.TrimSpace(username), strings.TrimSpace(password))
	return parsed.String()
}

func mergeNoProxyValues(configs ...*ProxyConfig) string {
	seen := map[string]bool{}
	values := make([]string, 0)
	for _, cfg := range configs {
		if cfg == nil || strings.TrimSpace(cfg.NoProxy) == "" {
			continue
		}
		for _, part := range strings.Split(cfg.NoProxy, ",") {
			trimmed := strings.TrimSpace(part)
			if trimmed == "" || seen[trimmed] {
				continue
			}
			seen[trimmed] = true
			values = append(values, trimmed)
		}
	}
	return strings.Join(values, ",")
}

func parseEndpoint(raw string, defaultScheme string, defaultPort int, allowedSchemes ...string) (host string, port int, scheme string, err error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", 0, "", fmt.Errorf("connector endpoint is required")
	}
	if !strings.Contains(raw, "://") {
		raw = defaultScheme + "://" + raw
	}

	parsed, parseErr := url.Parse(raw)
	if parseErr != nil {
		return "", 0, "", fmt.Errorf("parse connector endpoint %q: %w", raw, parseErr)
	}

	host = parsed.Hostname()
	if host == "" {
		return "", 0, "", fmt.Errorf("connector endpoint %q has no host", raw)
	}

	if len(allowedSchemes) > 0 {
		matched := false
		for _, s := range allowedSchemes {
			if strings.EqualFold(parsed.Scheme, s) {
				matched = true
				break
			}
		}
		if !matched {
			return "", 0, "", fmt.Errorf("connector endpoint %q uses unsupported scheme %q", raw, parsed.Scheme)
		}
	}

	port = defaultPort
	if parsed.Port() != "" {
		parsedPort, portErr := strconv.Atoi(parsed.Port())
		if portErr != nil {
			return "", 0, "", fmt.Errorf("parse connector endpoint port %q: %w", parsed.Port(), portErr)
		}
		port = parsedPort
	}

	return host, port, parsed.Scheme, nil
}

func stringValue(group map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := group[key]; ok {
			if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
				return text
			}
		}
	}
	return ""
}

func boolValue(group map[string]any, keys ...string) bool {
	for _, key := range keys {
		if value, ok := group[key]; ok {
			switch typed := value.(type) {
			case bool:
				return typed
			case string:
				parsed, err := strconv.ParseBool(typed)
				if err == nil {
					return parsed
				}
			}
		}
	}
	return false
}

func boolValueOrDefault(group map[string]any, fallback bool, keys ...string) bool {
	for _, key := range keys {
		if _, ok := group[key]; ok {
			return boolValue(group, key)
		}
	}
	return fallback
}
