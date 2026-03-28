# Story 13.2: Custom

**Epic**: Epic 13 - Settings Module
**Priority**: P1
**Status**: canonical

## Goal

Expose AppOS custom settings stored in `custom_settings` through unified entry IDs, shared defaults, shared validation hooks, and shared secret-handling rules.

## In Scope

- `module/key/value` to unified `entryId` mapping
- fallback/default handling for missing rows
- sensitive-field masking and preserve-on-patch behavior
- structured payload conventions
- removal of legacy module-specific settings routes

## API Paths

Custom settings entries are exposed only through unified entry APIs:

| Method | Path |
|---|---|
| `GET` | `/api/settings/schema` |
| `GET` | `/api/settings/entries` |
| `GET` | `/api/settings/entries/{entryId}` |
| `PATCH` | `/api/settings/entries/{entryId}` |

No module-specific paths such as `/api/settings/workspace/{module}`, `/api/settings/secrets`, or `/api/settings/tunnel` are part of the canonical contract.

## `custom_settings` Collection Structure

Custom settings persist in the PocketBase collection `custom_settings`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `module` | text | yes | logical module namespace |
| `key` | text | yes | logical group key inside the module |
| `value` | JSON | no | full group payload |

Collection rules and index:

- unique index on `(module, key)`
- list/view allowed only for superusers
- create/update/delete through PocketBase client API forbidden
- backend creates and updates rows via `settings.SetGroup()`

## Current Entry Map

| Entry ID | Module | Key | Default shape |
|---|---|---|---|
| `secrets-policy` | `secrets` | `policy` | `revealDisabled`, `defaultAccessMode`, `clipboardClearSeconds` |
| `space-quota` | `space` | `quota` | `maxSizeMB`, `maxPerUser`, `maxUploadFiles`, `shareMaxMinutes`, `shareDefaultMinutes`, `uploadAllowExts`, `uploadDenyExts`, `disallowedFolderNames` |
| `connect-terminal` | `connect` | `terminal` | `idleTimeoutSeconds`, `maxConnections` |
| `connect-sftp` | `connect` | `sftp` | `maxUploadFiles` |
| `deploy-preflight` | `deploy` | `preflight` | `minFreeDiskBytes` |
| `iac-files` | `files` | `limits` | `maxSizeMB`, `maxZipSizeMB`, `extensionBlacklist` |
| `tunnel-port-range` | `tunnel` | `port_range` | `start`, `end` |
| `proxy-network` | `proxy` | `network` | `httpProxy`, `httpsProxy`, `noProxy`, `username`, `password` |
| `docker-mirror` | `docker` | `mirror` | `mirrors`, `insecureRegistries` |
| `docker-registries` | `docker` | `registries` | `items` |
| `llm-providers` | `llm` | `providers` | `items` |

## Default Row Seeding

The migration seeds one row for every catalog entry whose source is `custom`.

Representative default values:

- `space/quota`: `maxSizeMB=10`, `maxPerUser=100`, `shareMaxMinutes=60`, `shareDefaultMinutes=30`, `maxUploadFiles=50`
- `connect/terminal`: `idleTimeoutSeconds=1800`, `maxConnections=0`
- `connect/sftp`: `maxUploadFiles=10`
- `files/limits`: `maxSizeMB=10`, `maxZipSizeMB=50`, blacklist string preset
- `tunnel/port_range`: `start=40000`, `end=49999`
- `secrets/policy`: `revealDisabled=false`, `defaultAccessMode=use_only`, `clipboardClearSeconds=0`
- `deploy/preflight`: `minFreeDiskBytes=536870912`

## Platform Rules

### Persistence

- custom settings are stored in `custom_settings`
- consumers use unified `entryId`, not module-specific HTTP paths

### Defaults

- missing rows resolve to a usable fallback object
- backend helpers are responsible for fallback safety

### Sensitive fields

- read returns `"***"` for `password`, `secret`, `apiKey`
- patch with `"***"` preserves stored value

### Structured payloads

- object-list groups use full replace semantics
- wrappers such as `{"items": [...]}` are part of the stable contract

## Current Entry Families

- `space-quota`
- `connect-terminal`
- `connect-sftp`
- `deploy-preflight`
- `iac-files`
- `tunnel-port-range`
- `secrets-policy`
- `proxy-network`
- `docker-mirror`
- `docker-registries`
- `llm-providers`

## Acceptance Criteria

1. Custom settings are exposed only through `/api/settings/entries/{entryId}`.
2. Fallback, mask, preserve, and validation behavior remains stable across all custom entries.
3. Legacy paths such as `/api/settings/workspace/*`, `/api/settings/secrets`, and `/api/settings/tunnel` are outside the module contract.
4. Backend catalog metadata is the source of truth for registration and ordering.
5. New custom entries do not introduce a second transport model.

## Exclusions

- frontend rendering and navigation
- consumer-owned business semantics