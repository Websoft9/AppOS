# Epic 4: Docker Operations API

## Overview

PocketBase custom routes for Docker container lifecycle management. Replaces Portainer — all Docker operations exposed as authenticated REST endpoints sharing PB's built-in auth (same JWT, same middleware).

**Status**: In Progress | **Priority**: P0 | **Depends on**: Epic 1, Epic 3

## Architecture

```
Dashboard (PB JS SDK)
  → pb.send('/api/appos/apps/deploy', ...)
  → PB auth middleware (RequireAuth) validates JWT automatically
  → Custom Go handler → Docker SDK → containers
```

No separate auth flow needed. PB custom routes inherit auth from `apis.RequireAuth()` — the same token from `pb.collection('users').authWithPassword()` works for all custom routes.

## Routes (backend/internal/routes/apps.go)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/appos/apps/deploy` | Deploy app from compose template |
| POST | `/api/appos/apps/:id/restart` | Restart app containers |
| POST | `/api/appos/apps/:id/stop` | Stop app |
| POST | `/api/appos/apps/:id/start` | Start app |
| DELETE | `/api/appos/apps/:id` | Remove app (soft/hard) |
| GET | `/api/appos/apps/:id/logs` | Stream container logs |
| GET | `/api/appos/apps/:id/env` | Get environment variables |
| PUT | `/api/appos/apps/:id/env` | Update environment variables |

## Stories

### 4.1: Core Docker Operations
- Deploy (docker compose up via Asynq async task)
- Start / Stop / Restart
- Delete (soft: keep volumes, hard: remove all)
- Error handling and status reporting

### 4.2: Logs & Environment
- Container log streaming (stdout/stderr)
- Environment variable CRUD
- Compose file read/write

### 4.3: Async Task Integration
- Asynq worker for long-running operations (deploy, rebuild)
- Task status tracking via PB collection `deployments`
- Realtime status updates via PB SSE subscriptions

## Definition of Done

- [ ] All CRUD operations work via custom routes
- [ ] Auth middleware blocks unauthenticated requests
- [ ] Deploy creates async task, status updates via realtime
- [ ] Error responses follow PB error format
- [ ] Docker socket operations properly error-handled

## What Was Removed (vs old Portainer epic)

Old epic was Portainer SSO + Cockpit plugin. Now eliminated:
- ~~Portainer~~ → PB custom routes + Docker SDK
- ~~SSO token exchange~~ → PB unified auth (one JWT for everything)
- ~~Cockpit plugin system~~ → React Dashboard
- ~~Session management~~ → PB authStore handles it

