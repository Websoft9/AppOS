# Story 15.3: Docker Terminal

**Epic**: Epic 15 – Connect: Terminal Ops
**Status**: Complete | **Priority**: P1 | **Depends on**: Story 15.1, 15.2

## Scope Positioning

This story owns all Docker terminal concerns in Epic 15, including shell selection strategy and Docker terminal connection stability fixes.

---

## User Story

As a superuser, I can open a terminal inside any running container directly from the Docker page, so that I can debug containers without leaving the UI.

---

## Implementation

### Backend (`backend/internal/terminal/docker_exec.go`)

`DockerExecConnector` implements the `Session` interface via Docker socket (`/var/run/docker.sock`).

```
WS  /api/ext/terminal/docker/:containerId   ?shell=/bin/sh (default)
```

- Calls Docker API `POST /containers/{id}/exec` → `POST /exec/{id}/start` with `AttachStdin`, `AttachStdout`, `Tty: true`
- Relay: same raw-bytes + control-frame protocol as SSH terminal
- `containerId` accepts both container name and ID
- Default shell: `/bin/sh` (bash not guaranteed in all images)
- Restricted to Superuser role

Audit log on connect and disconnect:

```json
{ "action": "terminal.docker.exec", "user_id": "…", "container_id": "…", "session_id": "…", "ip": "…", "started_at": "…", "ended_at": "…" }
```

### Frontend

No new route. Entry point: Docker page → container row action menu → **"Open Terminal"**.

Opens a `<Dialog size="full">` containing `<TerminalPanel containerId={containerId} />`.

`TerminalPanel` already supports `{ containerId }` prop (Story 15.2); this story wires the Docker page trigger.

```
dashboard/src/routes/_app/_auth/docker.tsx
  → container row actions: add "Open Terminal" item
  → on click: set activeContainerId state, open Dialog
  → Dialog: <TerminalPanel containerId={activeContainerId} />
```

No file manager for containers (SFTP targets registered servers, not ephemeral containers).

---

## Acceptance Criteria

- [x] Docker page container row has "Open Terminal" action
- [x] Clicking opens a full-screen Dialog with a working xterm.js terminal
- [x] Terminal connects to the correct container via Docker exec
- [x] Resize control frame works inside the Dialog
- [x] Default shell is `/bin/sh`; custom shell supported via `?shell=` (not exposed in UI for MVP)
- [x] Docker terminal supports auto shell strategy (`/bin/bash` → `/bin/sh` → `/bin/zsh`) when manual shell is not selected
- [x] Docker terminal supports manual shell selection (`sh` / `bash` / `zsh`) from UI
- [x] Closing the Dialog disconnects the exec session
- [x] Connect and disconnect events appear in audit log
- [x] Action is hidden / returns 403 for non-Superuser roles
- [x] Key Docker terminal connection failure paths are handled with explicit user-facing errors and reconnectability

---

## Dev Agent Record

### Files Created/Modified

```
backend/internal/terminal/docker_exec.go            # DockerExecConnector, Session impl via Docker socket
backend/internal/terminal/terminal_test.go          # +3 tests: default shell, socket, interface check
backend/internal/routes/terminal.go                 # handleDockerExecTerminal + route registration
backend/internal/routes/terminal_test.go            # +1 test: TestDockerExecRequiresAuth
dashboard/src/components/docker/ContainersTab.tsx   # Added onOpenTerminal prop + "Terminal" menu item
dashboard/src/routes/_app/_auth/docker.tsx           # Added TerminalPanel Dialog for docker exec
```

### Decisions

- Used raw Docker Engine API over unix socket (`/var/run/docker.sock`) — not Docker CLI
- exec/start with Connection: Upgrade → hijacked bidirectional I/O, same relay pattern as SSH
- Terminal action only visible for running containers (`c.State === "running"`)
- Default shell `/bin/sh` (not bash) since many containers don't have bash
- Reused `<TerminalPanel containerId={id} />` from Story 15.2 — zero duplication
- Docker exec WS 同样受益于 `wsTokenAuth` Priority=-1019 修复（共享同一 terminal group），无需额外处理
- nginx WS location regex 同时覆盖 `/api/ext/terminal/ssh/` 和 `/api/ext/terminal/docker/`

### Code Review Fixes

- `bufferedConn`: 包装 `net.Conn` + `bufio.Reader`，防止 HTTP hijack 后首字节丢失
- Context cancellation: `Connect()` 用 goroutine+select 包装，支持 context 取消
- Shell 选择器: Docker exec 对话框增加 sh/bash/zsh 选项，TerminalPanel 增加 `shell` prop
- Audit: Docker relay 循环增加 `bytes_in`/`bytes_out` 原子计数
