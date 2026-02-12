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
lastUpdated: '2026-02-12'
revision: '2.0 - All-in-One Architecture'
---

# Architecture Decision Document - AppOS

## Architecture Overview

**All-in-One Container**: Single container packages all core services - Go Backend, SQLite, Redis, Convex (self-hosted), Nginx (internal routing), and Dashboard. External reverse proxy handles SSL and domain routing.

```
┌─────────────────────────────────────────────────────────┐
│                   Reverse Proxy                         │
│              (Nginx/Traefik/Caddy)                      │
│  • SSL Termination  • Domain Routing  • Let's Encrypt  │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              websoft9 (All-in-One Container)            │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Nginx (Internal Proxy)                           │  │
│  │  Routes: /api → Backend, / → Dashboard           │  │
│  └─────────────┬─────────────────────────────────────┘  │
│                │                                         │
│  ┌─────────────┴──────────┬──────────────┐             │
│  │                        │              │             │
│  ▼                        ▼              ▼             │
│ ┌──────────────┐  ┌──────────────┐  ┌─────────────┐   │
│ │  Dashboard   │  │   Backend    │  │   Convex    │   │
│ │   (React)    │  │   (Go API)   │  │(Self-hosted)│   │
│ │              │  │              │  │             │   │
│ │ • TanStack   │  │ • REST API   │  │ • Auth      │   │
│ │ • shadcn/ui  │  │ • WebSocket  │  │ • Database  │   │
│ └──────────────┘  │ • Asynq      │  │ • Realtime  │   │
│                   │   Worker     │  └─────────────┘   │
│                   └──────┬───────┘                     │
│                          │                             │
│  ┌───────────────────────┼─────────────────┐           │
│  ▼                       ▼                 ▼           │
│ ┌──────────┐      ┌──────────┐      ┌──────────┐      │
│ │  SQLite  │      │  Redis   │      │  Docker  │      │
│ │          │      │          │      │  Socket  │      │
│ │ • Users  │      │ • Asynq  │      │          │      │
│ │ • Apps   │      │ • Queue  │      │ (Host)   │      │
│ │ • Config │      │ • Cache  │      └──────────┘      │
│ └──────────┘      └──────────┘                         │
└─────────────────────────────────────────────────────────┘
```

## Core Decisions

### Architecture Approach

**Unified API Gateway**: Single Go-based backend serves as unified API for external users (CLI, API clients) while internally orchestrating Convex (state management), Asynq (task execution), and system operations.

### Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Frontend** | Vite + React + TanStack Router | Modern SPA, file-based routing, pure static build |
| **UI** | shadcn/ui + Tailwind CSS 4 | Code-ownership components, modern styling |
| **Backend** | Go + chi | Single binary, stdlib-style, lightweight router |
| **Database** | SQLite | Embedded database, zero-config, single file |
| **BaaS** | Convex (self-hosted) | Realtime subscriptions, reactive queries |
| **Task Queue** | Asynq + Redis | Persistent queue, auto-retry, monitoring UI |
| **Web Terminal** | xterm.js + creack/pty | Industry standard terminal emulator, native PTY |
| **Container Runtime** | Docker | Single-server optimized |
| **Internal Proxy** | Nginx | Routes /api → Backend, / → Dashboard (inside container) |
| **External Proxy** | Nginx/Traefik/Caddy | SSL termination, domain routing, Let's Encrypt |
| **Version Control** | SQLite | Configuration history with timestamps |

### Infrastructure Components

**All-in-One Container Services:**
- **Backend** (Go): REST API + WebSocket + Asynq Worker
- **SQLite**: Users, apps, deployments, config versions
- **Redis**: Asynq task queue backend (persistent)
- **Convex**: Self-hosted realtime database and auth
- **Nginx**: Internal routing (Dashboard + API)
- **Dashboard**: React SPA (static files served by Nginx)

**External Components:**
- **Reverse Proxy**: Independent container/service for SSL + domain routing
- **Docker Daemon**: Host Docker socket (mounted into container)

## Role Division

| Concern | Owner | Rationale |
|---------|-------|-----------|
| User authentication | Convex Auth (self-hosted) | Modern auth flows, session management |
| Realtime updates | Convex Database | Reactive queries, live subscriptions |
| Persistent data | SQLite | Users, apps, deployments, config history |
| Task orchestration | Asynq + Redis | Persistent queue, auto-retry, long-running tasks |
| System commands | Go + exec | Direct Docker CLI execution |
| File operations | Go + os | Compose file management, volume operations |
| Web Terminal | xterm.js + creack/pty | Browser-based PTY with real shell |
| Internal routing | Nginx | Static files + API proxy (inside container) |
| External routing | Reverse Proxy | SSL + domain management (outside container) |

