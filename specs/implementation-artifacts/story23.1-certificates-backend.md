# Story 23.1: Certificates Backend

**Epic**: Epic 23 - Certificates
**Priority**: P1
**Status**: Done
**Depends on**: Epic 12, Epic 19

## Objective

Evolve the existing `certificates` collection into the Epic 23 data model, add a certificate template loader, and wire PocketBase hooks for PEM validation and metadata extraction.

## Acceptance Criteria

- [x] AC1: All Epic 23 certificate fields are defined in `1740000000_create_resource_collections.go` (merged into the original creation migration; no separate upgrade migration). Schema includes `template_id`, `kind`, `issuer`, `subject`, `status`, `issued_at`, `serial_number`, `signature_algorithm`, `key_bits`, `cert_version`, plus `created`/`updated` autodate fields.
- [x] AC2: `GET /api/certificates/templates` returns all templates from `backend/domain/certs/templates.json`, including at least `self_signed_basic` and `ca_import_basic`.
- [x] AC3: Before-create hook on `certificates` rejects any request where `cert_pem` is provided but does not start with `-----BEGIN CERTIFICATE-----` (returns 400).
- [x] AC4: Before-create hook on `certificates` rejects binary content in `cert_pem` (null bytes detected in first 8 KB slice) with 400.
- [x] AC5: Before-create hook on `certificates` parses `cert_pem` when provided and writes `issuer`, `subject`, `expires_at`, `issued_at`, `serial_number`, `signature_algorithm`, `key_bits`, `cert_version` extracted from the first certificate in the chain. Frontend-supplied values for these fields are ignored.
- [x] AC6: Before-update hook applies the same PEM validation and metadata extraction as before-create whenever `cert_pem` changes.
- [x] AC7: Before-create hook validates `template_id` against the loaded template list and returns 400 if unknown.
- [x] AC8: `expires_at` field stores UTC datetime. Hook derives it from the X.509 `NotAfter` field.
- [x] AC9: `OnRecordEnrich` hook (covers both list and view) checks whether `expires_at` is in the past while `status` is still `active`. If so, it updates `status` to `expired` asynchronously.

## Tasks

- [x] Task 1: All fields defined in `1740000000_create_resource_collections.go` (merged; no separate upgrade migration)
- [x] Task 2: Certificate template loader `backend/domain/certs/templates.go`
- [x] Task 3: PB collection hooks `backend/domain/certs/hooks.go`
- [x] Task 4: PEM parsing utility `backend/domain/certs/pem.go`
- [x] Task 5: Routes registered in `backend/domain/routes/certificates.go`

## Collection Schema

| Field | PB Type | Notes |
|-------|---------|-------|
| `name` | text, required | |
| `domain` | text | |
| `template_id` | text | |
| `kind` | select | `self_signed` \| `ca_issued` |
| `cert_pem` | text | |
| `key` | relation → secrets | |
| `issuer` | text | backend-written |
| `subject` | text | backend-written |
| `expires_at` | date | backend-written, `NotAfter` |
| `issued_at` | date | backend-written, `NotBefore` |
| `serial_number` | text | backend-written, hex |
| `signature_algorithm` | text | backend-written |
| `key_bits` | number (int) | backend-written |
| `cert_version` | number (int) | backend-written |
| `status` | select | `active` \| `expired` \| `revoked` |
| `auto_renew` | bool | |
| `description` | text | |
| `created` | autodate | |
| `updated` | autodate | |
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

- `backend/infra/migrations/1762700000_update_certificates_for_epic23.go` — new
- `backend/domain/certs/templates.go` — new
- `backend/domain/certs/templates.json` — new
- `backend/domain/certs/pem.go` — new (shared PEM parsing: `ExtractCertMeta`, `IsBinaryContent`, `ValidatePEMHeader`)
- `backend/domain/certs/hooks.go` — new
- `backend/domain/routes/certificates.go` — new (templates route only)
- `backend/domain/routes/routes.go` — updated (register certificates routes + hooks)
- `backend/platform/hooks/hooks.go` — updated (register certs hooks)
