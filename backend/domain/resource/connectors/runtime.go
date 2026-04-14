package connectors

import (
	"fmt"
	"net/url"
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

func selectDefaultConnector(items []*Connector, kind string) (*Connector, error) {
	if len(items) == 0 {
		return nil, &RuntimeConfigError{Kind: kind, Reason: RuntimeReasonNoConnectorConfigured}
	}

	defaults := make([]*Connector, 0, len(items))
	for _, item := range items {
		if item.IsDefault() {
			defaults = append(defaults, item)
		}
	}
	if len(defaults) == 1 {
		return defaults[0], nil
	}
	if len(defaults) > 1 {
		return nil, &RuntimeConfigError{Kind: kind, Reason: RuntimeReasonMultipleDefaults}
	}

	if len(items) == 1 {
		return items[0], nil
	}
	return nil, &RuntimeConfigError{Kind: kind, Reason: RuntimeReasonDefaultRequired}
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
