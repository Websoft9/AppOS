# Story 23.4: Certificate Consumption Boundary

**Epic**: Epic 23 - Certificates
**Priority**: P2
**Status**: Proposed
**Depends on**: Story 23.1

## Objective

Define the exact contract that *other modules* (proxy, deploy) use to read certificate material at runtime. No filesystem layout is created in this story — that is deferred to the consuming module (reverse proxy epic). This story documents the boundary, adds a helper function, and ensures that resolving private key material is safe via the Secrets module.

## Scope

This story defines and implements the **reading side** only. It does not configure the reverse proxy, deploy pipeline, or any file-writing logic. Those are Epic 24 concerns.

## Acceptance Criteria

- [ ] AC1: A Go function `ResolveCertificate(app, certID, callerID string) (*CertMaterial, error)` exists in `backend/internal/certs/` and is importable by other packages.
- [ ] AC2: `ResolveCertificate` reads the certificate record by ID via the PocketBase app instance (not via HTTP).
- [ ] AC3: If the certificate `status` is not `active`, `ResolveCertificate` returns an error (`ErrCertNotActive`).
- [ ] AC4: `CertMaterial` contains `CertPEM string` and `KeyPEM string`. `KeyPEM` is the decrypted private key text.
- [ ] AC5: The private key is resolved by calling the existing `secrets.Resolve(app, secretID, callerID)` function, then extracting the `"private_key"` field from the returned payload map.
- [ ] AC6: If `cert_pem` is empty (certificate not yet generated), `ResolveCertificate` returns `ErrCertNotReady`.
- [ ] AC7: The function is covered by a unit test with a mock PocketBase app, testing the happy path and the two error cases (not active, not ready).
- [ ] AC8: `GET /api/collections/certificates/records/:id` is the standard HTTP interface for consumers that do not have direct Go import access (external scripts, future API consumers). No additional custom route is needed for basic reads.

## Contract Definition

### Go Interface

```go
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
func ResolveCertificate(app core.App, certID string, callerID string) (*CertMaterial, error)
```

### HTTP Interface (PB Native — no custom route needed)

```
GET /api/collections/certificates/records/:id
Authorization: superuser (or authenticated user — ListRule/ViewRule allow auth users)
```

Response: PocketBase standard record JSON. Relevant fields:
```json
{
  "id": "...",
  "cert_pem": "-----BEGIN CERTIFICATE-----\n...",
  "key": "secret_record_id",
  "status": "active",
  "expires_at": "2027-03-12T00:00:00Z"
}
```

The `key` field is a relation ID pointing to a secret record. The caller must separately resolve the private key via `GET /api/collections/secrets/records/:key_id` — but note secrets are superuser-only and the payload is encrypted. In practice, inter-module communication within the Go backend MUST use `ResolveCertificate()`, not HTTP.

## Implementation Tasks

### Task 1: Resolve function and types

File: `backend/internal/certs/resolve.go`

```go
package certs

import (
    "fmt"

    "github.com/pocketbase/pocketbase/core"
    "github.com/websoft9/appos/backend/internal/secrets"
)

func ResolveCertificate(app core.App, certID string, callerID string) (*CertMaterial, error) {
    record, err := app.FindRecordById("certificates", certID)
    if err != nil {
        return nil, ErrCertNotFound
    }

    if record.GetString("status") != "active" {
        return nil, ErrCertNotActive
    }

    certPEM := record.GetString("cert_pem")
    if certPEM == "" {
        return nil, ErrCertNotReady
    }

    keyPEM := ""
    secretID := record.GetString("key")
    if secretID != "" {
        // Use the existing secrets.Resolve() — handles decryption, records usage, emits audit
        payload, err := secrets.Resolve(app, secretID, callerID)
        if err != nil {
            return nil, fmt.Errorf("resolving private key secret: %w", err)
        }
        if v, ok := payload["private_key"]; ok {
            keyPEM, _ = v.(string)
        }
    }

    return &CertMaterial{
        CertID:  certID,
        CertPEM: certPEM,
        KeyPEM:  keyPEM,
    }, nil
}
```

No new function is needed in the secrets package — `secrets.Resolve()` already handles decryption, usage tracking, and audit.

### Task 2: Unit test

File: `backend/internal/certs/resolve_test.go`

Test cases:
1. Happy path: status=active, cert_pem populated, key relation present → returns CertMaterial with both PEM strings
2. Status not active: status=expired → returns ErrCertNotActive
3. Cert not ready: status=active, cert_pem="" → returns ErrCertNotReady

Use table-driven tests with a minimal PocketBase test setup (see existing `*_test.go` files in the codebase for the pattern).

## Consumption Pattern Documentation

**For proxy/deploy authors (internal Go consumers):**

```go
import "github.com/websoft9/appos/backend/internal/certs"

material, err := certs.ResolveCertificate(app, certRecordID, "")
if err != nil {
    // handle: ErrCertNotFound, ErrCertNotActive, ErrCertNotReady
}
// material.CertPEM → write to temp file or pass to TLS config
// material.KeyPEM  → write to temp file or pass to TLS config
```

**For shell scripts / external consumers (not recommended for production):**

```bash
# Read cert record via PB API (superuser token required)
curl -H "Authorization: Bearer $PB_SUPERUSER_TOKEN" \
  http://localhost:8090/api/collections/certificates/records/:id
```

Private key retrieval from shell requires a second call to `/api/collections/secrets/records/:key_id` plus a decrypt step — this is intentionally not exposed as a convenience route. Use the Go API.

## Non-Goals

- No filesystem layout is defined here. Where and how the proxy writes cert/key files to disk is Epic 24.
- No `GET /api/certificates/:id/material` route that returns decrypted key material over HTTP. This is an intentional security boundary.
- No bulk resolution endpoint.

## File List

| Path | Action |
|------|--------|
| `backend/internal/certs/resolve.go` | Create |
| `backend/internal/certs/resolve_test.go` | Create |
