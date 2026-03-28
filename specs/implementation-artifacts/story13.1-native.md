# Story 13.1: Native

**Epic**: Epic 13 - Settings Module
**Priority**: P1
**Status**: canonical

## Goal

Expose PocketBase native settings through the unified AppOS Settings module without copying PocketBase business logic into AppOS-specific handlers.

## In Scope

- native entries under one `/api/settings` surface
- schema metadata for native entries
- native read/write adapter behavior
- native entry-bound actions

## Native Entries

- `basic`
- `smtp`
- `s3`
- `logs`

## API Paths

Native entries use the same unified API surface as custom entries:

| Method | Path |
|---|---|
| `GET` | `/api/settings/schema` |
| `GET` | `/api/settings/entries` |
| `GET` | `/api/settings/entries/{entryId}` |
| `PATCH` | `/api/settings/entries/{entryId}` |
| `POST` | `/api/settings/actions/{actionId}` |

Current native action IDs:

- `test-email`
- `test-s3`

## Storage Mapping

Native entries are projections over PocketBase's internal settings object.

| Entry ID | PocketBase group | Exported fields |
|---|---|---|
| `basic` | `meta` | `appName`, `appURL` |
| `smtp` | `smtp` | `enabled`, `host`, `port`, `username`, `password`, `authMethod`, `tls`, `localName` |
| `s3` | `s3` | `enabled`, `bucket`, `region`, `endpoint`, `accessKey`, `secret`, `forcePathStyle` |
| `logs` | `logs` | `maxDays`, `minLevel`, `logIP`, `logAuthId` |

## Native Payload Rules

- read path clones PocketBase settings and exports only catalog-declared fields
- patch path wraps the incoming payload in the owning PocketBase group name and saves the cloned settings object
- native entries do not use the `custom_settings` collection
- field visibility is controlled by the catalog projection, not by returning full PocketBase settings blobs

## Required Contract

### Read/Write

- native entries are loaded and saved through unified entry IDs
- native persistence remains PocketBase-owned behind a thin adapter layer

### Schema

- each entry declares `id`, `title`, `section`, `source`, `fields`
- `source` for this slice is always `native`
- supported actions are declared by schema, not hardcoded in the frontend

### Actions

- `test-email`
- `test-s3`

Actions execute through `POST /api/settings/actions/{actionId}`.

## Acceptance Criteria

1. Native settings are available only through unified `/api/settings` routes.
2. AppOS does not reimplement PocketBase settings business rules.
3. Entry metadata is backend-owned and consumable by the shared Settings page.
4. Native actions remain entry-bound through schema metadata.
5. Backend-defined schema order is preserved for native entries.

## Exclusions

- `custom_settings` persistence
- consumer-specific setting semantics
- frontend composition rules