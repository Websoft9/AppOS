# Story 13.4: Onboarding

**Epic**: Epic 13 - Settings Module
**Priority**: P1
**Status**: canonical

## Goal

Define the standard delivery path for landing a new module configuration into the shared Settings module.

## Trigger

Use this story when a consumer module needs a new admin-facing config entry.

## Required Inputs

1. consumer owner doc
2. storage source decision: `native` or `custom`
3. entry metadata: `id`, `title`, `section`, `source`, `fields`, optional `actions`
4. defaults and validation rules
5. representative tests for discovery and read/write behavior

## Required Storage Decision

### If source = `native`

- define the PocketBase group projection used by the entry
- expose only catalog-declared fields from that group
- patch via the unified `/api/settings/entries/{entryId}` path only

### If source = `custom`

- define the `(module, key)` pair
- define the default JSON object returned by `DefaultGroup(module, key)`
- ensure the `custom_settings` collection can store the group as one JSON `value` blob
- let migration seeding pick it up through the catalog-backed seed list

## Delivery Checklist

1. define the setting in the consumer epic or story
2. register the entry in the settings catalog
3. add or update backend defaults, validation, and adapter behavior
4. expose it through unified settings routes only
5. ensure the shared Settings page can render and save it
6. add regression coverage

## Canonical Registration Shape

Every new entry must define enough metadata for both API and storage wiring:

| Field | Required for |
|---|---|
| `id` | unified API path and frontend selection |
| `title` | shared Settings UI |
| `section` | left-nav grouping |
| `source` | adapter dispatch |
| `fields` | rendering and projection |
| `actions` | optional action wiring |
| `PocketBaseGroup` or `(module, key)` | storage binding |

## Ownership Split

### Epic 13 owns

- catalog registration
- unified transport shape
- shared mask/default/action conventions
- schema-driven page composition

### Consumer doc owns

- field meaning
- runtime usage
- domain-specific operator guidance
- business validation intent beyond platform-level rules

## Acceptance Criteria

1. Every new config has one consumer owner doc and one Epic 13 registration point.
2. No bespoke feature-specific settings API is introduced.
3. New config lands on the shared Settings page.
4. Platform rules stay centralized in Epic 13.
5. Consumer semantics stay outside Epic 13 unless no consumer owner exists yet.