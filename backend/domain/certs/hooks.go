package certs

import (
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/secrets"
)

var (
	startExpirySweepOnce sync.Once
	stopExpirySweepCh    chan struct{}
)

// RegisterHooks binds PocketBase event hooks for the certificates collection.
func RegisterHooks(app *pocketbase.PocketBase) {
	// Before-create: validate template_id, validate PEM, extract metadata
	app.OnRecordCreateRequest("certificates").BindFunc(func(e *core.RecordRequestEvent) error {
		templateID := e.Record.GetString("template_id")
		if templateID != "" {
			if _, ok := FindTemplate(templateID); !ok {
				return apis.NewBadRequestError("invalid template_id", nil)
			}
		}

		privateKeySecretID := normalizePrivateKeySecretRef(e.Record)
		if err := validatePrivateKeySecretRef(app, privateKeySecretID, actorID(e.Auth)); err != nil {
			return apis.NewBadRequestError(err.Error(), nil)
		}

		// PEM validation and metadata extraction
		certPEM := e.Record.GetString("cert_pem")
		if certPEM != "" {
			if IsBinaryContent(certPEM) {
				return apis.NewBadRequestError("cert_pem contains binary content; only text PEM is supported", nil)
			}
			if !ValidatePEMHeader(certPEM) {
				return apis.NewBadRequestError("cert_pem must start with -----BEGIN CERTIFICATE-----", nil)
			}

			meta, err := ExtractCertMeta(certPEM)
			if err != nil {
				return apis.NewBadRequestError("failed to parse certificate PEM: "+err.Error(), nil)
			}

			e.Record.Set("issuer", meta.Issuer)
			e.Record.Set("subject", meta.Subject)
			e.Record.Set("expires_at", meta.ExpiresAt.Format(time.RFC3339))
			e.Record.Set("issued_at", meta.IssuedAt.Format(time.RFC3339))
			e.Record.Set("serial_number", meta.SerialNumber)
			e.Record.Set("signature_algorithm", meta.SignatureAlgorithm)
			e.Record.Set("key_bits", meta.KeyBits)
			e.Record.Set("cert_version", meta.CertVersion)
		}

		err := e.Next()
		if err == nil {
			audit.Write(app, audit.Entry{
				UserID:       actorID(e.Auth),
				UserEmail:    actorEmail(e.Auth),
				Action:       "certificate.create",
				ResourceType: "certificate",
				ResourceID:   e.Record.Id,
				ResourceName: e.Record.GetString("name"),
				Status:       audit.StatusSuccess,
				IP:           e.RealIP(),
				UserAgent:    e.Request.Header.Get("User-Agent"),
			})
		}
		return err
	})

	// Before-update: validate PEM and extract metadata when cert_pem changes
	app.OnRecordUpdateRequest("certificates").BindFunc(func(e *core.RecordRequestEvent) error {
		existing, err := app.FindRecordById("certificates", e.Record.Id)
		if err != nil {
			return err
		}

		newPEM := e.Record.GetString("cert_pem")
		oldPEM := existing.GetString("cert_pem")

		if oldPEM != "" && newPEM == "" {
			return apis.NewBadRequestError("cert_pem cannot be cleared once set", nil)
		}

		privateKeySecretID := normalizePrivateKeySecretRef(e.Record)
		if err := validatePrivateKeySecretRef(app, privateKeySecretID, actorID(e.Auth)); err != nil {
			return apis.NewBadRequestError(err.Error(), nil)
		}

		if newPEM != "" && newPEM != oldPEM {
			if IsBinaryContent(newPEM) {
				return apis.NewBadRequestError("cert_pem contains binary content; only text PEM is supported", nil)
			}
			if !ValidatePEMHeader(newPEM) {
				return apis.NewBadRequestError("cert_pem must start with -----BEGIN CERTIFICATE-----", nil)
			}

			meta, err := ExtractCertMeta(newPEM)
			if err != nil {
				return apis.NewBadRequestError("failed to parse certificate PEM: "+err.Error(), nil)
			}

			e.Record.Set("issuer", meta.Issuer)
			e.Record.Set("subject", meta.Subject)
			e.Record.Set("expires_at", meta.ExpiresAt.Format(time.RFC3339))
			e.Record.Set("issued_at", meta.IssuedAt.Format(time.RFC3339))
			e.Record.Set("serial_number", meta.SerialNumber)
			e.Record.Set("signature_algorithm", meta.SignatureAlgorithm)
			e.Record.Set("key_bits", meta.KeyBits)
			e.Record.Set("cert_version", meta.CertVersion)
		}

		err = e.Next()
		if err == nil {
			audit.Write(app, audit.Entry{
				UserID:       actorID(e.Auth),
				UserEmail:    actorEmail(e.Auth),
				Action:       "certificate.update",
				ResourceType: "certificate",
				ResourceID:   e.Record.Id,
				ResourceName: e.Record.GetString("name"),
				Status:       audit.StatusSuccess,
				IP:           e.RealIP(),
				UserAgent:    e.Request.Header.Get("User-Agent"),
			})
		}
		return err
	})

	// Expiry sweep runs in background; read paths stay read-only.
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		startExpirySweepOnce.Do(func() {
			stopExpirySweepCh = make(chan struct{})
			go runExpirySweepLoop(app, stopExpirySweepCh)
		})
		return se.Next()
	})

	app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error {
		if stopExpirySweepCh != nil {
			close(stopExpirySweepCh)
			stopExpirySweepCh = nil
		}
		return e.Next()
	})
}

func validatePrivateKeySecretRef(app core.App, secretID, userID string) error {
	secretID = strings.TrimSpace(secretID)
	if secretID == "" {
		return nil
	}

	if err := secrets.ValidateRef(app, secretID, userID); err != nil {
		return fmt.Errorf("invalid private key secret")
	}

	rec, err := app.FindRecordById("secrets", secretID)
	if err != nil {
		return fmt.Errorf("invalid private key secret")
	}

	if strings.TrimSpace(rec.GetString("template_id")) != "tls_private_key" {
		return fmt.Errorf("certificate key must reference a tls_private_key secret")
	}

	if strings.TrimSpace(rec.GetString("status")) == "revoked" {
		return fmt.Errorf("invalid private key secret")
	}

	return nil
}

func runExpirySweepLoop(app core.App, stop <-chan struct{}) {
	if err := expireDueCertificates(app); err != nil {
		log.Printf("[WARN] certs: initial expiry sweep failed: %v", err)
	}

	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if err := expireDueCertificates(app); err != nil {
				log.Printf("[WARN] certs: periodic expiry sweep failed: %v", err)
			}
		case <-stop:
			return
		}
	}
}

func expireDueCertificates(app core.App) error {
	now := time.Now().UTC().Format(time.RFC3339)
	records, err := app.FindRecordsByFilter(
		"certificates",
		"status = 'active' && expires_at != '' && expires_at <= {:now}",
		"",
		200,
		0,
		map[string]any{"now": now},
	)
	if err != nil {
		return err
	}

	for _, record := range records {
		record.Set("status", "expired")
		if saveErr := app.Save(record); saveErr != nil {
			log.Printf("[WARN] certs: failed to mark certificate %s expired: %v", record.Id, saveErr)
		}
	}

	return nil
}

// checkAndExpire updates status to "expired" if expires_at is in the past
// and status is still "active". The save is async to avoid blocking the response.
func actorID(auth *core.Record) string {
	if auth == nil {
		return "system"
	}
	return auth.Id
}

func actorEmail(auth *core.Record) string {
	if auth == nil {
		return ""
	}
	return auth.GetString("email")
}
