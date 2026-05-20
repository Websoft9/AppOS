# Story 15.2: Terminal Session Resume

**Epic**: Epic 15 - Terminal Connection Framework
**Status**: Draft | **Priority**: P1 | **Depends on**: Story 15.1, Story 20.2, Story 20.6

## Problem Statement

The current Terminal Hub shows resumable sessions based on frontend local storage only.

That is not a real session contract:

- [web/src/lib/connect-session.ts] stores only UI tab metadata: `tabs`, `activeTabId`, `updatedAt`.
- [web/src/components/connect/TerminalPanel.tsx] always opens a fresh WebSocket on mount and closes it on unmount.
- [backend/domain/routes/terminal_shell.go] closes the SSH session when the WebSocket closes.
- SFTP operations are stateless per request in [backend/domain/terminal/connector_sftp.go], so there is no live file-session object to reattach.

Result: when the user leaves `/terminal/server/:serverId`, the browser component unmounts, the WebSocket closes, the backend SSH session is torn down, and `Resume` can only create a new connection.

## User Story

As a superuser, I can leave a terminal workspace and later resume the same server workspace from the Terminal Hub, so that SSH sessions stay alive across in-app navigation and the Files panel restores to the previous state.

## Goals

1. Resume the same SSH PTY session after in-app navigation when the detach timeout has not expired.
2. Restore workspace state, including side panel mode and file path, when returning from the Terminal Hub.
3. Replace local-storage-only session presence in the Terminal Hub with backend session truth.
4. Preserve explicit disconnect semantics so operators can intentionally terminate remote sessions.

## Non-Goals

- Multi-browser collaborative attach to the same PTY session.
- Session recording or playback.
- Persisting file selection, modal state, or in-progress form edits inside the Files panel.
- Extending the resume contract to Docker exec in the first slice.

## Current Gaps

### Gap 1: session identity is frontend-only

The Terminal Hub derives `Active Sessions` entirely from `connect.session.v1` in local storage. It has no backend query for active SSH sessions, detached sessions, or session ownership.

### Gap 2: WebSocket lifetime equals SSH lifetime

The backend session registry in [backend/domain/terminal/registry.go] tracks active `Session` objects, but the route handlers unregister and close them as soon as the WebSocket is closed. The registry today supports idle timeout only; it does not support detach/reattach.

### Gap 3: Files state is not part of the persisted snapshot

The route [web/src/routes/_app/_auth/_superuser/terminal.server.$serverId.tsx] already accepts `panel`, `path`, and `lockedRoot` search params, but [web/src/pages/connect/ConnectServerPage.tsx] does not persist those values into a resumable backend session contract.

### Gap 4: SFTP has no resumable transport session

Files operations are REST calls that each open a short-lived SFTP-over-SSH client. True `resume` for Files therefore means restoring workspace context, not reattaching a long-lived file transport.

## Proposed Design

## 1. Backend-owned terminal session model

Add a backend session record owned by the authenticated user.

Suggested model:

```go
type TerminalWorkspaceSnapshot struct {
    ActiveServerID string `json:"active_server_id"`
    SidePanel      string `json:"side_panel,omitempty"`   // "none" | "files"
    FilePath       string `json:"file_path,omitempty"`
    LockedRoot     string `json:"locked_root,omitempty"`
    SplitRatio     *float64 `json:"split_ratio,omitempty"`
}

type TerminalSessionSummary struct {
    ID             string    `json:"id"`
    UserID         string    `json:"user_id"`
    ServerID       string    `json:"server_id"`
    SessionType    string    `json:"session_type"` // "ssh"
    State          string    `json:"state"`        // "attached" | "detached" | "closing"
    StartedAt      time.Time `json:"started_at"`
    LastActivityAt time.Time `json:"last_activity_at"`
    DetachExpiresAt time.Time `json:"detach_expires_at,omitempty"`
    Workspace      TerminalWorkspaceSnapshot `json:"workspace"`
}
```

Rules:

- Session IDs must be opaque UUIDs.
- Ownership is enforced server-side through PB auth; users can only list or attach their own sessions.
- Only one active WebSocket attachment is allowed per session at a time.
- Explicit disconnect transitions to `closing` and removes the session immediately.
- Browser navigation away from the workspace transitions to `detached`, not `closed`.

## 2. Detach/reattach lifecycle for SSH

Extend the backend terminal registry so SSH sessions can survive a temporary frontend disconnect.

### Required registry behavior

- `RegisterAttached(sessionID, session, owner, serverID)` creates a live session.
- `Detach(sessionID)` marks the session detached and starts a detach TTL countdown.
- `Attach(sessionID, conn)` rebinds the live PTY to a new WebSocket if the session is still owned by the caller and not expired.
- `Close(sessionID, reason)` closes the PTY and removes the registry entry.

### Timeout policy

- Keep the existing idle timeout for truly inactive sessions.
- Add a shorter detach timeout for abandoned browser navigations, for example 10 minutes.
- When detach timeout expires, the backend closes the PTY and removes the session.

### Output buffering

While detached, the remote shell may keep producing output.

Use a bounded ring buffer per detached session, for example the last 256 KB or last N frames, so reattach can replay recent output without unbounded memory growth.

If the buffer overflows, drop oldest output and mark the session summary with `buffer_truncated=true` for operator transparency.

## 3. API surface

### New REST endpoints

```text
GET    /api/terminal/sessions
GET    /api/terminal/sessions/:sessionId
PATCH  /api/terminal/sessions/:sessionId/workspace
POST   /api/terminal/sessions/:sessionId/disconnect
```

### WebSocket contract

Keep the existing SSH route shape but allow attach by session ID.

