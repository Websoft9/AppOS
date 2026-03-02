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
- Terminal operations are grouped under a top `Action` menu (right of `Docker`): `Run Script`, `Inspect Ports`, `Manage Services`.
- `Port Inspector` dialog shows occupied/reserved ports, PID as dedicated column, compact table without horizontal scrolling, sorting, and per-row `Release` action.
- `Release` uses confirmation dialog with optional force checkbox and danger warning; execution shows progress state.
- Clicking `Manage Services` opens a dialog:
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
| GET | `/ports` | List all currently occupied/reserved ports (`view=occupancy\|reservation\|all`, optional `protocol=tcp\|udp`) |
| GET | `/ports/{port}` | Unified port occupancy/reservation inspection (`view=occupancy\|reservation\|all`, optional `protocol=tcp\|udp`) |
| POST | `/ports/{port}/release` | Release occupied port owner (`mode=graceful\|force`, optional `protocol=tcp\|udp`) |
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
- Terminal page `Port Inspector` dialog calls:
  - list: `/terminal/server/{serverId}/ports`
  - release: `POST /terminal/server/{serverId}/ports/{port}/release`
- Terminal page `Service Manager` dialog calls:
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
- [x] AC10: Unified port inspection API returns occupancy and reservation sources; reservation includes `container_declared` and degrades safely when Docker is unavailable.
- [x] AC11: Terminal page exposes `Inspect Ports` and `Manage Services` under top `Action` menu.
- [x] AC12: Port list includes PID column, compact layout, sorting, and per-row release action for occupied ports.
- [x] AC13: Release flow uses confirmation dialog with optional force mode warning and in-progress feedback.

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
  - [x] 1.1b Add unified port inspect endpoint (`/ports/{port}`) with `view` and `protocol` validation
  - [x] 1.2 Add systemd services list endpoint with keyword filter
  - [x] 1.3 Add systemd status and logs endpoints for selected service
  - [x] 1.4 Add audit logging for power and systemd operations
  - [x] 1.5 Port reservation sources include `systemd_socket`, `kernel_reserved`, and `container_declared` with Docker-unavailable safe fallback
- [x] Task 2: Add frontend integration API methods
  - [x] 2.1 Add `serverPower` helper
  - [x] 2.2 Add `listSystemdServices` helper
  - [x] 2.3 Add `getSystemdStatus` and `getSystemdLogs` helpers
- [x] Task 3: Add minimal UI flows
  - [x] 3.1 Servers resource row actions: `Connect` with ping-check modal
  - [x] 3.2 Servers resource row actions: `Restart` and `Shutdown` with confirmation
  - [x] 3.3 Terminal page: `Action` menu + `Manage Services` dialog flow
  - [x] 3.3b Terminal page: `Inspect Ports` dialog with compact sortable table + release flow
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
- Added unified port inspection endpoint `GET /api/ext/terminal/server/{serverId}/ports/{port}` with `view=occupancy|reservation|all` and optional `protocol=tcp|udp`.
- Added all-ports endpoint `GET /api/ext/terminal/server/{serverId}/ports` for full occupied/reserved listing.
- Added occupied-port release endpoint `POST /api/ext/terminal/server/{serverId}/ports/{port}/release` with graceful/force mode.
- Reservation detection now includes `container_declared`; when target host has no Docker (or Docker probe fails), API returns a safe probe status instead of failing.
- Port Inspector now uses compact sortable table, dedicated PID column, and per-row release action.
- Release uses styled confirmation dialog with optional force mode, danger warning, and progress feedback.
- Release robustness fixes: cancel now clears transient UI state; invalid release body returns 400; unsuccessful release (still occupied) returns 409 conflict.
- Consolidated terminal tools into top `Action` dropdown menu (with `Run Script` submenu) and removed floating overlays inside terminal content area.
- Added server power action UI (`Restart`/`Shutdown`) in resources servers row actions with confirmation flow.
- Updated servers `Connect` action to match terminal page behavior: ping-check modal before navigation.
- Added `Systemd Services` modal in Connect terminal workspace: keyword search, select service, then `Status | Details | Logs` in one dialog.
- Updated connect split layout preset control to a 2-column icon-style menu.
- Added backend tests for new endpoint validation and auth guards.

### Change Log

- 2026-02-28: Implemented Story 15.5 Server Ops backend + minimal UI flows; aligned server connect UX and terminal layout preset UX.
- 2026-03-02: Added unified server port inspection endpoint and reservation-source extension (`container_declared`) with Docker-unavailable robustness.
- 2026-03-02: Added all-ports list API and Connect Terminal `Ports` dialog entry.
- 2026-03-02: Added port release API + Port Inspector release button and PID-oriented occupancy details.
- 2026-03-02: Code review round 2 — fixed slice-reuse data corruption bug in detectAllPortReservations, removed 5 dead helper functions, added parseRangePorts upper-bound guard (>1024 range skip), added 500ms settling delay before after-check, simplified detectPortOccupancy dead branch, expanded ReleaseServerPortResponse type, added 409 handling in frontend release flow, fixed tab/space indentation, added TestParseRangePortsEdgeCases.
