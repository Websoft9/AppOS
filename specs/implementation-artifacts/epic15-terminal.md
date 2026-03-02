# Epic 15: Connect – Terminal Ops

**Module**: Connect (Part 1) | **Status**: In Progress | **Priority**: P1 | **Depends on**: Epic 1, 3, 8, 13

## Overview

Browser-based server operations with a unified Connect workspace: terminal command execution, SFTP file management, and Docker container terminal. Credentials are sourced exclusively from the Resource Store (`servers` collection); no credential duplication.

---

## Change Request (2026-03-02)

Terminal UI enters optimization phase with the following targets:

1. Support multiple active server connections with vertical tab list and collapse/expand behavior.
2. Add location navigation in Terminal header: `Connect > Servers`.
3. Replace direct disconnect with fixed 2-second safe-exit experience ("Safely disconnecting") before session close.
4. In split view (Docker/Files + Terminal), terminal shell area must support horizontal scrolling and keep visual focus at bottom for current active tab.
5. Replace current split icon usage with two-pane icon semantics; split preset menu includes: `30/70`, `0/100` (hide Terminal shell), `50/50`, `70/30`, `reset`; preset rows are text-only (no per-row icon).
6. Mirror the safe-exit pattern on connect: show a minimum 2-second "Establishing secure connection..." feedback before the terminal tab opens, even when the connectivity check completes faster.

Connect settings ownership clarification:

- Terminal idle timeout
- Max connections (default: `0`, means unlimited)

These settings are managed under Epic 13 (Settings Management), not Epic 15.

---

## Optimization Snapshot (2026-03-02)

The Connect Terminal workspace has completed a major UX stabilization pass in this chat cycle:

- Multi-connection rail now supports dynamic width, improved list-item affordance, and reduced visual redundancy.
- `+ New` action is simplified for creating sessions; repeated connection to an already-connected server now requires explicit confirmation.
- Switching active terminal tabs no longer forces WebSocket reconnect.
- Idle timer is refreshed on active-session switch.
- Files / Docker side panel state is preserved across terminal-tab switching (same server context).
- Server-bound side-panel cache is pruned automatically when all tabs for that server are closed.
- Docker Containers list avoids forced oversized viewport behavior for small datasets.
- Connect flow enforces a minimum 2-second "Establishing secure connection..." feedback (symmetric with the disconnect safe-exit experience).

---

## Proposed Next Improvements (Backlog)

Epic 15 keeps only cross-story themes here to avoid duplication with story-level specs:

- Session reliability and status semantics
- Session restore and quick-return UX
- Side-panel persistence and bounded cache strategy
- Docker tab scroll behavior consistency
- Keyboard accessibility for connect workflows

Detailed implementation candidates are maintained in Story 15.2 follow-up section:
`specs/implementation-artifacts/story15.2-terminal-ui.md`.

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

Terminal behavior settings (idle timeout, max connections) are governed by Epic 13 settings domain.

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

Multi-connection workspace with vertical connection tab rail (collapsible), terminal pane, and optional Docker/Files side panel.

```
┌──────────────────────────────────────────────────────┐
│ Connect Servers            [Terminal][Files][Docker][⛶]│
├───────────┬─────────────────────────┬────────────────┤
│ [+ New]   │                         │                │
│ ● srv-1   │   xterm.js terminal     │  Files/Docker  │
│ ○ srv-2   │   (active tab content)  │  side panel    │
│           │                         │  (optional)    │
└───────────┴─────────────────────────┴────────────────┘
```

SSH and SFTP share the same server context – switching to the Files side panel reuses the active server; no separate authentication.

**Terminal tab**: xterm.js, auto-fit on window resize, reconnect button on disconnect.

**Files side panel:**
- Single-pane table layout with breadcrumb navigation
- Double-click to enter directory
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
| 15.2 | Terminal UI | `<TerminalPanel>`, server selector, reconnect, unified terminal workspace shell execution + 2026-03 optimization scope |
| 15.3 | Docker Terminal | `docker_exec.go`, `<TerminalPanel>` container mode, shell strategy, connection stability |
| 15.4 | SFTP Enhancements | file properties/symlink/copy-move progress, upload limits, share parity with Space |
| 15.5 | Server Ops | server list restart/shutdown actions, Terminal systemd dialog, service status/log APIs |

| Story | Status |
|-------|--------|
| 15.1 | ✅ Complete |
| 15.2 | ✅ Complete |
| 15.3 | ✅ Complete |
| 15.4 | 🟡 Ready for Dev |
| 15.5 | ⚪ Draft |
