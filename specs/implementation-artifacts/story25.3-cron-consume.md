# Story 25.3: Cron Consume

**Epic**: Epic 25 - System Cron
**Priority**: P2
**Status**: done
**Depends on**: Story 25.1, Story 25.2

## Objective

Add the minimal System Task list that consumes PocketBase native cron list/run APIs and connects each row to the cron log view. This story is the consumption layer only; it does not change native cron definitions.

## Acceptance Criteria

- [x] AC1: A System Task list page consumes native `GET /api/crons` and renders the available cron jobs.
- [x] AC2: The list includes at least `Job ID`, `Schedule`, and `Actions`.
- [x] AC3: Each row exposes an entry to open execution logs for that job.
- [x] AC4: Each row reuses native manual run via `POST /api/crons/{jobId}`.
- [x] AC5: After manual run, the page supports refreshing or reopening logs for the same job.
- [x] AC6: The page remains read-only except for native manual run and log viewing.
- [x] AC7: PocketBase built-in jobs can appear in the list even if they have no rich AppOS execution logs.

## Data Flow

```text
System Task list
  GET /api/crons

Manual run
  POST /api/crons/{jobId}

Execution logs
  GET /api/crons/{jobId}/logs
```

## Page Draft

Recommended page name: `System Tasks`.

Recommended first route:

```text
/system-tasks
```

The page consumes PocketBase native cron inventory and opens the log drawer from Story 25.2.

### Desktop Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ System / System Tasks                                        [ Refresh ]    │
├──────────────────────────────────────────────────────────────────────────────┤
│ System Tasks                                                              │
│ Review native scheduled jobs and inspect recent execution logs.           │
├──────────────────────────────────────────────────────────────────────────────┤
│ Search [____________________]                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Job ID                  Schedule          Last Status   Last Run   Actions  │
│──────────────────────────────────────────────────────────────────────────────│
│ cleanup_logs            0 3 * * *         Success       Today      [Logs][Run]
│ backup_auto             0 2 * * *         Unknown       —          [Logs][Run]
│ __pb_logs_cleanup__     0 0 * * *         Unknown       —          [Logs][Run]
└──────────────────────────────────────────────────────────────────────────────┘
```

### Mobile Draft

```text
┌──────────────────────────────┐
│ System Tasks    [ Refresh ]  │
├──────────────────────────────┤
│ cleanup_logs                 │
│ 0 3 * * *                    │
│ Success · Today              │
│ [Logs] [Run]                 │
├──────────────────────────────┤
│ backup_auto                  │
│ 0 2 * * *                    │
│ Unknown · —                  │
│ [Logs] [Run]                 │
└──────────────────────────────┘
```

### List Rules

- Use native `jobId` as the primary identifier shown in the list
- `Schedule` displays the native cron expression without interpretation in MVP
- `Last Status` and `Last Run` are derived from `/api/crons/{jobId}/logs` only when available
- When no AppOS execution logs exist, show `Unknown` and `—`
- `Run` uses native `POST /api/crons/{jobId}`
- `Logs` opens the log drawer from Story 25.2

### Column Definition

| Column | Source | Notes |
|--------|--------|-------|
| `Job ID` | `GET /api/crons` | primary identity |
| `Schedule` | `GET /api/crons` | raw cron expression |
| `Last Status` | derived from `/api/crons/{jobId}/logs` | `Success`, `Error`, `Unknown` |
| `Last Run` | derived from `/api/crons/{jobId}/logs` | formatted timestamp or `—` |
| `Actions` | mixed | `Logs`, `Run` |

## Implementation Notes

- Use the native cron list as the source of truth for job inventory.
- Do not create a parallel task registry in frontend state.
- If product naming differs from raw `jobId`, use lightweight display mapping only; do not redefine identity.
- Keep the first version table-first. Do not add grouping, tabs, category chips, summary cards, or charts.

### Log Summary Loading Strategy

`Last Status` and `Last Run` require one `/api/crons/{jobId}/logs` call per row. To avoid N blocking requests on page load, use **lazy loading**:

- Render the list immediately after `GET /api/crons` resolves; leave `Last Status` and `Last Run` as `—` initially.
- Do **not** pre-fetch logs for every row on mount.
- Fetch logs only when the user opens the Logs drawer for a specific row.
- This means `Last Status` / `Last Run` columns are only populated after the drawer has been opened at least once per row in the current session.

This is the accepted MVP trade-off. A background prefetch pass may be added later but is out of scope here.

### Sidebar Mount

Add `System Tasks` as a child of `systemNavItem` (superuser) only. Do **not** add it to `systemNavItemBasic`.

```ts
// dashboard/src/components/layout/Sidebar.tsx — systemNavItem.children
{ id: 'system-tasks', label: 'System Tasks', href: '/system-tasks' }
```

### Run Button Behavior

- No confirmation dialog required in MVP.
- Clicking `Run` calls `POST /api/crons/{jobId}` directly.
- Show a toast on completion: success → "Job triggered", error → error message.
- After run, do not auto-refresh the log drawer; let the user manually reopen or refresh.

## Dependencies

- Story 25.1 backend log endpoint
- Story 25.2 frontend log view

## Dev Agent Record

**Implemented by**: Amelia (dev agent)
**Status**: done

### Files Modified
- `dashboard/src/routes/_app/_auth/_superuser/system-tasks.tsx` — added `logSummaries` state + `handleSummaryLoaded` callback to `SystemCronsContent`; added `onSummaryLoaded` prop to `CronLogDrawer` (called after log fetch); added `Last Status` and `Last Run` columns to main table (lazily populated when drawer opens); expanded row `colSpan` 3→5
- `dashboard/src/pages/components/ComponentsPage.tsx` — added `InstalledComponentsContent` and `ActiveServicesContent` exported components (self-contained, reuse existing helpers)
- `dashboard/src/routes/_app/_auth/_superuser/status.tsx` — rewrote to use 3 flat tabs (Components / Active Services / System Crons) using the new exports; removed nested `ComponentsPage` embed
- `specs/implementation-artifacts/sprint-status.yaml` — `25.3-cron-consume: done`

### Implementation Notes
- `Last Status` / `Last Run` start as `—` for all rows; they are written into `logSummaries` (Map) only when the Logs drawer fetches data for that `jobId` in the current session
- `InstalledComponentsContent` and `ActiveServicesContent` are self-contained exports with own state — `ComponentsPage` (standalone route) is unchanged
- TypeScript: `tsc --noEmit` passes with zero errors