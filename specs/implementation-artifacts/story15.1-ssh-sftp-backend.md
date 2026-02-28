# Story 15.1: SSH + SFTP Backend

**Epic**: Epic 15 – Connect: Terminal Ops
**Status**: Complete | **Priority**: P1 | **Depends on**: Epic 1, 3, 8

---

## User Story

As a superuser, I can open a terminal session and browse files on any registered server, so that I can manage servers directly from the browser without installing an SSH client.

---

## Implementation

### New files

```
backend/internal/terminal/
  connector.go      # Session & Connector interfaces
  ssh.go            # SSHConnector: dial, PTY alloc, stdin/stdout relay
  sftp.go           # SFTPConnector: per-request SFTP session over SSH transport
  session.go        # idle timeout (30 min), cleanup on PB token expiry
backend/internal/routes/terminal.go   # register all routes below
```

### Connector interfaces (`connector.go`)

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

`SFTPConnector` does **not** implement `Session` – it opens a short-lived SFTP client per HTTP request.

### Credential flow

```
route handler receives serverId
  → app.FindRecordById("servers", serverId)
  → resolve servers.credential → secrets/:id
  → crypto.Decrypt(secret.value)
  → inject into SSHConnector.Connect() [in-memory only]
```

Supports `auth_type`: `password` and `private_key`. Uses `servers.shell` if set; otherwise SSH server default.

### Routes (`/api/ext/terminal/`, `RequireAuth()`)

**SSH – WebSocket**

```
WS  /ssh/:serverId
```

Protocol:
- Raw bytes: stdin ↑ / stdout+stderr ↓
- Control frame (JSON, prefix `0x00`): `{"type":"resize","rows":24,"cols":80}` | `{"type":"error","message":"..."}` | `{"type":"close"}`

Timeouts: SSH dial = 10 s; idle = 30 min; close immediately on PB token expiry.

**SFTP – REST**

```
GET     /sftp/:serverId/list?path=      → { path, entries[] }   # includes name, type, size, mode, modified_at
GET     /sftp/:serverId/download?path=  → stream
POST    /sftp/:serverId/upload?path=    → multipart, max 50 MB
POST    /sftp/:serverId/mkdir           → { path }
POST    /sftp/:serverId/rename          → { from, to }
DELETE  /sftp/:serverId/delete?path=
```

Backend always returns all directory entries (including dot-files). Hidden file filtering is the frontend's responsibility.

### Audit log (Epic 12)

Every connection and key file operation written to audit:

```json
{ "action": "terminal.ssh.connect",  "user_id": "…", "server_id": "…", "session_id": "…", "ip": "…", "started_at": "…", "ended_at": "…", "bytes_in": 0, "bytes_out": 0 }
{ "action": "terminal.sftp.upload",  "user_id": "…", "server_id": "…", "path": "…", "size": 0 }
{ "action": "terminal.sftp.download","user_id": "…", "server_id": "…", "path": "…" }
{ "action": "terminal.sftp.delete",  "user_id": "…", "server_id": "…", "path": "…" }
```

### WebSocket auth – `wsTokenAuth` middleware

WebSocket 无法通过 header 传 Authorization token，改用 URL query param `?token=`。

`wsTokenAuth` 中间件从 query 读 token → `FindAuthRecordByToken` → 设置 `e.Auth`。

**关键决策**: Priority 必须设为 **-1019**（介于 `loadAuthToken`=-1020 和 `RequireAuth`=0 之间）。否则 PocketBase hook 按 Priority 排序时，父级 group 的 `RequireAuth`(0) 会先于子级的 `wsTokenAuth`(0) 执行，导致 401。

> ⚠️ **踩坑记录**: 这个问题经历了 3 轮修复才定位。前两次分别尝试了设 header 和直接 set e.Auth，但都因 Priority 排序导致中间件根本未执行。PocketBase `hook.Hook` 使用 `sort.SliceStable` 按 Priority 升序排列，同 Priority 时保持插入顺序（父 group 先于子 group）。

### SFTP recursive search

```
GET  /sftp/:serverId/search?path=&keyword=&recursive=true  → { results[] }
```

`sftp.go` 新增 `SearchFiles()` 方法，使用 `sftp.Walk` 递归遍历。返回 `SearchResult{Path, Name, Size, IsDir, ModTime}`。

### nginx WebSocket proxy

nginx.conf 需在 `/api/` location 之前添加 WS 专用 location：

```nginx
location ~ ^/api/ext/terminal/(ssh|docker)/ {
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    ...
}
```

