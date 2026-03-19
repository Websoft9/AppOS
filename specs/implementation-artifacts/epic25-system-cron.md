# Epic 25: System Cron

## Overview

**Minimal execution log layer for PocketBase native cron jobs** — AppOS does not replace PocketBase scheduling and does not introduce user-managed cron CRUD. This epic adds only cron execution logging and log query support on top of PocketBase native cron.

**Status**: Backlog | **Priority**: P2 | **Depends on**: Epic 1, Epic 3, Epic 12

## Product Position

`System Cron` is an internal operations module for platform-maintained jobs.

It owns only:
- structured execution logging for cron runs
- log query support for PocketBase native cron jobs
- minimal Dashboard log viewing for native cron jobs

It does not own:
- user-created cron jobs
- cron create / edit / delete UI
- custom scheduling engine
- replacement of PocketBase built-in cron registration
- arbitrary script execution from the UI

## Minimal Architecture

PocketBase remains the source of truth for scheduled jobs and for list/run APIs.

```text
PocketBase app.Cron()
  ↓
Native cron APIs
GET  /api/crons
POST /api/crons/{jobId}
  ↓
Structured execution logs in PocketBase _logs
  ↓
Additional log query endpoint
GET  /api/crons/{jobId}/logs
  ↓
Dashboard System Cron pages
```

Rules:
- PocketBase native cron remains the execution source.
- This epic does not add a compatibility facade for list or run.
- AppOS custom work for this module is limited to execution logging and log querying.
- First release adds only the cron log layer; no extra scheduling abstraction.

## Scope

### In Scope

- Add structured logs for AppOS-maintained cron handlers
- Query cron execution logs from PocketBase logs storage
- Provide a minimal Dashboard log viewing surface for native cron jobs

### Out of Scope

- Create, update, delete, enable, disable cron jobs
- User-defined cron expressions
- Custom list/run wrapper around PocketBase native cron APIs
- Generic job history engine beyond log-derived summaries
- Replacing PocketBase Dashboard > Settings > Crons
- Migrating existing async worker tasks into cron tasks
- Arbitrary shell/script runner

## Compatibility Policy

Compatibility with PocketBase native cron is mandatory.

1. `jobId` is defined by PocketBase native cron registration.
2. AppOS must consume native list/trigger APIs directly instead of duplicating them elsewhere.
3. PocketBase built-in jobs such as `__pb*__` are read-only from the product perspective.
4. The AppOS log layer is best-effort for pre-existing native jobs.
5. Full log experience is guaranteed only for cron handlers that adopt the AppOS structured logging contract.

Implication:
- every PocketBase cron job can appear in the AppOS list
- only AppOS-instrumented jobs are guaranteed to have rich execution logs

## Logging Contract

This epic is intentionally minimal: execution observability is implemented through PocketBase native logging instead of a dedicated `cron_runs` collection.

All AppOS-maintained cron handlers should emit structured logs through `app.Logger()`.

Required log fields:

| Field | Type | Notes |
|-------|------|-------|
| `type` | text | fixed value `cron` |
| `component` | text | fixed value `system_cron` |
| `job_id` | text | PocketBase cron job id |
| `run_id` | text | unique per execution |
| `phase` | text | `start`, `success`, `error` |
| `trigger` | text | `scheduled` or `manual` |
| `duration_ms` | number | present on terminal phases |
| `error` | any | error summary for failed runs |

Preferred messages:
- `cron started`
- `cron finished`
- `cron failed`

Notes:
- Logs are stored in PocketBase `_logs`.
- Log persistence follows PocketBase batching/debounce behavior.
- The UI must tolerate short write delay and incomplete runs.

## Implementation Logic

The implementation is intentionally two-step and must stay minimal.

### Step 1 — Write execution logs into PocketBase native logs

Each AppOS-maintained cron handler is wrapped with a shared logging wrapper.

Execution flow:

