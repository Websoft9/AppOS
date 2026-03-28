# Epic 13: Settings Module

**Module**: Settings | **Status**: Canonicalized | **Priority**: P2 | **Depends on**: Epic 1, Epic 3

## Overview

Epic 13 owns the Settings platform itself:

- one backend-owned `/api/settings` surface
- one schema/catalog that describes all settings entries
- one schema-driven Dashboard Settings page
- one shared rule set for defaults, masking, actions, and persistence adapters

Epic 13 does **not** own the full product semantics of every individual setting. Once a settings entry belongs to a business domain, that domain's epic or story owns the field meaning, validation intent, and runtime behavior.

The canonical module design is intentionally split into four delivery stories:

- [specs/implementation-artifacts/story13.1-native.md](specs/implementation-artifacts/story13.1-native.md)
- [specs/implementation-artifacts/story13.2-custom.md](specs/implementation-artifacts/story13.2-custom.md)
- [specs/implementation-artifacts/story13.3-frontend.md](specs/implementation-artifacts/story13.3-frontend.md)
- [specs/implementation-artifacts/story13.4-onboarding.md](specs/implementation-artifacts/story13.4-onboarding.md)

## Responsibilities

Epic 13 is responsible for:

- unified settings routes under `/api/settings`
- schema registry for sections, entries, sources, fields, and actions
- adapter layer for PocketBase settings and `custom_settings`
- masking and preserve-on-patch semantics for sensitive fields
- fallback/default behavior for missing settings rows
- schema-driven Settings navigation and load/save orchestration

## API Surface

