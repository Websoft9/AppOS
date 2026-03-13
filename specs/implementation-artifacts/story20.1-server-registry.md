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

> Collection migration originated in Epic 8; ownership transferred to Epic 20 as of the Epic 8 refactor.
