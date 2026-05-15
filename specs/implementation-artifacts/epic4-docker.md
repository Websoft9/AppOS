# Epic 4: Docker Operations Layer

## Overview

**Docker control-plane API** — AppOS exposes authenticated Docker inventory and action routes for one explicit server scope at a time. All five Docker resource types (compose, images, containers, networks, volumes) remain available, but the API should model server scope directly instead of hiding it behind optional query parameters.

All routes use a unified execution abstraction, but the product contract is server-scoped first:

- `local` means AppOS manages the host Docker daemon through the mounted host `docker.sock`
- non-local server ids resolve to SSH or tunnel-backed Docker execution on that managed server

Epic 4 is the Docker control-plane surface for AppOS.
It answers:

- what Docker objects exist now
- what their current configuration and inventory are
- what operator actions AppOS can execute against them

It does not own runtime telemetry trends or health judgment. Those belong to Epic 28 Monitoring.

**Status**: Stories 4.1-4.3 Complete, 4.4 Deferred | **Priority**: P0 | **Depends on**: Epic 1, Epic 3

## API Direction

This epic should converge on one formal route shape:

- `/api/servers/{serverId}/docker/...`

Planning rules:

- remove the legacy `ext` prefix from the product-facing contract
- do not hide execution scope in optional `server_id` query parameters
- treat `local` as a first-class `serverId`, not as an omitted default
- keep server-discovery or capability-list routes outside the Docker object tree when practical

Current implementation still uses `/api/ext/docker/...` plus optional `server_id` in many places. That is a compatibility shape, not the target product contract.

## Product Boundary

Keep the split minimal and explicit:

| Concern | Epic 4 owns | Epic 28 owns |
|--------|-------------|--------------|
| Containers | inventory, inspect, logs, start/stop/restart/remove | CPU, memory, network telemetry; freshness; health/status projection |
| Images | inventory, inspect, pull, remove, prune, registry checks | not a primary monitoring object in MVP |
| Volumes | inventory, inspect, remove, prune | not a primary monitoring object in MVP |
| Networks | inventory, inspect-equivalent list/create/remove | not a primary monitoring object in MVP |
| Compose | project inventory, config, logs, up/down/start/stop/restart | not a monitor target; may appear only as container labels |

Planning rule:

- Epic 4 owns Docker inventory and actions
- Epic 28 owns runtime evidence and health judgment
- UI may show Epic 28 evidence inside Docker views, but Docker actions remain Epic 4-owned

## Architecture

```
Dashboard (PB JS SDK)
  → pb.send('/api/servers/{serverId}/docker/...', ...)
  → PB auth middleware (RequireAuth)
  → Route handler → server-scoped docker client
        → local: host docker.sock-backed execution from inside AppOS container
        → remote: SSH/tunnel-backed execution on managed server
```

**This epic is a thin control-plane wrapper.** No app store, no deployment orchestration, no task queues. Business logic (app management, async deploy) belongs in a future epic that _consumes_ these APIs.

## Execution Model

Epic 4 has two execution substrates, but one product contract:

1. `local`
    - AppOS runs in a container with the host `/var/run/docker.sock` mounted in
    - local Docker inventory and actions therefore target the host Docker daemon directly
    - some features may use Docker CLI, others may use raw Docker Engine API over the same socket

2. `managed server`
    - Docker inventory and actions run through SSH or tunnel-backed access to the target server
    - the server record is the source of truth for host, auth, and tunnel resolution

The UI should not expose these as two different product modes. It should expose one server-scoped Docker workspace whose backend execution path depends on `serverId`.

## Routes

Target route family:

- `/api/servers/{serverId}/docker/...`

All object and action routes should include `serverId` in the path.
`local` is the canonical local scope.
List responses may still include `host` or `server_id` fields for operator clarity, but routing should not depend on query-time server selection.

