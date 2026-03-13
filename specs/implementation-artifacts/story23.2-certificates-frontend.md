# Story 23.2: Certificates Frontend

**Epic**: Epic 23 - Certificates
**Priority**: P1
**Status**: Done
**Depends on**: Story 23.1

## Objective

Add the Certificates page to the `Credentials` section. Forms are template-driven. All data operations use the PocketBase native collection SDK — do not use the existing `/api/ext/resources/certificates` custom route.

## Acceptance Criteria

- [x] AC1: `Certificates` appears as a navigation entry under the `Credentials` visual group in the sidebar, alongside `Secrets` and `Environments`.
- [x] AC2: The Certificates list page is at route `/certificates`.
- [x] AC3: The list shows columns: Name, Domain, Kind, Issued, Expires, Status. Expired certificates show a visual warning state on the Status badge. Columns Name/Domain/Issued/Expires are sortable; Kind and Status support dropdown filters.
- [x] AC4: The create form renders fields from the template selected by the user, using the template list fetched from `GET /api/certificates/templates`.
- [x] AC5: For `self_signed_basic` template, the form shows Name, Domain, Description and a validity days input. cert_pem/key are not shown.
- [x] AC6: For `ca_import_basic` template, the form shows Name, Domain, cert_pem (textarea with file-pick-to-paste), key (relation selector to secrets), and Description.
- [x] AC7: The `cert_pem` field uses `file-textarea` behaviour: the user can either paste PEM text or use a file picker that reads the file as text and pastes the content into the textarea. Files with binary content are rejected client-side before submission.
- [x] AC8: All write operations use the PocketBase native SDK. The old `/api/ext/resources/certificates` path is not used.
- [x] AC9: The `key` relation field selector filters secrets by `template_id = 'tls_private_key'` when that template exists; falls back to showing all active secrets.
- [x] AC10: `issuer`, `subject`, `expires_at`, `status` fields are display-only in the edit form.

## Navigation

Sidebar placement:

```
Credentials
  Secrets        → /secrets
  Certificates   → /certificates              ← this story
  Environments   → /admin/credentials/env-vars
```

`Credentials` is a sidebar visual grouping label only. It is not a route or page.

## UI Layout

### List Page

```
┌──────────────────────────────────────────────────────────────────────┐
│ Certificates                               [ New Certificate ]       │
├──────────────────────────────────────────────────────────────────────┤
│ Name         Domain          Kind           Expires     Status       │
│──────────────────────────────────────────────────────────────────────│
│ prod-tls     example.com     Self-Signed    2027-03-12  active       │
│ staging-tls  staging.io      CA-Issued      2026-06-01  ⚠ expiring   │
└──────────────────────────────────────────────────────────────────────┘
```

Empty state: "No certificates yet. Create one to assign TLS material to your proxy or applications."

### Create Form (Self-Signed)

```
Template: [ Self-Signed Certificate ▾ ]

Name *        [ prod-tls              ]
Domain *      [ example.com           ]
Description   [ textarea              ]

ℹ A certificate and private key will be generated on the server after saving.

[ Save ]
```

### Create Form (CA Import)

```
Template: [ CA-Issued Certificate (Import) ▾ ]

Name *                    [ staging-tls      ]
Domain *                  [ staging.io        ]
Certificate Chain (PEM) * [ ──── textarea ──── ]  [ Upload File ]
Private Key Secret        [ select or create  ]
Description               [ textarea          ]

[ Save ]
```

### Detail / Edit

Read-only fields (shown but not editable):

- Issuer
- Subject
- Expires At
- Status

Editable fields: Name, Description, key (relation). cert_pem is editable for `ca_import_basic` certificates.

For `self_signed_basic` certificates, show a `[ Renew ]` button (wired in Story 23.3 AC14).

## Route Files

- `dashboard/src/routes/_app/_auth/certificates.tsx` — list + create + edit page
- Update `dashboard/src/components/layout/Sidebar.tsx` — add Certificates entry under `credentialsNavItem.children`

## Dev Notes

- Use `pb.collection('certificates').getFullList()` for list, `.create()` for create, `.update()` for update, `.delete()` for delete.
- Fetch templates: `pb.send('/api/certificates/templates', { method: 'GET' })`.
- Binary file rejection client-side: read first 8 KB of file as text; if the string contains null bytes (`\x00`), show error and clear the field.
- Accepted file extensions for cert_pem: `.pem`, `.crt`, `.cer`, `.txt`. Reject `.p12`, `.pfx` with a clear error message: "Binary certificate formats are not supported. Export the certificate as PEM first."
- `expires_at` display: format as locale date. Show a warning badge when `expires_at` is within 30 days.
- Status badge colours: `active` = default, `expired` = destructive, `revoked` = secondary.