All Epic 13 routes are mounted under `/api/settings` and require superuser authentication.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/settings/schema` | Return the backend-owned settings catalog: entries, sections, fields, sources, and action bindings |
| `GET` | `/api/settings/entries` | Return current values for all settings entries |
| `GET` | `/api/settings/entries/{entryId}` | Return one settings entry by unified identifier |
| `PATCH` | `/api/settings/entries/{entryId}` | Update one settings entry by unified identifier |
| `POST` | `/api/settings/actions/{actionId}` | Execute an entry-bound action such as SMTP or S3 connectivity tests |

### Route Shape

`GET /api/settings/schema`

```json
{
  "entries": [
    {
      "id": "basic",
      "title": "Basic",
      "section": "system",
      "source": "native",
      "fields": [
        { "id": "appName", "label": "App Name", "type": "string" }
      ],
      "actions": []
    }
  ],
  "actions": [
    {
      "id": "test-email",
      "title": "Send Test Email",
      "entryId": "smtp"
    }
  ]
}
```

`GET /api/settings/entries`

```json
{
  "items": [
    {
      "id": "space-quota",
      "value": {
        "maxSizeMB": 10,
        "maxPerUser": 100
      }
    }
  ]
}
```

`GET` or `PATCH /api/settings/entries/{entryId}`

```json
{
  "id": "space-quota",
  "value": {
    "maxSizeMB": 10,
    "maxPerUser": 100
  }
}
```

Validation errors use `422` with field-level payload:

```json
{
  "errors": {
    "maxUploadFiles": "must be between 1 and 200"
  }
}
```

## Storage Model

Epic 13 currently spans two persistence families.

### 1. PocketBase native settings

- source value: `native`
- storage model: PocketBase internal settings object
- AppOS adapter behavior: read with `app.Settings().Clone()`, project only catalog-declared fields, patch by wrapping the target PocketBase group and saving the cloned settings object

Current native group mapping:

| Entry ID | PocketBase group |
|---|---|
| `basic` | `meta` |
| `smtp` | `smtp` |
| `s3` | `s3` |
| `logs` | `logs` |

### 2. `custom_settings` collection

- source value: `custom`
- storage model: one JSON row per `(module, key)` pair
- backend helper package: `internal/settings/settings.go`

Current collection structure:

| Field | Type | Notes |
|---|---|---|
| `module` | text | required |
| `key` | text | required |
| `value` | JSON | settings payload for that logical group |

Current collection constraints and rules:

- unique index: `(module, key)`
- list/view: superuser only
- create/update/delete via PocketBase client API: forbidden
- backend writes use `settings.SetGroup()`

Current custom row mapping:

| Entry ID | Module | Key |
|---|---|---|
| `secrets-policy` | `secrets` | `policy` |
| `space-quota` | `space` | `quota` |
| `connect-terminal` | `connect` | `terminal` |
| `connect-sftp` | `connect` | `sftp` |
| `deploy-preflight` | `deploy` | `preflight` |
| `iac-files` | `files` | `limits` |
| `tunnel-port-range` | `tunnel` | `port_range` |
| `proxy-network` | `proxy` | `network` |
| `docker-mirror` | `docker` | `mirror` |
| `docker-registries` | `docker` | `registries` |
| `llm-providers` | `llm` | `providers` |

## Catalog Contract

Each settings entry is defined in the backend catalog with this logical structure:

| Field | Meaning |
|---|---|
| `id` | unified entry identifier used by API paths |
| `title` | UI-facing entry label |
| `section` | navigation group, currently `system` or `workspace` |
| `source` | persistence adapter, currently `native` or `custom` |
| `fields` | field metadata exposed to the frontend |
| `actions` | optional action IDs bound to the entry |

Action metadata currently uses this structure:

| Field | Meaning |
|---|---|
| `id` | unified action identifier used by API paths |
| `title` | operator-facing action label |
| `entryId` | owning entry ID |

## Terminology Boundary

- **Settings**: admin-facing persisted values exposed through the Epic 13 Settings Module and its shared `/api/settings` surface.
- **Configuration**: runtime system, service, deploy, or file-based configuration outside the shared Settings Module contract.
- **Preferences**: user-local or browser-local choices such as theme, panel state, or terminal font size; preferences are not Epic 13 settings unless explicitly promoted into the shared Settings Module.

Epic 13 is not responsible for:

- domain-specific business workflows behind a setting
- feature-specific UI outside the shared Settings surface
- consumer runtime behavior after settings are read
- compatibility aliases for legacy settings routes

## Ownership Model

| Settings surface | Canonical owner |
|---|---|
| `basic`, `smtp`, `s3`, `logs` | Epic 13 |
| `space-quota` | Epic 9 / Space |
| `connect-terminal` | Epic 15 / Connect Terminal |
| `connect-sftp` | Epic 20 / Servers |
| `tunnel-port-range` | Story 16.5 |
| `secrets-policy` | Story 19.4 |
| `deploy-preflight` | Story 17.10 |
| `iac-files` | Epic 14 |
| `proxy-network`, `docker-mirror`, `docker-registries`, `llm-providers` | Remain documented in Epic 13 until a dedicated consumer document exists |

## Story Split

| Story | Focus |
|---|---|
| 13.1 | Backend native settings adapter for PocketBase settings |
| 13.2 | Backend custom settings adapter for `custom_settings` |
| 13.3 | Frontend schema-driven Settings page |
| 13.4 | Module onboarding path for adding new settings entries |

## Documentation Policy

- Epic 13 is intentionally split by platform responsibility, not by individual consumer module.
- Core module design lives across Stories 13.1 to 13.4.
- Consumer-specific settings should be documented in the consumer epic or story, not in a separate Epic 13 sub-story.
- New settings work should update the consumer doc first, then register the entry in the Epic 13 canonical module spec.
- Transitional legacy docs from the previous decomposition are intentionally removed.

## Out of Scope

- user-level preferences
- import/export of settings
- settings audit/change history
- compatibility routes for legacy module-specific settings APIs
- duplicating consumer rules that already belong to the owning epic

## Follow-up Direction

- Add more consumer-owned entries without changing the unified API shape.
- Keep schema entry ordering backend-defined and stable.
- Continue migrating old docs to consumer ownership when a domain matures enough to own its own settings contract.