### Compose

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/servers/{serverId}/docker/compose/ls` | `docker compose ls --format json` (returns JSON array) |
| POST | `/api/servers/{serverId}/docker/compose/up` | `docker compose up -d` (body: `{projectDir}`) |
| POST | `/api/servers/{serverId}/docker/compose/down` | `docker compose down` (body: `{projectDir, removeVolumes?}`) |
| POST | `/api/servers/{serverId}/docker/compose/start` | `docker compose start` |
| POST | `/api/servers/{serverId}/docker/compose/stop` | `docker compose stop` |
| POST | `/api/servers/{serverId}/docker/compose/restart` | `docker compose restart` |
| GET | `/api/servers/{serverId}/docker/compose/logs` | `docker compose logs --tail` (query: `projectDir, tail`) |
| GET | `/api/servers/{serverId}/docker/compose/config` | Read compose file content |
| PUT | `/api/servers/{serverId}/docker/compose/config` | Write compose file content |

### Images

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/servers/{serverId}/docker/images` | `docker image ls --format json` |
| POST | `/api/servers/{serverId}/docker/images/pull` | `docker pull <name:tag>` |
| DELETE | `/api/servers/{serverId}/docker/images/{id...}` | `docker image rm` (wildcard for `sha256:` prefix) |
| POST | `/api/servers/{serverId}/docker/images/prune` | `docker image prune -f` |
| GET | `/api/servers/{serverId}/docker/images/{id}/inspect` | `docker image inspect` |
| GET | `/api/servers/{serverId}/docker/images/registry/search` | `docker search` (limit capped at 100) |
| GET | `/api/servers/{serverId}/docker/images/registry/status` | Registry connectivity check |

### Containers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/servers/{serverId}/docker/containers` | `docker ps -a --format json` |
| GET | `/api/servers/{serverId}/docker/containers/{id}` | `docker inspect` |
| GET | `/api/servers/{serverId}/docker/containers/{id}/logs` | `docker logs` |
| GET | `/api/servers/{serverId}/docker/containers/{id}/stats` | request-time stats compatibility route |
| POST | `/api/servers/{serverId}/docker/containers/{id}/start` | `docker start` |
| POST | `/api/servers/{serverId}/docker/containers/{id}/stop` | `docker stop` |
| POST | `/api/servers/{serverId}/docker/containers/{id}/restart` | `docker restart` |
| DELETE | `/api/servers/{serverId}/docker/containers/{id}` | `docker rm` (query: `force=true` for force remove) |

### Networks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/servers/{serverId}/docker/networks` | `docker network ls --format json` |
| POST | `/api/servers/{serverId}/docker/networks` | `docker network create` |
| DELETE | `/api/servers/{serverId}/docker/networks/{id}` | `docker network rm` |

### Volumes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/servers/{serverId}/docker/volumes` | `docker volume ls --format json` |
| DELETE | `/api/servers/{serverId}/docker/volumes/{id}` | `docker volume rm` |
| POST | `/api/servers/{serverId}/docker/volumes/prune` | `docker volume prune -f` |
| GET | `/api/servers/{serverId}/docker/volumes/{id}/inspect` | `docker volume inspect` |

