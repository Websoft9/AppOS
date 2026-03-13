# Epic 20: Servers

**Module**: Servers | **Status**: In Progress | **Priority**: P1 | **Depends on**: Epic 1, 3, 12, 13, 15, 16

## Overview

Covers all server-domain business: the `servers` resource registry, SSH-based terminal access, SFTP file management, Docker container exec, and server operations (power, ports, systemd). Both frontend and backend are owned here. The Terminal UI framework (tab rail, TerminalPanel component, ConnectError system) is provided by Epic 15.

---

## Scope Boundaries

| In scope | Out of scope |
|----------|-------------|
| Server Registry (CRUD + secrets) | Terminal framework / tab rail (→ Epic 15) |
| SSH PTY backend + shell route | Tunnel establishment (→ Epic 16) |
| SFTP file management | App deployment (→ Epic 17) |
| Docker Exec on server containers | Terminal idle/max-connections settings (→ Epic 13) |
| Server Ops: connectivity, power, ports, systemd | Database / cloud resource types (future epics) |
| Server-specific frontend (Files, Docker panels) | |

---

## Architecture

```
servers collection (PocketBase)
secrets collection (PocketBase)
        ↓
backend/internal/servers/   ← SSH, SFTP, Docker Exec, Session, Ops
        ↓
/api/servers/*  (PocketBase custom routes, RequireSuperuserAuth)
        ↓
dashboard/src/components/connect/
  ServerSelector.tsx
  FileManagerPanel.tsx
  TerminalPanel.tsx  ← from Epic 15 framework
```

### Connectors

| Connector | File | Interface |
|-----------|------|-----------|
| `SSHConnector` | `ssh.go` | Implements `Connector` (streaming PTY) |
| `SFTPConnector` | `sftp.go` | Does NOT implement `Connector` — stateless REST per-request |
| `DockerExecConnector` | `docker_exec.go` | Implements `Connector` (streaming PTY) |

**Tech Stack:**

| Layer | Tech |
|-------|------|
| Terminal render | xterm.js (via Epic 15 `<TerminalPanel>`) |
| WebSocket | PocketBase custom route |
| PTY | `creack/pty` |
| SSH | `golang.org/x/crypto/ssh` |
| SFTP | `github.com/pkg/sftp` |
| Docker Exec | Docker Engine API (`/containers/:id/exec`) |

**Go structure:**

```
backend/internal/servers/
  connector.go        # ConnectError, ConnectErrorCategory, Connector/Session interfaces
  ssh.go              # SSHConnector: dial, auth, PTY relay, classifyDialError
  sftp.go             # SFTPConnector: file list/read/write/transfer via SFTP
  docker_exec.go      # DockerExecConnector: exec + PTY relay
  session.go          # session lifecycle, idle timeout, cleanup
backend/internal/routes/
  server_shell.go     # WS: SSH PTY handler
  server_files.go     # REST: SFTP-backed file operations
  server_ops.go       # REST: connectivity, power, ports, systemd
  server_containers.go  # WS: Docker exec PTY handler
```

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
| `credential` | relation → secrets | ✅ | Credential secret (Password or SSH Key only) |
| `shell` | text | — | Override login shell (empty = server default) |
| `tunnel_server` | relation → servers | — | Required when `connect_type=tunnel` |

> `auth_type` removed — credential type is determined by the secret's `template_id` (`single_value` = Password, `ssh_key` = SSH Key).

### `secrets` collection

See [Epic 19](epic19-secrets.md) for full data model. Servers consume secrets via `credential` relation field, filtered to `template_id ∈ {single_value, ssh_key}` and `status = active`.

---

## Backend API

All custom routes require `RequireSuperuserAuth()`. Server Registry uses PocketBase native records API (standard auth).

**OpenAPI tags:**

| Tag | Scope |
|-----|-------|
| `Server Registry` | Server records CRUD (PB native records) |
| `Server Shell` | SSH PTY WebSocket session |
| `Server Containers` | Docker exec PTY WebSocket session |
| `Server Files` | SFTP-backed file management |
| `Server Ops` | Connectivity, power, ports, systemd |

