---
stepsCompleted: [1, 2, 3, 4, 5, 7, 8]
inputDocuments:
  - specs/planning-artifacts/product-brief.md
  - specs/planning-artifacts/prd.md
workflowType: 'architecture'
project_name: 'AppOS'
user_name: 'AppOS'
date: '2026-02-04'
lastStep: 8
status: 'complete'
completedAt: '2026-02-05'
lastUpdated: '2026-02-13'
revision: '3.0 - PocketBase Framework'
---

# Architecture Decision Document - AppOS

## Architecture Overview

**All-in-One Container**: PocketBase as application framework (not standalone BaaS). All business logic compiled into single Go binary. Dashboard uses PocketBase JS SDK directly.

```
┌─────────────────────────────────────────────────────────┐
│                   Reverse Proxy                         │
│              (Nginx/Traefik/Caddy)                      │
│  • SSL Termination  • Domain Routing  • Let's Encrypt  │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                appos (All-in-One Container)             │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Nginx (Internal Proxy)                           │  │
│  │  / → Dashboard,  /api/ + /_/ → PocketBase        │  │
│  └─────────────┬─────────────────────────────────────┘  │
│                │                                         │
│  ┌─────────────┴──────────────────────┐                 │
│  │                                    │                 │
│  ▼                                    ▼                 │
│ ┌──────────────┐     ┌────────────────────────────┐    │
│ │  Dashboard   │     │  PocketBase (Framework)    │    │
│ │   (React)    │     │                            │    │
│ │              │     │ • Built-in: Auth, DB,      │    │
│ │ • PB SDK     │     │   Realtime, Admin UI       │    │
│ │ • TanStack   │     │                            │    │
│ │ • shadcn/ui  │     │ • Custom routes:           │    │
│ └──────────────┘     │   Docker, Proxy, Terminal  │    │
│                      │                            │    │
│                      │ • Asynq Worker (embedded)  │    │
│                      └──────┬─────────────────────┘    │
│                             │                           │
│  ┌──────────────────────────┼──────────────┐           │
│  ▼                          ▼              ▼           │
│ ┌──────────┐         ┌──────────┐   ┌──────────┐      │
│ │  Redis   │         │  SQLite  │   │  Docker  │      │
│ │ (Asynq)  │         │  (PB)   │   │  Socket  │      │
│ └──────────┘         └──────────┘   └──────────┘      │
└─────────────────────────────────────────────────────────┘
```

## Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Framework** | PocketBase (Go) | Auth + DB + Realtime + Admin UI + custom routes in one binary |
| **Frontend** | Vite + React + TanStack Router | Modern SPA, file-based routing |
| **UI** | shadcn/ui + Tailwind CSS 4 | Code-ownership components |
| **Frontend SDK** | PocketBase JS SDK | Auth, CRUD, Realtime, custom route calls — all built-in |
| **Task Queue** | Asynq + Redis | Persistent async tasks, auto-retry (embedded in PB process) |
| **Web Terminal** | xterm.js + creack/pty | WebSocket via PB custom route |
| **Container Runtime** | Docker | Single-server optimized |
| **Internal Proxy** | Nginx | Static files + API routing (inside container) |
| **External Proxy** | Nginx/Traefik/Caddy | SSL termination, domain routing |

## Core Design: PocketBase as Framework

PocketBase is used as an **application framework** — not a standalone BaaS service. All business logic is compiled into the same Go binary via PocketBase's extension API.

### What PocketBase Provides (built-in, zero code)

- **Auth**: JWT, password auth, OAuth2, token refresh, session management
- **Database**: SQLite with Collection CRUD API + API Rules
- **Realtime**: SSE subscriptions + custom message broadcasting
- **Admin UI**: Data management at `/_/`
- **Middleware**: Auth token loader, rate limiting, CORS, panic recovery
- **Cron**: Scheduled jobs
- **File storage**: Upload/download with local or S3 backend
- **Logging**: Structured logs with Dashboard viewer

### What We Extend (custom Go code)

- **Docker operations**: deploy, restart, stop, delete apps
- **Reverse proxy management**: domain binding, SSL config
- **Web terminal**: WebSocket + PTY (full-duplex)
- **Backup/restore**: filesystem + encryption
- **System monitoring**: CPU, memory, disk metrics
- **Asynq integration**: async task queue for long-running operations

## API Architecture

### Two API layers, one process

```
Dashboard / CLI
      │
      │  PocketBase JS SDK (pb.send(), pb.collection(), pb.realtime)
      │
      ▼
┌─────────────────────────────────────────────┐
│  PocketBase Process (single binary)         │
│                                             │
│  ┌─── Built-in API ──────────────────────┐  │
│  │  /api/collections/apps/records   CRUD │  │
│  │  /api/collections/users/...      Auth │  │
│  │  /api/realtime                   SSE  │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ┌─── Custom Routes ────────────────────┐   │
│  │  Apps:   deploy, restart, stop,      │   │
│  │          delete, logs, env           │   │
│  │  Config: save, history, rollback     │   │
│  │  Proxy:  domains, ssl, reload        │   │
│  │  System: terminal, metrics, files    │   │
│  │  Backup: create, restore, list       │   │
│  └───────────────────────────────────────┘  │
│                                             │
│  ┌─── Asynq Worker (goroutine) ─────────┐  │
│  │  deploy:app → docker compose up      │   │
│  │  backup:create → tar + encrypt       │   │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### Unified auth for all routes

Custom routes share PocketBase's auth system automatically:

```go
// Global auth token loader runs for ALL requests (built-in + custom)
// → e.Auth is populated before your handler executes

// Route-level access control
g := se.Router.Group("/api/appos")
g.Bind(apis.RequireAuth())                          // any authenticated user
g.POST("/apps/deploy", deployApp)