## API Architecture

**Unified API**: All external access (CLI, third-party integrations) goes through AppOS Backend's REST API.

```
External Access                Internal Implementation
┌──────────────┐              
│   CLI /      │──────────────→ ┌─────────────────────┐
│  REST API    │                │  AppOS Backend      │
└──────────────┘                │                     │
                                │ ┌─────────────────┐ │
POST /v1/apps/deploy ──────────→│ │ API Handler     │ │
                                │ └────────┬────────┘ │
                                │          ↓          │
GET /v1/apps ───────────────────→│ ┌─────────────────┐ │
                                │ │ Convex Client   │─┼──→ Convex
                                │ └─────────────────┘ │
                                │                     │
                                │ ┌─────────────────┐ │
WS /terminal ───────────────────→│ │ Terminal Handler│ │
                                │ └─────────────────┘ │
                                │                     │
                                │ ┌─────────────────┐ │
                                │ │ Asynq Worker    │─┼──→ Redis
                                │ └─────────────────┘ │
                                └─────────────────────┘
```

**Dashboard Access**: Can choose between:
- **Option A**: Use unified REST API (same as CLI)
- **Option B**: Direct Convex SDK for reads (realtime), AppOS API for operations (optimized)

## Key Flows

### Application Deployment (via CLI)

```bash
$ appos deploy wordpress
```

1. CLI calls `POST /v1/apps/deploy` with JWT token
2. API handler validates auth with Convex
3. Creates Asynq task → Redis queue
4. Records deployment in Convex (status: pending)
5. Returns deployment ID to CLI
6. Asynq worker picks up task:
   - Fetch compose file from Git
   - Execute `docker compose up -d`
   - Update Convex (status: success/failed)
7. CLI can poll `GET /v1/deployments/:id` for status

### Application Deployment (via Dashboard)

**Option A - Unified API**:
```typescript
await appos.deploy('wordpress');  // Same as CLI
```

**Option B - Optimized** (recommended):
```typescript
// Trigger via AppOS API
const deployment = await appos.deploy('wordpress');

// Subscribe to status via Convex (realtime)
const status = useQuery(api.deployments.get, { id: deployment.id });
// Auto-updates when worker completes
```

### Web Terminal

```typescript
// Dashboard creates WebSocket connection
const ws = new WebSocket('wss://api.appos.io/terminal');
const term = new Terminal();

// xterm.js renders terminal in browser
term.onData(data => ws.send(data));
ws.onmessage = (e) => term.write(e.data);

// Backend: Go + creack/pty spawns real bash shell
// Bidirectional: user input → backend → shell → output → user
```

### Configuration Version Control

Compose files stored in filesystem with version history in SQLite:
1. User edits compose file via Dashboard
2. Backend API saves to `/websoft9/data/apps/{app}/docker-compose.yml`
3. Backend creates version snapshot in SQLite:
   - `config_versions` table: (id, app_id, content, created_at, created_by)
4. Manual trigger starts deployment via Asynq task
5. Task executes `docker compose up -d`
6. Rollback: Query SQLite for previous version → restore to filesystem → redeploy

## Container Topology

```yaml
services:
  websoft9:                    # All-in-one container
    image: websoft9:latest
    ports:
      - "9091:80"               # HTTP (internal nginx)
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock  # Docker access
      - websoft9-data:/websoft9/data                # Persistent data
    environment:
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
  
  reverse-proxy:               # External reverse proxy (independent)
    image: nginx:alpine         # Or Traefik/Caddy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - proxy-config:/etc/nginx
      - letsencrypt:/etc/letsencrypt
    depends_on:
      - websoft9

volumes:
  websoft9-data:               # SQLite DB, Redis RDB, config files
  proxy-config:
  letsencrypt:
```

**All-in-One Container Services** (managed by supervisord):
- **Backend** (Go binary):
  - chi HTTP server (REST API)
  - Asynq worker (3 concurrent workers for deployments)
  - WebSocket handler (terminal sessions)
  - SQLite client (persistent data)
  - Convex client (realtime sync)
- **Redis** (Asynq queue backend, persistent mode)
- **Convex** (self-hosted, realtime database)
- **Nginx** (internal proxy: / → dashboard, /api → backend)
- **Dashboard** (static React build served by nginx)

## Constraints

