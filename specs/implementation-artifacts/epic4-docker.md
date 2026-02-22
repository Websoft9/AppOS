# Epic 4: Docker Operations Layer

## Overview

**Pure Docker CLI abstraction** — PocketBase custom routes wrapping `docker` and `docker compose` commands. Zero business logic. All five Docker resource types (compose, images, containers, networks, volumes) exposed as authenticated REST endpoints.

All routes use unified `Executor` interface for command execution (local subprocess now, SSH remote later).

**Status**: Stories 4.1-4.3 Complete, 4.4 Deferred | **Priority**: P0 | **Depends on**: Epic 1, Epic 3

## Architecture

```
Dashboard (PB JS SDK)
  → pb.send('/api/ext/docker/...', ...)
  → PB auth middleware (RequireAuth)
  → Route handler → docker.Client → Executor.Run()
      → LocalExecutor: os/exec (default)
      → RemoteExecutor: SSH (future)
```

**This epic is a thin CLI wrapper.** No app store, no deployment orchestration, no task queues. Business logic (app management, async deploy) belongs in a future epic that _consumes_ these APIs.

## Routes

All routes under `/api/ext/docker/`. All list responses include `host` field identifying the server. Localhost only (remote server support in Story 4.4).

### Compose

| Method | Path | Description |
|--------|------|-------------|
| GET | `/compose/ls` | `docker compose ls --format json` (returns JSON array) |
| POST | `/compose/up` | `docker compose up -d` (body: `{projectDir}`) |
| POST | `/compose/down` | `docker compose down` (body: `{projectDir, removeVolumes?}`) |
| POST | `/compose/start` | `docker compose start` |
| POST | `/compose/stop` | `docker compose stop` |
| POST | `/compose/restart` | `docker compose restart` |
| GET | `/compose/logs` | `docker compose logs --tail` (query: `projectDir, tail`) |
| GET | `/compose/config` | Read compose file content |
| PUT | `/compose/config` | Write compose file content |

### Images

| Method | Path | Description |
|--------|------|-------------|
| GET | `/images` | `docker image ls --format json` |
| POST | `/images/pull` | `docker pull <name:tag>` |
| DELETE | `/images/{id...}` | `docker image rm` (wildcard for `sha256:` prefix) |
| POST | `/images/prune` | `docker image prune -f` |

### Containers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/containers` | `docker ps -a --format json` |
| GET | `/containers/:id` | `docker inspect` |
| POST | `/containers/:id/start` | `docker start` |
| POST | `/containers/:id/stop` | `docker stop` |
| POST | `/containers/:id/restart` | `docker restart` |
| DELETE | `/containers/:id` | `docker rm` |

### Networks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/networks` | `docker network ls --format json` |
| POST | `/networks` | `docker network create` |
| DELETE | `/networks/:id` | `docker network rm` |

### Volumes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/volumes` | `docker volume ls --format json` |
| DELETE | `/volumes/:id` | `docker volume rm` |
| POST | `/volumes/prune` | `docker volume prune -f` |

### Command Execution

| Method | Path | Description |
|--------|------|-------------|
| POST | `/exec` | Execute arbitrary docker command (body: `{command}`) |

## Stories (4)

### 4.1: Executor Interface ✅
- Define `Executor` interface (`Run`, `RunStream`, `Ping`, `Host`) — wraps any shell command
- Implement `LocalExecutor` (refactor existing `Client.run()`)
- Refactor `docker.Client` to delegate all `docker` / `docker compose` commands to Executor
- Compose routes: **ls**, up, down, start, stop, restart, logs, config read/write (9 endpoints)
- `Exec()` method + `/exec` endpoint for arbitrary docker commands
- Register routes under `/api/ext/docker/compose/*`
- **Replaces current `apps.go` routes** → migrate to `/compose/*`

### 4.2: Resource Management (Images, Containers, Networks, Volumes) ✅
- Images: list, pull, remove, prune
- Containers: list, inspect, start, stop, restart, remove
- Networks: list, create, remove
- Volumes: list, remove, prune
- All return JSON (Docker `--format json` output)
- All list responses include `host` field (preparation for multi-server)

### 4.3: Frontend — Docker Resource Dashboard ✅
- Tabbed page: Containers | Images | Volumes | Networks | Compose
- Single toolbar row: server selector → TabsList → Refresh → Run Command button
- Refresh triggers `refreshSignal` prop increment; each tab re-fetches on change
- Run Command dialog (`sm:max-w-3xl`, 768px) with server picker + terminal output history
- List views with host column for each resource type
- Action buttons: start/stop/restart/remove/prune per resource
- Compose: logs viewer (full tier dialog) + config editor
- Depends on: Epic 7 (design system, layout), Story 4.1 + 4.2 (API)

### 4.4: Remote Execution (Future)
- `RemoteExecutor` via `crypto/ssh` with connection pooling
- PB collection `servers` (host, port, ssh_user, ssh_key_path, is_default), auto-migration
- Add `?server=<id>` query parameter to all routes (omitted = localhost, backward compatible)
- Deferred until local implementation is validated

## Implementation Order

```
4.1 (Executor + Compose) → 4.2 (Resources) → 4.3 (Frontend) → 4.4 (Remote, future)
```

## Definition of Done

### Story 4.1 ✅
- [x] Executor interface defined with `Run`, `RunStream`, `Ping`, `Host`
- [x] 9 compose endpoints functional (including `/compose/ls`)
- [x] `/exec` endpoint for arbitrary docker commands
- [x] Old `/api/ext/apps/*` routes removed
- [x] Auth middleware enforced on all routes

### Story 4.2 ✅
- [x] All resource CRUD endpoints return valid JSON with `host` field
- [x] Prune operations safe (skip in-use resources)
- [x] Container start/stop/restart work for standalone containers
- [x] Image delete uses `/{id...}` wildcard for `sha256:` prefix

### Story 4.3 ✅
- [x] 5-tab resource dashboard — server selector, TabsList, Refresh, Run Command all in one toolbar row
- [x] Actions (start/stop/remove/prune) trigger API calls
- [x] Compose logs in full-tier dialog, config editor saves via API
- [x] Run Command dialog (`sm:max-w-3xl`) with server picker + terminal output history

### Story 4.4
- [ ] RemoteExecutor connects via SSH key auth
- [ ] `servers` collection auto-created on migration
- [ ] All Story 4.1/4.2 tests pass with RemoteExecutor

## Technical Notes

**Executor Interface** (backend/internal/docker/executor.go):
```go
type Executor interface {
    Run(ctx context.Context, command string, args ...string) (string, error)
    RunStream(ctx context.Context, command string, args ...string) (io.Reader, error)
    Ping(ctx context.Context) error
    Host() string  // returns server identifier ("local" for LocalExecutor)
}
```

**Key Decisions & Learnings:**
- `docker compose ls --format json` returns a JSON **array**, unlike other `--format json` commands which return NDJSON
- Image IDs with `sha256:` prefix break standard path routing → use PocketBase `/{id...}` wildcard
- All list endpoints return `host` field in response — anticipates multi-server UI
- Frontend UX: command execution via dialog popup (not inline or tab) — cleanest separation of concerns
- Dialog sizes standardized in `coding-decisions.md#dialog-sizes` (sm/default/md/lg/xl/full tiers)
- Container image requires `docker-cli` + `docker-cli-compose` packages (both `Dockerfile` and `Dockerfile.local`)

**What moved OUT of Epic 4:**
- Asynq async tasks → future business epic (app management)
- `deployments` collection → future business epic
- App store deploy logic → future business epic
- Environment variable abstraction → compose config read/write replaces it

