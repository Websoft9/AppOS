# Story 20.13: Server Detail Cron Tab

**Epic**: Epic 20 - Servers
**Status**: Draft | **Priority**: P1 | **Depends on**: Story 20.5, Story 20.6

## Scope Positioning

This story defines the product-facing UI contract for `Server Detail > Cron`.

It is intentionally small.
The goal is not to build a generic automation center.
The goal is to make one Linux server crontab manageable from the AppOS UI.

This story owns:

- the `Cron` tab naming and scope
- the minimal cron entry list for one server
- create, edit, enable, disable, and delete interactions
- the reduced data contract for one cron entry

This story does not own:

- PocketBase native cron inventory or execution logs
- job history, alerts, retries, or notifications
- `systemd timers`
- arbitrary script library or workflow orchestration
- terminal-based fallback UX as the primary product surface

## Product Boundary

Epic 20 cron and Epic 25 cron are different products.

Epic 20 cron means:

- Linux server crontab management on a managed remote server

Epic 25 cron means:

- PocketBase native cron inventory and execution logs for AppOS internal jobs

MVP must keep these surfaces separate.
Do not collapse them into one shared `System Tasks` concept.

## User Story

As a superuser, I can manage cron entries for one server from the detail page, so that I do not need to SSH into the machine just to make simple scheduled-task changes.

## Product Direction

The tab should feel like a visual `crontab` editor, not like a new scheduler.

The core principle is:

`one server + one crontab target + minimal CRUD`

The UI should optimize for three operator questions:

1. what scheduled entries exist now
2. what will run and when
3. how do I safely change one entry

If a feature does not help answer one of those questions, it should stay out of MVP.

## Minimal Data Contract

Each cron row should expose only:

1. `Name`
2. `Schedule`
3. `Command`
4. `Status`

Field rules:

- `Name` is an AppOS-side label for readability and row targeting
- `Schedule` is the raw five-field cron expression
- `Command` is the raw command text that cron executes
- `Status` is `Enabled` or `Disabled`

MVP should not add:

- timezone selection
- per-entry environment variable editor
- run history
- next-run simulation engine
- advanced expression builder

## Information Architecture

The default `Cron` tab contains exactly three regions:

1. `Toolbar`
2. `Cron Entries`
3. `Entry Editor`

### 1. Toolbar

The toolbar contains only:

- page title
- one `New Entry` action
- one refresh action

Do not add summary cards, filters, analytics, or status charts in MVP.

### 2. Cron Entries

The main surface is a dense table for one server.

Show these columns:

1. `Name`
2. `Schedule`
3. `Command`
4. `Status`
5. `Actions`

Allowed row actions:

- `Edit`
- `Enable` or `Disable`
- `Delete`

The list should default to scan speed, not deep detail.
Long commands may truncate in the table and expand only inside the editor.

### 3. Entry Editor

The editor may open as a drawer, sheet, or inline panel.

It contains only:

- `Name`
- `Schedule`
- `Command`
- `Enabled`

Validation should stay basic:

- schedule must be a valid five-field cron expression
- command must be non-empty
- name may be empty only if product decides to auto-generate one, otherwise require it

## Interaction Rules

### List

- list the current managed crontab entries for the selected server
- show disabled entries clearly
- do not mix AppOS internal cron jobs into this list

### Create

- creating an entry writes one new cron row into the managed target crontab
- success returns the refreshed list

### Edit

- editing replaces the targeted entry, not the entire visible list from the user's perspective
- the product should avoid exposing raw crontab text editing in MVP

### Enable / Disable

- disabling should preserve the entry but mark it inactive in the underlying crontab format
- enabling should restore the original active cron line

### Delete

- delete permanently removes the targeted entry from the managed crontab
- a lightweight confirmation is acceptable

## Backend Contract Direction

Story 20.5 remains the owner of the low-level Server Ops route family.
This story adds the UI-driven requirements for a cron route subset.

Recommended MVP endpoints:

```text
GET    /api/servers/:serverId/ops/cron/jobs
POST   /api/servers/:serverId/ops/cron/jobs
PUT    /api/servers/:serverId/ops/cron/jobs/:entryId
POST   /api/servers/:serverId/ops/cron/jobs/:entryId/enable
POST   /api/servers/:serverId/ops/cron/jobs/:entryId/disable
DELETE /api/servers/:serverId/ops/cron/jobs/:entryId
```

Backend expectations:

