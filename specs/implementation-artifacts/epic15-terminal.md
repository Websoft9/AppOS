# Epic 15: Terminal – Connection Framework

**Module**: Terminal | **Status**: In Progress | **Priority**: P1 | **Depends on**: Epic 1, 3, 13

## Overview

Provides the Terminal workspace framework. This epic owns the shared session abstraction, the multi-tab workspace layout, and the embeddable `<TerminalPanel>` component used by interactive workspaces.

Terminal currently centers on **Server Workbench**. Inside a server workspace, `Shell (SSH)` and `Files (SFTP)` are two operation surfaces of the same server context, not separate top-level products. A future **Sandbox** workspace may consume the same framework, but it is a sibling workspace, not a capability mixed into Server Workbench.

---

## Scope Boundaries

| In scope | Out of scope |
|----------|-------------|
| Session / connector interfaces | SSH, SFTP, Docker Exec implementations (→ Epic 20) |
| ConnectError classification system | Resource-specific error handling |
| Terminal workspace layout & routing | Server-specific side panels |
| `<TerminalPanel>` generic component | Server Registry, Server Ops APIs |
| UX conventions (establish, resume, disconnect, split, breadcrumb) | Database consoles, cloud management, API explorers |
| Workspace model: Server Workbench now, Sandbox later | SSH and SFTP as separate top-level entry points |

---

## Architecture

```
Workspace Type (server today, sandbox later)
        ↓
Connector Interface  (backend/domain/servers/)
        ↓
WebSocket / REST  (PocketBase custom route, workspace-scoped)
        ↓
Terminal Workspace UI
  ├─ Shell surface
  └─ Files surface (when supported)
```

### Connector Interface

Defined in `backend/domain/servers/connector.go`. All resource-specific connectors must implement these interfaces.

```go
// Streaming connectors (PTY / shell)
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

Non-streaming connectors (e.g. SFTP) do not implement `Connector` — they open short-lived transport connections per request.

### ConnectError Classification

`ConnectError` is the canonical error type returned by all `Connector.Connect()` implementations. Categories are defined in `connector.go`; individual connectors map their native errors into these categories.

```go
type ConnectErrorCategory string

const (
    ErrCatAuthFailed         ConnectErrorCategory = "auth_failed"
    ErrCatNetworkUnreachable ConnectErrorCategory = "network_unreachable"
    ErrCatConnectionRefused  ConnectErrorCategory = "connection_refused"
    ErrCatCredentialInvalid  ConnectErrorCategory = "credential_invalid"
    ErrCatSessionFailed      ConnectErrorCategory = "session_failed"
    ErrCatServerDisconnected ConnectErrorCategory = "server_disconnected"
)

