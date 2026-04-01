# Story 16.3: Tunnel Operations View

**Epic**: Epic 16 – SSH Tunnel: Local Server Management
**Status**: done | **Priority**: P1 | **Depends on**: Story 16.2

---

## User Story

As a superuser, I can open a dedicated tunnel operations view to see which tunnel servers are currently connected and take basic recovery actions, so that tunnel access can be operated from one place without depending on the future Monitor module.

---

## Acceptance Criteria

1. A dedicated `Tunnels` view exists for current-state tunnel operations; it is separate from the setup wizard and is not positioned as a metrics dashboard.
2. The view shows summary cards for `total`, `online`, `offline`, and `waiting for first connect` tunnel servers.
3. The main table shows at least `server`, `group`, `status`, `last seen`, `mapped services/ports`, and `remote address`.
4. Operators can trigger these actions for a tunnel server from the view: `open setup`, `check status`, `disconnect session`, and `rotate token`.
5. Backend exposes canonical tunnel APIs under `/api/tunnel/*`; any legacy ext-prefixed tunnel routes are migrated and not retained as the long-term contract.
6. Tunnel remains the source of truth for current connection state and session control; Monitor is explicitly out of scope except as a future consumer of tunnel events and fields.
7. The story persists minimal operator context for current/last session visibility: `tunnel_connected_at`, `tunnel_remote_addr`, `tunnel_disconnect_at`, and `tunnel_disconnect_reason`.

## Tasks / Subtasks

- [x] Add minimal tunnel operations backend surface (AC: 3,4,5,7)
  - [x] Add `GET /api/tunnel/overview`
  - [x] Add `GET /api/tunnel/servers/:id/session`
  - [x] Add `POST /api/tunnel/servers/:id/disconnect`
  - [x] Persist current/last session operator fields on connect/disconnect
- [x] Migrate tunnel API prefix to canonical domain routes (AC: 5)
  - [x] Move backend route registration from the legacy ext-prefixed tunnel surface to `/api/tunnel/*`
  - [x] Update frontend callers to `/api/tunnel/*`
  - [x] Remove or deprecate legacy ext-prefixed tunnel usage in the implementation
- [x] Add the tunnel operations page in Dashboard (AC: 1,2,3,4)
  - [x] Add summary cards for current state
  - [x] Add a table focused on tunnel servers only
  - [x] Add operator actions with confirmation where destructive
- [x] Preserve module boundaries in UI and API wording (AC: 1,6)
  - [x] Do not add CPU / memory / disk charts to this view
  - [x] Do not place tunnel control actions in Monitor-owned surfaces

## Dev Notes

- This story is a control-plane story, not a monitoring story.
- The page answers: who is connected now, what is mapped, and what can the operator do next.
- Monitor may later consume tunnel events for uptime, disconnect frequency, trends, and alerts, but that work does not belong here.
- Keep the first version lean. Avoid logs, charts, and health scoring in this story.

### References

- [Source: specs/implementation-artifacts/epic16-tunnel.md#Backend API]
- [Source: specs/implementation-artifacts/epic16-tunnel.md#Module boundary]
- [Source: specs/implementation-artifacts/epic16-tunnel.md#Tunnel operations view]
- [Source: specs/planning-artifacts/architecture.md#Route prefix convention]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References

- `cd /data/dev/appos/backend && go test ./internal/routes -run 'TestTunnel(OverviewReturnsEmptyCollections|SessionReturnsDisconnectReasonLabel|SessionReturnsReconnectSummary)$' -count=1`
- `cd /data/dev/appos/dashboard && npm test -- --run src/pages/system/TunnelsPage.test.tsx`

### Completion Notes List

- Added canonical tunnel operations APIs under `/api/tunnel/*`, including overview, session, disconnect, pause, resume, setup, token, logs, and forwards surfaces.
- Persisted operator-facing session fields such as `tunnel_connected_at`, `tunnel_remote_addr`, `tunnel_disconnect_at`, and `tunnel_disconnect_reason` from tunnel session lifecycle hooks.
- Implemented the dedicated `Tunnels` page with current-state summary, tunnel-only table, inline details, connection logs, setup access, status checks, restart connection, pause/resume, and token rotation actions.
- Kept the view focused on tunnel operations rather than Monitor-style metrics; no CPU, memory, disk, or generic health dashboard behavior was added.
- Covered overview/session behavior and frontend operator flows with passing route and page tests.

### File List

- `backend/domain/routes/tunnel.go`
- `backend/domain/routes/tunnel_handlers.go`
- `backend/domain/routes/tunnel_helpers.go`
- `backend/domain/routes/tunnel_test.go`
- `dashboard/src/pages/system/TunnelsPage.tsx`
- `dashboard/src/pages/system/TunnelsPage.test.tsx`
- `dashboard/src/routes/_app/_auth/_superuser/tunnels.tsx`