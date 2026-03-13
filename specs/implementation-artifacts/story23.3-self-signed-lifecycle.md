# Story 23.3: Self-Signed Certificate Lifecycle

**Epic**: Epic 23 - Certificates
**Priority**: P1
**Status**: Proposed
**Depends on**: Story 23.1, Story 23.2

**Note**: Story 23.2 depends on this story for the auto-generate and renew button UI behaviors (AC13, AC14). These two stories should be developed in tandem or Story 23.3 should ship first.

## Objective

Implement server-side generation and renewal of self-signed certificates. Two custom routes handle the full lifecycle: `generate-self-signed` (initial creation of cert material) and `renew-self-signed` (rotation — new key + new cert). Private keys are stored via the Secrets module (AES-256-GCM encryption).

## Acceptance Criteria

- [ ] AC1: `POST /api/certificates/:id/generate-self-signed` returns 400 when the target record's `kind` is not `self_signed`.
- [ ] AC2: `POST /api/certificates/:id/generate-self-signed` returns 409 Conflict when `cert_pem` is already populated (the certificate has already been generated; use renew instead).
- [ ] AC3: `POST /api/certificates/:id/generate-self-signed` generates an RSA-2048 private key and a self-signed X.509 certificate using the record's `domain` field as the CN.
- [ ] AC4: The private key is stored as a new Secret record (not as raw text in the certificates record). The `key` relation field on the certificates record is set to the newly created secret's ID.
- [ ] AC5: After generation, `cert_pem`, `issuer`, `subject`, `expires_at`, and `status=active` are all populated on the certificates record.
- [ ] AC6: If secret creation succeeds but certificate writing to the certificates record fails, the orphaned secret is deleted (cleanup on failure).
- [ ] AC7: `POST /api/certificates/:id/renew-self-signed` works regardless of whether `cert_pem` is already populated. It performs full rotation: new RSA key + new certificate.
- [ ] AC8: On renew, if the record already has a `key` relation pointing to a secret, that secret is updated with the new private key material. If no secret exists, a new one is created.
- [ ] AC9: Both endpoints require superuser authentication. A non-superuser request returns 401.
- [ ] AC10: Both endpoints emit an audit event (`certificate.generate` / `certificate.renew`) including the certificate record ID and name.
- [ ] AC11: Request body parameter `validity_days` is accepted as an integer (default: 365 if omitted). Minimum 1, maximum 3650.
- [ ] AC12: Request body parameter `key_bits` is accepted by generate (but not renew — always RSA-2048 on renew). Valid values: 2048 or 4096. Defaults to 2048.
- [ ] AC13: After creating a `self_signed_basic` record, the UI automatically triggers `POST /api/certificates/:id/generate-self-signed` with `{ "validity_days": 365 }`. Failure is shown as an inline error; the record remains and can be retried.
- [ ] AC14: For `self_signed_basic` certificates, the edit/detail view shows a `[ Renew ]` button that calls `POST /api/certificates/:id/renew-self-signed` with `{ "validity_days": 365 }`.

## API Contract

### Generate

```
POST /api/certificates/:id/generate-self-signed
Authorization: superuser
Content-Type: application/json

{
  "validity_days": 365,   // optional, default 365
  "key_bits": 2048        // optional, default 2048, valid: 2048 | 4096
}
```

Success response `200`:
```json
{
  "id": "cert_record_id",
  "cert_pem": "-----BEGIN CERTIFICATE-----\n...",
  "expires_at": "2027-03-12T00:00:00Z",
  "issuer": "CN=example.com",
  "subject": "CN=example.com",
  "status": "active"
}
```

Error responses:
- `400` — `kind` is not `self_signed`, or `validity_days` / `key_bits` invalid
- `409` — `cert_pem` is already populated; use renew
- `404` — certificate record not found
- `401` — not superuser

### Renew

```
POST /api/certificates/:id/renew-self-signed
Authorization: superuser
Content-Type: application/json

{
  "validity_days": 365    // optional, default 365
}
```

Success response `200`: same shape as generate.

