package certs

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/secrets"
)

// CertMaterial holds resolved, decrypted TLS material.
type CertMaterial struct {
	CertID  string
	CertPEM string // full PEM certificate chain
	KeyPEM  string // decrypted RSA/ECDSA private key in PEM format
}

var (
	ErrCertNotFound  = errors.New("certificate record not found")
	ErrCertNotActive = errors.New("certificate is not in active state")
	ErrCertNotReady  = errors.New("certificate has no cert_pem; generate it first")
)

// ResolveCertificate is the canonical function for other modules (proxy, deploy)
// to obtain TLS material for a given certificate record ID.
//
// callerID is used only for audit/logging; pass "" for system calls.
func ResolveCertificate(app core.App, certID string, callerID string) (*CertMaterial, error) {
	return resolveCertificateWith(certID, callerID,
		func(certID string) (*core.Record, error) {
			return app.FindRecordById("certificates", certID)
		},
		func(secretID, callerID string) (*secrets.ResolveResult, error) {
			return secrets.Resolve(app, secretID, callerID)
		},
	)
}

func resolveCertificateWith(certID string, callerID string, findCertificate func(string) (*core.Record, error), resolveSecret func(string, string) (*secrets.ResolveResult, error)) (*CertMaterial, error) {
	if strings.TrimSpace(callerID) == "" {
		callerID = secrets.CreatedSourceSystem
	}

	record, err := findCertificate(certID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrCertNotFound
		}
		return nil, fmt.Errorf("find certificate %s: %w", certID, err)
	}

	if record.GetString("status") != "active" {
		return nil, ErrCertNotActive
	}

	certPEM := record.GetString("cert_pem")
	if certPEM == "" {
		return nil, ErrCertNotReady
	}

	keyPEM := ""
	secretID := getPrivateKeySecretID(record)
	if secretID != "" {
		result, err := resolveSecret(secretID, callerID)
		if err != nil {
			return nil, fmt.Errorf("resolving private key secret: %w", err)
		}
		v, ok := result.Payload["private_key"]
		if !ok {
			return nil, fmt.Errorf("resolving private key secret: missing private_key field")
		}
		key, ok := v.(string)
		if !ok || strings.TrimSpace(key) == "" {
			return nil, fmt.Errorf("resolving private key secret: private_key must be a non-empty string")
		}
		keyPEM = key
	}

	return &CertMaterial{
		CertID:  certID,
		CertPEM: certPEM,
		KeyPEM:  keyPEM,
	}, nil
}