- operate on one explicit server-scoped crontab target
- read and write through standard Linux cron mechanisms
- preserve unrelated entries when updating one managed entry
- use a stable `entryId` so the UI does not depend on row index

### Backend Ownership Rule

- Story 20.5 continues to own the route family shape under `/api/servers/:serverId/ops/*`
- Story 20.13 defines only the cron-specific route contract and UI-facing payloads
- the first implementation should add cron endpoints into the existing Server Ops backend rather than creating a new module family

### Managed Entry Rule

MVP should manage only AppOS-recognizable cron entries inside the chosen crontab target.

That means:

- AppOS-created entries carry a stable machine marker so they can be listed and updated safely
- unrelated third-party lines may remain in the crontab file without being editable in MVP
- the UI list should only show entries that the backend can identify as managed cron rows

This is the safety trade-off that keeps the product visual and narrow without pretending to be a full raw crontab editor.

### Suggested Response Shapes

`GET /api/servers/:serverId/ops/cron/jobs`

```json
{
    "items": [
        {
            "entryId": "cron_01jv8k0m4m8f2s",
            "name": "nightly-backup",
            "schedule": "0 2 * * *",
            "command": "/opt/bin/backup.sh",
            "enabled": true,
            "source": "managed"
        }
    ]
}
```

`POST /api/servers/:serverId/ops/cron/jobs`

```json
{
    "name": "nightly-backup",
    "schedule": "0 2 * * *",
    "command": "/opt/bin/backup.sh",
    "enabled": true
}
```

`PUT /api/servers/:serverId/ops/cron/jobs/:entryId`

```json
{
    "name": "nightly-backup",
    "schedule": "0 3 * * *",
    "command": "/opt/bin/backup.sh",
    "enabled": true
}
```

Minimal write response rule:

- create, update, enable, disable, and delete may return either the updated item or a refreshed list envelope
- first rollout should prefer returning the updated item plus a success message to keep UI updates simple

### Error Contract

MVP should keep errors small and operator-readable.

Recommended backend error cases:

- `400` invalid cron expression
- `400` empty command
- `404` managed cron entry not found
- `409` write conflict or target changed during update
- `500` remote cron read or write failed

Suggested error shape:

```json
{
    "code": 400,
    "message": "invalid cron expression"
}
```

### Validation Rules

Backend validation should enforce:

- exactly five cron time fields in MVP
- non-empty command
- maximum label length kept short enough for table rendering
- maximum command length bounded for safe UI handling

Backend should not enforce or simulate:

- shell linting
- command safety inspection
- future schedule preview
- timezone conversion

## Frontend Surface Direction

Story 20.6 remains the owner of the server detail tab shell.
This story defines the `Cron` tab contents inside that shell.

Recommended placement:

- Server Detail tab label: `Cron`
- available only for Linux server targets that support cron management in the backend
- no separate top-level navigation entry in MVP

### Tab Layout

The tab should use a standard two-layer structure:

1. header bar
2. content region

Header bar contents:

- title: `Cron`
- one-line helper copy
- `Refresh` button
- `New Entry` button

Content region contents:

- table by default
- editor drawer only when creating or editing
- simple empty state when there are no managed entries

### Table Behavior

The table should support:

- stable row order from backend response
- truncation for long commands
- immediate status visibility through badge or muted row styling
- row-level overflow menu for `Edit`, `Enable` or `Disable`, `Delete`

The table should not support in MVP:

- client-side filters
- search
- pagination
- inline editing
- row expansion

Reason:

the expected entry count for the first rollout is small, and the fastest useful version is a static list with direct actions.

### Editor Behavior

The editor should open in a drawer or sheet consistent with existing server detail patterns.

Create mode:

- empty `Name`
- empty `Schedule`
- empty `Command`
- `Enabled` checked by default

Edit mode:

- loads the current item values
- save action remains single-step

Buttons:

- `Cancel`
- `Save`

Do not add test-run, preview, duplicate, or advanced toggle sections.

### Empty State

When no managed cron entries exist, the tab should show:

- one short explanation that no AppOS-managed cron entries exist yet
- one `New Entry` action

Do not imply that the server has no cron configuration at all.
The empty state refers only to the managed entry scope.

## UX Copy Direction

Use direct Linux-aware wording without over-explaining cron.

Preferred labels:

- `Cron`
- `New Entry`
- `Schedule`
- `Command`
- `Enabled`
- `Disabled`

Avoid broader labels such as:

- `Automation`
- `Scheduled Jobs`
- `Task Center`

## Acceptance Criteria