---

### Server Registry

Standard PocketBase records API for `servers` collection.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/collections/servers/records` | List servers |
| GET | `/api/collections/servers/records/:id` | Get server |
| POST | `/api/collections/servers/records` | Create server |
| PATCH | `/api/collections/servers/records/:id` | Update server |
| DELETE | `/api/collections/servers/records/:id` | Delete server |

---

### Server Shell

| Method | Path | Description |
|--------|------|-------------|
| WS | `/api/servers/:serverId/shell` | Open SSH PTY session |

**WebSocket protocol** (shared with Docker exec — defined in Epic 15 framework):
- Raw bytes: stdin (client→server), stdout/stderr (server→client)
- Control frames (JSON, prefixed `0x00`):
  - `{ "type": "resize", "rows": N, "cols": N }`
  - `{ "type": "error", "category": "...", "message": "..." }`
  - `{ "type": "close" }`

ConnectError categories are defined in Epic 15 (`connector.go`).

---

### Server Containers

Docker exec PTY session on a container running on the server.

| Method | Path | Description |
|--------|------|-------------|
| WS | `/api/servers/containers/:containerId/shell` | Docker exec PTY (`?shell=/bin/sh`) |

Same WebSocket protocol as Server Shell.

**Shell strategy**: tries `/bin/bash`, falls back to `/bin/sh`. Explicit shell override via `?shell=` query param.

---

### Server Files

SFTP-backed file management. Path prefix is protocol-transparent; future resource types may share the same surface.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/servers/:serverId/files/list` | List directory (name, type, size, mode, modified_at) |
| GET | `/api/servers/:serverId/files/search` | Search files by name pattern |
| GET | `/api/servers/:serverId/files/constraints` | Upload/permission constraints for this server |
| GET | `/api/servers/:serverId/files/stat` | Stat a single path |
| GET | `/api/servers/:serverId/files/download` | Stream download |
| POST | `/api/servers/:serverId/files/upload` | Multipart upload |
| POST | `/api/servers/:serverId/files/mkdir` | `{ path }` |
| POST | `/api/servers/:serverId/files/rename` | `{ from, to }` |
| POST | `/api/servers/:serverId/files/chmod` | `{ path, mode }` |
| POST | `/api/servers/:serverId/files/chown` | `{ path, uid, gid }` |
| POST | `/api/servers/:serverId/files/symlink` | `{ linkpath, target }` |
| POST | `/api/servers/:serverId/files/copy` | `{ src, dst }` |
| GET | `/api/servers/:serverId/files/copy-stream` | SSE progress stream for copy |
| POST | `/api/servers/:serverId/files/move` | `{ src, dst }` |
| DELETE | `/api/servers/:serverId/files/delete` | File or directory |
| GET | `/api/servers/:serverId/files/read` | Read file content as text |
| POST | `/api/servers/:serverId/files/write` | Write/overwrite file content |

---

### Server Ops

Server lifecycle management and OS-level inspection via SSH.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/servers/:serverId/ops/connectivity` | Connectivity check (`mode=tcp\|ssh\|tunnel`) |
| POST | `/api/servers/:serverId/ops/power` | `{ action: reboot\|shutdown }` |
| GET | `/api/servers/:serverId/ops/ports` | List listening ports |
| GET | `/api/servers/:serverId/ops/ports/:port` | Inspect a single port (process, state) |
| POST | `/api/servers/:serverId/ops/ports/:port/release` | Kill process holding port |
| GET | `/api/servers/:serverId/ops/systemd/services` | List systemd services |
| GET | `/api/servers/:serverId/ops/systemd/:service/status` | Service status |
| GET | `/api/servers/:serverId/ops/systemd/:service/content` | Service unit file content |
| GET | `/api/servers/:serverId/ops/systemd/:service/logs` | Journald logs |
| POST | `/api/servers/:serverId/ops/systemd/:service/action` | `{ action: start\|stop\|restart\|enable\|disable }` |
| GET | `/api/servers/:serverId/ops/systemd/:service/unit` | Read unit file |
| PUT | `/api/servers/:serverId/ops/systemd/:service/unit` | Write unit file |
| POST | `/api/servers/:serverId/ops/systemd/:service/unit/verify` | Validate unit file syntax |
| POST | `/api/servers/:serverId/ops/systemd/:service/unit/apply` | Write + reload unit |

**Connectivity response schema:**

```json
// Online:
{ "status": "online", "mode": "ssh", "latency_ms": 187 }