```text
WS /api/terminal/ssh/:serverId?token=...                // create new session
WS /api/terminal/ssh/:serverId?token=...&session_id=... // attach existing session
```

Behavior:

- Without `session_id`, the backend creates a new SSH session and returns the generated `session_id` in an initial control frame.
- With `session_id`, the backend validates ownership, server match, and session state, then reattaches.
- If the session cannot be resumed, return a structured control frame with a resumable failure category and the frontend falls back to opening a fresh session after operator confirmation.

Initial control frame example:

```json
{ "type": "session", "session_id": "...", "state": "attached" }
```

## 4. Frontend state model

### Terminal Hub

[web/src/pages/terminal/TerminalIndexPage.tsx] should stop treating local storage as the source of truth for `Active Sessions`.

Replace it with `GET /api/terminal/sessions`.

The Hub should render:

- attached sessions
- detached-but-resumable sessions
- last activity time from backend
- exact resume target from the saved workspace snapshot

Local storage can remain for cosmetic local preferences only, not for resumable-session truth.

### Connect workspace

[web/src/pages/connect/ConnectServerPage.tsx] should accept an optional `sessionId` route search value and use it to attach instead of always creating a fresh SSH session.

Suggested route search:

```ts
type TerminalServerSearch = {
  sessionId?: string
  panel?: 'files'
  path?: string
  lockedRoot?: string
}
```

### Workspace snapshot persistence

Persist a debounced backend workspace snapshot whenever these values change:

- active server tab
- side panel mode
- current file path
- locked root path
- split ratio

This lets the Hub reconstruct the previous view and lets the connect page restore the same Files panel location.

## 5. Files resume semantics

Files do not need a reattached backend transport session.

Resume for Files means:

1. re-open the same server workspace
2. restore `sidePanel = files`
3. restore `currentPath`
4. restore `lockedRoot` if the workspace entered Files from a constrained context

This is already compatible with the existing route search contract in [web/src/routes/_app/_auth/_superuser/terminal.server.$serverId.tsx]. The missing piece is persisting and sourcing those values from backend workspace snapshots rather than transient local state.

## 6. UI contract changes

### Terminal Hub labels

- `Active Sessions` means backend-known SSH sessions that are still attachable.
- `Resume` means `reattach same PTY session and restore workspace snapshot`.
- If the detach TTL has expired, do not show `Resume`; show `Open Terminal` instead.

### Explicit disconnect

The workspace close action must remain authoritative:

- closing the current terminal intentionally calls `POST /api/terminal/sessions/:sessionId/disconnect`
- navigating away inside AppOS should detach, not disconnect

### Expired resume path

If the user clicks Resume after the session expired server-side:

- show a clear message: `Previous terminal session expired. Opened a new connection.`
- do not silently pretend the old session was resumed

## Data Flow

```text
Terminal Hub
  -> GET /api/terminal/sessions
  -> choose session
  -> navigate /terminal/server/:serverId?sessionId=:id&panel=files&path=...

Connect workspace
  -> mount TerminalPanel with sessionId
  -> WS attach or create
  -> receive session control frame with session_id
  -> PATCH /api/terminal/sessions/:sessionId/workspace on debounced UI changes

Browser leaves page
  -> frontend closes WS without explicit disconnect
  -> backend marks session detached
  -> session remains resumable until detach TTL or idle TTL expires
```

## Implementation Slices

### Slice A: backend session truth

- Add terminal session summary model in the backend registry.
- Add `GET /api/terminal/sessions`.
- Change Terminal Hub to consume backend sessions instead of local storage.

This slice fixes stale Hub state even before full PTY resume lands.

### Slice B: SSH detach/reattach

- Extend registry and route handlers for detached session retention.
- Add `session_id` attach support in SSH WebSocket flow.
- Add bounded detached-output replay.

### Slice C: workspace snapshot restore

- Add session workspace snapshot persistence endpoint.
- Persist Files panel state and split ratio.
- Route Resume through saved workspace snapshot.

### Slice D: cleanup and semantics

- Remove local-storage-backed `Active Sessions` semantics.
- Rename stale actions and empty states where needed.
- Add explicit expired-session messaging.

## Risks

1. Detached PTY sessions can keep long-running commands alive. This is intended, but explicit disconnect and detach TTL must remain visible and reliable.
2. Buffered output replay must stay bounded to avoid backend memory growth.
3. Multi-tab browser attach attempts need server-side conflict handling; only one active attachment per session should be allowed in the first version.
4. Files state should be intentionally scoped. Restoring every modal and selection would create high-complexity, low-value persistence.

## Acceptance Criteria

- [ ] Terminal Hub lists backend-known resumable sessions instead of local-storage snapshots.
- [ ] Leaving `/terminal/server/:serverId` by internal navigation does not immediately destroy the SSH PTY session.
- [ ] Resume reattaches to the same PTY session when detach timeout has not expired.
- [ ] Resume restores Files panel state when the previous workspace had the Files panel open.
- [ ] Explicit disconnect closes the backend session immediately and removes it from the Hub.
- [ ] Expired detached sessions are not shown as resumable.
- [ ] A detached session is automatically closed when detach TTL or idle TTL expires.
- [ ] The frontend shows a clear fallback message when an expired session cannot be resumed.

## Technical Direction Summary

`True resume` is not a local-storage problem.

SSH resume requires a backend-owned detachable PTY session model.
Files resume requires workspace snapshot persistence, not a long-lived SFTP transport.

The implementation should therefore move session truth to the backend, keep PTY sessions alive across short-lived frontend disconnects, and treat Files as restorable UI context layered on top of that SSH session.