# Story 15.5: Server Ops

**Epic**: Epic 15 – Connect: Terminal Ops
**Status**: review | **Priority**: P1 | **Depends on**: Story 15.1, 15.2

## Scope Positioning

This story adds minimal server operations in Connect/Terminal domain:
- power actions: restart / shutdown
- systemd service discovery
- single service status and logs
- lightweight UI entry points in Resource list and Terminal workspace

Resources CRUD stays in Epic 8 (`/api/ext/resources/servers*`).

## UI Scope

- On server resource list page, add `Restart` and `Shutdown` in row actions.
- In Terminal workspace, add `Systemd Services` button next to `Runscript`.
- Clicking `Systemd Services` opens a dialog:
  1. keyword search
  2. select one service result
  3. view actions: `Status` | `Details` | `Logs`
  4. control actions: `Start` | `Stop` | `Restart` | `Enable` | `Disable` (with confirmation)
  5. unit management: read/edit unit file, `Validate` and `Apply` (daemon-reload + restart)

No extra pages are introduced.

## Backend API

All routes are under `/api/ext/terminal/server/{serverId}`.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/power` | Restart / Shutdown (`action` in body) |
| GET | `/systemd/services` | List services matching keyword |
| GET | `/systemd/{service}/status` | Service status |
| GET | `/systemd/{service}/content` | Service unit content (cat) |
| GET | `/systemd/{service}/logs` | Recent journal entries |
| POST | `/systemd/{service}/action` | Control: start/stop/restart/enable/disable |
| GET | `/systemd/{service}/unit` | Read unit file (raw + path) |
| PUT | `/systemd/{service}/unit` | Write unit file (64 KB limit) |
| POST | `/systemd/{service}/unit/verify` | Verify unit file syntax |
| POST | `/systemd/{service}/unit/apply` | Daemon-reload + restart |

## Frontend Integration

- Resource servers page action menu calls `POST /terminal/server/{serverId}/power`.
- Terminal page `Systemd Services` dialog calls:
  - list: `/terminal/server/{serverId}/systemd/services`
  - status: `/terminal/server/{serverId}/systemd/{service}/status`
  - content: `/terminal/server/{serverId}/systemd/{service}/content`
  - logs: `/terminal/server/{serverId}/systemd/{service}/logs`
  - action: `/terminal/server/{serverId}/systemd/{service}/action`
  - unit CRUD: GET/PUT `/terminal/server/{serverId}/systemd/{service}/unit`
  - verify: POST `/terminal/server/{serverId}/systemd/{service}/unit/verify`
  - apply: POST `/terminal/server/{serverId}/systemd/{service}/unit/apply`

## Acceptance Criteria

- [x] AC1: Server list row actions include `Restart` and `Shutdown`, both with confirmation dialog.
- [x] AC2: Power API supports only `restart` and `shutdown`; unsupported actions return 400.
- [x] AC3: Terminal page has `Systemd Services` button beside `Runscript`; click opens one dialog.
- [x] AC4: Dialog supports keyword search and service selection from matched results.
- [x] AC5: After selecting a service, user can view `Status` | `Details` | `Logs` in the same dialog.
- [x] AC6: After selecting a service, user can run `Start` | `Stop` | `Restart` | `Enable` | `Disable` with confirmation.
- [x] AC7: Unit file read/edit is available; `Validate` checks syntax and `Apply` performs daemon-reload + restart.
- [x] AC8: Unit write enforces a 64 KB content limit.
- [x] AC9: All operations require superuser auth and are audit-logged.

## Guardrails

- No arbitrary command passthrough.
- Only allowlisted operations are exposed.
- Keep route shape consistent with existing `/api/ext/terminal/*` design.
- Keep UX in existing pages and one modal only (no additional view hierarchy).

## Out of Scope

- Generic remote command execution API.
- Multi-host batch operations.
- Historical log analytics and export.

## Tasks / Subtasks

- [x] Task 1: Add backend Server Ops API routes under `/api/ext/terminal/server/{serverId}`
  - [x] 1.1 Add power endpoint with allowlist action validation (`restart`/`shutdown`)
  - [x] 1.2 Add systemd services list endpoint with keyword filter
  - [x] 1.3 Add systemd status and logs endpoints for selected service
  - [x] 1.4 Add audit logging for power and systemd operations
- [x] Task 2: Add frontend integration API methods
  - [x] 2.1 Add `serverPower` helper
  - [x] 2.2 Add `listSystemdServices` helper
  - [x] 2.3 Add `getSystemdStatus` and `getSystemdLogs` helpers
- [x] Task 3: Add minimal UI flows
  - [x] 3.1 Servers resource row actions: `Connect` with ping-check modal
  - [x] 3.2 Servers resource row actions: `Restart` and `Shutdown` with confirmation
  - [x] 3.3 Terminal page: `Systemd Services` button + single dialog flow
  - [x] 3.4 Layout preset dropdown changed to 2-column icon-style grid
- [x] Task 4: Validation
  - [x] 4.1 Backend route tests updated for Server Ops
  - [x] 4.2 Backend regression tests pass (`./internal/routes`, `./internal/terminal`)
  - [x] 4.3 Frontend typecheck and tests pass

## Dev Agent Record

### File List

- backend/internal/routes/terminal.go
- backend/internal/routes/terminal_test.go
- dashboard/src/lib/connect-api.ts
- dashboard/src/routes/_app/_auth/resources/servers.tsx
- dashboard/src/pages/connect/ConnectServerPage.tsx
- specs/implementation-artifacts/story15.5-server-ops.md

### Completion Notes

- Implemented Story 15.5 backend APIs in existing terminal route domain with strict action/service validation.
- Added server power action UI (`Restart`/`Shutdown`) in resources servers row actions with confirmation flow.
- Updated servers `Connect` action to match terminal page behavior: ping-check modal before navigation.
- Added `Systemd Services` modal in Connect terminal workspace: keyword search, select service, then `Status | Details | Logs` in one dialog.
- Updated connect split layout preset control to a 2-column icon-style menu.
- Added backend tests for new endpoint validation and auth guards.

### Change Log

- 2026-02-28: Implemented Story 15.5 Server Ops backend + minimal UI flows; aligned server connect UX and terminal layout preset UX.
