package certs

import (
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"strings"
	"time"
)

// CertMeta holds parsed X.509 certificate metadata.
type CertMeta struct {
	Issuer             string
	Subject            string
	ExpiresAt          time.Time
	IssuedAt           time.Time
	SerialNumber       string
	SignatureAlgorithm string
	KeyBits            int
	CertVersion        int
}

// ExtractCertMeta parses the first CERTIFICATE PEM block from certPEM and
// returns structured X.509 metadata.
func ExtractCertMeta(certPEM string) (CertMeta, error) {
	block, _ := pem.Decode([]byte(certPEM))
	if block == nil || block.Type != "CERTIFICATE" {
		return CertMeta{}, fmt.Errorf("no CERTIFICATE PEM block found")
	}

	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return CertMeta{}, fmt.Errorf("parse certificate: %w", err)
	}

	meta := CertMeta{
		ExpiresAt:          cert.NotAfter.UTC(),
		IssuedAt:           cert.NotBefore.UTC(),
		SerialNumber:       cert.SerialNumber.Text(16),
		SignatureAlgorithm: cert.SignatureAlgorithm.String(),
		CertVersion:        cert.Version,
	}

	meta.Issuer = cert.Issuer.CommonName
	if meta.Issuer == "" {
		meta.Issuer = cert.Issuer.String()
	}

	meta.Subject = cert.Subject.CommonName
	if meta.Subject == "" {
		meta.Subject = cert.Subject.String()
	}

	switch pub := cert.PublicKey.(type) {
	case *rsa.PublicKey:
		meta.KeyBits = pub.N.BitLen()
	case *ecdsa.PublicKey:
		meta.KeyBits = pub.Curve.Params().BitSize
	}

	return meta, nil
}

// IsBinaryContent checks the first 8192 bytes of data for null bytes.
func IsBinaryContent(data string) bool {
	probe := data
	if len(probe) > 8192 {
		probe = probe[:8192]
	}
	return strings.ContainsRune(probe, '\x00')
}

// ValidatePEMHeader checks that data starts with -----BEGIN CERTIFICATE-----.
func ValidatePEMHeader(data string) bool {
	return strings.HasPrefix(strings.TrimSpace(data), "-----BEGIN CERTIFICATE-----")
}
