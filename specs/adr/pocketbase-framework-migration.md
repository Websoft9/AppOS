# ADR: PocketBase BaaS → Framework Migration

**Date**: 2026-02-13
**Status**: Approved
**Supersedes**: convex-to-pocketbase-migration.md (partially)

---

## Context

Architecture v2.1 ran PocketBase as a standalone BaaS alongside a separate Go backend (chi). This meant:

- **Two processes**: Backend (chi) + PocketBase (standalone), coordinated via HTTP
- **Custom HTTP client**: `backend/internal/pocketbase/client.go` for Backend → PB communication
- **No frontend SDK reuse**: Dashboard needed a custom Backend SDK or dual SDK (PB SDK + Backend SDK)
- **Duplicated concerns**: Auth middleware in both Backend and PocketBase

## Decision

**Use PocketBase as application framework** — compile all business logic into the PocketBase binary via its Go extension API.

Eliminate the separate Go backend. One process serves everything: built-in PB APIs + custom routes for system operations.

## Rationale

| Aspect | Before (BaaS) | After (Framework) |
|--------|---------------|-------------------|
| Processes | 2 (Backend + PB) | 1 (PB with extensions) |
| Inter-service calls | HTTP (localhost) | Direct Go function calls |
| Auth | Dual middleware | Single middleware chain |
| Frontend SDK | Custom or dual | PocketBase JS SDK only |
| Admin UI | PB data only | All data (PB manages everything) |
| Custom route auth | Manual token validation | Automatic (`e.Auth` populated by global middleware) |
| Code to maintain | ~5000 lines (backend) | ~3000 lines (extensions only) |

## Key Technical Facts

1. **Custom routes are first-class citizens** in PocketBase — they share the same auth middleware, rate limiting, CORS, and error handling as built-in APIs.
2. **PocketBase router is standard `net/http`** — WebSocket upgrade for terminal works natively.
3. **Asynq can embed as goroutine** inside the PocketBase process — no architectural conflict.
4. **`pb.send()`** in PocketBase JS SDK can call custom routes with the same auth token — frontend needs zero custom code for API calls.

## Impact

### Removed
- `backend/cmd/server/main.go` — replaced by PocketBase main
- `backend/internal/server/` — chi router, middleware
- `backend/internal/pocketbase/client.go` — no longer needed (direct Dao access)

### Retained
- `backend/internal/server/handlers/` — migrated to PB custom routes
- Asynq + Redis integration — embedded in PB process
- Docker/proxy/terminal logic — unchanged, just different entry point

### Architecture docs updated
- `specs/planning-artifacts/architecture.md` → v3.0

## Risks

- PocketBase major version upgrades may require migration effort
- Single process crash affects all functionality (mitigated by supervisord auto-restart)
