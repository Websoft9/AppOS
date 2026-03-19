# Story 6.2: Active Services

Status: proposed

## Story

As a system administrator,
I want to inspect active internal services inside the Components workspace,
so that I can monitor runtime state and read diagnostics without introducing dangerous default controls.

## Acceptance Criteria

1. `Active Services` tab lists all supervisord-managed internal services through backend routes under `/api/components/services`.
2. Each service row shows at minimum: `name`, `state`, `pid`, `uptime`, `cpu`, `memory`, and last refresh timestamp.
3. UI shows summary counts for total, running, stopped, and error services.
4. Per-service logs are viewable from the tab, with stdout/stderr toggle and refresh support.
5. Tab supports configurable auto-refresh plus manual refresh.
6. Service actions such as `start`, `stop`, and `restart` are not exposed by default in MVP.
7. If service actions are introduced later, they must be gated by backend metadata and default to disabled.
8. Existing service-management backend behavior may be retained internally, but this story migrates the user-facing surface into a safer, diagnostics-first tab.
9. Error and degraded states are explicit. If resource metrics cannot be sampled, service row still renders with status and log access where safe.

## Tasks / Subtasks

- [ ] Re-scope existing Services functionality into Components domain (AC: 1,6,7,8)
  - [ ] Replace legacy `/api/ext/services*` route references with `/api/components/services*` in the specification
  - [ ] Identify which current service page behaviors remain user-facing and which stay backend-only
- [ ] Implement Active Services tab UI (AC: 1,2,3,4,5,6,9)
  - [ ] Render service list/table with state badge, pid, uptime, CPU, memory
  - [ ] Add summary counters and refresh controls
  - [ ] Add log dialog/panel with stdout/stderr switching
- [ ] Define safe operation policy (AC: 6,7,8)
  - [ ] Bind any future service action exposure to component/service metadata
  - [ ] Set default action policy to observe-only for core services
- [ ] Integrate runtime data sources (AC: 1,2,5,9)
  - [ ] Continue to use supervisord XML-RPC for service state
  - [ ] Continue to use process sampling for CPU/memory where needed
  - [ ] Ensure graceful handling when metrics are unavailable but status and logs remain available
- [ ] Validation (AC: 1-9)
  - [ ] Backend tests for service list and log route behavior
  - [ ] Frontend tests/typecheck for tab rendering and log switching

## Dev Notes

- This story is effectively the migration of the old standalone `Services` page into a tab under `Components`.
- Keep runtime operations scoped to AppOS internal services. User-deployed app containers remain outside this story and outside Epic 6 service control.
- If route compatibility matters for transition, keep existing backend endpoints and migrate frontend placement first.
- Default UX stance is diagnostics-first: view state, version context, and logs before any action controls are considered.
- Epic 6 must not introduce or preserve `/api/ext/*` service endpoints in the target specification.

### Suggested API Shape

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/components/services` | List active internal services |
| GET | `/api/components/services/{name}/logs` | Read service logs |

Future action routes may remain implemented backend-side, but they should not be surfaced in the MVP UI unless metadata explicitly enables them. If introduced later, they should follow the same non-`ext` route family, for example `/api/components/services/{name}/restart`.

### API Contract

#### `GET /api/components/services`

Purpose: return the runtime service list for the `Active Services` tab.

Response `200 OK`:

```json
[
  {
    "name": "appos",
    "state": "running",
    "pid": 122,
    "uptime": 266400,
    "cpu": 1.2,
    "memory": 96468992,
    "last_detected_at": "2026-03-18T10:24:00Z",
    "log_available": true
  },
  {
    "name": "worker",
    "state": "stopped",
    "pid": 0,
    "uptime": 0,
    "cpu": 0,
    "memory": 0,
    "last_detected_at": "2026-03-18T10:24:00Z",
    "log_available": true
  }
]
```

Field rules:

| Field | Type | Required | Notes |
|------|------|----------|-------|
| `name` | string | yes | Service key and display label |
| `state` | string | yes | Runtime state such as `running`, `stopped`, `fatal`, `starting` |
| `pid` | number | yes | `0` when not running |
| `uptime` | number | yes | Seconds since service start; `0` when unavailable |
| `cpu` | number | yes | CPU percentage snapshot |
| `memory` | number | yes | RSS bytes snapshot |
| `last_detected_at` | string | yes | RFC3339 timestamp |
| `log_available` | boolean | yes | Whether log retrieval is enabled for this service |

#### `GET /api/components/services/{name}/logs`

Purpose: return service logs for one service without exposing process control in MVP.

Query parameters:

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `stream` | string | no | `stdout` or `stderr`; default `stdout` |
| `tail` | integer | no | Line count limit; default `200` |

Response `200 OK`:

```json
{
  "name": "appos",
  "stream": "stdout",
  "content": "2026-03-18T10:22:01Z app started\n2026-03-18T10:22:03Z http listening on :80\n",
  "truncated": false,
  "last_detected_at": "2026-03-18T10:24:00Z"
}
```

Error behavior:

1. `401 Unauthorized` when auth is missing or invalid.
2. `404 Not Found` when the service key is unknown.
3. `409 Conflict` may be returned when logs are intentionally disabled by metadata.
4. `500 Internal Server Error` when supervisor/log retrieval fails unexpectedly.

## References

- [Source: specs/implementation-artifacts/epic6-components.md#Stories]
- [Source: dashboard/src/routes/_app/_auth/services.tsx]
