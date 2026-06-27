package routes

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net/mail"
	"net/smtp"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/domodwyer/mailyak/v3"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingsschema "github.com/websoft9/appos/backend/domain/config/sysconfig/schema"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	persistence "github.com/websoft9/appos/backend/infra/persistence"
)

type testEmailRecipient struct {
	Address string `json:"address"`
	Name    string `json:"name"`
}

type testEmailTemplate struct {
	Subject    string `json:"subject"`
	ActionURL  string `json:"actionUrl"`
	ActionName string `json:"actionName"`
}

type testEmailRequest struct {
	Template testEmailTemplate    `json:"template"`
	To       []testEmailRecipient `json:"to"`
}

func loadConnectorBackedSettingsEntryValue(app core.App, entryID string) (map[string]any, bool, error) {
	switch entryID {
	case "smtp":
		cfg, err := loadDisplayedSMTPConfig(app)
		if err != nil {
			if connectors.IsRuntimeReason(err, connectors.RuntimeReasonNoConnectorConfigured) {
				return nil, false, nil
			}
			return nil, true, err
		}
		return map[string]any{
			"enabled":    true,
			"host":       cfg.Host,
			"port":       cfg.Port,
			"username":   cfg.Username,
			"password":   cfg.Password,
			"authMethod": smtpAuthMethod(cfg),
			"tls":        cfg.TLS || cfg.ImplicitTLS,
			"localName":  cfg.LocalName,
		}, true, nil
	case "docker-registries":
		items, err := connectors.ListRegistryWith(persistence.NewConnectorRepository(app), connectors.NewSecretResolver(app))
		if err != nil {
			return nil, true, err
		}
		if len(items) == 0 {
			return nil, false, nil
		}
		mapped := make([]map[string]any, 0, len(items))
		for _, item := range items {
			mapped = append(mapped, map[string]any{
				"host":     item.Host,
				"username": item.Username,
				"password": item.Password,
			})
		}
		return map[string]any{"items": mapped}, true, nil
	default:
		return nil, false, nil
	}
}

func loadDisplayedSMTPConfig(app core.App) (*connectors.SMTPConfig, error) {
	items, err := persistence.NewConnectorRepository(app).ListByKind(connectors.KindSMTP)
	if err != nil {
		return nil, err
	}
	item, err := selectDisplayedConnector(items, connectors.KindSMTP)
	if err != nil {
		return nil, err
	}
	return smtpConfigFromDisplayedConnector(item)
}

func selectDisplayedConnector(items []*connectors.Connector, kind string) (*connectors.Connector, error) {
	if len(items) == 0 {
		return nil, &connectors.RuntimeConfigError{Kind: kind, Reason: connectors.RuntimeReasonNoConnectorConfigured}
	}
	defaults := make([]*connectors.Connector, 0, len(items))
	for _, item := range items {
		if item.IsDefault() {
			defaults = append(defaults, item)
		}
	}
	if len(defaults) == 1 {
		return defaults[0], nil
	}
	if len(defaults) > 1 {
		return earliestDisplayedConnector(defaults), nil
	}
	return earliestDisplayedConnector(items), nil
}

func earliestDisplayedConnector(items []*connectors.Connector) *connectors.Connector {
	if len(items) == 0 {
		return nil
	}
	candidates := append([]*connectors.Connector(nil), items...)
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

func smtpConfigFromDisplayedConnector(connector *connectors.Connector) (*connectors.SMTPConfig, error) {
	if connector == nil {
		return nil, &connectors.RuntimeConfigError{Kind: connectors.KindSMTP, Reason: connectors.RuntimeReasonNoConnectorConfigured}
	}
	config := connector.Config()
	host, port, implicitTLS := parseDisplayedSMTPEndpoint(strings.TrimSpace(connector.Endpoint()))
	result := &connectors.SMTPConfig{
		ConnectorID: connector.ID(),
		Name:        connector.Name(),
		TemplateID:  connector.TemplateID(),
		Endpoint:    strings.TrimSpace(connector.Endpoint()),
		Host:        host,
		Port:        port,
		Username:    stringConfigValue(config, "username", "user"),
		Password:    "",
		FromAddress: stringConfigValue(config, "fromAddress", "from_address"),
		AuthScheme:  connector.AuthScheme(),
		LocalName:   stringConfigValue(config, "localName", "local_name"),
		TLS:         boolConfigValue(config, "tls", false),
		ImplicitTLS: implicitTLS,
	}
	return result, nil
}

func parseDisplayedSMTPEndpoint(raw string) (host string, port int, implicitTLS bool) {
	port = 587
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", port, false
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", port, false
	}
	host = strings.TrimSpace(parsed.Hostname())
	if parsed.Port() != "" {
		if parsedPort, portErr := strconv.Atoi(parsed.Port()); portErr == nil && parsedPort > 0 {
			port = parsedPort
		}
	}
	implicitTLS = strings.EqualFold(parsed.Scheme, "smtps") || port == 465
	return host, port, implicitTLS
}