Error responses:
- `400` — `kind` is not `self_signed`, or `validity_days` invalid
- `404` — certificate record not found
- `401` — not superuser

## Implementation Tasks

### Task 1: Certificate generation logic

File: `backend/internal/certs/generate.go`

Functions:
- `GenerateSelfSigned(domain string, keyBits int, validityDays int) (certPEM string, keyPEM string, err error)`
  1. Generate RSA private key using `crypto/rsa.GenerateKey(rand.Reader, keyBits)`
  2. Build `x509.Certificate` template:
     - `SerialNumber`: random 128-bit integer
     - `Subject.CommonName`: domain
     - `DNSNames`: `[]string{domain}`
     - `NotBefore`: `time.Now()`
     - `NotAfter`: `time.Now().Add(time.Duration(validityDays) * 24 * time.Hour)`
     - `KeyUsage`: `x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature`
     - `ExtKeyUsage`: `[]x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}`
     - `IsCA`: false
  3. Self-sign with `x509.CreateCertificate(rand.Reader, tmpl, tmpl, &privKey.PublicKey, privKey)`
  4. PEM-encode the certificate (`CERTIFICATE` block) and private key (`RSA PRIVATE KEY` block)
  5. Return both PEM strings

Note: `ExtractCertMeta` is defined in `backend/internal/certs/pem.go` (Story 23.1). This story reuses it; does not redefine it.

### Task 2: Secret creation/update helpers for private key

File: `backend/internal/certs/keysecret.go`

**Important**: Secrets encryption hooks only fire on HTTP requests (`OnRecordCreateRequest`), not on direct `app.Save()` calls. These helpers must call `secrets.EncryptPayload()` and `secrets.BuildPayloadMeta()` directly before saving.

Functions:
- `StorePrivateKeySecret(app core.App, certRecord *core.Record, keyPEM string) (secretID string, err error)`
  1. Build payload: `payload := map[string]any{"private_key": keyPEM}`
  2. Encrypt: `enc, err := secrets.EncryptPayload(payload)`
  3. Build meta: `meta := secrets.BuildPayloadMeta(payload, tpl)` where `tpl, _ = secrets.FindTemplate("tls_private_key")`
  4. Create record via `app.Save(rec)` with fields set:
     - `name = certRecord.GetString("name") + "-key"`
     - `template_id = "tls_private_key"`
     - `payload_encrypted = enc`
     - `payload_meta = meta`
     - `version = 1`
     - `status = "active"`
     - `created_by = ""` (system-generated)
  5. On success: set `certRecord.Set("key", rec.Id)` and save cert record
  6. Return the secret record ID

- `UpdatePrivateKeySecret(app core.App, secretID string, keyPEM string) error`
  1. Fetch existing secret record by ID
  2. Build payload + encrypt + build meta (same as above)
  3. Update: `rec.Set("payload_encrypted", enc)`, `rec.Set("payload_meta", meta)`
  4. `app.Save(rec)`

### Task 3: Route handlers

File: `backend/internal/certs/generate_routes.go`

```go
import (
    "github.com/pocketbase/pocketbase/core"
    "github.com/pocketbase/pocketbase/tools/router"
)

func registerGenerateRoutes(g *router.RouterGroup[*core.RequestEvent]) {
    g.POST("/{id}/generate-self-signed", handleGenerateSelfSigned)
    g.POST("/{id}/renew-self-signed",    handleRenewSelfSigned)
}
```

Handler signature: `func handleGenerateSelfSigned(e *core.RequestEvent) error`
Path parameter: `e.Request.PathValue("id")`
Auth check: `e.Auth == nil` → `apis.NewUnauthorizedError(...)`
Response: `e.JSON(http.StatusOK, data)`
Error: `e.BadRequestError(msg, err)`, `e.NotFoundError(msg, err)`