> ⚠️ 通用 `/api/` block 设置了 `Connection ""` 会剥离 WebSocket Upgrade 头。

### `servers` collection – new field

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `shell` | text | No | Login shell override. Empty = SSH server default. |

---

## Acceptance Criteria

- [x] `WS /ssh/:serverId` opens a PTY session; stdin/stdout relay works end-to-end
- [x] Resize control frame correctly resizes the remote PTY
- [x] Session closes after 30 min idle or on PB token expiry
- [x] SFTP list returns all entries including dot-files
- [x] SFTP upload rejects files > 50 MB with 413
- [x] SFTP download streams file correctly
- [x] All SSH connect/disconnect and SFTP upload/download/delete events appear in audit log
- [x] Raw SSH credentials (password / private key) never appear in any HTTP response or WebSocket message
- [x] `servers.shell` overrides the login shell when set
- [x] SSH connect times out after 10 s on unreachable host
- [x] WebSocket token auth via `?token=` query param works end-to-end (wsTokenAuth Priority=-1019)
- [x] SFTP recursive search returns matching files across subdirectories
- [x] nginx WS location block correctly proxies WebSocket upgrade

---

## Dev Agent Record

### Files Created/Modified

```
backend/go.mod                                          # added github.com/pkg/sftp
backend/go.sum                                          # updated
backend/internal/migrations/1741400000_add_server_shell.go  # servers.shell field
backend/internal/terminal/connector.go                  # Session & Connector interfaces, ConnectorConfig
backend/internal/terminal/terminal.go                   # LocalSession rename (was Session, conflicts with interface)
backend/internal/terminal/ssh.go                        # SSHConnector: dial, auth, PTY relay
backend/internal/terminal/sftp.go                       # SFTPClient: list, download, upload, mkdir, rename, delete
backend/internal/terminal/session.go                    # session registry with idle timeout (30 min)
backend/internal/terminal/terminal_test.go              # 7 unit tests (session registry, auth method, config)
backend/internal/routes/terminal.go                     # SSH WS + SFTP REST routes, resolveServerConfig, audit
backend/internal/routes/terminal_test.go                # 6 route tests (auth, validation, 400 paths)
backend/internal/routes/routes.go                       # registerTerminalRoutes added
```

### Decisions

- Renamed existing `Session` struct → `LocalSession` to avoid conflict with new `Session` interface
- SSH shell start: tries `cfg.Shell` first, falls back to `sess.Shell()` if custom shell fails
- SFTP uses per-request short-lived connections (not pooled) — simple and stateless for MVP
- `resolveServerConfig` is shared between SSH and SFTP — single point for credential decryption
- `handleControlFrame` strips 0x00 prefix before JSON parse — frontend can send either TextMessage or prefixed BinaryMessage
- **wsTokenAuth Priority=-1019**: PocketBase hook 系统按 Priority 升序执行。`loadAuthToken`(-1020) → `wsTokenAuth`(-1019) → `RequireAuth`(0)。此顺序确保 WS query token 在 RequireAuth 检查前已解析。这是最关键的技术决策
- nginx WS proxy 必须在通用 `/api/` 之前匹配，因为 `/api/` 的 `Connection ""` 会破坏 WebSocket 升级
- SFTP search 使用 `sftp.Walk` 而非 `ReadDir` 递归，简单但大目录树可能慢

### Code Review Fixes

- SSH shell: `sess.Shell()` 作为默认 fallback，不再使用字面量 `"$SHELL"`
- SFTP `WriteFile`: 增加 `sftpMaxWriteBytes`(2MB) 大小限制
- Audit: SSH/Docker 断连审计增加 `bytes_in`/`bytes_out`（`atomic.Int64` 计数）
- Download audit: 移至操作完成后记录，含 success/failure 状态
- Session: `registeredSession` 增加 `done chan struct{}`，`Unregister` 时关闭，idle goroutine 立即退出
- 移除未使用的 `creack/pty` import 和 `io.Discard` 占位
- CORS `CheckOrigin` 添加注释说明
- SSH Host Key 验证：新增 `sshHostKeyCallback()` + `sync.Once` 进程级缓存；优先读 `~/.ssh/known_hosts` 或 `/etc/ssh/ssh_known_hosts`；无 known_hosts 时默认 `InsecureIgnoreHostKey`（与 WS 终端一致）；设 `APPOS_REQUIRE_SSH_HOST_KEY=1` 启用严格模式
- `isExpectedPowerDisconnect()`: 仅匹配 "connection reset"、"broken pipe"、"closed network connection"（移除过宽的 "eof" 和 "connection refused"）
