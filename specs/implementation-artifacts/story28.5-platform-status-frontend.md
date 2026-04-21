# Story 28.5: Platform Status Frontend Page

**Epic**: Epic 28 - Monitoring
**Priority**: P1
**Status**: Done
**Depends on**: Story 28.1, Story 28.2, Story 28.4

## Objective

Converge the current `System > Status` frontend into one simple platform-first page that answers one question first: can the platform be used right now?

## Scope

- Keep `System > Status` as the single operator entry for platform runtime status
- Add one top-level `Platform Availability` block
- Show infrastructure trends with one shared time range selector
- Show active bundled services as the main diagnostic table
- Keep platform targets as a compact control-plane summary, not the main surface
- Keep available non-active components behind a secondary entry, not a primary section

## Principles

- Availability first, evidence second
- Prefer one page over multiple tabs
- Use user-facing capability language before internal monitor terms
- Keep the page diagnostic-first, not dashboard-heavy

## Existing Surface Context

- Current route: `web/src/routes/_app/_auth/_superuser/status.tsx`
- Current monitor overview: `web/src/pages/system/MonitorOverview.tsx`
- Current components and services surface: `web/src/pages/components/ComponentsPage.tsx`

## Implementation Targets

- `web/src/routes/_app/_auth/_superuser/status.tsx`
	- replace the current multi-tab status entry with one single-page platform status layout
- `web/src/pages/system/MonitorOverview.tsx`
	- reuse or extract monitor overview parts needed for compact platform-target summary and counts
- `web/src/pages/components/ComponentsPage.tsx`
	- reuse active-services data and secondary components entry instead of duplicating contracts

## Implementation Tasks

- [x] Create one top-level `Platform Availability` section at the top of the page
- [x] Add one shared-range `Infrastructure` section for CPU, memory, disk, and network trends
- [x] Keep `Active Services` as the main operator table on the page
- [x] Reduce `Platform Targets` to a compact control-plane summary
- [x] Move non-active component inventory behind a secondary `Components` entry from the services section

## Source of Truth

- First pass should derive `Platform Availability` in the frontend from existing status read models already used by the page
- The first pass does not require a new backend availability endpoint
- First pass availability conclusion should be computed from:
	- platform target summary from monitor overview
	- active bundled service states already exposed by the services surface
	- infrastructure trend section only as supporting evidence, not as the sole unavailable trigger

## Page Draft

```text
+------------------------------------------------------------------------------------------------------------------+
| Status                                                                                          Last update: 2m ago |
| Unified platform status for AppOS runtime, services, and infrastructure                                               |
+------------------------------------------------------------------------------------------------------------------+

+------------------------------------------------------------------------------------------------------------------+
| Platform Availability                                                                                    Degraded |
| Core management is available, but background task execution may be delayed.                                      |
|                                                                                                                  |
| Affected capabilities                                                                                            |
|  Console Access            Available                                                                             |
|  Application Management    Available                                                                             |
|  Background Jobs           Limited                                                                               |
|  Monitoring                Available                                                                             |
|                                                                                                                  |
| Primary reason                                                                                                   |
|  Scheduler heartbeat is stale. Delayed task execution may occur.                                                 |
|                                                                                                                  |
| Last checked                                                                                                     |
|  2026-04-21 14:20                                                                                               |
+------------------------------------------------------------------------------------------------------------------+

+------------------------------------------------------------------------------------------------------------------+
| Infrastructure                                                                      Range: [1h] [6h] [24h] [7d] |
| Platform resource consumption trends                                                                                |
+------------------------------------------------------------------------------------------------------------------+
| +---------------------------------+  +---------------------------------+  +---------------------------------+     |
| | CPU                             |  | Memory                          |  | Disk                            |     |
| | 32%   Normal                    |  | 68%   Normal                    |  | 54%   Normal                    |     |
| |                                 |  |                                 |  |                                 |     |
| |      . . . ./\..../\....        |  |      ..../\....../....         |  |      ..../....../\....         |     |
| |                                 |  |                                 |  |                                 |     |
| | current: 32%                    |  | current: 5.4 GB / 8 GB          |  | current: 120 GB / 240 GB       |     |
| +---------------------------------+  +---------------------------------+  +---------------------------------+     |
|                                                                                                                  |
| +---------------------------------+                                                                              |
| | Network                         |                                                                              |
| | 12 MB/s   Normal                |                                                                              |
| |                                 |                                                                              |
| |      ..../\....../....          |                                                                              |
| |                                 |                                                                              |
| | current: in 8 MB/s / out 4 MB/s |                                                                              |
| +---------------------------------+                                                                              |
+------------------------------------------------------------------------------------------------------------------+

+------------------------------------------------------------------------------------------------------------------+
| Active Services                                                                                      [Components] |
| Core runtime and bundled services                                                                                |
+------------------------------------------------------------------------------------------------------------------+
| Name                Status       Uptime        Last Checked         Notes                            Action       |
|------------------------------------------------------------------------------------------------------------------|
| appos-core          Running      3d 4h         2026-04-21 14:20     API healthy                      [Logs]       |
| appos-worker        Running      3d 4h         2026-04-21 14:20     Queue healthy                    [Logs]       |
| appos-scheduler     Warning      12m           2026-04-21 14:20     Tick delayed                     [Logs]       |
| redis               Running      8d 2h         2026-04-21 14:20     Cache ready                      [Logs]       |
| nginx               Running      8d 2h         2026-04-21 14:20     Proxy ready                      [Logs]       |
| victoria-metrics    Running      8d 2h         2026-04-21 14:20     Metrics storage healthy          [Logs]       |
| netdata             Running      8d 2h         2026-04-21 14:20     Collector active                 [Logs]       |
+------------------------------------------------------------------------------------------------------------------+

+------------------------------------------------------------------------------------------------------------------+
| Platform Targets                                                                                     Healthy 2 / 3 |
| Control-plane runtime health                                                                                      |
+------------------------------------------------------------------------------------------------------------------+
| Target               Status        Reason / Summary                                                                |
|------------------------------------------------------------------------------------------------------------------|
| AppOS Core           Healthy       Process alive, uptime stable, runtime healthy                                  |
| Worker               Healthy       Background worker is running and dispatch loop is active                        |
| Scheduler            Degraded      Last scheduler tick exceeded threshold                                          |
+------------------------------------------------------------------------------------------------------------------+

+--------------------------------------------------------------------------+
| Components                                                               |
| Available but non-active capabilities inside container                   |
+--------------------------------------------------------------------------+
| docker              Available         28.x                               |
| node                Available         22.x                               |
+--------------------------------------------------------------------------+
```

