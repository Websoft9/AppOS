package routes

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net/mail"
	"net/smtp"
	"strings"

	"github.com/domodwyer/mailyak/v3"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingscatalog "github.com/websoft9/appos/backend/domain/config/sysconfig/catalog"
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
		cfg, err := connectors.LoadSMTPWith(persistence.NewConnectorRepository(app), connectors.NewSecretResolver(app))
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

func loadRuntimeSMTPConfig(app core.App) (*connectors.SMTPConfig, error) {
	if cfg, err := connectors.LoadSMTPWith(persistence.NewConnectorRepository(app), connectors.NewSecretResolver(app)); err == nil {
		return cfg, nil
	} else if runtimeErr := (*connectors.RuntimeConfigError)(nil); !errors.As(err, &runtimeErr) || !connectors.IsRuntimeReason(err, connectors.RuntimeReasonNoConnectorConfigured) {
		return nil, err
	}
	return loadLegacySMTPConfig(app)
}

func loadLegacySMTPConfig(app core.App) (*connectors.SMTPConfig, error) {
	entry, ok := settingscatalog.FindEntry("smtp")
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
		message, err = mailyak.NewWithTLS(serverAddr, auth, &tls.Config{ServerName: cfg.Host})
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
