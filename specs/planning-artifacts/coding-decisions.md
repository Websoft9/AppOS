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

## Testing

**Decision**: use `http://127.0.0.1:<port>` for external testing; do not use `http://localhost:<port>`.

**Credentials**: stored in `build/.env`. Default superuser: `SUPERUSER_EMAIL` / `SUPERUSER_PASSWORD`. Always bypass proxy: `curl --noproxy '127.0.0.1'`.

**Rationale**: HTTP proxy settings may prevent `localhost` connections. Using `127.0.0.1` bypasses proxy and ensures direct local access.

**Applies to**:
- API endpoint testing: `curl http://127.0.0.1:9091/api/health`
- Dashboard access: `http://127.0.0.1:9091/`
- Development server: `http://127.0.0.1:5173/`
- Container health checks (internal): Use `localhost` (no proxy inside container)