## Acceptance Criteria

### AC1: Unified page

Given the operator opens `System > Status`
When the page renders
Then the status experience is shown as one unified page
And the previous split between monitor, components, and services tabs is removed from the primary status flow

### AC2: Platform Availability first

Given platform status data is available
When the top of the page renders
Then the page shows one `Platform Availability` conclusion
And it includes overall status, affected capabilities, primary reason, and last checked time
And the first pass derives that conclusion from existing status read models already consumed by the page

### AC3: Shared infrastructure range

Given infrastructure trend cards are shown
When the operator changes the selected time range
Then CPU, memory, disk, and network cards all refresh using the same selected range

### AC4: Active services remain primary

Given the page is rendered
When the operator scans the main evidence area
Then active bundled services are directly visible as the main operational table
And log access remains available from that table

### AC5: Platform targets are secondary evidence

Given platform target data is available
When it is presented on the page
Then it appears below `Active Services`
And it is limited to one summary section
And each target item shows only target name, status, and one short reason or summary line
And it does not render per-target trend charts in this story

### AC6: Components are secondary

Given non-active components are available
When the operator needs that inventory
Then it is reachable from the `Active Services` section through one secondary `Components` trigger
And the trigger opens a secondary surface such as a drawer, dialog, or equivalent overlay
And non-active components are not rendered as a standalone primary section on the main page

## Notes

- `Platform Availability` is a product conclusion, not a raw monitor object
- `Platform Targets` remain important, but only as control-plane evidence for the availability conclusion
- The first implementation pass should reuse existing read models and frontend building blocks where possible

## Dev Agent Record

### Completion Notes

- Replaced the old multi-tab `System > Status` route with a unified platform-first page.
- Derived `Platform Availability` in the frontend from monitor overview targets plus active bundled services.
- Added a shared infrastructure range selector with `1h`, `6h`, `24h`, `7d`, and `Custom`, with the custom start/end editor rendered directly below the selector.
- Kept `Active Services` primary and moved installed components into a secondary drawer opened from that section.
- Promoted `System Crons` to a direct child under the `System` navigation group.
- Refined `Platform Targets` into a three-column detail layout with richer per-target summary fields.
- Renamed the infrastructure section to `系统性能` and clarified it reads AppOS container metrics from `platform/appos-core`, not host metrics.
- Renamed the main services section to `Bundled services` and changed the secondary components entry to a text link that opens a right-side drawer.
- Removed the small `Healthy x / y` target aggregate because the platform target set is intentionally small.
- Finalized `Platform performance` as five trend cards sourced from `platform/appos-core` series (`CPU %`, `MEM USAGE / LIMIT`, `MEM %`, `NET I/O`, `BLOCK I/O`) in a three-column layout.
- Changed the components entry to `Bundle >` and redesigned the drawer as a compact list surface with `Name`, `Version`, `Updated`, and `CLI` columns plus inline refresh/close actions.

### File List

- `web/src/routes/_app/_auth/_superuser/status.tsx`
- `web/src/pages/system/PlatformStatusPage.tsx`
- `web/src/pages/system/PlatformStatusPage.test.tsx`
- `web/src/pages/system/monitor-overview-shared.ts`
- `web/src/pages/system/MonitorOverview.tsx`
- `web/src/components/monitor/SharedTimeRangeSelector.tsx`
- `web/src/pages/components/component-status-shared.ts`
- `web/src/pages/components/ComponentsPage.tsx`
- `web/src/components/layout/Sidebar.tsx`
- `web/src/components/layout/Sidebar.test.tsx`

## Change Log

- 2026-04-21: Implemented the unified platform status page, extracted shared monitor/components data helpers, and updated system navigation plus tests.
- 2026-04-21: Refined platform target density, renamed the performance/services sections, and changed the components overlay from dialog to drawer.
- 2026-04-21: Finalized platform performance as five AppOS container trend cards, updated the custom range editor placement, and redesigned the `Bundle >` drawer as a list view.