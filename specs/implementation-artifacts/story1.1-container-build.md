# Story 1.1: Container Build & Deployment

**Epic**: Epic 1 - Infrastructure & Build System  
**Priority**: P0  
**Status**: Ready for Dev

---

## User Story

As a developer, I need Dockerfiles and container configurations to package the All-in-One container with all services.

## Architecture Context

**Container Architecture**:
- Single container running services via supervisord
- Internal Nginx routes Dashboard (/) and PocketBase API (/api, /_)
- Persistent data volume: `/appos/data`
- No external dependencies (fully self-contained)

**Services Inside Container**:
1. **AppOS (port 8090)** - PocketBase framework with custom extensions
   - Built-in: Auth, DB (SQLite), Realtime, Admin UI
   - Custom routes: Docker ops, proxy management, terminal, backup
   - Asynq worker (embedded in same process)
2. **Redis (port 6379)** - Asynq task queue backend (optional)
3. **Nginx (port 80)** - Internal proxy serving Dashboard + routing requests

## Build Strategies

1. **Development Build** (`Dockerfile.local`): Fast iteration with pre-built artifacts
2. **Production Build** (`Dockerfile`): Multi-stage build for consistency
3. **Process Manager**: supervisord orchestrates all services
4. **Data Persistence**: Single volume mount at `/appos/data`

## Acceptance Criteria

- [x] `Dockerfile` builds successfully (multi-stage)
- [x] `Dockerfile.local` builds successfully (pre-built artifacts)
- [x] Final image < 100MB (Alpine + PocketBase framework)
- [x] Container starts with all services RUNNING (appos, redis, nginx)
- [x] HEALTHCHECK passes after 30s
- [x] Dashboard accessible at `/` 
- [x] PocketBase API accessible at `/api/` and `/_/` (Admin UI)
- [x] Custom routes at `/api/appos/*` (apps, proxy, system, backup)
- [ ] Data persists in `/appos/data` after restart

## Build Strategy Comparison

| Aspect | Dockerfile.local | Dockerfile |
|--------|------------------|------------|
| **Build Time** | ~30s | ~5-10 min |
| **Host Requires** | Node + Go | Docker only |
| **Use Case** | Development | Production/CI |
| **Image Size** | < 100MB | < 100MB |

## Dockerfile Requirements

### Image Size Optimization

**Target**: < 100MB final image

**Strategies**:
1. Use `alpine:3.19` as runtime base (not debian)
2. Build with `-ldflags="-w -s"` to strip Go binary
3. Use `npm run build` with production optimizations
4. Multi-stage build: discard build tools
5. Clean package manager cache: `rm -rf /var/cache/apk/*`
6. Use minimal nginx (nginx-alpine or built-in from alpine)

### Dockerfile.local

- Base: `alpine:3.19`
- Copy pre-built: `dashboard/dist`, `backend/appos`
- Install: nginx, supervisor, redis, ca-certificates, curl, bash
- Config: supervisord.conf, nginx.conf, entrypoint.sh
- Data dirs: `/appos/data/{pb_data,redis,apps}`
- HEALTHCHECK: `curl -f http://localhost/api/health`

**Note**: PocketBase framework compiled into `appos` binary (Go 1.26.0, PB 0.36.2)

### Dockerfile (Multi-Stage)

**Stage 1 - Dashboard**: `node:20-alpine` → build to `/build/dist`
**Stage 2 - Backend**: `golang:1.26-alpine` → build `cmd/appos/main.go` to `/build/appos`
**Stage 3 - Runtime**: `alpine:3.19` → copy artifacts + configs

## File Structure

```
build/
├── Dockerfile              # Production multi-stage build
├── Dockerfile.local        # Development build (pre-built artifacts)
├── docker-compose.yml      # Container orchestration
├── .env                    # Environment variables
├── .dockerignore           # Exclude files from build context
├── supervisord.conf        # Process manager (redis/pocketbase/backend/nginx)
├── nginx.conf              # Internal proxy config (/, /api/, /pb/, /terminal)
└── entrypoint.sh           # Container init script
```

**Data Volume**: `appos_data` (Docker named volume) → `/appos/data`

**INIT_MODE** (env, default `setup`):
- `setup`: 全新容器不创建 superuser，用户通过 Setup 页面创建
- `auto`: entrypoint 用 `SUPERUSER_EMAIL` + `SUPERUSER_PASSWORD` 自动创建

**Data Directories** (inside container):
```
/appos/data/
├── pb_data/                # PocketBase data (data.db, auxiliary.db)
│   ├── data.db            # Main database (apps, users, etc.)
│   └── auxiliary.db       # Logs and system metadata
├── redis/                  # Redis persistence (AOF/RDB)
└── apps/                   # User-deployed app configurations
```

