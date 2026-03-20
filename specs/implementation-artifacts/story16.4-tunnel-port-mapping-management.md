# Story 16.4: Tunnel Port Mapping Management

**Epic**: Epic 16 – SSH Tunnel: Local Server Management
**Status**: backlog | **Priority**: P1 | **Depends on**: Story 16.3

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

- [ ] Add minimal backend mapping model and API (AC: 1,2,3)
  - [ ] Add `GET /api/tunnel/servers/:id/forwards`
  - [ ] Add `PUT /api/tunnel/servers/:id/forwards`
  - [ ] Validate only `connect_type = tunnel` servers can use this surface
- [ ] Keep runtime state separate from desired state (AC: 2,3,4)
  - [ ] Apply stable-reuse-first allocation semantics (AC: 6)
  - [ ] Preserve `tunnel_services` as effective/current mappings
  - [ ] Expose reconnect-required semantics in API/UI wording
  - [ ] Release effective ports only on forward/server removal
- [ ] Add minimal Dashboard UI (AC: 4,5)
  - [ ] Add Tunnel-owned mapping editor/view
  - [ ] Show desired vs effective mappings

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


### Completion Notes List


### File List