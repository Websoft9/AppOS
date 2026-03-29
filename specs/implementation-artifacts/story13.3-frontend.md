# Story 13.3: Frontend

**Epic**: Epic 13 - Settings Module
**Priority**: P1
**Status**: canonical

## Goal

Render one shared Settings page from backend schema and entry payloads instead of hardcoded route tables, module maps, or feature-specific settings pages.

## Inputs

- `GET /api/settings/schema`
- `GET /api/settings/entries`
- `GET/PATCH /api/settings/entries/{entryId}`
- `POST /api/settings/actions/{actionId}`

## API Shapes Consumed By Frontend

### Schema payload

```json
{
  "entries": [
    {
      "id": "connect-terminal",
      "title": "Connect Terminal",
      "section": "workspace",
      "source": "custom",
      "fields": [
        {
          "id": "idleTimeoutSeconds",
          "label": "Idle Timeout Seconds",
          "type": "integer",
          "helpText": "Disconnect idle terminal sessions after this many seconds."
        }
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

### Entries list payload

```json
{
  "items": [
    {
      "id": "connect-terminal",
      "value": {
        "idleTimeoutSeconds": 1800,
        "maxConnections": 0
      }
    }
  ]
}
```

### Single entry read/write payload

```json
{
  "id": "connect-terminal",
  "value": {
    "idleTimeoutSeconds": 1800,
    "maxConnections": 0
  }
}
```

## Frontend Rules

### Navigation

- navigation is built from schema `section`
- primary order follows backend catalog order
- frontend must not alphabetize the primary nav

### Rendering

- page composition is schema-driven
- entry form internals may stay specialized when needed
- native and custom entries share one page shell

### Save model

- save behavior targets unified `entryId`
- actions target unified `actionId`
- frontend must not route by legacy module paths

## Acceptance Criteria

1. The shared Settings page is schema-driven at the page-composition level.
2. Navigation uses backend sections and backend order.
3. Save/load behavior uses unified entry and action helpers.
4. Native and custom entries coexist without separate settings pages.
5. Frontend does not hardcode `System` and `Workspace` entry membership.

## Exclusions

- backend registration of new entries
- consumer runtime logic after a setting is saved

## Review Follow-ups (AI)

- [ ] [AI-Review][MEDIUM] `sectionLabel()` in `shared.tsx` hardcodes "System" and "Workspace" labels — consider deriving from backend or i18n [dashboard/src/routes/_app/_auth/_superuser/-settings-sections/shared.tsx:L61-69]
- [ ] [AI-Review][LOW] `StringSlice` helper in `settings.go` is defined but unused by settings routes — verify consumer usage or remove [backend/internal/settings/settings.go:L139]
- [ ] [AI-Review][LOW] `nonSensitiveFieldsMatch` uses `fmt.Sprint` for value comparison, which may be unreliable for nested types [backend/internal/routes/settings.go:L342]