## Key Configuration Files

- **supervisord.conf**: Process manager (redis → appos → nginx)
  - `appos serve --http=0.0.0.0:8090` (PocketBase + custom routes + Asynq worker)
- **nginx.conf**: Routes: `/` (dashboard), `/api/` + `/_/` (PocketBase + custom routes)
- **entrypoint.sh**: Init data dirs, handle INIT_MODE (auto/setup), start supervisord
- **docker-compose.yml**: Named volume (`appos_data`), health check, port mapping
- **.env**: HTTP_PORT, REDIS_ADDR, IMAGE_NAME, SUPERUSER_EMAIL, SUPERUSER_PASSWORD
- **.dockerignore**: Exclude node_modules, .git, *.log, pb_data

---

## Verification

```bash
# Build and start
make image build && make start

# Check services
docker exec appos supervisorctl status

# Test endpoints
curl http://127.0.0.1:9091/
curl http://127.0.0.1:9091/api/health

# Check image size
docker images appos:latest  # Should be < 100MB

# Verify persistence
docker restart appos && docker exec appos ls /appos/data/
```

---

## Implementation Tasks

- [x] Create `Dockerfile` (multi-stage: node → go 1.26 → runtime)
- [x] Create `Dockerfile.local` (copies pre-built artifacts)
- [x] Create `supervisord.conf` (3 services: redis, appos, nginx)
- [x] Create `nginx.conf` (routes: / → static, /api + /_ → appos:8090)
- [x] Create `entrypoint.sh` (init pb_data, handle INIT_MODE, start supervisord)
- [x] Create `docker-compose.yml` (named volume `appos_data`, health check)
- [x] Create `.env` (port, redis addr, image name)
- [x] Create `.dockerignore` (exclude node_modules, .git, pb_data)
- [x] Add HEALTHCHECK to both Dockerfiles
- [x] Test both build strategies
- [x] Verify all services start correctly (appos + redis + nginx: ✅)
- [x] PocketBase Admin UI accessible at `/_/`
- [x] Custom routes working at `/api/appos/*`
- [ ] Verify data persistence after restart

---

## Dev Agent Record

**2026-02-13**: Architecture Refactor - PocketBase as Framework

**Phase 1 - Migration from chi-based Backend to PocketBase Framework**:
- **Change**: Backend 从独立 chi HTTP server 迁移为 PocketBase 扩展
- **Rationale**:
  - ✅ 单进程架构（PocketBase + custom routes + Asynq worker）
  - ✅ 无需维护独立的 auth/database 客户端代码
  - ✅ 统一的 middleware 和 auth 系统
  - ✅ 减少依赖（移除 chi, zerolog, godotenv 等）
  - ✅ 更小的二进制体积（42MB 单文件）

**Phase 2 - Code Restructure**:
- **Entry Point**: `cmd/appos/main.go` (PocketBase.New() + extensions)
- **Custom Routes**: `internal/routes/` (apps, proxy, system, backup)
  - 使用 `app.OnServe().BindFunc` 注册路由
  - 使用 `apis.RequireAuth()` / `apis.RequireSuperuserAuth()` 中间件
- **Event Hooks**: `internal/hooks/` (collection lifecycle events)
- **Asynq Worker**: `internal/worker/` (embedded, 与 PocketBase 共享进程)
  - 支持 graceful shutdown via `app.OnTerminate()`

**Phase 3 - Dependencies**:
- Go: 1.26.0
- PocketBase: 0.36.2
- Asynq: 0.26.0
- Docker Client: CLI wrapper (避免 SDK 版本耦合)
- Terminal: creack/pty + gorilla/websocket

**Phase 4 - Review Fixes**:
- P1: Worker lifecycle - 修复 `OnServe` 重复启动问题
- P2: Asynq client - 使用单例模式避免连接泄漏
- P3: Docker CLI style - 统一函数调用风格
- P4: Terminal subprocess - 添加 `Process.Kill()` 防止孤儿进程
- P5: Unused params - 移除 `routes.Register` 未使用的 app 参数
- P6: Graceful shutdown - 添加 `OnTerminate` hook

**Status**: 架构重构完成，编译通过，服务正常运行。Redis 可选依赖（不影响 PocketBase 核心功能）。

---

## Status

**Current**: Ready for Dev  
**Last Updated**: 2026-02-12  
**Estimated Effort**: 2-3 days  

**Dependencies**:
- Go 1.26.0+ (for building appos binary)
- PocketBase 0.36.2 (compiled into appos)
- Dashboard builds to `dist/`
- Backend compiles to `appos` (single binary)
- Docker 20.10+ with BuildKit
- Redis (optional, for async tasks)

**Note**: Makefile commands for build/start/stop are defined in Story 1.2
