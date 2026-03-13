# Story 23.1: Certificates Backend

**Epic**: Epic 23 - Certificates
**Priority**: P1
**Status**: Proposed
**Depends on**: Epic 12, Epic 19

## Objective

Evolve the existing `certificates` collection into the Epic 23 data model, add a certificate template loader, and wire PocketBase hooks for PEM validation and metadata extraction.

## Acceptance Criteria

- [ ] AC1: Migration `1762700000_update_certificates_for_epic23.go` adds `template_id`, `kind`, `issuer`, `subject`, `status` fields to the existing `certificates` collection without breaking existing records. Existing records receive `kind = ca_issued` and `status = active` as defaults.
- [ ] AC2: `GET /api/certificates/templates` returns all templates from `backend/internal/certs/templates.json`, including at least `self_signed_basic` and `ca_import_basic`.
- [ ] AC3: Before-create hook on `certificates` rejects any request where `cert_pem` is provided but does not start with `-----BEGIN CERTIFICATE-----` (returns 400).
- [ ] AC4: Before-create hook on `certificates` rejects binary content in `cert_pem` (null bytes detected in first 8 KB slice) with 400.
- [ ] AC5: Before-create hook on `certificates` parses `cert_pem` when provided and writes `issuer`, `subject`, `expires_at` extracted from the first certificate in the chain. Frontend-supplied values for these fields are ignored.
- [ ] AC6: Before-update hook applies the same PEM validation and metadata extraction as before-create whenever `cert_pem` changes.
- [ ] AC7: Before-create hook validates `template_id` against the loaded template list and returns 400 if unknown.
- [ ] AC8: `expires_at` field stores UTC datetime. Hook derives it from the X.509 `NotAfter` field.
- [ ] AC9: An `OnRecordViewRequest("certificates")` hook checks whether `expires_at` is in the past while `status` is still `active`. If so, it updates `status` to `expired` on the record (async save) before returning the response. The caller always sees the current expiry state without a separate API call.

## Tasks

- [ ] Task 1: Migration `1762700000_update_certificates_for_epic23.go`
  - [ ] 1.1 Add `template_id` text field
  - [ ] 1.2 Add `kind` select field: values `self_signed`, `ca_issued`; no required constraint (to keep backward compat)
  - [ ] 1.3 Add `issuer` text field
  - [ ] 1.4 Add `subject` text field
  - [ ] 1.5 Add `status` select field: values `active`, `expired`, `revoked`; no required constraint
  - [ ] 1.6 Change `expires_at` from DateField to DateTimeField if not already
  - [ ] 1.7 Update existing records: set `kind = ca_issued`, `status = active` where null
  - [ ] 1.8 Down migration: remove added fields in reverse order

- [ ] Task 2: Certificate template loader `backend/internal/certs/templates.go`
  - [ ] 2.1 Load `backend/internal/certs/templates.json` at startup; fail fast if malformed
  - [ ] 2.2 Expose `FindTemplate(id string)` and `ListTemplates()` functions
  - [ ] 2.3 Register `GET /api/certificates/templates` route; return 200 with full template list

- [ ] Task 3: PB collection hooks `backend/internal/certs/hooks.go`
  - [ ] 3.1 Before-create: validate `template_id` against loaded templates
  - [ ] 3.2 Before-create: when `cert_pem` is non-empty, call `ExtractCertMeta` from `pem.go`, validate text-only (reject binary), validate PEM header, overwrite issuer/subject/expires_at on record
  - [ ] 3.3 Before-update: apply same PEM validation/extraction as before-create when `cert_pem` changes
  - [ ] 3.4 On-view hook: if `expires_at < time.Now()` and `status == "active"`, update `status = "expired"` via async `app.Save()`. The in-flight response reflects the updated status.
  - [ ] 3.5 Register hooks via `RegisterHooks(app)` called from `backend/internal/hooks/hooks.go`

- [ ] Task 4: PEM parsing utility `backend/internal/certs/pem.go`
  - [ ] 4.1 `ExtractCertMeta(certPEM string) (issuer, subject string, expiresAt time.Time, err error)` — parse first CERTIFICATE PEM block, extract metadata
  - [ ] 4.2 `IsBinaryContent(data string) bool` — check first 8192 bytes for null bytes
  - [ ] 4.3 `ValidatePEMHeader(data string) bool` — check `-----BEGIN CERTIFICATE-----` prefix
  - This file is imported by hooks (Story 23.1) and generate (Story 23.3)

- [ ] Task 5: Register routes
  - [ ] 5.1 Add `RegisterCertificatesRoutes(se)` to `backend/internal/routes/routes.go`
  - [ ] 5.2 Mount `GET /api/certificates/templates` (auth required, follows secrets pattern)

## Collection Schema (reference)

| Field | PB Type | Constraints |
|-------|---------|-------------|
| `name` | text | required, max 200 |
| `template_id` | text | required |
| `kind` | select | `self_signed` \| `ca_issued` |
| `domain` | text | required |
| `cert_pem` | text | optional |
| `key` | relation → secrets | optional, maxSelect 1 |
| `issuer` | text | optional, backend-written |
| `subject` | text | optional, backend-written |
| `expires_at` | datetime | optional, backend-written |
| `status` | select | `active` \| `expired` \| `revoked` |
| `auto_renew` | bool | default false |
| `description` | text | optional |
| `groups` | json | optional |

Collection rules (updated by migration):

| Operation | Rule |
|-----------|------|
| list | `@request.auth.id != ""` |
| view | `@request.auth.id != ""` |
| create | nil (superuser only) |
| update | nil (superuser only) |
| delete | nil (superuser only) |

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/collections/certificates/records` | authenticated | List certificates |
| GET | `/api/collections/certificates/records/:id` | authenticated | Get certificate |
| POST | `/api/collections/certificates/records` | superuser | Create certificate |
| PATCH | `/api/collections/certificates/records/:id` | superuser | Update certificate |
| DELETE | `/api/collections/certificates/records/:id` | superuser | Delete certificate |
| GET | `/api/certificates/templates` | authenticated | Return template list |

## Dev Notes

- PEM parsing in Go: `encoding/pem` + `crypto/x509`. Parse all blocks; use the first `CERTIFICATE` block to extract subject/issuer/expiry.
- `issuer`: use `cert.Issuer.CommonName`; fall back to `cert.Issuer.String()` if CN is empty.
- `subject`: use `cert.Subject.CommonName`; fall back to `cert.Subject.String()` if CN is empty.
- Binary detection: read the first 8192 bytes of `cert_pem`; if `strings.ContainsRune(probe, '\x00')` return 400.
- Do not add custom CRUD routes for certificates. All record operations go through the PB native `/api/collections/certificates/records` endpoint.

## File List

- `backend/internal/migrations/1762700000_update_certificates_for_epic23.go` — new
- `backend/internal/certs/templates.go` — new
- `backend/internal/certs/templates.json` — new
- `backend/internal/certs/pem.go` — new (shared PEM parsing: `ExtractCertMeta`, `IsBinaryContent`, `ValidatePEMHeader`)
- `backend/internal/certs/hooks.go` — new
- `backend/internal/routes/certificates.go` — new (templates route only)
- `backend/internal/routes/routes.go` — updated (register certificates routes + hooks)
- `backend/internal/hooks/hooks.go` — updated (register certs hooks)
