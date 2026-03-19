# Story 25.2: Cron Frontend

**Epic**: Epic 25 - System Cron
**Priority**: P2
**Status**: done
**Depends on**: Story 25.1

## Objective

Add the minimal frontend log viewing experience for one cron job. The UI must stay read-only except for native manual run, and focus on recent execution logs plus lightweight summary fields.

## Acceptance Criteria

- [x] AC1: The frontend can request `GET /api/crons/{jobId}/logs` for a selected cron job.
- [x] AC2: A cron log view renders recent log lines with at least `created`, `level`, `message`, `phase`, and `trigger`.
- [x] AC3: The view displays lightweight summary fields when available: `lastRun`, `lastStatus`, `lastDurationMs`.
- [x] AC4: When the endpoint returns no instrumented logs, the UI shows a clear empty state rather than an error.
- [x] AC5: Failed runs visually distinguish error records from success records.
- [x] AC6: The UI tolerates short write delay after manual run and supports refresh or re-fetch.
- [x] AC7: No create, edit, delete, enable, or disable controls are introduced.

## UX Scope

- One selected job log panel, sheet, drawer, or detail page
- Recent log lines only
- Lightweight summary, not a full analytics dashboard
- Read-only presentation

## Page Draft

Recommended first implementation: a right-side log drawer opened from the System Task list.

### Route Strategy

- Keep the primary route on the System Task list page
- Open logs in a drawer or sheet bound to the selected `jobId`
- A dedicated detail route is optional later; it is not required for MVP

### Log Drawer Layout

```text
┌──────────────────────────────────────────────────────────────┐
│ Cron Logs: cleanup_logs                           [ Refresh ]│
├──────────────────────────────────────────────────────────────┤
│ Last Status   Success                                       │
│ Last Run      2026-03-19 09:00:00 UTC                       │
│ Duration      182 ms                                        │
├──────────────────────────────────────────────────────────────┤
│ Time                  Level   Phase     Trigger   Message   │
│──────────────────────────────────────────────────────────────│
│ 2026-03-19 09:00:00   INFO    success   scheduled cron fin… │
│ 2026-03-19 09:00:00   INFO    start     scheduled cron sta… │
│ 2026-03-18 09:00:01   ERROR   error     manual    cron fai… │
├──────────────────────────────────────────────────────────────┤
│ Selected row detail                                          │
│ run_id: abc123                                               │
│ error: timeout while cleaning old log batches                │
└──────────────────────────────────────────────────────────────┘
```

### Mobile Draft

```text
┌──────────────────────────────┐
│ Cron Logs                    │
│ cleanup_logs                 │
├──────────────────────────────┤
│ Status   Success             │
│ LastRun  2026-03-19 09:00    │
│ Duration 182 ms              │
├──────────────────────────────┤
│ 09:00:00  success            │
│ cron finished                │
├──────────────────────────────┤
│ 09:00:00  start              │
│ cron started                 │
└──────────────────────────────┘
```

### View Rules

- Default sort: newest first
- Show the latest 20 to 50 items in MVP
- Summary cards are single-line values, not charts
- Row expansion may show `runId` and `error` only; raw JSON dump is optional
- Refresh is manual in MVP; no streaming or auto-tail

## Data Contract

Input endpoint:

```text
GET /api/crons/{jobId}/logs
```

Expected fields:

- `jobId`
- `lastRun`
- `lastStatus`
- `lastDurationMs`
- `items[]`
  - `created`
  - `level`
  - `message`
  - `runId`
  - `phase`
  - `trigger`
  - `durationMs`
  - `error`

## Implementation Notes

- Reuse existing dashboard table/detail presentation patterns where possible.
- Keep the first version simple: no grouping by `runId`, no virtualized log viewer, no streaming transport.
- A manual refresh action is acceptable for MVP.
- If route structure already has a System page convention, follow it instead of introducing a new navigation model.
- Prefer reusing the Audit / Logs table patterns for timestamp, level badge, empty state, and refresh interaction.

## Route

The log drawer is co-located on the System Task list page. No separate route is needed for MVP.

Route file: `dashboard/src/routes/_app/_auth/_superuser/system-tasks.tsx`

Drawer state is managed as local component state (`selectedJobId`). Opening a drawer triggers:

```ts
pb.send(`/api/crons/${jobId}/logs`, { method: 'GET' })
```

Do not use `pb.collection()` for this endpoint. Use `pb.send()` consistent with other custom endpoints in the project.

## Dependencies

- Story 25.1 backend endpoint and logging contract

## Dev Agent Record

**Implemented by**: Amelia (dev agent)
**Status**: done

### Files Created
- `dashboard/src/routes/_app/_auth/_superuser/system-tasks.tsx` — System Tasks page with `SystemTasksPage` component and `CronLogDrawer`

### Files Modified
- `dashboard/src/routeTree.gen.ts` — registered `AppAuthSuperuserSystemTasksRoute` in all required sections: import, route constant, `FileRoutesByFullPath`, `FileRoutesByTo`, `FileRoutesById`, `fullPaths`, `to`, `id` unions, `FileRoutesByPath` declare module, `AppAuthSuperuserRouteChildren` interface and const object
- `dashboard/src/components/layout/Sidebar.tsx` — added `{ id: 'system-tasks', label: 'System Tasks', href: '/system-tasks' }` to `systemNavItem.children`
- `specs/implementation-artifacts/sprint-status.yaml` — `25.2-cron-frontend: done`

### Implementation Notes
- `SystemTasksPage` fetches `GET /api/crons` via `pb.send()` to list native PocketBase cron jobs
- Page follows `coding-decisions-ui.md` spec: `text-2xl font-bold tracking-tight` header, Refresh right-aligned, chevron inline row expansion, 3-dot DropdownMenu for actions, empty state without table headers
- `CronLogDrawer` (Sheet, right side, `sm:max-w-2xl`) fetches `GET /api/crons/{jobId}/logs` via `pb.send()`
- Drawer shows summary bar (lastStatus badge, lastRun, lastDurationMs) and log table with levelBadge/phaseBadge helpers
- Row expansion in drawer reveals `runId` and `error` for failed runs
- TypeScript: `tsc --noEmit` passes with zero errors