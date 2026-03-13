# Epic 23: Certificates

**Module**: Credentials / Certificates | **Status**: Proposed | **Priority**: P1 | **Depends on**: Epic 12, Epic 19

## Objective

Introduce `Certificates` as a first-class module for certificate lifecycle and metadata.

`Certificates` is parallel to `Secrets`. `Credentials` is only a visual grouping in navigation and has no business logic.

## Navigation

```
Admin
└── Credentials
    ├── Secrets
    ├── Certificates
    └── Environments
```

`Certificates` is a sibling of `Secrets` and `Environments` under the visual `Credentials` group.

## Requirements

- `Certificates` owns certificate inventory, lifecycle, and metadata.
- `Secrets` remains a separate module for encrypted sensitive values; it is not the certificate inventory.
- `Certificates` supports file-based templates, independent from Secrets templates, so different certificate shapes can define different fields and validation.
- MVP certificate families are:
  - `self_signed`
  - `ca_issued`
- MVP operations support generation and renewal only for `self_signed` certificates.
- `ca_issued` certificates are supported as imported assets with metadata tracking only.
- Free CA and commercial CA are both represented as `ca_issued`; this epic does not integrate with online CA providers.
- Binary certificate formats are not supported in this epic.
- Reverse proxy and other consumers reference certificate records, not raw secret payloads.

## Scope Boundaries

| In scope | Out of scope |
|----------|-------------|
| Certificates CRUD | Online CA / ACME integration |
| Certificate templates | Let's Encrypt / ZeroSSL / commercial CA APIs |
| Self-signed certificate issue and renew | DNS challenge / HTTP challenge automation |
| Imported CA-issued certificate tracking | Cluster or multi-node cert sync |
| Certificate metadata extraction and validation | Full PKI management |
| Proxy-facing certificate references | Replacing Secrets business logic |

## Data Model

Primary resource: `certificates` collection (PocketBase).

The collection already exists from Epic 8 with a minimal schema. Epic 23 adds the missing fields via a migration.

### Collection Schema

| Field | PB Type | Constraints | Notes |
|-------|---------|-------------|-------|
| `name` | text | required, max 200, unique index | Display name |
| `template_id` | text | required | Certificate template id |
| `kind` | select | required, `self_signed` \| `ca_issued` | Certificate family |
| `domain` | text | required | Primary domain / CN |
| `cert_pem` | text | optional | Full PEM chain; set by import or generate |
| `key` | relation → secrets | optional, maxSelect 1 | Private key secret reference |
| `issuer` | text | optional, written by backend hook | Extracted common name from cert |
| `subject` | text | optional, written by backend hook | Extracted subject from cert |
| `expires_at` | datetime | optional, written by backend hook | Extracted from cert_pem |
| `status` | select | default `active`, `active` \| `expired` \| `revoked` | Lifecycle state |
| `auto_renew` | bool | default false | Reserved for future use |
| `description` | text | optional | |
| `groups` | json | optional | Array of resource_group IDs |

Notes:

- `issuer`, `subject`, `expires_at` are written by the before-create/update hook when `cert_pem` is provided. They must not be writeable directly by the frontend.
- `key` retains the existing field name for backward compatibility. It references a `secrets` record holding the private key.
- Template definitions live in a dedicated file `backend/internal/certs/templates.json`, not in the Secrets template file.
- MVP only accepts text-based PEM content. Binary formats are rejected by the backend hook.
- Uploaded source files are import carriers only. Normalized PEM content is stored; the original file object is not persisted.

### Collection Rules

| Operation | Rule | Who |
|-----------|------|-----|
| list | `@request.auth.id != ""` | Any authenticated user |
| view | `@request.auth.id != ""` | Any authenticated user |
| create | nil | Superuser only |
| update | nil | Superuser only |
| delete | nil | Superuser only |

## API

Prefer PocketBase native collection API wherever possible.

### Native collection API

Primary CRUD uses the `certificates` collection directly.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/collections/certificates/records` | List certificates |
| GET | `/api/collections/certificates/records/:id` | Get certificate |
| POST | `/api/collections/certificates/records` | Create certificate |
| PATCH | `/api/collections/certificates/records/:id` | Update certificate metadata/material |
| DELETE | `/api/collections/certificates/records/:id` | Delete certificate |

### Minimal custom routes

Custom routes are allowed only for behavior that is not plain record CRUD.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/certificates/templates` | Return certificate templates |
| POST | `/api/certificates/:id/generate-self-signed` | Generate initial self-signed material |
| POST | `/api/certificates/:id/renew-self-signed` | Renew self-signed material |

