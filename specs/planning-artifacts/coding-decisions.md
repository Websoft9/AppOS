# Coding decisions

Scope: frontend/UI decisions are maintained in [coding-decisions-ui.md](coding-decisions-ui.md).

## Story/Epic Guidelines{#story}

Decision: Story/Epic artifacts define what to build, not how to implement it.

- Must include: objective, complete requirements, acceptance criteria, and integration notes.
- May include: key technical decisions, file structure planning, and ASCII diagrams.
- Avoid: implementation code, language-specific type design, detailed signatures, and repeated descriptions.
- Principle: a Story is a delivery contract, not an implementation guide.

## Container Development{#container}

- Use `build/` as the single image build directory.
- Validate backend and frontend changes inside containers.
- Use `make` as the standard entrypoint for build, start, stop, logs, and clean workflows.
- After normal code changes, default to `make redo` for a clean rebuild and redeploy.
- Use `make run` only for faster static-file iteration.

## Go Module Config Convention{#go-config}

Decision: each module keeps constants, error codes, and variable configuration in a dedicated `config.go`.

## Settings Ownership Baseline{#settings-ownership}

- Distinguish module-owned settings from shared settings-platform concerns.
- The owning module remains responsible for runtime semantics.
- The settings platform owns shared storage, validation entry, and the workspace settings API surface.
- Exposing module settings under `/api/settings/{module}` is the baseline and does not change ownership.
- Each module keeps a dedicated `config.go` for defaults, constants, shared structs, and settings-loading helpers.

## Custom Route Ownership & Guard{#custom-route-guard}

- All custom `/api/<domain>/*` APIs must be defined in `backend/domain/routes/`.
- Registration is centralized at `routes.Register(se)` from `backend/cmd/appos/main.go`.
- Route ownership is enforced by tests, not lint rules.
- Primary gate: `make test`; fast OpenAPI guard: `make openapi-check`.
- `make lint` remains for static style and code-quality checks only.

## API Naming Baseline{#api-baseline}

Decision: separate resource registry APIs from runtime operation APIs.

### API split

- Resource domain = inventory and control-plane records.
- Server domain = runtime actions on a specific server.

### Prefix baseline

- Registry APIs use PocketBase record paths such as `/api/collections/servers/records`.
- Runtime operation APIs use custom server-scoped paths such as `/api/servers/*`.

### Server API groups

- `Server Registry` (in Resource domain)
- `Server Shell`
- `Server Files`
- `Server Ops`
- `Server Containers`

### OpenAPI tagging baseline

- Use one-level tags with stable prefixes.
- Required server tags: `Server Registry`, `Server Shell`, `Server Files`, `Server Ops`, `Server Containers`.

### Compatibility policy

- Do not break existing routes only for naming cleanup.
- Prefer additive migration: add the new path, keep the old alias during transition, then remove it in a planned versioned change.
- Group matrix remains the source of truth for route-to-tag mapping.

## Testing

- Use `http://127.0.0.1:<port>` for external testing; do not use `http://localhost:<port>`.
- Credentials are stored in `build/.env`; default superuser uses `SUPERUSER_EMAIL` and `SUPERUSER_PASSWORD`.
- Always bypass proxies with `curl --noproxy '127.0.0.1'`.
- This applies to API testing, dashboard access, and the dev server. Inside containers, `localhost` is acceptable.

## Migrations{#migrations}

- Use one migration file per domain.
- During MVP, modify the existing domain migration directly instead of creating incremental files.

## Architecture{#architecture}

Decision: backend code follows DDD. Domain logic lives under `backend/domain/`, infrastructure concerns under `backend/infra/`, and shared runtime integration under `backend/platform/`.

Domain ownership and product IA are defined in [architecture.md](architecture.md) and [prd.md](prd.md). This section only defines code-layer boundaries and dependency rules.

Dependency direction follows inward-dependency rules:

- domain may depend only on domain types and domain-owned abstractions
- domain must not import infrastructure implementations or framework-specific details
- infrastructure may depend on domain and implement domain-defined abstractions
- application-layer orchestration may compose domain abstractions with infrastructure implementations at the boundary

**Decision**: AppOS backend layering is interpreted as follows.

### Domain layer

- Location: `backend/domain/`
- Responsibility: business concepts, invariants, lifecycle semantics, policies, use-case coordination, and domain-owned contracts.
- Allowed dependencies: other domain packages and domain-owned interfaces.
- Prohibited dependencies: `backend/infra/`, `backend/platform/`, and concrete framework or IO details.

### Infrastructure layer

- Location: `backend/infra/`
- Responsibility: technical adapters for docker, crypto, filesystem, migrations, cron, and other IO concerns.
- May import domain to implement domain contracts.
- Must not own lifecycle, secrets, deploy, tunnel, or other business rules.

### Platform layer

- Location: `backend/platform/`
- Responsibility: host and runtime integration shared across domains, such as components inventory, PocketBase hooks, and supervisor-facing integration.
- May depend on domain and infrastructure where needed, but must not become the home for business decision logic.

### Application-layer interpretation for AppOS

- AppOS does not require a top-level `application/` directory.
- Application-layer behavior is defined by responsibility, not folder name.
- In current AppOS code, this orchestration often lives in domain services, workers, and route-coordination code.
- Flows like validate -> resolve -> persist -> enqueue -> audit should be treated as application-layer logic even when currently placed under `backend/domain/`.

**Decision**: when in doubt, classify code by question.

- If the code answers "what business rule must always be true?", it belongs to domain.
- If it answers "in what order do we call collaborators to complete a use case?", it belongs to application-layer orchestration.
- If it answers "how do we talk to docker, PocketBase, filesystem, crypto, supervisor, or another technical system?", it belongs to infrastructure or platform.