- **Single-server architecture**: All services in one container, no distribution
- **Docker required**: Host must have Docker 20.10+ installed
- **Persistent storage**: SQLite + Redis RDB in `/websoft9/data` volume
- **Self-contained**: No external dependencies (Convex self-hosted)
- **Reverse proxy required**: External proxy for SSL and domain management
- **Token-based auth**: JWT tokens issued by self-hosted Convex

## Deployment Modes

### Development
```bash
# Run locally with hot reload
$ make dev
# Go backend: air (hot reload)
# Dashboard: vite dev server
```

### Production
```bash
# All-in-one container
$ docker compose up -d
# Single binary serves everything
```

### Horizontal Scaling (if needed)
```bash
# Scale backend instances
$ docker compose up -d --scale appos-backend=3
# Load balancer distributes API requests
# Asynq workers automatically coordinate via Redis
```

## CLI Architecture

**Single Binary**: Cobra-based CLI calls unified REST API.

```bash
# Installation
$ go install github.com/appos/cli@latest

# Configuration
$ appos config set-token YOUR_TOKEN
$ appos config set-url https://api.appos.io

# Usage
$ appos deploy wordpress
$ appos list
$ appos logs wordpress
$ appos delete wordpress
```

**Implementation**: Go HTTP client → AppOS REST API → Same backend logic as Dashboard

## Technology Decisions Summary

| Decision | Choice | Alternative Considered | Why Chosen |
|----------|--------|----------------------|-----------|
| Backend Language | Go | Node.js, Python | Single binary, performance, concurrency |
| Database | SQLite | PostgreSQL, MySQL | Embedded, zero-config, perfect for single-server |
| Task Queue | Asynq + Redis | Temporal, Machinery | Persistent queue, auto-retry, monitoring UI |
| BaaS | Convex (self-hosted) | Supabase, Firebase | Realtime subscriptions, no vendor lock-in |
| Terminal | xterm.js + PTY | ttyd, gotty | Industry standard, actively maintained |
| Router | TanStack Router | React Router | File-based, type-safe |
| API Framework | chi | Gin, Echo, Fiber | Stdlib-compatible, lightweight, composable |
| Internal Proxy | Nginx | Caddy, none | Standard, lightweight, serves static files |
| External Proxy | Nginx/Traefik/Caddy | All valid | Flexible options, documented integration |
| Process Manager | supervisord | systemd, s6 | Container-optimized, XML-RPC API |

## Architecture Review

### ✅ Strengths

1. **True All-in-One Design**
   - Single container with all services (Redis, Convex, Backend, Nginx)
   - SQLite for persistent data (zero-config)
   - No external cloud dependencies
   - Self-contained, data sovereignty

2. **Operational Simplicity**
   - One `docker run` command to start
   - supervisord orchestrates all internal services
   - Persistent data in single volume
   - Simple backup/restore (copy `/websoft9/data`)

3. **Flexible Reverse Proxy**
   - Independent module, not coupled to core
   - Multiple implementation options (Nginx/Traefik/Caddy)
   - User can choose based on preference
   - Clear API for proxy management

4. **Reliable Task Execution**
   - Asynq + Redis for persistent queue
   - Auto-retry on failure
   - Survives container restarts
   - Built-in monitoring UI

5. **Modern Stack**
   - Go: Single binary, excellent concurrency
   - SQLite: Battle-tested, zero maintenance
   - Convex (self-hosted): Realtime without vendor lock-in
   - xterm.js: Industry standard terminal
   - TanStack Router: Type-safe routing

### ⚠️ Considerations

1. **Convex Self-Hosted Dependency**
   - Decision: Using self-hosted Convex for auth and realtime
   - Benefit: No vendor lock-in, data sovereignty
   - Alternative: Can replace with PostgreSQL + custom auth if needed

2. **Redis Single Point of Failure**
   - Risk: Redis down = no task execution
   - Mitigation: Redis AOF persistence + container restart policy
   - Decision: Single instance acceptable for single-server scenario

3. **Monitoring & Observability**
   - Current: Supervisord process monitoring + logs
   - Recommendation: Add Prometheus metrics endpoint in backend
   - Priority: Medium (add before production)

4. **Security**
   - Auth: Convex handles JWT validation
   - Rate limiting: Add chi middleware
   - Input validation: Implement in API handlers
   - Priority: High (implement during development)

5. **Reverse Proxy Integration**
   - External proxy required for SSL and domain management
   - Multiple options: Nginx, Traefik, Caddy
   - Configuration managed via API (FR-3)

---

## Reverse Proxy Module Design

### Architecture

