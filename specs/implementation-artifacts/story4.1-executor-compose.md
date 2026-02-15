# Story 4.1: Executor Interface

**Epic**: Epic 4 - Docker Operations Layer  
**Priority**: P0  
**Status**: Complete  
**Depends on**: Epic 1 (build), Epic 3 (auth)

## User Story
As a developer, I want a unified command execution layer and Docker/Compose REST endpoints, so that all Docker CLI operations (both `docker` and `docker compose`) are accessible via API and the execution layer is ready for future remote support.

## Acceptance Criteria
- [x] `Executor` interface defined with `Run`, `RunStream`, `Ping`, `Host`
- [x] `LocalExecutor` implemented using `os/exec`
- [x] Existing `docker.Client` refactored to use `Executor` interface
- [x] 9 compose endpoints registered under `/api/ext/docker/compose/*`
- [x] `Exec()` method + `/exec` endpoint for arbitrary docker commands
- [x] All endpoints require authentication (PB `RequireAuth`)
- [x] Old `/api/ext/apps/*` routes removed
- [x] `routes.go` updated to register new docker routes

## Definition of Done
- [ ] `Executor` interface + `LocalExecutor` pass unit tests
- [ ] All 8 compose endpoints return correct responses
- [ ] `make start` compiles and runs without errors
- [ ] Unauthenticated requests return 401

---

## Technical Context

### Architecture (layered)

```
Route handler → docker.Client.ComposeUp()  → Executor.Run("docker", "compose", "up", "-d")
                docker.Client.ImageList()   → Executor.Run("docker", "image", "ls")  (Story 4.2)
```

- **Executor**: Generic shell command runner. Not Docker-specific. `Run(ctx, command, args...)` executes any command.
- **Client**: Docker CLI semantic layer. Methods like `ComposeUp()`, `ImageList()` build the correct `docker` args and delegate to Executor.
- **Routes**: HTTP handlers that parse requests, call Client, return JSON.

### Current State

- `backend/internal/docker/docker.go` — `Client` with `run()` via `os/exec`. Methods: Ping, ComposeUp, ComposeDown, ComposeRestart, ComposeStop, ComposeLogs
- `backend/internal/routes/apps.go` — 7 stub routes under `/api/ext/apps/*` (all "not implemented")
- `backend/internal/routes/routes.go` — `registerAppRoutes(g)` to be replaced

### Target State

**1. Executor interface** (`backend/internal/docker/executor.go`):
- `Run(ctx, command, args...) (string, error)` — buffered output
- `RunStream(ctx, command, args...) (io.Reader, error)` — streaming (for logs)
- `Ping(ctx) error`
- `Host() string` — returns server identifier ("local" for LocalExecutor)

**2. LocalExecutor** (`backend/internal/docker/local.go`):
- Move existing `Client.run()` logic here
- `DOCKER_HOST` env set per command

**3. Refactored Client** (`backend/internal/docker/docker.go`):
- `New(exec Executor) *Client`
- All methods delegate to `c.exec.Run("docker", ...)`

**4. Routes** (`backend/internal/routes/docker.go`):
- `registerDockerRoutes(g)` replaces `registerAppRoutes(g)`
- Compose group under `/docker/compose/*`

### API Specification

All compose routes accept `projectDir` to identify which compose project to operate on.

**CLI wrapper routes** (via Executor):

| Endpoint | Method | Body/Query | Docker Command |
|----------|--------|-----------|----------------|
| `/compose/ls` | GET | | `docker compose ls --format json` |
| `/compose/up` | POST | `{"projectDir": "/path"}` | `docker compose up -d` |
| `/compose/down` | POST | `{"projectDir": "/path", "removeVolumes": false}` | `docker compose down [-v]` |
| `/compose/start` | POST | `{"projectDir": "/path"}` | `docker compose start` |
| `/compose/stop` | POST | `{"projectDir": "/path"}` | `docker compose stop` |
| `/compose/restart` | POST | `{"projectDir": "/path"}` | `docker compose restart` |
| `/compose/logs` | GET | `?projectDir=/path&tail=100` | `docker compose logs --tail` |
| `/exec` | POST | `{"command": "ps -a"}` | `docker <command>` (arbitrary) |

**File I/O routes** (direct file read/write, NOT via Executor):

| Endpoint | Method | Body/Query | Operation |
|----------|--------|-----------|----------|
| `/compose/config` | GET | `?projectDir=/path` | Read `docker-compose.yml` |
| `/compose/config` | PUT | `{"projectDir": "/path", "content": "yaml..."}` | Write `docker-compose.yml` |

### Files to Create/Modify

| Action | File | What |
|--------|------|------|
| Create | `backend/internal/docker/executor.go` | Executor interface |
| Create | `backend/internal/docker/local.go` | LocalExecutor implementation |
| Modify | `backend/internal/docker/docker.go` | Client uses Executor, remove `run()` |
| Create | `backend/internal/routes/docker.go` | Compose route handlers |
| Modify | `backend/internal/routes/routes.go` | Replace `registerAppRoutes` → `registerDockerRoutes` |
| Delete | `backend/internal/routes/apps.go` | Replaced by docker.go |

### Error Handling

All errors follow PocketBase format:
```json
{"code": 400, "message": "compose up failed", "data": {"stderr": "..."}}
```

---

## Next Story
**Story 4.2**: Resource Management — Images, Containers, Networks, Volumes endpoints

---

## Dev Notes (added during implementation)

- `Host()` added to Executor interface: returns server identifier, enables frontend to show which server a resource belongs to
- `Exec()` added to Client: runs arbitrary `docker <command>` with `parseCommand()` for shell-like arg splitting
- `/compose/ls` endpoint added (missing from original spec): frontend needs it to list compose projects
- **Key bug**: `docker compose ls --format json` returns a JSON **array**, unlike other `--format json` commands which output NDJSON (one JSON object per line)
- All list route handlers inject `host` field into response via `c.docker.Host()`