// Offline (with error classification):
{ "status": "offline", "mode": "ssh", "category": "auth_failed", "reason": "authentication failed for user \"root\" at host:22 — verify password or key" }
```

---

## Configuration

### Per-server fields (`servers` collection)

| Field | Default | Description |
|-------|---------|-------------|
| `shell` | _(empty)_ | Override login shell. Empty = server SSH default. Use `powershell.exe` for Windows. |

### Per-user preferences (localStorage)

| Key | Default | Description |
|-----|---------|-------------|
| `connect.terminal.font_size` | `14` | Terminal font size (px) |
| `connect.terminal.scrollback` | `1000` | Scrollback buffer lines |
| `connect.sftp.show_hidden` | `false` | Show dot-files (frontend filter; backend always returns all entries) |

### Hard-coded limits (MVP)

| Setting | Value |
|---------|-------|
| SSH connect timeout | 10 s |
| SFTP upload max size | 50 MB |

Terminal behavior settings (idle timeout, max connections) are owned by Epic 13.

---

## Security

1. **Credentials never leave the backend** — Frontend sends only `serverId`; backend decrypts the credential in-memory and injects it into the connector. No secret appears in any HTTP response or WebSocket message.
2. **Every session is audited** — All SSH / SFTP / Docker exec sessions written to Epic 12 audit log: `user_id`, `server_id`, `session_id`, `ip`, `started_at`, `ended_at`, `bytes_in`, `bytes_out`. Key SFTP events (upload, download, delete) logged individually.
3. **Minimal session lifecycle** — Valid PB auth token required on WebSocket upgrade; session auto-closes on token expiry or Epic 13 idle timeout. Docker exec restricted to Superuser only.

Post-MVP: session recording/playback, JIT access approval, MFA on connect.

---

## Permissions

| Role | SSH terminal | SFTP | Docker exec | Server Ops |
|------|-------------|------|-------------|------------|
| Superuser | ✅ All servers | ✅ All servers | ✅ All containers | ✅ |
| Member | Phase 2 | Phase 2 | ❌ | Phase 2 |

---

## Frontend

### Server Connect View

Route: `/connect/server/:serverId` — uses Epic 15 Connect workspace layout.

```
┌──────────────────────────────────────────────────────────┐
│ Connect > Servers      [Shell][Files][Docker][Split]│
├───────────┬──────────────────────────┬───────────────────┤
│ [+ New]   │                          │                   │
│ ● srv-1   │   <TerminalPanel>        │  Files / Docker   │
│ ○ srv-2   │   (SSH PTY via WS)       │  side panel       │
│           │                          │                   │
└───────────┴──────────────────────────┴───────────────────┘
```

SSH and SFTP share the same server context — switching to the Files panel reuses the active server; no separate authentication step.

### Files Side Panel (`<FileManagerPanel>`)

```
dashboard/src/components/connect/FileManagerPanel.tsx
```

- Single-pane table layout with breadcrumb navigation
- Double-click to enter directory
- Context menu: download / rename / delete / chmod
- Drag-and-drop or button upload (max 50 MB)
- Hidden files toggle (persisted to localStorage key `connect.sftp.show_hidden`)

### Docker Side Panel

- Lists containers on the connected server via Docker Engine API proxied through SSH
- Container row action: "Open Terminal" → opens Docker exec `<TerminalPanel>` in a dialog or splits the view

### Embeddable Components

| Component | Props | Used in |
|-----------|-------|---------|
| `<TerminalPanel>` (Epic 15) | `serverId` | Server connect page |
| `<TerminalPanel>` (Epic 15) | `containerId` | Docker tab / Docker page dialog |
| `<FileManagerPanel>` | `serverId` | Server connect page, future integrations |
| `<ServerSelector>` | `onSelect` | `/connect` page |

Docker exec entry point: Docker page → container row action → Dialog with `<TerminalPanel containerId={id} />`.

### File Structure

```
dashboard/src/
  routes/_app/_auth/_superuser/
    connect.server.$serverId.tsx           # /connect/server/:serverId – server workspace
  components/connect/
    ServerSelector.tsx                     # server dropdown for /connect selector
    FileManagerPanel.tsx                   # SFTP file manager side panel
    # TerminalPanel.tsx                    # ← from Epic 15 (generic, shared)
