# Epic 15: Connect – Terminal & File Manager

**Module**: Connect (Part 1) | **Status**: Complete | **Priority**: P1 | **Depends on**: Epic 1, 3, 8

## Overview

Browser-based server access via SSH + SFTP in a unified interface, plus Docker container terminal. Credentials are sourced exclusively from the Resource Store (`servers` collection); no credential duplication.

---

## Architecture

```
Resource Store (servers)
        ↓
Connector Layer  (backend/internal/terminal/)
        ↓
WebSocket / REST  (PocketBase custom route)
        ↓
React Components  (xterm.js + file manager)
```

**Connectors:**
- `SSHConnector` – SSH session + PTY relay
- `SFTPConnector` – reuses SSH connection, REST-based file operations
- `DockerExecConnector` – Docker socket exec, PTY relay

**Connector interface** – for streaming (terminal) connectors only; reusable by Epic 16, 17:
```go
type Session interface {
    Write(p []byte) (n int, err error)
    Read(p []byte) (n int, err error)
    Resize(rows, cols uint16) error
    Close() error
}

type Connector interface {
    Connect(ctx context.Context, cfg ConnectorConfig) (Session, error)
}
```

`SFTPConnector` does **not** implement this interface – it is a stateless REST service that opens a short-lived SFTP session per request (reusing the SSH transport when possible).

**Tech Stack:**

| Layer | Tech |
|-------|------|
| Terminal render | xterm.js + xterm-addon-fit |
| WebSocket | PocketBase custom route |
| PTY | `creack/pty` |
| SSH | `golang.org/x/crypto/ssh` |
| SFTP | `github.com/pkg/sftp` |

**Go structure:**
```
backend/internal/terminal/
  connector.go      # Connector & Session interfaces
  ssh.go            # SSHConnector (PTY, relay)
  sftp.go           # SFTPConnector
  docker_exec.go    # DockerExecConnector
  session.go        # session lifecycle, timeout, cleanup
backend/internal/routes/terminal.go
```

---

## Backend API

All routes under `/api/ext/terminal/`, require `RequireAuth()`.

### SSH Terminal

| Method | Path | Description |
|--------|------|-------------|
| WS | `/ssh/:serverId` | Open PTY session |

**WebSocket protocol:**
- Raw bytes: stdin (client→server), stdout/stderr (server→client)
- Control frames (JSON, prefixed `0x00`): `resize`, `error`, `close`

Resize is handled via WebSocket control frame only – no separate REST endpoint.

### SFTP

| Method | Path | Description |
|--------|------|-------------|
| GET | `/sftp/:serverId/list?path=` | List directory (includes name, type, size, mode, modified_at) |
| GET | `/sftp/:serverId/download?path=` | Stream download |
| POST | `/sftp/:serverId/upload?path=` | Multipart upload |
| POST | `/sftp/:serverId/mkdir` | `{ path }` |
| POST | `/sftp/:serverId/rename` | `{ from, to }` |
| DELETE | `/sftp/:serverId/delete?path=` | File or directory |

### Docker exec

| Method | Path | Description |
|--------|------|-------------|
| WS | `/docker/:containerId` | `?shell=/bin/sh` |

Resize via WebSocket control frame (same protocol as SSH).

---

## Configuration

### Per-server (`servers` collection – new optional fields)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `shell` | text | _(empty)_ | Override login shell. Empty = server default login shell (SSH default). Set `powershell.exe` for Windows. |

### Per-user preferences (localStorage)

| Key | Default | Description |
|-----|---------|-------------|
| `connect.terminal.font_size` | `14` | Terminal font size (px) |
| `connect.terminal.scrollback` | `1000` | Scrollback buffer lines |
| `connect.sftp.show_hidden` | `false` | Show dot-files in file manager (frontend filter; backend always returns all entries) |

### Server-side limits (hard-coded for MVP)

| Setting | Value |
|---------|-------|
| SSH connect timeout | 10 s |
| Session idle timeout | 30 min |
| SFTP upload max size | 50 MB |

---

## Security (Zero Trust MVP)

1. **Credentials never leave backend** – Frontend sends only `serverId`; backend decrypts and injects into connector in-memory only; no secret ever appears in any HTTP response or WebSocket message.
2. **Every connection is audited** – All SSH / SFTP / Docker exec sessions written to the Epic 12 audit log: `user_id`, `server_id`, `session_id`, `ip`, `started_at`, `ended_at`, `bytes_in`, `bytes_out`. Key SFTP events (upload, download, delete) logged individually.
3. **Minimal session lifecycle** – Valid PB auth token required on WebSocket upgrade; session auto-closes on token expiry or 30-min idle; Docker exec restricted to Superuser only.

Post-MVP: session recording/playback, JIT access approval, MFA on connect.

---

## Permissions

| Role | SSH terminal | SFTP | Docker exec |
|------|-------------|------|-------------|
| Superuser | ✅ All servers | ✅ All servers | ✅ All containers |
| Member | Phase 2 | Phase 2 | ❌ |

---

## Frontend

### Unified Server Connect View

Route: `/connect` (server selector) → `/connect/server/:serverId` (active session)

Single page with two tabs only (`Terminal`, `Files`); SSH and SFTP are not split into separate pages.

```
┌──────────────────────────────────────────────┐
│ [Server selector ▼]  [Terminal | Files]  [⛶] │
├──────────────────────────────────────────────┤
│                                              │
│   xterm.js  /  File Manager  (tab-switched) │
│                                              │
└──────────────────────────────────────────────┘
```

SSH and SFTP share the same server context – switching to the Files tab reuses the active server; no separate authentication.

**Terminal tab**: xterm.js, auto-fit on window resize, reconnect button on disconnect.

**Files tab:**
- Directory tree (left pane) + file list (right pane)
- Breadcrumb navigation; double-click to enter directory
- Context menu: download / rename / delete
- Drag-and-drop or button upload
- Hidden files toggle (persisted to localStorage)

### Embeddable Components

Both panels are standalone React components, usable outside the Connect route:

| Component | Props | Embedded in |
|-----------|-------|-------------|
| `<TerminalPanel>` | `serverId` or `containerId` | Connect page; Docker page (container row → "Open Terminal") |
| `<FileManagerPanel>` | `serverId` | Connect page; future integrations |

Docker exec entry: Docker page → container row action → Dialog with `<TerminalPanel containerId={id} />`.

---

## Out of Scope (MVP)

- Multi-tab / session multiplexing
- In-browser SFTP file editing (download → edit locally)
- SCP batch transfer, SSH port forwarding
- WinRM / legacy Windows without OpenSSH
- RDP (→ deploy Apache Guacamole via app store)
- Session recording/playback, JIT access, MFA (Zero Trust post-MVP)
- Member-level server access control (Phase 2)

---

## Stories

| Story | Title | Key Deliverables |
|-------|-------|-----------------|
| 15.1 | SSH + SFTP backend | `connector.go` interface, `ssh.go`, `sftp.go`, all routes, audit log |
| 15.2 | Terminal & File Manager UI | `<TerminalPanel>`, `<FileManagerPanel>`, server selector, reconnect, hidden file toggle |
| 15.3 | Docker exec | `docker_exec.go`, `<TerminalPanel>` container mode, Docker page integration |
| 15.4 | Terminal & File Manager enhancements | SFTP advanced ops, batch upload limits, share parity with Space, docker terminal shell strategy + connection fix |

| Story | Status |
|-------|--------|
| 15.1 | ✅ Complete |
| 15.2 | ✅ Complete |
| 15.3 | ✅ Complete |
| 15.4 | 🟡 Ready for Dev |