func stringConfigValue(config map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := config[key]
		if !ok {
			continue
		}
		if text := strings.TrimSpace(fmt.Sprintf("%v", value)); text != "" && text != "<nil>" {
			return text
		}
	}
	return ""
}

func boolConfigValue(config map[string]any, key string, fallback bool) bool {
	value, ok := config[key]
	if !ok {
		return fallback
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return fallback
		}
		parsed, err := strconv.ParseBool(trimmed)
		if err != nil {
			return fallback
		}
		return parsed
	default:
		return fallback
	}
}

func loadRuntimeSMTPConfig(app core.App) (*connectors.SMTPConfig, error) {
	if cfg, err := connectors.LoadSMTPWith(persistence.NewConnectorRepository(app), connectors.NewSecretResolver(app)); err == nil {
		return cfg, nil
	} else if runtimeErr := (*connectors.RuntimeConfigError)(nil); !errors.As(err, &runtimeErr) || !connectors.IsRuntimeReason(err, connectors.RuntimeReasonNoConnectorConfigured) {
		return nil, err
	}
	return loadLegacySMTPConfig(app)
}

func loadLegacySMTPConfig(app core.App) (*connectors.SMTPConfig, error) {
	entry, ok := settingsschema.FindEntry("smtp")
	if !ok {
		return nil, fmt.Errorf("smtp settings entry not found")
	}
	value, err := sysconfig.LoadPocketBaseEntry(app, entry)
	if err != nil {
		return nil, err
	}
	host := strings.TrimSpace(sysconfig.String(value, "host", ""))
	if host == "" {
		return nil, fmt.Errorf("smtp host is not configured")
	}
	port := sysconfig.Int(value, "port", 587)
	return &connectors.SMTPConfig{
		Name:        "legacy-smtp-settings",
		Host:        host,
		Port:        port,
		Username:    sysconfig.String(value, "username", ""),
		Password:    sysconfig.String(value, "password", ""),
		AuthScheme:  connectors.AuthSchemeBasic,
		LocalName:   sysconfig.String(value, "localName", ""),
		TLS:         false,
		ImplicitTLS: false,
	}, nil
}

func sendTestEmail(app core.App, body testEmailRequest) error {
	if len(body.To) == 0 {
		return fmt.Errorf("at least one recipient is required")
	}

	cfg, err := loadRuntimeSMTPConfig(app)
	if err != nil {
		return err
	}

	var auth smtp.Auth
	if cfg.AuthScheme != connectors.AuthSchemeNone && cfg.Username != "" && cfg.Password != "" {
		auth = smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	}

	serverAddr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	var message *mailyak.MailYak
	if cfg.ImplicitTLS {
		message, err = mailyak.NewWithTLS(serverAddr, auth, &tls.Config{ServerName: cfg.Host, MinVersion: tls.VersionTLS12})
		if err != nil {
			return err
		}
	} else {
		message = mailyak.New(serverAddr, auth)
	}

	if cfg.LocalName != "" {
		message.LocalName(cfg.LocalName)
	}

	from := strings.TrimSpace(cfg.FromAddress)
	if from == "" {
		from = fallbackFromAddress(cfg)
	}
	message.From(from)
	message.Subject(strings.TrimSpace(body.Template.Subject))
	for _, recipient := range body.To {
		addr := strings.TrimSpace(recipient.Address)
		if addr == "" {
			continue
		}
		if strings.TrimSpace(recipient.Name) != "" {
			message.To((&mail.Address{Name: recipient.Name, Address: addr}).String())
			continue
		}
		message.To(addr)
	}

	plain := message.Plain()
	plain.WriteString("This is a test email from AppOS.\n")
	if strings.TrimSpace(body.Template.ActionName) != "" || strings.TrimSpace(body.Template.ActionURL) != "" {
		plain.WriteString("\n")
		if strings.TrimSpace(body.Template.ActionName) != "" {
			plain.WriteString(body.Template.ActionName)
			plain.WriteString(": ")
		}
		plain.WriteString(strings.TrimSpace(body.Template.ActionURL))
		plain.WriteString("\n")
	}

	if strings.TrimSpace(body.Template.Subject) == "" {
		message.Subject("Test email from AppOS")
	}

	return message.Send()
}

func fallbackFromAddress(cfg *connectors.SMTPConfig) string {
	if strings.Contains(cfg.Username, "@") {
		return cfg.Username
	}
	if cfg.Host != "" {
		return "noreply@" + cfg.Host
	}
	return "noreply@appos.local"
}

func smtpAuthMethod(cfg *connectors.SMTPConfig) string {
	if cfg.Username == "" || cfg.Password == "" || cfg.AuthScheme == connectors.AuthSchemeNone {
		return ""
	}
	return "PLAIN"
}
