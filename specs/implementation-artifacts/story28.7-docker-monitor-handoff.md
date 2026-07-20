# Story 28.7: Docker and Monitor Surface Handoff

**Epic**: Epic 28 - Monitoring
**Priority**: P1
**Status**: Proposed
**Depends on**: Epic 4, Story 28.4, Story 28.6, Story 20.9

## Objective

Define one minimal handoff contract between the Docker page and monitor surfaces so operators can move from runtime evidence to Docker actions, and from Docker inventory to deeper monitoring context, without either page taking over the other page's ownership.

## Boundary

This is a cross-surface handoff story, not a rewrite of Docker operations or Monitor.

Docker surfaces still own:

- Docker inventory
- inspect and logs access
- start, stop, restart, remove, pull, prune, and compose actions
- object-first navigation for containers, images, networks, volumes, and compose projects

Monitor surfaces still own:

- runtime telemetry trends
- freshness and coverage judgment
- latest status projection and degraded reason
- overview and detail conclusions about what is unhealthy and why

This story only standardizes how operators move between those two surfaces.

## User Story

As an operator,
I want one clear handoff model between Docker views and Monitor views,
so that I can inspect runtime evidence without losing action access, and execute Docker actions without confusing Docker inventory with monitoring ownership.

## Handoff Rule

Use one simple rule everywhere:

1. Docker page answers what exists and what action can be executed now.
2. Monitor page answers what is unhealthy, what is consuming resources, and whether telemetry is trustworthy.
3. When the current question changes, the UI should hand off to the owning surface instead of recreating that surface locally.

## Minimal Handoff Model

### Docker → Monitor

Use handoff from Docker surfaces when the operator needs:

- short-window trend context beyond inline evidence
- freshness diagnosis
- degraded or unhealthy explanation
- server-level monitor conclusions that are larger than one container row

Allowed MVP handoff examples:

- from Docker page container row to server detail `Monitor` tab
- from Docker page container evidence badge to monitor-backed detail view for the same server

### Monitor → Docker

Use handoff from Monitor surfaces when the operator needs:

- inspect payload
- logs
- terminal access
- start, stop, restart, remove, or other Docker actions
- image, network, volume, or compose inventory context

Allowed MVP handoff examples:

- from server detail `Monitor` tab to Docker tab for the same server
- from unhealthy container conclusion to Docker containers view for the owning server

## UX Contract

- Docker page may show compact monitor-backed evidence, but must remain inventory-first and action-ready.
- Monitor page may show compact Docker runtime context, but must remain diagnosis-first and trend-first.
- Do not duplicate full Docker tabs inside Monitor.
- Do not duplicate monitor overview or conclusions inside Docker.
- Handoff copy should make ownership obvious, such as `Open Docker`, `View Monitor`, or equivalent direct labels.

## MVP Scope

In scope:

- one explicit handoff from Docker page to Monitor surface for deeper diagnosis
- one explicit handoff from Monitor surface to Docker page for operational action
- copy and placement rules that keep ownership visible

Out of scope:

- merging Docker and Monitor into one page
- replacing Docker inventory APIs with monitor reads
- moving Docker actions into Monitor
- moving monitor conclusions and trend history into Docker as a full secondary workspace

## Acceptance Criteria

- [ ] AC1: Docker surfaces expose one clear path to deeper monitor context without re-implementing monitor conclusions locally.
- [ ] AC2: Monitor surfaces expose one clear path to Docker operations without re-implementing Docker inventory or actions locally.
- [ ] AC3: The handoff copy and destination keep ownership explicit: Docker owns inventory/actions, Monitor owns telemetry/status.
- [ ] AC4: Images, Networks, Volumes, and Compose remain Docker-owned surfaces and are not promoted into Monitor in this story.
- [ ] AC5: The story does not require new TSDB query freedom in the browser.
- [ ] AC6: The story does not introduce duplicate action buttons across Monitor and Docker pages.

## Implementation Notes

- prefer route-level handoff over embedding large cross-surface panels
- keep handoff server-scoped first; do not solve cross-server monitor-to-docker routing in MVP
- reuse existing Docker page and Server Detail Monitor destinations where possible instead of creating new standalone monitor routes
- if a container-specific deep link is not yet stable, hand off to the owning server surface first and highlight the relevant container there later

## References

- [Source: specs/implementation-artifacts/epic4-docker.md]
- [Source: specs/implementation-artifacts/epic28-monitoring.md]
- [Source: specs/implementation-artifacts/story28.6-container-stats-ui.md]
- [Source: specs/implementation-artifacts/story20.9-detail-monitor.md]