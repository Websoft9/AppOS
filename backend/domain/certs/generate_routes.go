package certs

import (
	"fmt"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/domain/audit"
)

var hostLabelRegexp = regexp.MustCompile(`^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`)

// RegisterGenerateRoutes mounts the generate and renew routes on the given group.
func RegisterGenerateRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	g.POST("/{id}/generate-self-signed", handleGenerateSelfSigned)
	g.POST("/{id}/renew-self-signed", handleRenewSelfSigned)
}

func handleGenerateSelfSigned(e *core.RequestEvent) error {
	if e.Auth == nil {
		return apis.NewUnauthorizedError("authentication required", nil)
	}
	if !isSuperuser(e.Auth) {
		return apis.NewForbiddenError("superuser required", nil)
	}

	id := e.Request.PathValue("id")
	record, err := e.App.FindRecordById("certificates", id)
	if err != nil {
		return e.NotFoundError("certificate not found", err)
	}

	if record.GetString("kind") != "self_signed" {
		return e.BadRequestError("only self_signed certificates can be generated", nil)
	}

	if record.GetString("cert_pem") != "" {
		return e.JSON(http.StatusConflict, map[string]string{
			"message": "Certificate already has cert material. Use renew-self-signed instead.",
		})
	}

	var body struct {
		ValidityDays int `json:"validity_days"`
		KeyBits      int `json:"key_bits"`
	}
	if err := e.BindBody(&body); err != nil {
		// Not a fatal error — use defaults
		body.ValidityDays = 0
		body.KeyBits = 0
	}
	if body.ValidityDays <= 0 {
		body.ValidityDays = 365
	}
	if body.ValidityDays > 3650 {
		return e.BadRequestError("validity_days must be between 1 and 3650", nil)
	}
	if body.KeyBits == 0 {
		body.KeyBits = 2048
	}
	if body.KeyBits != 2048 && body.KeyBits != 4096 {
		return e.BadRequestError("key_bits must be 2048 or 4096", nil)
	}

	domain, err := normalizeAndValidateDomain(record.GetString("domain"))
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}
	certPEM, keyPEM, err := GenerateSelfSigned(domain, body.KeyBits, body.ValidityDays)
	if err != nil {
		return e.InternalServerError("certificate generation failed", err)
	}

	secretID, err := StorePrivateKeySecret(e.App, record, keyPEM)
	if err != nil {
		return e.InternalServerError("failed to store private key", err)
	}

	meta, err := ExtractCertMeta(certPEM)
	if err != nil {
		deleteSecretBestEffort(e.App, secretID)
		return e.InternalServerError("failed to parse generated certificate", err)
	}

	record.Set("cert_pem", certPEM)
	record.Set("key", secretID)
	record.Set("issuer", meta.Issuer)
	record.Set("subject", meta.Subject)
	record.Set("expires_at", meta.ExpiresAt.Format(time.RFC3339))
	record.Set("issued_at", meta.IssuedAt.Format(time.RFC3339))
	record.Set("serial_number", meta.SerialNumber)
	record.Set("signature_algorithm", meta.SignatureAlgorithm)
	record.Set("key_bits", meta.KeyBits)
	record.Set("cert_version", meta.CertVersion)
	record.Set("status", "active")

	if err := e.App.Save(record); err != nil {
		deleteSecretBestEffort(e.App, secretID)
		return e.InternalServerError("failed to save certificate record", err)
	}

	audit.Write(e.App, audit.Entry{
		UserID:       e.Auth.Id,
		UserEmail:    e.Auth.GetString("email"),
		Action:       "certificate.generate",
		ResourceType: "certificate",
		ResourceID:   record.Id,
		ResourceName: record.GetString("name"),
		Status:       audit.StatusSuccess,
		IP:           e.RealIP(),
		UserAgent:    e.Request.Header.Get("User-Agent"),
	})

	return e.JSON(http.StatusOK, map[string]any{
		"id":         record.Id,
		"cert_pem":   certPEM,
		"expires_at": meta.ExpiresAt.Format(time.RFC3339),
		"issued_at":  meta.IssuedAt.Format(time.RFC3339),
		"issuer":     meta.Issuer,
		"subject":    meta.Subject,
		"status":     "active",
	})
}

