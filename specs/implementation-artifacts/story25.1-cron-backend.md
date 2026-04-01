# Story 25.1: Cron Backend

**Epic**: Epic 25 - System Cron
**Priority**: P2
**Status**: done
**Depends on**: Epic 1, Epic 3, Epic 12

## Objective

Add the minimal backend log layer for PocketBase native cron jobs. Keep native cron list and run behavior unchanged, write structured execution logs into PocketBase `_logs`, and expose a read-only log query endpoint at `GET /api/crons/{jobId}/logs`.

## Acceptance Criteria

- [x] AC1: A reusable cron logging wrapper exists for AppOS-maintained cron handlers.
- [x] AC2: Each wrapped cron execution writes a `start` log into PocketBase `_logs` with `type=cron`, `component=system_cron`, `job_id`, `run_id`, and `phase=start`.
- [x] AC3: Successful execution writes a terminal log with `phase=success` and `duration_ms`.
- [x] AC4: Failed execution writes a terminal log with `phase=error`, `duration_ms`, and a machine-readable error summary.
- [x] AC5: Manual trigger and scheduled trigger follow the same logging path and produce the same structured fields. The `trigger` field is best-effort: the wrapper defaults to `scheduled`; distinguishing `manual` is not guaranteed because PocketBase native `POST /api/crons/{jobId}` calls the handler directly without passing trigger context. The `trigger` field must not be omitted from the schema, but its value may always be `scheduled` in v1.
- [x] AC6: `GET /api/crons/{jobId}/logs` returns recent log lines for one cron job, filtered from PocketBase `_logs` by `type=cron`, `component=system_cron`, and `job_id={jobId}`. This endpoint requires superuser authentication, consistent with native `GET /api/crons`.
- [x] AC7: `GET /api/crons/{jobId}/logs` does not change native `GET /api/crons` or `POST /api/crons/{jobId}` behavior.
- [x] AC8: Response includes recent logs ordered by newest first and may include lightweight derived summary fields such as `last_run`, `last_status`, and `last_duration_ms`.
- [x] AC9: Non-instrumented native PocketBase jobs return an empty or partial log result without breaking the endpoint contract.
- [x] AC10: Automated backend tests cover at least one success path and one error path for the cron log query behavior.

## API

Native APIs remain unchanged:

```text
GET  /api/crons
POST /api/crons/{jobId}
```

This story adds:

```text
GET /api/crons/{jobId}/logs
```

Suggested response shape:

```json
{
  "jobId": "cleanup_logs",
  "lastRun": "2026-03-19T09:00:00Z",
  "lastStatus": "success",
  "lastDurationMs": 182,
  "items": [
    {
      "created": "2026-03-19T09:00:00Z",
      "level": "info",
      "message": "cron finished",
      "runId": "abc123",
      "phase": "success",
      "trigger": "scheduled",
      "durationMs": 182,
      "error": null
    }
  ]
}
```

## Implementation Notes

- Use `app.Logger().With(...)` to emit structured log attributes.
- Query logs through `app.LogQuery()`; do not read `_logs` with ad hoc SQL unless required by `LogQuery()` internals.
- Keep the endpoint read-only and scoped to one `jobId`.
- Do not introduce a dedicated `cron_runs` collection in MVP.
- If a wrapped handler panics, convert the failure into an error log before propagating or recovering according to existing backend policy.

## File Targets

- `backend/domain/routes/crons.go` — new file; implement `handleCronLogs` and `registerCronLogsRoute(se)`
- `backend/domain/routes/routes.go` — call `registerCronLogsRoute(se)` directly inside `Register(se)`, **not** inside any existing route group; the route must live on `se.Router` directly so it sits under `/api/crons/{jobId}/logs` alongside the native prefix
- `backend/domain/` cron wrapper — new shared helper (e.g. `backend/infra/cronutil/wrap.go`); apply to AppOS-maintained cron handlers when they are registered; no AppOS cron handlers exist yet — the wrapper ships as infrastructure and is wired up when the first entry appears in the Cron Specs Registry
- `backend/docs/openapi/native-api.yaml` — add `GET /api/crons/{jobId}/logs` under the `System Cron` tag
- backend tests covering query/filter behavior

## Dependencies

- Epic 12 audit conventions for system actor semantics
- PocketBase native logging and native cron APIs

## Notes

- No AppOS cron handlers exist in the codebase at the time this story is written. The wrapper is infrastructure only. The first AppOS cron job must be registered in the Cron Specs Registry in Epic 25 before it can adopt the wrapper.
- Auth on `GET /api/crons/{jobId}/logs`: register with `apis.RequireAdminAuth()` to match native cron API access level.