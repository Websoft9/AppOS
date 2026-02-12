# Story 1.1: Container Build & Deployment

**Epic**: Epic 1 - Infrastructure & Build System  
**Priority**: P0  
**Status**: Ready for Dev

---

## User Story

As a developer, I need Dockerfiles and container configurations to package the All-in-One container with all services.

## Architecture Context

**Container Architecture**:
- Single container running all services via supervisord
- Internal Nginx routes Dashboard (/) and Backend API (/api)
- Persistent data volume: `/appos/data`
- No external dependencies (fully self-contained)

**Services Inside Container**:
1. Redis (port 6379) - Asynq task queue backend
2. Convex (port 3210) - Self-hosted realtime database
3. Backend (port 8080) - Go API + Asynq worker + WebSocket terminal
4. Nginx (port 80) - Internal proxy serving Dashboard + routing API

## Build Strategies

1. **Development Build** (`Dockerfile.local`): Fast iteration with pre-built artifacts
2. **Production Build** (`Dockerfile`): Multi-stage build for consistency
3. **Process Manager**: supervisord orchestrates all services
4. **Data Persistence**: Single volume mount at `/appos/data`

## Acceptance Criteria

- [ ] `Dockerfile` builds successfully (multi-stage)
- [ ] `Dockerfile.local` builds successfully (pre-built artifacts)
- [ ] Both images < 100MB (optimized with alpine)
- [ ] Container starts with all services RUNNING
- [ ] HEALTHCHECK passes after 60s
- [ ] Dashboard accessible at `/`
- [ ] API accessible at `/api/health`
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
- Copy pre-built: `dashboard/dist`, `backend/main`, `convex-backend`
- Install: nginx, supervisor, redis, ca-certificates, curl, sqlite
- Config: supervisord.conf, nginx.conf, entrypoint.sh
- Data dirs: `/appos/data/{redis,convex,apps}`
- HEALTHCHECK: `curl -f http://localhost/api/health`

### Dockerfile (Multi-Stage)

**Stage 1 - Dashboard**: `node:20-alpine` → build to `/build/dist`
**Stage 2 - Backend**: `golang:1.22-alpine` → build with CGO to `/build/main`
**Stage 3 - Runtime**: `alpine:3.19` → copy artifacts + configs

## File Structure

```
build/
├── Dockerfile              # Production multi-stage build
├── Dockerfile.local        # Development build (pre-built artifacts)
├── docker-compose.yml      # Container orchestration
├── .env                    # Environment variables
├── .dockerignore           # Exclude files from build context
├── supervisord.conf        # Process manager (redis/convex/backend/nginx)
├── nginx.conf              # Internal proxy config (//api//terminal)
├── entrypoint.sh           # Container init script
└── convex-backend          # Convex binary (download or build)
```

**Data Directories** (inside container):
```
/appos/data/
├── redis/                  # Redis persistence
├── convex/                 # Convex data
├── apps/                   # User apps
└── appos.db                # SQLite database
```

## Key Configuration Files

- **supervisord.conf**: Process manager (redis → convex → backend → nginx)
- **nginx.conf**: Routes: `/` (dashboard), `/api/` (backend), `/terminal` (websocket)
- **entrypoint.sh**: Init data dirs, create SQLite schema, start supervisord
- **docker-compose.yml**: Volume mounts, health check, port mapping
- **.env**: HTTP_PORT, CONTAINER_NAME, IMAGE_NAME, APPOS_DATA_PATH, passwords
- **.dockerignore**: Exclude node_modules, .git, *.log

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

- [ ] Create `Dockerfile` (multi-stage: node → go → runtime)
- [ ] Create `Dockerfile.local` (copies pre-built artifacts)
- [ ] Create `supervisord.conf` (4 services with priorities)
- [ ] Create `nginx.conf` (routes: / → static, /api → backend, /terminal → ws)
- [ ] Create `entrypoint.sh` (init data dirs, start supervisord)
- [ ] Create `docker-compose.yml` (volume mounts, health check)
- [ ] Create `.env` (port, passwords, image name)
- [ ] Create `.dockerignore` (exclude node_modules, .git)
- [ ] Add HEALTHCHECK to both Dockerfiles
- [ ] Test both build strategies
- [ ] Verify all services start correctly
- [ ] Verify data persistence after restart

---

## Status

**Current**: Ready for Dev  
**Last Updated**: 2026-02-12  
**Estimated Effort**: 2-3 days  

**Dependencies**:
- Convex backend binary (download or build)
- Dashboard builds to `dist/`
- Backend compiles to `main`
- Docker 20.10+ with BuildKit

**Note**: Makefile commands for build/start/stop are defined in Story 1.2