```

---

## Out of Scope (MVP)

- In-browser SFTP file editing (download → edit locally)
- SCP batch transfer, SSH port forwarding
- WinRM / legacy Windows without OpenSSH
- RDP (→ deploy Apache Guacamole via app store)
- Session recording/playback, JIT access, MFA at connect
- Member-level server access control (Phase 2)

---

## Stories

### Story 20.1 — Server Registry

**Status**: ✅ Complete

Establish the `servers` collection and its full CRUD surface. This is a pure data story — no SSH, no terminal, no ops. The collection definition originated in Epic 8; this story formally owns it within the Servers module.

**Backend:**
- Go migration: `servers` collection with all fields (`name`, `host`, `port`, `user`, `connect_type`, `credential`, `shell`, `tunnel_server`)
- API: PocketBase native Records API (`/api/collections/servers/records/*`) — no custom routes needed
- Auth rule: `RequireSuperuserAuth` on all operations

**Frontend:**
- Route: `/resources/servers` (list) + `/resources/servers/new` + `/resources/servers/:id`
- List page: name, host, port, connect_type, credential columns; row actions Edit / Delete
- Form: all fields with credential picker (filtered to `template_id ∈ {single_value, ssh_key}`, `status = active`)
- Tunnel server field shown only when `connect_type = tunnel` (conditional field visibility)

---

| Story | Title | Key Deliverables |
|-------|-------|-----------------|
| 20.1 | Server Registry | `servers` collection migration, PB native CRUD, frontend list/form pages |
| 20.2 | SSH + SFTP | `connector.go`, `ssh.go`, `sftp.go`, all routes, audit log; Connect workspace UI, FileManagerPanel |
| 20.3 | Docker Terminal | `docker_exec.go`, container shell route, shell strategy |
| 20.4 | SFTP Enhancements | file properties, symlink, copy/move progress, upload limits |
| 20.5 | Server Ops | connectivity check (with error category), power, ports, systemd API + frontend |

| Story | Status |
|-------|--------|
| 20.1 | ✅ Complete |
| 20.2 | ✅ Complete |
| 20.3 | ✅ Complete |
| 20.4 | ✅ Complete |
| 20.5 | 🟡 In Review |

---

## Maintenance Updates (2026-03-04)

### 1) Package naming consistency (Review item #13)

- The backend package under `backend/internal/servers/` now uses `package servers` in all source files.
- Route-layer imports were normalized to `servers ".../internal/servers"` for readability and onboarding consistency.
- This aligns Go package naming with directory naming and removes the previous `terminal`/`servers` mismatch.

### 2) Session registry lifecycle control (Review item #14)

- `session.go` was refactored from per-session goroutines to a single background idle monitor (janitor).
- Explicit lifecycle APIs were added:
  - `StartIdleMonitor()`
  - `StopIdleMonitor()`
- Application lifecycle integration:
  - Start on PocketBase `OnServe`
  - Stop on PocketBase `OnTerminate`
- `StopIdleMonitor()` is idempotent and performs cleanup of tracked sessions, improving test isolation and graceful shutdown behavior.