`handleGenerateSelfSigned(e *core.RequestEvent) error`:
1. Authenticate: `e.Auth == nil` → `apis.NewUnauthorizedError("authentication required", nil)`; non-superuser → `apis.NewForbiddenError("superuser required", nil)`
2. Get ID via `e.Request.PathValue("id")`; fetch certificates record by ID (404 if not found)
3. Validate `kind == "self_signed"` (400 if not)
4. Validate `cert_pem == ""` (409 if already has cert)
5. Parse request body for `validity_days` and `key_bits`
6. Call `GenerateSelfSigned(domain, keyBits, validityDays)` → certPEM, keyPEM
7. Call `StorePrivateKeySecret(app, certRecord, keyPEM)` → secretID
8. Extract metadata via `ExtractCertMeta(certPEM)` → issuer, subject, expiresAt
9. Update record: `Set("cert_pem", certPEM)`, `Set("issuer", issuer)`, `Set("subject", subject)`, `Set("expires_at", expiresAt)`, `Set("status", "active")`
10. Save record. On failure: call cleanup to delete the secret created in step 7.
11. Emit audit event `certificate.generate`
12. Return 200 JSON with updated fields

`handleRenewSelfSigned(e *core.RequestEvent) error`:
1. Authenticate: same auth check as generate (superuser required)
2. Get ID via `e.Request.PathValue("id")`; fetch record by ID (404 if not found)
3. Validate `kind == "self_signed"` (400 if not)
4. Parse request body for `validity_days` (default 365)
5. Call `GenerateSelfSigned(domain, 2048, validityDays)` → certPEM, keyPEM
6. If `record.Get("key") != ""` → call `UpdatePrivateKeySecret(app, existingSecretID, keyPEM)`
   Else → call `StorePrivateKeySecret(app, certRecord, keyPEM)` → sets `key` relation on record
7. Extract metadata → update cert_pem, issuer, subject, expires_at, status=active
8. Save record
9. Emit audit event `certificate.renew`
10. Return 200 JSON with updated fields

### Task 4: Register generate routes

In `backend/internal/certs/certificates.go` (or wherever `registerCertificatesRoutes` is defined):

```go
func RegisterCertificatesRoutes(se *core.ServeEvent) {
    g := se.Router.Group("/api/certificates")
    g.GET("/templates", handleGetTemplates).Bind(apis.RequireAuth())
    registerGenerateRoutes(g)
}
```

Note: `RegisterCertificatesRoutes` is the public entry point called from `routes.Register(se)`. Auth binding follows the secrets route pattern. No validate route — expiry detection is handled by the PB view hook in Story 23.1.

### Task 5: Add tls_private_key template to secrets (if not already present)

Check `backend/internal/secrets/templates.json`. If no template with `id: "tls_private_key"` exists, add:

```json
{
  "id": "tls_private_key",
  "label": "TLS Private Key",
  "description": "Asymmetric private key for a TLS certificate",
  "fields": [
    { "key": "private_key", "label": "Private Key (PEM)", "type": "textarea", "required": true }
  ]
}
```

This allows the keysecret helper to create typed secret records that the frontend can identify.

## Dev Notes

### Imports needed

```go
import (
    "crypto/rand"
    "crypto/rsa"
    "crypto/x509"
    "crypto/x509/pkix"
    "encoding/pem"
    "math/big"
    "time"
)
```

### Random serial number

```go
serialNumber, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
```

### PEM encoding private key

```go
pem.EncodeToMemory(&pem.Block{
    Type:  "RSA PRIVATE KEY",
    Bytes: x509.MarshalPKCS1PrivateKey(privKey),
})
```

### Error response pattern (match other routes in this codebase)

```go
return e.JSON(http.StatusConflict, map[string]string{
    "message": "Certificate already has cert material. Use renew-self-signed instead.",
})
```

### Cleanup on failure

```go
if saveErr != nil {
    app.Delete(secretRecord) // best-effort; log on error
    return saveErr
}
```

## File List

| Path | Action |
|------|--------|
| `backend/internal/certs/generate.go` | Create |
| `backend/internal/certs/keysecret.go` | Create |
| `backend/internal/certs/generate_routes.go` | Create |
| `backend/internal/certs/certificates.go` | Update — add `registerGenerateRoutes(g)` call |
| `backend/internal/secrets/templates.json` | Update — add `tls_private_key` entry if absent |
