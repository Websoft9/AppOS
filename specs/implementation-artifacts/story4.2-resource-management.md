# Story 4.2: Docker Resource Management

**Epic**: Epic 4 - Docker Operations Layer  
**Priority**: P0  
**Status**: Complete  
**Depends on**: Story 4.1 (Executor + Client)

## User Story
As a developer, I want REST endpoints for managing Docker images, containers, networks, and volumes, so that all Docker resources are controllable via API.

## Acceptance Criteria
- [x] 4 resource groups registered under `/api/ext/docker/*`
- [x] All endpoints use `docker.Client` → `Executor` (established in 4.1)
- [x] All return Docker JSON output directly with `host` field
- [x] All require authentication
- [x] `make start` compiles and runs

## Definition of Done
- [x] 16+ endpoints functional (see API table below)
- [x] Prune operations skip in-use resources (Docker handles this natively)
- [x] Image delete uses `/{id...}` wildcard for `sha256:` prefix

---

## Technical Context

### Architecture (same as 4.1)

```
Route handler → docker.Client.ImageList() → Executor.Run("docker", "image", "ls", "--format", "json")
```

All 17 routes are **Docker CLI wrappers via Executor**. No file I/O, no business logic.

### Client Methods to Add (`backend/internal/docker/docker.go`)

| Method | Docker Command |
|--------|---------------|
| `ImageList(ctx)` | `docker image ls --format json` |
| `ImagePull(ctx, name)` | `docker pull <name>` |
| `ImageRemove(ctx, id)` | `docker image rm <id>` |
| `ImagePrune(ctx)` | `docker image prune -f` |
| `ContainerList(ctx)` | `docker ps -a --format json` |
| `ContainerInspect(ctx, id)` | `docker inspect <id>` |
| `ContainerStart(ctx, id)` | `docker start <id>` |
| `ContainerStop(ctx, id)` | `docker stop <id>` |
| `ContainerRestart(ctx, id)` | `docker restart <id>` |
| `ContainerRemove(ctx, id)` | `docker rm <id>` |
| `NetworkList(ctx)` | `docker network ls --format json` |
| `NetworkCreate(ctx, name)` | `docker network create <name>` |
| `NetworkRemove(ctx, id)` | `docker network rm <id>` |
| `VolumeList(ctx)` | `docker volume ls --format json` |
| `VolumeRemove(ctx, id)` | `docker volume rm <id>` |
| `VolumePrune(ctx)` | `docker volume prune -f` |

### Routes to Add (`backend/internal/routes/docker.go`)

Extend `registerDockerRoutes()` from Story 4.1:

```go
// Images
images := docker.Group("/images")
images.GET("", handleImageList)
images.POST("/pull", handleImagePull)
images.DELETE("/{id}", handleImageRemove)
images.POST("/prune", handleImagePrune)

// Containers
containers := docker.Group("/containers")
containers.GET("", handleContainerList)
containers.GET("/{id}", handleContainerInspect)
containers.POST("/{id}/start", handleContainerStart)
containers.POST("/{id}/stop", handleContainerStop)
containers.POST("/{id}/restart", handleContainerRestart)
containers.DELETE("/{id}", handleContainerRemove)

// Networks
networks := docker.Group("/networks")
networks.GET("", handleNetworkList)
networks.POST("", handleNetworkCreate)
networks.DELETE("/{id}", handleNetworkRemove)

// Volumes
volumes := docker.Group("/volumes")
volumes.GET("", handleVolumeList)
volumes.DELETE("/{id}", handleVolumeRemove)
volumes.POST("/prune", handleVolumePrune)
```

### Files to Modify

| Action | File |
|--------|------|
| Modify | `backend/internal/docker/docker.go` — add 16 Client methods |
| Modify | `backend/internal/routes/docker.go` — add 4 resource groups, 17 handlers |

---

## Next Story
**Story 4.3**: Frontend — Docker Resource Dashboard

---

## Dev Notes (added during implementation)

- Image IDs with `sha256:` prefix break standard PocketBase `/:id` path routing → switched to `/{id...}` wildcard route
- All list responses include `host` field (value from `Executor.Host()`) — anticipates multi-server UI in Story 4.4
- Container list endpoint changed to `/containers/list` (avoids conflict with `/:id` catch-all)
- Similarly: `/images/list`, `/networks/list`, `/volumes/list`
