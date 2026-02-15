# Epic 6: Services Module

## Objective

Manage appos container internal services (supervisord programs) — view status, start/stop/restart, view logs — through PocketBase custom routes, integrated into Dashboard.

## Requirements

### 6.1 Service List & Status Display

- Fetch all supervisord program list and status via PB custom route
- Display: program name, state (Running/Stopped/Fatal/Starting), PID, uptime
- State visual indicators: Running=green, Stopped=grey, Fatal=red, Starting=orange
- Resource monitoring per process: CPU%, Memory (RSS)
- Summary stats: total/running/stopped/error counts, aggregate CPU/Memory
- Auto-refresh interval (configurable, default 5s)
- Manual refresh button
- Loading/empty/error states
- Responsive layout (mobile 320px+)

### 6.2 Service Control Operations

- Action buttons per service: Start, Stop, Restart
- Buttons disabled based on current state (e.g., Stop disabled if already stopped)
- Confirmation dialog for destructive actions (stop/restart)
- Loading indicator during operation
- Success/error feedback notification
- Auto-refresh status after operation completes

### 6.3 Service Logs

- View stdout/stderr logs per service (last N lines, default 200)
- Toggle between stdout and stderr
- Support real-time tail mode (auto-scroll new lines)
- Display in modal dialog
- Log content max size capped to prevent browser memory issues

## Acceptance Criteria

- [ ] Services page accessible at `/services` route in Dashboard
- [ ] All supervisord programs displayed with correct status
- [ ] Start/Stop/Restart operations work reliably via PB custom routes
- [ ] Resource usage (CPU%, Memory) shown per service
- [ ] Logs viewable per service with stdout/stderr toggle
- [ ] UI uses shadcn/ui + Tailwind, consistent with Dashboard design system
- [ ] Proper auth: all API calls go through PB unified auth
- [ ] Error handling for API failures
- [ ] Responsive on mobile

## Key Technical Decisions

**Data flow**:
```
Dashboard → PB JS SDK (pb.send) → PB Custom Route → supervisord / system commands → response
```

**Backend approach**: XML-RPC as primary interface for supervisord operations (structured data, reliable state management). CLI (`ps`) as supplement for resource monitoring (Memory/RSS) which XML-RPC does not expose.

**CPU monitoring**: Two-sample delta method — reads `/proc/<pid>/stat` ticks + `/proc/stat` system ticks, sleeps 200ms, reads again, computes percentage from delta. Uses `runtime.NumCPU()` normalization.

**Action buttons**: lucide-react icons (`Play`, `Square`, `RotateCw`, `FileText`) with `Loader2` spinner for loading states. Log dialog sized at `max-w-[90vw] max-h-[85vh]`.

**Frontend location**: `dashboard/src/routes/_app/_auth/services/`

## Integration Notes

- **Depends on**: Epic 7 (Dashboard framework — routing, layout, PB SDK integration)
- **Backend**: PB custom routes wrap supervisord operations; supervisord XML-RPC stays on localhost:9001, only PB process accesses it
- **Auth**: PB unified auth middleware — no direct frontend-to-supervisord access
- **Boundary with Epic 4**: Epic 4 manages user-deployed Docker applications (external containers). Epic 6 manages appos internal services (supervisord programs inside the appos container). No overlap.
