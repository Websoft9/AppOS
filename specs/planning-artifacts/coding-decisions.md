# Coding decisions

Scope: frontend/UI decisions are maintained in [coding-decisions-ui.md](coding-decisions-ui.md).

## Story/Epic Guidelines{#story}

Decision: Story/Epic artifacts define **what to build**, not implementation-level details.

**Must include**:
- **Objective**: One sentence describing the delivery goal
- **Requirements**: Complete list of all functional requirements (use lists/tables, no omissions)
- **Acceptance Criteria**: Verifiable checklist
- **Integration Notes**: Dependencies with other stories/epics

**May include**:
- Key technical decisions (e.g., API contract style, data model boundaries, caching strategy)
- File structure planning
- ASCII architecture diagrams (layout, flow)

**Avoid**:
- Language-specific type/interface definitions (implementation phase)
- Implementation code snippets (implementation phase)
- Detailed function signatures, DTO fields, or component props design
- Redundant descriptions (do not repeat the same information across sections)

**Principle**: A Story is a delivery contract, not an implementation guide.

## Container Development{#container}

**Decision**: Use `build/` as the single image build directory.

**Decision**: Validate backend and frontend changes inside containers.

**Decision**: Use `make` as the standard entrypoint for build/start/stop/logs/clean workflows.

**Decision**: After every development iteration (code change), use `make redo` to rebuild and redeploy from scratch:

```bash
make redo
```

This single command replaces the manual sequence:
1. `make rm` — stop container and remove all data volumes (auto-confirmed)
2. `make build` — compile backend binary + build frontend assets
3. `make image build-local` — build the `websoft9/appos:dev` Docker image from pre-built artifacts
4. `make start dev` — start the container with the dev image on port 9091

Use `make redo` whenever schema migrations or binary changes require a clean environment. For hot-reloading static files only, use `make run` instead (faster, ~10s).

## Go Module Config Convention{#go-config}

Decision: for each module, define constants, error codes, and variable configuration in a dedicated `config.go` file.

## Settings Ownership Baseline{#settings-ownership}

**Decision**: distinguish `business settings` from `settings platform`.

- `business settings` belong to the business module that owns the runtime behavior.
- the `settings platform` owns the shared storage, validation entry, and workspace settings API surface.

**Decision**: exposing business settings under `/api/settings/{module}` is the correct baseline.

- unified settings API path is a platform concern.
- a module adopting that path does not change story ownership; it remains a business-module delivery unless reusable settings infrastructure is added.

**Decision**: each business module should keep a dedicated `config.go`.

- it aggregates module-level defaults, constants, shared structs, and settings-loading helpers.
- routes/services may consume settings through this module config boundary instead of scattering config reads.

## Custom Route Ownership & Guard{#custom-route-guard}

**Decision**: all custom `/api/<domain>/*` APIs must be defined in `backend/domain/routes/` only.

**Decision**: route registration entrypoint is centralized at `routes.Register(se)` from `backend/cmd/appos/main.go`; adding custom route registrations outside `backend/domain/routes/` is prohibited.

**Decision**: architecture guard is enforced as a **test gate**, not a lint rule.

**Execution policy**:
- Primary gate: `make test` (or targeted Go test) should fail when ownership rule is violated.
- Fast OpenAPI guard remains available via `make openapi-check`.
- `make lint` is reserved for static style/code-quality checks and should not carry route-ownership architecture assertions.

**Rationale**:
- Keeps ownership checks deterministic and CI-friendly.
- Aligns with existing OpenAPI coverage checks under Go test flow.
- Avoids mixing architectural contract enforcement with formatter/linter responsibilities.

## API Naming Baseline{#api-baseline}

**Decision**: separate **resource registry APIs** from **runtime operation APIs**.

### Domain split (industry-aligned)

- **Resource domain** = inventory/control-plane records (CRUD and metadata).
- **Server domain** = runtime actions on a specific server (shell/files/ops/containers).

### Prefix baseline

- Registry APIs use PocketBase native records paths.
	- Example: `/api/collections/servers/records`, `/api/collections/databases/records`.
- Runtime operation APIs use server-scoped custom paths.
	- Current implementation: `/api/servers/*` (server shell/files/ops/container actions).

### Server capability groups (product-level)

- `Server Registry` (in Resource domain)
- `Server Shell`
- `Server Files`
- `Server Ops`
- `Server Containers`

### OpenAPI tagging baseline