Rules:

- Do not add custom CRUD routes for certificate records.
- Use PocketBase hooks on the `certificates` collection for validation, metadata extraction, and write guards.
- Keep certificate generation and renewal as the only certificate-specific commands.
- Expiry detection uses a PB view hook: on every view/list request, if `expires_at` is in the past and `status` is still `active`, the hook updates `status` to `expired` inline. No separate validate endpoint is needed.

## File Handling

MVP file handling is text-first.

- The UI may let users choose local files, but those files are read as text and submitted as record content.
- The original uploaded file does not need to be stored as a file asset.
- `cert_pem` is stored in the `certificates` record.
- Private key content is stored through `Secrets` encryption, not as plaintext in the `certificates` record.

Storage decision:

- Public certificate chain: store normalized text content in database fields.
- Private key: store encrypted content in `Secrets`.
- Original uploaded file: do not persist in MVP.

Binary files:

- Binary certificate formats such as `.p12` and `.pfx` are explicitly unsupported in this epic.
- The UI and backend validation should reject binary certificate uploads.

## Template Model

`Certificates` uses file-based templates similar to Secrets, but with certificate-specific fields and validation rules.

### Template file

Location: `backend/internal/certs/templates.json`. Loaded at startup; served via `GET /api/certificates/templates`.

Template object shape:

```
{
  "id": string,           // unique; matches template_id stored on record
  "label": string,        // display label shown in UI
  "kind": string,         // must match "self_signed" or "ca_issued"
  "description": string,  // one-line UI description (optional)
  "fields": [             // drives form rendering and backend validation
    {
      "key": string,
      "label": string,
      "type": "text" | "textarea" | "relation" | "boolean",
      "required": bool,
      "upload": bool       // textarea fields only; enables file-pick-to-paste
    }
  ]
}
```

Field types for certificate templates: `text`, `textarea`, `relation`, `boolean`. Sensitive types such as `password` are not used here (private keys are stored via Secrets, not as template fields).

### Initial templates

```json
[
  {
    "id": "self_signed_basic",
    "label": "Self-Signed Certificate",
    "kind": "self_signed",
    "description": "Generate a self-signed certificate on this server",
    "fields": [
      { "key": "name", "label": "Name", "type": "text", "required": true },
      { "key": "domain", "label": "Domain / CN", "type": "text", "required": true },
      { "key": "description", "label": "Description", "type": "textarea" }
    ]
  },
  {
    "id": "ca_import_basic",
    "label": "CA-Issued Certificate (Import)",
    "kind": "ca_issued",
    "description": "Import a certificate issued by a certificate authority",
    "fields": [
      { "key": "name", "label": "Name", "type": "text", "required": true },
      { "key": "domain", "label": "Domain / CN", "type": "text", "required": true },
      { "key": "cert_pem", "label": "Certificate Chain (PEM)", "type": "textarea", "required": true, "upload": true },
      { "key": "key", "label": "Private Key Secret", "type": "relation", "required": false },
      { "key": "description", "label": "Description", "type": "textarea" }
    ]
  }
]
```

## Acceptance Criteria

- `Certificates` appears as its own page under `Credentials`.
- `Credentials` remains a visual grouping only; no shared business logic is introduced there.
- Users can create, edit, list, and delete certificate records.
- Certificate forms are rendered from file-based certificate templates.
- Users can generate a self-signed certificate from the Certificates module.
- Users can renew a self-signed certificate from the Certificates module.
- Users can import a CA-issued certificate and private key for tracking and later consumption.
- Certificate create/update validates PEM format and extracts certificate metadata.
- Consumers bind to certificate records rather than storing raw cert/key material directly.
- No online CA service integration is required for MVP.

## Stories

### Story 23.1 Certificates Backend

Create the `certificates` domain model, certificate template loader, validation flow, and certificate-specific CRUD behavior.

### Story 23.2 Certificates Frontend

Add the Certificates page under `Credentials`, driven by certificate templates and certificate-specific forms.

### Story 23.3 Self-Signed Lifecycle

Support self-signed certificate generation and renewal.

### Story 23.4 Certificate Consumption

Define the integration boundary so reverse proxy and future modules consume certificate records by reference.

## Non-Goals

- No online CA integration in this epic.
- No automatic ACME issuance.
- No commercial CA API integration.
- No certificate marketplace or provider abstraction.
- No binary certificate import or storage.
- No redesign of the Secrets module.

## Product Decision

Do not integrate online CA services in MVP.

Reason: current product need is self-signed generation and renewal. The model should remain extensible for future CA integration, but this epic should not absorb that complexity now.