```text
app.Cron().MustAdd(jobId, cronExpr, wrappedHandler)
  ↓
cron starts
  ↓
write `start` log into PocketBase _logs
  ↓
run business handler
  ↓
write `success` or `error` log into PocketBase _logs
```

Rules:
- the wrapper generates one `run_id` per execution
- all log lines must include `job_id`
- scheduled trigger and manual trigger share the same logging path
- failed runs must log a machine-readable error summary

### Step 2 — Read execution logs through a cron log endpoint

AppOS adds a log query endpoint under the native cron namespace:

```text
GET /api/crons/{jobId}/logs
```

This endpoint does not read from a dedicated cron table. It queries PocketBase `_logs` via `app.LogQuery()` and filters structured log entries by:

- `type = cron`
- `component = system_cron`
- `job_id = {jobId}`

The response returns recent log lines and may derive lightweight summary fields such as:
- `last_run`
- `last_status`
- `last_duration_ms`

Design constraints:
- no separate `cron_runs` collection in MVP
- no replacement of native `GET /api/crons` or `POST /api/crons/{jobId}`
- no guarantee of rich logs for non-instrumented PocketBase built-in jobs

## API Surface

PocketBase native APIs remain the primary surface:

```text
GET  /api/crons
POST /api/crons/{jobId}
```

This epic adds only one additional endpoint under the same native prefix:

```text
GET  /api/crons/{jobId}/logs
```

Contract notes:
- `GET /api/crons` remains native PocketBase behavior.
- `POST /api/crons/{jobId}` remains native PocketBase behavior.
- `GET /api/crons/{jobId}/logs` returns recent structured log lines filtered from PocketBase logs.

## UI Scope

The first UI is intentionally small.

- Reuse native cron list and run capabilities
- Add recent execution log viewing per job
- No create/edit/delete controls are shown

## Cron Specs Registry

All current and future AppOS cron specifications must be maintained in this epic.

Use the table below as the single registry for cron job specs.

| Spec ID | PB Job ID | Type | Schedule | Description | Logging Contract | Status |
|--------|-----------|------|----------|-------------|------------------|--------|
| 25.x-template | `<job_id>` | native / appos | `<cron expr>` | Add spec here when a new cron is approved | required for rich logs | backlog |

Maintenance rules:
- Do not create separate cron planning documents unless the cron is large enough to justify its own story.
- Add the job spec here first, then implement code.
- If a cron is pure PocketBase built-in and not AppOS-maintained, list it only when the UI needs a product label or note.

## Stories

### Story 25.1 — Cron Backend

- Add reusable structured logging wrapper for AppOS cron handlers
- Ensure each execution writes `start` / `success` / `error` records into PocketBase `_logs`
- Add `GET /api/crons/{jobId}/logs`
- Query PocketBase `_logs` via `app.LogQuery()`
- Derive minimal `last_status` / `last_run` from log data when possible

### Story 25.2 — Cron Frontend

- Add cron log viewing UI for one selected job
- Display recent execution logs sourced from `/api/crons/{jobId}/logs`
- Display lightweight summary fields such as last run and last status
- No create/edit/delete controls

### Story 25.3 — Cron Consume

- Add a System Task list page that consumes native `GET /api/crons`
- Add entry action to open execution logs for a selected job
- Reuse native manual run behavior via `POST /api/crons/{jobId}`
- Keep the page read-only except for manual run and log viewing

## Acceptance Direction

Epic 25 is successful when:

- AppOS can display PocketBase native cron jobs without redefining them
- AppOS-instrumented cron jobs expose recent execution logs through `/api/crons/{jobId}/logs`
- The UI remains read-only except for native manual run

## Out of Scope Follow-up

Potential future evolution, not part of this epic:

- dedicated `cron_runs` collection for stronger history semantics
- per-job alerting / notification rules
- manual rerun payloads or parameterized jobs
- unified background jobs console across cron and Asynq