admin := se.Router.Group("/api/appos/admin")
admin.Bind(apis.RequireSuperuserAuth())             // superuser only
admin.POST("/proxy/config", configProxy)
```

### Frontend: single SDK

```typescript
import PocketBase from 'pocketbase';
const pb = new PocketBase('/');

// Auth (built-in)
await pb.collection('users').authWithPassword(email, password);

// CRUD (built-in, token auto-attached)
const apps = await pb.collection('apps').getList();

// Realtime (built-in)
pb.collection('deployments').subscribe('*', (e) => { ... });

// Custom routes (same SDK, same token)
await pb.send('/api/appos/apps/deploy', { method: 'POST', body: { name: 'wordpress' } });
```

## Key Flows

### Application Deployment

1. Dashboard calls `pb.send('/api/appos/apps/deploy', ...)`
2. PocketBase auth middleware validates JWT → `e.Auth` populated
3. Handler creates deployment record via `e.App.Save(record)`
4. Handler enqueues Asynq task → Redis
5. Returns `{ deployment_id, status: "pending" }`
6. Dashboard subscribes: `pb.collection('deployments').subscribe(id, ...)`
7. Asynq worker executes `docker compose up -d`, updates record status
8. PocketBase auto-broadcasts status change to subscribed clients

### Web Terminal

```go
// Custom route upgrades to WebSocket (standard net/http compatible)
se.Router.GET("/api/appos/terminal", func(e *core.RequestEvent) error {
    conn, _ := upgrader.Upgrade(e.Response, e.Request, nil)
    ptmx, _ := pty.Start(exec.Command("bash"))
    // bidirectional relay: conn ↔ ptmx
}).Bind(apis.RequireAuth())
```

### Configuration Version Control

1. User edits compose file via Dashboard
2. Custom route saves to `/appos/data/apps/{app}/docker-compose.yml`
3. Creates version record in PB collection `config_versions`
4. Manual deploy trigger → Asynq task → `docker compose up -d`
5. Rollback: query previous version → restore file → redeploy

## Container Topology

```yaml
services:
  appos:
    image: appos:latest
    ports:
      - "9091:80"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - appos-data:/appos/data
    environment:
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}

  reverse-proxy:
    image: nginx:alpine          # or Traefik/Caddy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - proxy-config:/etc/nginx
      - letsencrypt:/etc/letsencrypt

volumes:
  appos-data:                    # SQLite, Redis RDB, app configs
  proxy-config:
  letsencrypt:
```

**Internal services** (managed by supervisord):
- **PocketBase** (Go binary): built-in API + custom routes + Asynq worker
- **Redis**: Asynq queue backend (persistent)
- **Nginx**: internal proxy (/ → dashboard, /api + /_/ → PocketBase)
- **Dashboard**: static React build served by Nginx

## Constraints

- **Single-server architecture**: no distribution
- **Docker 20.10+** required on host
- **Persistent storage**: single volume at `/appos/data`
- **Self-contained**: no external cloud dependencies
- **External reverse proxy required** for SSL and domain management

## Reverse Proxy Module

External reverse proxy handles SSL and domain routing. Independent from the all-in-one container.

```
Internet → :443 → [Reverse Proxy] → app1.com → container:port
                                   → app2.com → container:port
                                   → appos     → appos:9091
```

**Custom routes manage proxy config**:
```
POST   /api/appos/proxy/domains          – add domain binding
GET    /api/appos/proxy/domains          – list bindings
DELETE /api/appos/proxy/domains/:domain  – remove binding
POST   /api/appos/proxy/domains/:domain/ssl – request certificate
POST   /api/appos/proxy/reload           – reload proxy config
```

Supports Nginx, Traefik, or Caddy. Custom routes generate config files and reload the proxy service.

## Technology Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Application framework | PocketBase | Single binary: auth + DB + realtime + Admin UI + extensible |
| Task Queue | Asynq + Redis | Persistent async tasks with retry, embedded in PB process |
| Terminal | xterm.js + PTY | WebSocket via PB custom route, standard Go libs |
| Frontend Router | TanStack Router | File-based, type-safe |
| Process Manager | supervisord | Container-optimized, simple config |

## Architecture Review

### Strengths

1. **Single process** — PocketBase + business logic compiled into one Go binary. No inter-service HTTP overhead.
2. **Frontend uses official SDK** — PocketBase JS SDK handles auth, CRUD, realtime, token management. Zero custom SDK needed.
3. **Unified auth** — Custom routes share PocketBase auth system. One JWT, one middleware chain, one Admin UI.
4. **Admin UI included** — Data, users, logs manageable via `/_/` without custom tooling.
5. **Operationally simple** — 2 supervised processes (PocketBase, Redis) instead of 3 (Backend, PocketBase, Redis).

### Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| PocketBase breaking changes on upgrade | Medium | Pin version, review changelog before upgrade |
| Single process crash takes everything down | Low | supervisord auto-restart; PB is mature and stable |
| Redis SPOF for task queue | Low | AOF persistence + restart policy; acceptable for single-server |
| No auto-generated OpenAPI for custom routes | Low | Manual spec for ~15 custom endpoints |

## CLI Architecture

Cobra-based Go binary calls PocketBase HTTP API (built-in + custom routes):

```bash
$ appos deploy wordpress        # → POST /api/appos/apps/deploy
$ appos list                    # → GET  /api/collections/apps/records
$ appos logs wordpress          # → GET  /api/appos/apps/:id/logs
$ appos proxy add example.com   # → POST /api/appos/proxy/domains
```

Same JWT auth. Same endpoints as Dashboard. Separate Go module (`cmd/cli/`).

### Complexity: **Low** ✅

One main binary + Redis. No inter-service communication. Standard Go extension patterns.
