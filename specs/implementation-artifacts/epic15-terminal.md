# Epic 15: Terminal – Connection Framework

**Module**: Terminal | **Status**: In Progress | **Priority**: P1 | **Depends on**: Epic 1, 3, 13

## Overview

Provides the generic, resource-agnostic Terminal UI framework. This epic owns the shared connector abstraction, the multi-tab connection workspace layout, and the embeddable `<TerminalPanel>` component. It does **not** implement any specific resource type — those live in their own epics (Epic 20 for Servers, future epics for databases, cloud, etc.).

---

## Scope Boundaries

| In scope | Out of scope |
|----------|-------------|
| Connector / Session interfaces | SSH, SFTP, Docker Exec implementations (→ Epic 20) |
| ConnectError classification system | Resource-specific error handling |
| Connect page layout & routing | Server-specific side panels |
| `<TerminalPanel>` generic component | Server Registry, Server Ops APIs |
| UX conventions (establish, disconnect, split, breadcrumb) | Shared settings delivery (→ Epic 13 Settings Module) |

---

## Architecture

```
Resource Store (any collection: servers, databases, …)
        ↓
Connector Interface  (backend/domain/servers/)
        ↓
WebSocket / REST  (PocketBase custom route, resource-scoped)
        ↓
<TerminalPanel>  (generic React component, resource-agnostic)
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
/terminal                              → Terminal index (resource hub)
/terminal/server/:serverId             → server workspace (Epic 20)
```

> Sidebar menu item: **Terminal** (`/terminal`), icon `TerminalSquare`.

### Terminal Index Page

Two-zone layout: top header + bottom split.

```
┌──────────────────────────────────────────────┐
│ Terminal                                     │  ← header (border-b)
│ Connecting your remote resources at one place│
├────────┬─────────────────────────────────────┤
│[icons] │                                     │  ← collapsible nav + content
│Overview│  Overview / Servers / Cloud /       │
│Servers │  Databases / APIs panel             │
│Cloud…  │                                     │
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
| Overview | ✅ | Capability cards + Connected Resources list |
| Servers | ✅ | Active Sessions + Available Servers |
| Cloud | 🔜 Coming Soon | |
| Databases | 🔜 Coming Soon | |
| APIs | 🔜 Coming Soon | |

**Overview panel**: capability cards (click Servers card → navigates to Servers tab) + list of resources with an active session.

**Servers panel**: Active Sessions section (from `loadConnectSession()`) + Available Servers section with Add Server shortcut. Connecting triggers a 2-second minimum feedback dialog.

### UX Conventions

**Connect flow (minimum 2 s feedback)**
Show "Establishing secure connection…" spinner for at least 2 seconds, even when the connectivity check completes faster.

**Disconnect flow (minimum 2 s feedback)**
Replace disconnect action with a 2-second "Safely disconnecting…" phase before session teardown.

**Idle indicator**: inactive tabs show a visual idle badge; timer is delivered through the Epic 13 Settings Module and semantically owned here.

**Multiple connections**: opening an already-connected resource requires explicit confirmation before creating a second tab.

**Side panel state**: preserved across tab switches within the same resource context; pruned when all tabs for that resource are closed.

### `<TerminalPanel>` Component

Embeddable, resource-agnostic terminal component. Each resource epic supplies the WebSocket URL.

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
    terminal.index.tsx                     # /terminal – resource hub
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
| Superuser | All resources |
| Member | Phase 2 (per-resource grants) |

---

## Out of Scope (MVP)

- In-browser file editing
- SCP batch transfer, SSH port forwarding
- WinRM / RDP (→ deploy Guacamole via app store)
- Session recording/playback, JIT access, MFA
- Member-level resource access control (Phase 2)
- Database / cloud resource connectors (future epics)

---

## Stories

| Story | Title | Status |
|-------|-------|--------|
| 15.1 | Terminal UI | ✅ Complete |

All resource-specific stories are tracked in their respective resource epics (e.g. Epic 20 for Servers).