- [ ] AC1: Server Detail includes a `Cron` tab for supported server targets.
- [ ] AC2: The tab lists AppOS-managed cron entries for the selected server using `Name`, `Schedule`, `Command`, `Status`, and `Actions` columns.
- [ ] AC3: The tab provides `New Entry`, `Edit`, `Enable`, `Disable`, and `Delete` flows.
- [ ] AC4: Create and edit use the same reduced editor with only `Name`, `Schedule`, `Command`, and `Enabled` fields.
- [ ] AC5: The frontend never mixes PocketBase native cron inventory into this server tab.
- [ ] AC6: Backend write APIs use a stable `entryId` rather than row index semantics.
- [ ] AC7: The backend preserves unrelated non-managed crontab lines during managed entry writes.
- [ ] AC8: Invalid schedule or empty command surfaces an inline validation error or request error without breaking the page.
- [ ] AC9: The tab does not introduce logs, run history, `Run now`, templates, or raw crontab text editing.

## Developer Context

### Backend Surfaces Likely Touched

- `backend/domain/routes/server_ops.go` or the current Server Ops route owner
- `backend/domain/routes/server*_test.go` route tests for auth and validation
- server-domain SSH helper or cron helper under `backend/domain/servers/` or `backend/infra/`
- OpenAPI description for Server Ops routes

### Frontend Surfaces Likely Touched

- the current server detail route and tab model from Story 20.6
- feature-scoped server detail components under `web/src/components/servers/`
- server API client helper for cron list and write calls
- focused tests for the server detail cron tab

### Implementation Order

Build in this order:

1. backend list endpoint plus managed-entry parsing
2. backend create and update paths
3. backend enable, disable, and delete paths
4. frontend read-only table
5. frontend create and edit drawer
6. destructive action confirmations and regression tests

## Tasks / Subtasks

- [ ] Task 1: Add backend cron route subset under existing Server Ops ownership
    - [ ] 1.1 Add list endpoint for managed cron entries
    - [ ] 1.2 Add create endpoint with basic cron validation
    - [ ] 1.3 Add update endpoint by `entryId`
    - [ ] 1.4 Add enable and disable endpoints by `entryId`
    - [ ] 1.5 Add delete endpoint by `entryId`
- [ ] Task 2: Add backend managed-entry persistence rules
    - [ ] 2.1 Define AppOS cron line marker format
    - [ ] 2.2 Preserve unrelated crontab lines during write operations
    - [ ] 2.3 Return stable `entryId` for managed entries
    - [ ] 2.4 Add route tests for auth, validation, and update safety
- [ ] Task 3: Add frontend `Cron` tab surface
    - [ ] 3.1 Mount the tab in the server detail tab rail
    - [ ] 3.2 Render the minimal cron table
    - [ ] 3.3 Add create and edit drawer flow
    - [ ] 3.4 Add enable, disable, and delete actions
    - [ ] 3.5 Add empty state and request-error handling
- [ ] Task 4: Validation
    - [ ] 4.1 Backend tests cover list, create, update, enable or disable, and delete
    - [ ] 4.2 Frontend typecheck passes
    - [ ] 4.3 Focused UI tests cover empty state, edit flow, and delete confirmation

## Out of Scope

- execution logs and historical runs
- manual `Run now`
- cron templates or guided recipes
- environment variable management
- multiple crontab owners per server
- full raw-file editor for `/etc/crontab` or arbitrary files under `/etc/cron.*`

## Acceptance Direction

This story is successful when:

- a superuser can open one server's `Cron` tab and see the current managed cron entries
- a superuser can create, edit, enable, disable, and delete a cron entry from the UI
- the product remains visibly narrow and does not drift into a generic job platform
- PocketBase native cron remains outside this surface

## ASCII Draft

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Server / Cron                                           [ Refresh ] │
│ Scheduled entries for this server                         [ New ]    │
├──────────────────────────────────────────────────────────────────────┤
│ Name             Schedule         Command              Status Action │
│──────────────────────────────────────────────────────────────────────│
│ nightly-backup   0 2 * * *        /opt/bin/backup.sh   Enabled ...  │
│ prune-tmp        0 4 * * 0        find /tmp ...        Disabled ... │
└──────────────────────────────────────────────────────────────────────┘

Editor:

Name      [ nightly-backup            ]
Schedule  [ 0 2 * * *                 ]
Command   [ /opt/bin/backup.sh        ]
Enabled   [ x ]

                    [ Cancel ] [ Save ]
```