type ConnectError struct {
    Category ConnectErrorCategory
    Message  string
    Cause    error
}
```

WebSocket control frame schema (JSON, prefixed `0x00`):

```json
{ "type": "error", "category": "<ConnectErrorCategory>", "message": "<human-readable>" }
```

REST connectivity responses include `"category"` and `"reason"` fields when `"status": "offline"`.

---

## Frontend

### Routing

```
/terminal                              → Server Workbench landing page
/terminal/server/:serverId             → server workspace (Epic 20)
```

> Sidebar menu item: **Terminal** (`/terminal`), icon `TerminalSquare`.

If Sandbox is shipped later, the navigation may become:

```text
Terminal
├─ Server Workbench
└─ Sandbox
```

Until then, `/terminal` is the Server Workbench landing page.

### Server Workbench Landing Page

Two-zone layout: top header + bottom split.

```
┌──────────────────────────────────────────────┐
│ Server Workbench                             │  ← header (border-b)
│ Open, resume, and manage server workspaces   │
├────────┬─────────────────────────────────────┤
│[icons] │                                     │  ← collapsible nav + content
│Overview│  Recent / Active + Available Servers│
│Servers │                                     │
└────────┴─────────────────────────────────────┘
```

**Left nav** (collapsible vertical tab bar):
- Default state: **collapsed** (icon-only, `w-12`); click anywhere to expand (`w-44`).
- Toggle button: `PanelLeft` / `PanelLeftClose`.
- Collapsed state shows icon tooltips on hover.
- Auto-collapses when `activeTab === 'overview'`.

**Tabs**:

| Tab | Status | Notes |
|-----|--------|-------|
| Overview | ✅ | Recent or active workspaces + entry actions |
| Servers | ✅ | Active Sessions + Available Servers |

**Overview panel**: recent or active workspaces + primary actions such as Resume, Open Workbench, and Add Server.

**Servers panel**: Active Sessions section (from `loadConnectSession()`) + Available Servers section with Add Server shortcut. Connecting triggers a 2-second minimum feedback dialog.

**Server workspace rule**: `Shell (SSH)` and `Files (SFTP)` belong inside the same server workspace. They are not separate top-level Terminal categories.

**Sandbox note**: a future sandbox shell may appear as a sibling Terminal workspace, not as another tab inside Server Workbench.

### UX Conventions

**Connect flow (minimum 2 s feedback)**
Show "Establishing secure connection…" spinner for at least 2 seconds, even when the connectivity check completes faster.

**Disconnect flow (minimum 2 s feedback)**
Replace disconnect action with a 2-second "Safely disconnecting…" phase before session teardown.

**Idle indicator**: inactive tabs show a visual idle badge; timer is delivered through the Epic 13 Settings Module and semantically owned here.

**Multiple connections**: opening an already-connected resource requires explicit confirmation before creating a second tab.

**Side panel state**: preserved across tab switches within the same resource context; pruned when all tabs for that resource are closed.

### `<TerminalPanel>` Component

Embeddable terminal component for interactive workspaces. Each consuming epic supplies the WebSocket URL.

```
dashboard/src/components/connect/TerminalPanel.tsx
```

**Responsibilities:**
- xterm.js render, auto-fit on resize
- WebSocket lifecycle (connect, ping, reconnect button on drop)
- Control frame parsing: `resize`, `error`, `close`
- ConnectError display with category icon and human-readable label

| Category | Icon | Label |
|----------|------|-------|
| `auth_failed` | KeyRound | Authentication Failed |
| `network_unreachable` | WifiOff | Network Unreachable |
| `connection_refused` | ShieldX | Connection Refused |
| `credential_invalid` | Settings | Credential Config Error |
| `session_failed` | ServerCrash | Session Failed |
| `server_disconnected` | Unplug | Server Disconnected |

**Local preferences** (localStorage, not Epic 13 settings):

| Key | Default | Description |
|-----|---------|-------------|
| `connect.terminal.font_size` | `14` | Terminal font size (px) |
| `connect.terminal.scrollback` | `1000` | Scrollback buffer lines |

Terminal behavior settings (`connect-terminal`) are delivered through the Epic 13 Settings Module, while semantic ownership belongs to Epic 15.
Local browser preferences such as font size and scrollback remain preferences, not shared settings.

### File Structure

```
dashboard/src/
  routes/_app/_auth/_superuser/
    terminal.index.tsx                     # /terminal – Server Workbench landing page
    terminal.server.$serverId.tsx          # /terminal/server/:id
  pages/terminal/
    TerminalIndexPage.tsx                  # Terminal index page component
  components/connect/
    TerminalPanel.tsx                      # generic terminal component
    ServerSelector.tsx                     # (legacy, kept for compatibility)
```

---

## Security Principles (Zero Trust MVP)

1. **Credentials never leave the backend** — Frontend sends only a resource ID; backend decrypts and injects credentials in-memory only. No secret appears in any HTTP response or WebSocket message.
2. **Every session is audited** — All streaming sessions write to the Epic 12 audit log: `user_id`, `resource_id`, `session_id`, `ip`, `started_at`, `ended_at`, `bytes_in`, `bytes_out`.
3. **Minimal session lifecycle** — Valid PB auth token required on WebSocket upgrade; session auto-closes on token expiry or the configured `connect-terminal` idle timeout delivered through the Epic 13 Settings Module.

Post-MVP: session recording/playback, JIT access approval, MFA on connect.

---

## Permissions

| Role | Terminal access |
|------|----------------|
| Superuser | All terminal workspaces |
| Member | Phase 2 (per-workspace grants) |

---

## Out of Scope (MVP)

- In-browser file editing
- SCP batch transfer, SSH port forwarding
- WinRM / RDP (→ deploy Guacamole via app store)
- Session recording/playback, JIT access, MFA
- Member-level resource access control (Phase 2)
- Database consoles
- Cloud resource management
- API explorer / generic remote tooling hub
- SSH and SFTP as separate landing pages

---

## Stories

| Story | Title | Status |
|-------|-------|--------|
| 15.1 | Terminal UI | ✅ Complete |
| 15.2 | Terminal Session Resume | Draft |

All resource-specific stories are tracked in their respective resource epics (e.g. Epic 20 for Servers).