```
                    Internet
                       │
                       │ :80, :443
                       ▼
            ┌──────────────────────┐
            │   Reverse Proxy      │
            │  (Nginx/Traefik)     │
            │                      │
            │ • SSL Termination    │
            │ • Let's Encrypt      │
            │ • Domain Routing     │
            └──────────┬───────────┘
                       │
          ┌────────────┼────────────┐
          │            │            │
          ▼            ▼            ▼
     app1.com     app2.com    websoft9.com
     (nginx:80)   (mysql:80)   (websoft9:80)
```

### Responsibilities

**Reverse Proxy (External)**:
- SSL certificate management (Let's Encrypt automation)
- Domain → container port mapping
- HTTPS enforcement
- Request routing to deployed applications
- Access to websoft9 Dashboard

**Websoft9 Internal Nginx**:
- Dashboard static files (/)
- Backend API routing (/api)
- WebSocket terminal (/terminal)
- Health checks (/health)

### Implementation Options

#### Option 1: Nginx (Simple)
```yaml
# docker-compose.yml
services:
  reverse-proxy:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./proxy/nginx.conf:/etc/nginx/nginx.conf
      - ./proxy/conf.d:/etc/nginx/conf.d
      - certbot-data:/etc/letsencrypt
  
  certbot:
    image: certbot/certbot
    volumes:
      - certbot-data:/etc/letsencrypt
    command: certonly --webroot -w /var/www/certbot
```

**Management**: Websoft9 backend generates nginx config files, reloads nginx

#### Option 2: Traefik (Dynamic)
```yaml
services:
  reverse-proxy:
    image: traefik:v2.10
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik-certs:/letsencrypt
    command:
      - "--providers.docker=true"
      - "--certificatesresolvers.letsencrypt.acme.email=admin@example.com"
```

**Management**: Websoft9 backend adds Docker labels to deployed containers

#### Option 3: Caddy (Automatic SSL)
```yaml
services:
  reverse-proxy:
    image: caddy:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
```

**Management**: Websoft9 backend generates Caddyfile, reloads Caddy

### API Integration (FR-3)

**Backend API Endpoints**:
```
POST /api/v1/proxy/domains
  Body: { domain: "app.example.com", target: "wordpress:80", ssl: true }
  
GET /api/v1/proxy/domains
  Response: [{ domain, target, ssl, certificate_status }]

DELETE /api/v1/proxy/domains/:domain

POST /api/v1/proxy/domains/:domain/ssl
  Action: Request Let's Encrypt certificate

POST /api/v1/proxy/reload
  Action: Reload proxy configuration
```

### Data Model (SQLite)

```sql
CREATE TABLE proxy_domains (
    id INTEGER PRIMARY KEY,
    domain TEXT UNIQUE NOT NULL,
    target_container TEXT NOT NULL,
    target_port INTEGER NOT NULL,
    ssl_enabled BOOLEAN DEFAULT 0,
    ssl_certificate_path TEXT,
    force_https BOOLEAN DEFAULT 0,
    created_at DATETIME,
    updated_at DATETIME
);
```

### Workflow

**Deploy Application with Domain**:
1. User deploys WordPress via Dashboard
2. User adds domain: "blog.example.com" → wordpress:80
3. Backend creates proxy config (Nginx/Traefik/Caddy)
4. Backend requests SSL certificate (if enabled)
5. Backend reloads proxy
6. Domain becomes accessible with HTTPS

**Certificate Renewal**:
- Let's Encrypt: Auto-renewal via certbot/Traefik/Caddy
- Websoft9 monitors certificate expiry
- Sends alert 30 days before expiration

---

### 🎯 Recommendations

**Before MVP:**
1. Implement reverse proxy API (FR-3)
2. Choose one proxy solution (recommend Traefik for dynamic config)
3. Add health check endpoints
4. Implement SQLite schema for proxy config

**Before Production:**
1. Add Prometheus metrics
2. Implement certificate monitoring
3. Add backup/restore for proxy config
4. Test SSL renewal automation

### 📏 Complexity Score: **Low** ✅

- All-in-one container: Low complexity (supervisord orchestration)
- Self-hosted Convex: Medium (but abstracted)
- Redis + Asynq: Low (well-documented)
- Reverse proxy: Low (standard patterns)
- Infrastructure: Simple (1 main container + optional proxy)

**Overall Assessment**: Architecture is well-balanced and truly self-contained. No external cloud dependencies. Reverse proxy design is flexible (supports 3 implementation options). Clear separation between internal routing (nginx in container) and external routing (independent proxy).