func handleRenewSelfSigned(e *core.RequestEvent) error {
	if e.Auth == nil {
		return apis.NewUnauthorizedError("authentication required", nil)
	}
	if !isSuperuser(e.Auth) {
		return apis.NewForbiddenError("superuser required", nil)
	}

	id := e.Request.PathValue("id")
	record, err := e.App.FindRecordById("certificates", id)
	if err != nil {
		return e.NotFoundError("certificate not found", err)
	}

	if record.GetString("kind") != "self_signed" {
		return e.BadRequestError("only self_signed certificates can be renewed", nil)
	}

	var body struct {
		ValidityDays int `json:"validity_days"`
	}
	if err := e.BindBody(&body); err != nil {
		body.ValidityDays = 0
	}
	if body.ValidityDays <= 0 {
		body.ValidityDays = 365
	}
	if body.ValidityDays > 3650 {
		return e.BadRequestError("validity_days must be between 1 and 3650", nil)
	}

	domain, err := normalizeAndValidateDomain(record.GetString("domain"))
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}
	certPEM, keyPEM, err := GenerateSelfSigned(domain, 2048, body.ValidityDays)
	if err != nil {
		return e.InternalServerError("certificate generation failed", err)
	}

	// Update or create the private key secret
	existingKeyID := record.GetString("key")
	if existingKeyID != "" {
		if err := UpdatePrivateKeySecret(e.App, existingKeyID, keyPEM); err != nil {
			return e.InternalServerError("failed to update private key", err)
		}
	} else {
		secretID, err := StorePrivateKeySecret(e.App, record, keyPEM)
		if err != nil {
			return e.InternalServerError("failed to store private key", err)
		}
		record.Set("key", secretID)
	}

	renewMeta, err := ExtractCertMeta(certPEM)
	if err != nil {
		return e.InternalServerError("failed to parse generated certificate", err)
	}

	record.Set("cert_pem", certPEM)
	record.Set("issuer", renewMeta.Issuer)
	record.Set("subject", renewMeta.Subject)
	record.Set("expires_at", renewMeta.ExpiresAt.Format(time.RFC3339))
	record.Set("issued_at", renewMeta.IssuedAt.Format(time.RFC3339))
	record.Set("serial_number", renewMeta.SerialNumber)
	record.Set("signature_algorithm", renewMeta.SignatureAlgorithm)
	record.Set("key_bits", renewMeta.KeyBits)
	record.Set("cert_version", renewMeta.CertVersion)
	record.Set("status", "active")

	if err := e.App.Save(record); err != nil {
		return e.InternalServerError("failed to save certificate record", err)
	}

	audit.Write(e.App, audit.Entry{
		UserID:       e.Auth.Id,
		UserEmail:    e.Auth.GetString("email"),
		Action:       "certificate.renew",
		ResourceType: "certificate",
		ResourceID:   record.Id,
		ResourceName: record.GetString("name"),
		Status:       audit.StatusSuccess,
		IP:           e.RealIP(),
		UserAgent:    e.Request.Header.Get("User-Agent"),
	})

	return e.JSON(http.StatusOK, map[string]any{
		"id":         record.Id,
		"cert_pem":   certPEM,
		"expires_at": renewMeta.ExpiresAt.Format(time.RFC3339),
		"issued_at":  renewMeta.IssuedAt.Format(time.RFC3339),
		"issuer":     renewMeta.Issuer,
		"subject":    renewMeta.Subject,
		"status":     "active",
	})
}

func isSuperuser(auth *core.Record) bool {
	return auth != nil && auth.Collection().Name == core.CollectionNameSuperusers
}

func normalizeAndValidateDomain(raw string) (string, error) {
	domain := strings.TrimSpace(raw)
	if domain == "" {
		return "", fmt.Errorf("domain is required for self-signed certificates")
	}

	if len(domain) > 253 {
		return "", fmt.Errorf("domain is too long")
	}

	if net.ParseIP(domain) != nil {
		return domain, nil
	}

	host := domain
	if strings.HasPrefix(host, "*.") {
		host = strings.TrimPrefix(host, "*.")
	}
	if strings.Contains(host, "/") || strings.Contains(host, " ") || strings.Contains(host, "\t") {
		return "", fmt.Errorf("domain format is invalid")
	}

	labels := strings.Split(host, ".")
	if len(labels) == 0 {
		return "", fmt.Errorf("domain format is invalid")
	}
	for _, label := range labels {
		if !hostLabelRegexp.MatchString(label) {
			return "", fmt.Errorf("domain format is invalid")
		}
	}

	return domain, nil
}
