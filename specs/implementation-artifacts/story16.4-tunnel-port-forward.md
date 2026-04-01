# Story 16.4: Tunnel Port Forward

**Epic**: Epic 16 – SSH Tunnel: Local Server Management
**Status**: done | **Priority**: P1 | **Depends on**: Story 16.3

---

## User Story

As a superuser, I can manage desired port mappings for a tunnel server, so that AppOS can expose additional local TCP services through the Tunnel module without turning this into a generic Server capability.

---

## Acceptance Criteria

1. Tunnel provides a canonical API to read and replace desired port mappings for one `connect_type = tunnel` server.
2. Desired mappings are Tunnel-owned configuration; `tunnel_services` remains effective/runtime state.
3. Mapping changes do not hot-apply to the current session; they take effect on next reconnect or regenerated setup.
4. Tunnel UI shows desired mappings and current effective mappings separately enough for operators to understand drift.
5. Server UI may expose a Tunnel settings entry, but does not own the port mapping model.
6. Port allocation is stable-reuse-first: reconnect prefers existing effective ports, and release happens on forward/server removal rather than temporary offline state.

## Tasks / Subtasks

- [x] Add minimal backend mapping model and API (AC: 1,2,3)
  - [x] Add `GET /api/tunnel/servers/:id/forwards`
  - [x] Add `PUT /api/tunnel/servers/:id/forwards`
  - [x] Validate only `connect_type = tunnel` servers can use this surface
- [x] Keep runtime state separate from desired state (AC: 2,3,4)
  - [x] Apply stable-reuse-first allocation semantics (AC: 6)
  - [x] Preserve `tunnel_services` as effective/current mappings
  - [x] Expose reconnect-required semantics in API/UI wording
  - [x] Release effective ports only on forward/server removal
- [x] Add minimal Dashboard UI (AC: 4,5)
  - [x] Add Tunnel-owned mapping editor/view
  - [x] Show desired vs effective mappings

## Dev Notes

- Keep first version lean: TCP only.
- Do not implement live in-session reconfiguration in this story.
- Do not turn desired mappings into generic Server fields.
- Do not adopt fully dynamic session-scoped port churn in the first version.

### References

- [Source: specs/implementation-artifacts/epic16-tunnel.md#Desired vs effective mappings]
- [Source: specs/implementation-artifacts/epic16-tunnel.md#Backend API]
- [Source: specs/adr/tunnel-port-forward-ownership.md]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References

- `cd /data/dev/appos/backend && go test ./internal/routes -run 'TestTunnelForwardsGetReturnsDefaultsWhenUnset|TestTunnelForwardsPutValidatesAndPersists|TestTunnelSetupUsesDesiredForwards' -count=1`
- `cd /data/dev/appos/dashboard && npm test -- --run src/pages/system/TunnelsPage.test.tsx`

### Completion Notes List

- Added tunnel-owned desired forwards storage on `servers.tunnel_forwards` with `GET/PUT /api/tunnel/servers/:id/forwards`.
- Kept `tunnel_services` as effective runtime state while setup generation and reconnect allocation read desired forwards separately.
- Reused stable-reuse-first allocation in `internal/tunnel/portpool.go`, including reconnect reuse and forward reconciliation behavior.
- Added `TunnelsPage` port-forward sheet showing `Desired Forwards` and `Effective Mappings` side by side, with reconnect-required save guidance.
- Covered backend default/persist/setup behavior and frontend desired-forward editing flow with tests.

### File List

- `backend/domain/routes/tunnel_handlers.go`
- `backend/domain/routes/tunnel_helpers.go`
- `backend/domain/routes/tunnel.go`
- `backend/domain/routes/tunnel_test.go`
- `backend/domain/tunnel/portpool.go`
- `backend/domain/tunnel/portpool_test.go`
- `dashboard/src/pages/system/TunnelsPage.tsx`
- `dashboard/src/pages/system/TunnelsPage.test.tsx`