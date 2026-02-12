# Coding decisions

## UI{#ui}

Design System Foundation (shadcn/ui, Tailwind, Dark/Light theme)

## Container Development{#container}

**Image Build Directory**: Use `build/` directory exclusively for image construction. Ignore other directories including `docker/`.

**Testing Protocol**: All backend and frontend code must be tested within containers. During development, copy code to the appropriate container paths.

**Development Workflow**: Use `make` commands for all operations (build, start, stop, logs, clean, etc.).

## Testing

**External Endpoint Access**: Always use `http://127.0.0.1:<port>` for external testing, **never** `http://localhost:<port>`.

**Rationale**: HTTP proxy settings may prevent `localhost` connections. Using `127.0.0.1` bypasses proxy and ensures direct local access.

**Applies to**:
- API endpoint testing: `curl http://127.0.0.1:9091/api/health`
- Dashboard access: `http://127.0.0.1:9091/`
- Development server: `http://127.0.0.1:5173/`
- Container health checks (internal): Use `localhost` (no proxy inside container)