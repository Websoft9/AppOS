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

## Overview

AppOS is a single-server platform built as one application container plus an external reverse proxy.

- PocketBase is the application framework, not a separate BaaS product.
- AppOS business logic is implemented in Go extensions inside the PocketBase process.
- Dashboard and CLI share the same HTTP API and auth model.
- Long-running work runs through Asynq + Redis.
- Public ingress, TLS, and domain routing stay outside the container.

```text
Internet -> External Reverse Proxy -> appos container
                                   -> Nginx -> Dashboard
                                   -> Nginx -> PocketBase + Go extensions
                                   -> Redis for async jobs
```

## Key Decisions

- Backend framework: PocketBase + Go extensions
- Frontend: React + Vite + TanStack Router
- UI: shadcn/ui + Tailwind CSS 4
- Client access: PocketBase JS SDK for built-in and custom APIs
- Async jobs: Asynq + Redis
- Terminal: xterm.js + PTY over WebSocket
- Runtime: Docker on a single host
- Internal proxy: Nginx
- External proxy: Nginx, Traefik, or Caddy
- Process supervision: supervisord inside the container

## Boundaries

### Application boundary

PocketBase built-ins provide auth, CRUD, realtime, admin UI, middleware, cron, and file primitives.

Custom Go code owns AppOS-specific behavior:

- app lifecycle and Docker actions
- server base capability management for server prerequisites
- gateway and domain binding management
- terminal and remote operations
- backup and restore
- metrics, diagnostics, and host operations
- async orchestration and operation state transitions

### Domain boundary

- Secrets Management remains an independent domain.
- Gateway Management owns certificates, routing, and publication.
- Runtime Infrastructure owns shared runtime assets and non-secret environment artifacts.
- Platform Configuration is a composition layer, not a catch-all business domain.

### Product baseline

Collaboration remains a top-level module with `Groups` and `Topics`.

## API and Interaction Model

AppOS exposes two API layers in one process:

- PocketBase built-in APIs: `/api/collections/*`, `/api/realtime`, `/api/admins/*`
- AppOS custom APIs: `/api/<domain>/*`

- Custom APIs use stable domain prefixes. Detailed naming and compatibility rules live in [coding-decisions.md](coding-decisions.md).
- Custom routes reuse PocketBase auth and middleware.
- Dashboard and CLI must call the same endpoints.
- Frontend defaults to PocketBase JS SDK for CRUD, auth, realtime, and custom requests.

## Runtime Topology

In-container services:

- PocketBase process with custom routes and embedded workers
- Redis as the durable queue backend
- Nginx for static serving and internal request routing
- Dashboard static bundle

External reverse proxy responsibilities:

- TLS termination
- domain routing
- certificate lifecycle
- forwarding traffic to AppOS and deployed applications

AppOS may manage proxy configuration through custom APIs, but the proxy remains an external infrastructure component.

## PRD Alignment Guardrails

The architecture must continue to satisfy the current PRD:

- Application lifecycle actions return explicit operation states such as pending, success, failed, or attention required.
- Resource operations cover terminal, file, service, and container actions from one product surface.
- Resource control supports both local and remotely managed targets.
- Runtime configuration assets include registry settings, proxy settings, shared envs, IaC files, and credentials.
- Operational visibility includes logs, events, task status, and basic filtered diagnostic views.
- Non-functional guardrails remain in force: fast command acknowledgement, idempotent lifecycle and settings operations, auditability, and protection of sensitive values at rest and in UI exposure.

## Critical Flows

Deployment:

1. Dashboard or CLI calls a lifecycle endpoint.
2. API validates auth, writes operation state, and enqueues a job.
3. Worker performs Docker actions.
4. State updates are exposed through realtime and query APIs.

Configuration:

1. User updates a runtime asset.
2. AppOS validates, persists, and versions the change.
3. Apply, rollback, or follow-up execution runs synchronously or through a job, depending on cost.

Server base capability management:

1. Dashboard or CLI reads capability readiness synchronously.
2. If a prerequisite is missing, API accepts an async command such as ensure, upgrade, or verify.
3. A Server Base domain worker executes preflight, command execution, and verification.
4. Status projection, audit, and events expose the final outcome to dependent domains.

Terminal:

1. Authenticated request opens a shell endpoint.
2. Backend binds WebSocket traffic to a PTY.
3. Output and control signals stream bidirectionally.

## Constraints and Risks

Constraints:

- single-server only
- host Docker required
- persistent state under `/appos/data`
- self-contained deployment with no mandatory cloud dependency
- external reverse proxy required for public HTTPS

Key risks:

- PocketBase upgrade incompatibility: pin version and review upgrades explicitly
- single-process failure impact: keep runtime simple and rely on supervised restart
- Redis as single queue backend: acceptable under single-server constraints
- custom APIs need manual contract documentation: keep custom endpoint specs maintained

## Async Execution Boundary

AppOS should share one async substrate across long-running domains, but not force one business runner model on every domain.

Shared across domains:

- Asynq + Redis
- worker hosting and retry infrastructure
- operation id and phase-oriented status conventions
- audit and event publication patterns

Kept separate by domain:

- App Lifecycle runner remains app- and release-oriented
- Server Base runner remains server-capability-oriented

Implication:

- Server Base may reuse the same queue and worker process model as App Lifecycle
- Server Base should keep its own command handlers, operation DTOs, and phase semantics

## Complexity Assessment

Overall complexity should remain low: one backend process model, one queue backend, one auth model, and one shared API surface for Dashboard and CLI.
