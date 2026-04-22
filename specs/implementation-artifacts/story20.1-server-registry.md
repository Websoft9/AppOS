# Story 20.1: Server Registry

**Epic**: Epic 20 – Servers
**Status**: Complete | **Priority**: P1 | **Depends on**: Epic 1, 3, 19

---

## User Story

As a superuser, I can add, view, edit, and delete server records, so that SSH targets are available for terminal access, file management, and deployment.

---

## Data Model

### `servers` collection

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | text | ✅ | Display name |
| `host` | text | ✅ | Hostname or IP |
| `port` | number | ✅ | SSH port (default: 22) |
| `user` | text | ✅ | Login username |
| `connect_type` | select | ✅ | `direct` \| `tunnel` |
| `credential` | relation → secrets | ✅ | Password or SSH Key secret |
| `shell` | text | — | Override login shell (empty = server default) |
| `tunnel_server` | relation → servers | — | Required when `connect_type = tunnel` |

> Full field rationale in [Epic 20 — Data Model](epic20-servers.md#data-model).

---

## Implementation

- **Migration**: Go migration defining the `servers` collection above
- **API**: PocketBase native Records API — no custom routes; all operations via `/api/collections/servers/records/*`
- **Frontend**: `/resources/servers` list page + create/edit form; credential picker filtered to `template_id ∈ {single_value, ssh_key}` and `status = active`; `tunnel_server` field shown only when `connect_type = tunnel`

### Connection Type UX

- `Connection Type` is a mode decision, not a low-context enum; the create/edit form should present it as two parallel choice cards rather than a plain dropdown.
- Field helper copy should stay short and use the product name `AppOS`: `Choose how this server connects to AppOS.`
- Each option should use one decision-oriented sentence instead of separate definition and "best for" blocks.
- `Direct SSH`: `Use when AppOS can reach this server directly over SSH.`
- `Reverse Tunnel`: `Use when this server is in a private or restricted network and must connect back to AppOS.`
- Avoid `?`-only disclosure for the primary explanation; the user should understand the difference without opening a tooltip.

### Servers List Information Architecture

- The server list should not expose tunnel implementation details such as mapped tunnel ports in the main table.
- The shared connectivity column should be named `Access`, not `Status`, and should answer one user question for every server type: `Can AppOS use this server right now?`
- `Access` is the cross-type availability signal.
- `Direct SSH`: current SSH reachability / connectivity result.
- `Reverse Tunnel`: current tunnel availability result.
- Tunnel-specific lifecycle state should be shown in a separate `Tunnel` column for tunnel servers only.
- `Tunnel` is not a duplicate of `Access`; it represents tunnel onboarding / readiness state, not generic availability.
- Preferred `Tunnel` values in the server list are product-facing lifecycle states such as `Setup Required`, `Ready`, or equivalent terminology approved by the tunnel domain contract.
- Do not keep the old `Tunnel Ports` column in the main server table; mapped services or ports belong in tunnel detail surfaces, not in the primary list scan.

> Collection migration originated in Epic 8; ownership transferred to Epic 20 as of the Epic 8 refactor.

## Dev Agent Record

### File List

- backend/domain/resource/servers/view.go
- backend/domain/routes/server.go
- backend/domain/routes/server_view.go
- backend/domain/routes/server_test.go
- web/src/routes/_app/_auth/resources/servers.tsx
- web/src/routes/_app/_auth/resources/-servers.test.tsx

### Completion Notes

- Added `GET /api/servers/view` as the server-list read model endpoint owned by the Server Registry story.
- The endpoint returns a server product view with shared `access` state for all server types and tunnel-only `tunnel` lifecycle state for reverse tunnel servers.
- Current implementation intentionally keeps direct-SSH `access` as a derived `unknown` state until a dedicated direct reachability read model exists; tunnel-backed `access` and `tunnel` values are derived from existing tunnel runtime/session facts.
- Added focused route tests for auth, direct/tunnel read-model output, and tunnel setup-required state.
- Switched the servers page to consume `/api/servers/view` instead of locally re-deriving credential and tunnel list state from PocketBase records plus ad hoc frontend helpers.
- The tunnel detail surface now reads tunnel services from the backend `tunnel.services` view payload rather than from the old main-table `tunnel_services` list column.
- Updated the focused servers page test file to use `/api/servers/view` fixtures and revalidated the page against the accepted `Access + Tunnel` column model.
