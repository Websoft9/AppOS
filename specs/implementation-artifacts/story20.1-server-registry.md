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

### UI Ownership Note

The canonical UI contract for the server form, list page, and detail page now lives in [story20.6-server-ui.md](story20.6-server-ui.md).

Story 20.1 keeps ownership of:

- server registry data model
- PocketBase CRUD contract
- field-level dependencies such as `tunnel_server` visibility and credential filtering

Story 20.6 owns:

- `Connection Type` presentation
- list information architecture
- list/detail navigation model
- detail page UI structure

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

- Added `GET /api/servers/connection` as the server-list read model endpoint owned by the Server Registry story.
- The endpoint returns a server product view with shared `access` state for all server types and tunnel-only `tunnel` lifecycle state for reverse tunnel servers.
- Current implementation intentionally keeps direct-SSH `access` as a derived `unknown` state until a dedicated direct reachability read model exists; tunnel-backed `access` and `tunnel` values are derived from existing tunnel runtime/session facts.
- Added focused route tests for auth, direct/tunnel read-model output, and tunnel setup-required state.
- Switched the servers page to consume `/api/servers/connection` instead of locally re-deriving credential and tunnel list state from PocketBase records plus ad hoc frontend helpers.
- The tunnel detail surface now reads tunnel services from the backend `tunnel.services` view payload rather than from the old main-table `tunnel_services` list column.
- Updated the focused servers page test file to use `/api/servers/connection` fixtures; the original implementation validated the then-current `Access + Tunnel` model, while canonical list/detail UI ownership now lives in Story 20.6.