- Use one-level tags with stable prefixes (Swagger UI has no native nested groups).
- Required tags for server-related APIs:
	- `Server Registry`
	- `Server Shell`
	- `Server Files`
	- `Server Ops`
	- `Server Containers`

### Compatibility policy

- Do not break existing routes solely for naming cleanup.
- Prefer additive migration: add new semantic path first, keep old path alias during transition, then remove old path in a scheduled versioned change.
- Group-matrix remains the source of truth for route-to-tag mapping.

## Testing

**Decision**: use `http://127.0.0.1:<port>` for external testing; do not use `http://localhost:<port>`.

**Credentials**: stored in `build/.env`. Default superuser: `SUPERUSER_EMAIL` / `SUPERUSER_PASSWORD`. Always bypass proxy: `curl --noproxy '127.0.0.1'`.

**Rationale**: HTTP proxy settings may prevent `localhost` connections. Using `127.0.0.1` bypasses proxy and ensures direct local access.

**Applies to**:
- API endpoint testing: `curl http://127.0.0.1:9091/api/health`
- Dashboard access: `http://127.0.0.1:9091/`
- Development server: `http://127.0.0.1:5173/`
- Container health checks (internal): Use `localhost` (no proxy inside container

## Migrations{#migrations}

**Decision**: one migration file per domain. All schema changes for a domain are consolidated into a single file.

**Decision**: during MVP, modify the existing migration file directly when schema changes are needed — do not create incremental migration files.

## Architecture{#architecture}

**Decision**: backend code follows DDD (Domain-Driven Design) model and conventions. Domain logic lives in aggregate roots and value objects under `domain/`; infrastructure concerns are isolated in `infra/`.)

**Decision**: dependency direction must follow DDD inward-dependency rules.

- the domain layer may depend on domain types and domain-owned abstractions only.
- the domain layer must not import infrastructure implementations, framework adapters, transport handlers, ORM details, filesystem helpers, queue clients, or external service SDK wrappers.
- infrastructure code may depend on domain code and implement domain-defined abstractions.
- application-layer orchestration may depend on domain abstractions and invoke infrastructure implementations only through composition or dependency injection at the boundary.

**Decision**: use this rule as the practical baseline.

- domain layer can depend on abstractions.
- domain layer cannot depend on infrastructure implementations.
- infrastructure layer depends on domain layer and implements those abstractions.

**Decision**: AppOS backend layering is interpreted as follows.

### Domain layer

- location baseline: `backend/domain/`
- responsibility: business concepts, invariants, lifecycle semantics, policies, orchestration rules, route-facing use-case coordination, and domain-owned contracts.
- allowed dependencies: other domain packages and domain-owned interfaces/types.
- prohibited dependencies: `backend/infra/`, `backend/platform/`, PocketBase-specific persistence details, Docker SDK concrete calls, filesystem path manipulation details, supervisor process control details.

### Infrastructure layer

- location baseline: `backend/infra/`
- responsibility: technical implementations and adapters for docker, crypto, filesystem utilities, migrations, cron helpers, and other concrete IO/integration concerns.
- dependency direction: may import `backend/domain/` to implement domain contracts or support domain workflows.
- prohibited responsibility: encoding business rules that belong to lifecycle, secrets, deploy, tunnel, or other domain modules.

### Platform layer

- location baseline: `backend/platform/`
- responsibility: host/runtime integration for platform capabilities shared across domains, such as components inventory, PocketBase hooks, and supervisor-facing runtime integration.
- dependency direction: may depend on domain and infrastructure packages where needed, but must not become the home for business decision logic.

### Application-layer interpretation for AppOS

- AppOS does not currently require a top-level `application/` directory as a mandatory packaging rule.
- application-layer behavior is defined by responsibility, not folder name.
- in current AppOS code, application-layer orchestration typically lives in domain services, workers, and route-coordination code when they are coordinating use cases rather than expressing core business invariants.
- if a flow mostly coordinates steps such as validate -> resolve -> persist -> enqueue -> audit, it should be treated as application-layer logic even if it is placed under `backend/domain/` for now.

**Decision**: when in doubt, classify code by question.

- if the code answers "what business rule must always be true?" it belongs to domain.
- if the code answers "in what order do we call collaborators to complete a use case?" it belongs to application-layer orchestration.
- if the code answers "how do we talk to docker, pocketbase, filesystem, crypto, process supervisor, or another technical system?" it belongs to infrastructure or platform.