### Command Execution

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/servers/{serverId}/docker/exec` | Execute arbitrary docker command (body: `{command}`) |

## Stories (4)

### 4.1: Executor Interface ✅
- Define `Executor` interface (`Run`, `RunStream`, `Ping`, `Host`) — wraps any shell command
- Implement `LocalExecutor` (refactor existing `Client.run()`)
- Refactor `docker.Client` to delegate all `docker` / `docker compose` commands to Executor
- Compose routes: **ls**, up, down, start, stop, restart, logs, config read/write (9 endpoints)
- `Exec()` method + command-execution endpoint for arbitrary docker commands
- Initial implementation may expose compatibility routes before the final server-scoped contract is complete
- **Replaces current `apps.go` routes** → migrate to explicit Docker control-plane routes

### 4.2: Resource Management (Images, Containers, Networks, Volumes) ✅
- Images: list, pull, remove, prune
- Containers: list, inspect, start, stop, restart, remove
- Networks: list, create, remove
- Volumes: list, remove, prune
- All return JSON (Docker `--format json` output)
- All list responses include `host` field (preparation for explicit server scope)

### 4.3: Frontend — Docker Resource Dashboard ✅

Historical delivery note: the originally implemented standalone `/docker` dashboard remains recorded in `story4.3-docker-dashboard.md`, but the current product-facing IA replan for Story 4.3 now lives in `story4.3-docker-workspace-replan.md`.

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
- converge all Docker routes on `/api/servers/{serverId}/docker/...`
- treat `local` as the canonical local target instead of omitting server scope
- retire legacy `/api/ext/docker/...` routing after migration consumers are updated
- Deferred until local implementation is validated

## Implementation Order

```
4.1 (Executor + Compose) → 4.2 (Resources) → 4.3 (Frontend) → 4.4 (Remote, future)
```

## Definition of Done

### Story 4.1 ✅
- [x] Executor interface defined with `Run`, `RunStream`, `Ping`, `Host`
- [x] 9 compose endpoints functional in the current compatibility routing shape
- [x] command-execution endpoint for arbitrary docker commands
- [x] Old `/api/ext/apps/*` routes removed
- [x] Auth middleware enforced on all routes
- [x] Non-root privilege escalation via `sudo` (local + SSH); password credential reused as sudo password

Target follow-up still pending for Story 4.1 scope:

- [ ] final contract uses `/api/servers/{serverId}/docker/...` instead of legacy `/api/ext/docker/...`
- [ ] local and remote execution share one explicit server-scoped route family

### Story 4.2 ✅
- [x] All resource CRUD endpoints return valid JSON with `host` field
- [x] Prune operations safe (skip in-use resources)
- [x] Container start/stop/restart work for standalone containers
- [x] Image delete uses `/{id...}` wildcard for `sha256:` prefix

Target follow-up still pending for Story 4.2 scope:

- [ ] all CRUD routes converge on server-scoped path parameters rather than optional query-time server selection

### Story 4.3 ✅
- [x] 5-tab resource dashboard — server selector, TabsList, Refresh, Run Command all in one toolbar row
- [x] Actions (start/stop/remove/prune) trigger API calls
- [x] Compose logs in full-tier dialog, config editor saves via API
- [x] Run Command dialog (`sm:max-w-3xl`) with server picker + terminal output history

Target follow-up still pending for Story 4.3 scope:

- [ ] frontend routes and API clients use explicit server-scoped Docker paths consistently

### Story 4.4
- [ ] RemoteExecutor connects via SSH key auth
- [ ] `servers` collection auto-created on migration
- [ ] All Story 4.1/4.2 tests pass with RemoteExecutor
- [ ] legacy `/api/ext/docker/...` compatibility routes can be removed after migration

## Technical Notes

**Executor Interface** (backend/infra/docker/executor.go):
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
- All Docker routes should be server-scoped in the path; `server_id` query support is a compatibility layer, not the target design
- `local` is not a hidden default mode. It is a first-class server scope backed by the host-mounted Docker socket
- All list endpoints may still return `host` or `server_id` fields in response — anticipates multi-server UI and audit clarity
- Frontend UX: command execution via dialog popup (not inline or tab) — cleanest separation of concerns
- Dialog sizes standardized in `coding-decisions.md#dialog-sizes` (sm/default/md/lg/xl/full tiers)
- Container image requires `docker-cli` + `docker-cli-compose` packages (both `Dockerfile` and `Dockerfile.local`)
- **Sudo escalation**: `LocalExecutor.SudoEnabled` set when process uid ≠ 0; `SSHExecutor.SudoEnabled` set when `user ≠ root`. Password-auth servers reuse the same credential as sudo password; key-auth servers require NOPASSWD in sudoers.
- Some local Docker features may use raw Docker Engine API over `/var/run/docker.sock` instead of Docker CLI; both still belong to the same Epic 4 control-plane contract

**What moved OUT of Epic 4:**
- Asynq async tasks → future business epic (app management)
- `deployments` collection → future business epic
- App store deploy logic → future business epic
- Environment variable abstraction → compose config read/write replaces it

**Deploy 流程与 IaC API 的关系（设计备忘）：**
部署应用时需将 `/appos/library/apps/{slug}/` 的模板拷贝到 `/appos/data/apps/{appId}/` 作为编排起始文件。此操作是内部流程，不通过 IaC API HTTP 端点，而是直接调用 `internal/fileutil/CopyDir()`，该包同时也是 IaC API 路由层的底层工具库。`/appos/library/` 不在 IaC API 的沙箱范围内，详见 [epic14-iac.md](epic14-iac.md#api-scope-boundary)。

