# Story 28.6: Container Stats UI in Server Detail

**Epic**: Epic 28 - Monitoring
**Priority**: P1
**Status**: Proposed
**Depends on**: Story 28.2, Story 28.4, Story 29.3

## Objective

Expose monitor-backed container usage evidence inside Server Detail so operators can see current container CPU, memory, and network usage without depending on request-time `docker stats` reads.

## Scope

- consume monitor-backed container telemetry for current usage and short-window trends
- keep the surface inside the existing Server Detail Docker experience
- preserve the current Docker inventory and action model for containers, images, networks, and volumes
- replace only the request-time container stats dependency where monitor-backed telemetry is available
- degrade safely when container telemetry is missing, stale, or partially unavailable

## Boundary

This story is a monitoring-consumption story, not a Docker control-plane rewrite.

Monitor owns:

- current container usage evidence
- short-window telemetry trends
- freshness and availability of telemetry-backed stats

Docker ext APIs still own:

- container inventory
- image inventory
- network inventory
- volume inventory
- inspect payloads
- logs
- start, stop, restart, remove, create, and prune actions

The UI must keep this split explicit. Do not redesign the Docker tab as a monitoring console.

## Unified Product Principle

For Docker in AppOS, keep one simple rule:

- Epic 4 owns Docker inventory and Docker actions
- Epic 28 owns runtime evidence and health judgment
- bridge stories may embed Epic 28 evidence inside Docker views, but must not move Docker control-plane ownership into monitor

Use this rule whenever a Docker-facing surface needs monitor-backed data.
If a feature answers what exists or what action can be executed, it belongs to Docker operations.
If it answers what is consuming resources, whether telemetry is fresh, or what is unhealthy, it belongs to monitoring.

## UX Contract

Primary operator questions:

1. which containers are consuming resources right now
2. whether usage is rising, stable, or missing telemetry
3. whether the server can still operate the container through the existing Docker actions

Presentation rules:

- keep container rows inventory-first
- show telemetry as supporting evidence, not as the primary grouping model
- keep `Images`, `Networks`, and `Volumes` inventory-only in this story
- avoid introducing a separate monitoring tab inside the Docker surface

## UI Contract

### Containers

For each container row, support these monitor-backed fields when available:

- current CPU usage
- current memory usage
- optional memory percent when the collector can provide a trustworthy denominator
- current network throughput or recent in/out summary
- telemetry freshness badge when data is stale or unavailable

Optional expansion behavior:

- short-window sparkline or mini trend for CPU and memory
- compact trend window options limited to allowlisted values such as `15m`, `1h`, or `6h`

Fallback rules:

- if monitor-backed telemetry is unavailable, keep inventory and actions usable
- do not block container actions when telemetry is stale
- show `No telemetry` or equivalent compact state instead of silently rendering zeros
- do not fall back to request-time `docker stats` once this story is active unless a later story explicitly preserves hybrid fallback behavior

### Images, Networks, Volumes

For this story:

- keep current behavior unchanged
- do not add monitor-backed usage summaries to these tabs
- do not imply that Netdata replaces Docker inventory collection for these objects

## Read Model Draft

This story assumes monitor-backed read APIs can provide allowlisted container telemetry by server and container identity.

Required read-model properties:

- server-scoped query
- stable `container_id` join key
- allowlisted series names only
- compact latest value plus short-window points
- explicit freshness or observation timestamp

The browser must not send arbitrary TSDB selector queries.

## Technical Context

Current implementation anchor points:

- `web/src/components/docker/ContainersTab.tsx`
- `web/src/components/connect/DockerPanel.tsx`
- `backend/domain/routes/docker.go`
- `backend/domain/routes/monitor.go`
- `backend/domain/monitor/metrics/tsdb/catalog.go`

Current repo behavior:

- container inventory is loaded from Docker ext APIs
- current container usage depends on request-time `docker stats`
- there is no monitor-specific container stats UI contract yet

This story should replace only the stats evidence path. It should not reopen the inventory and control contracts already anchored in Epic 29.

## Tasks / Subtasks

- [ ] Task 1: Define container telemetry frontend contract
	- [ ] 1.1 add monitor-facing types for latest container usage and short-window series
	- [ ] 1.2 define a stable join from monitor telemetry to Docker inventory by `container_id`
	- [ ] 1.3 define telemetry freshness and empty-state handling
- [ ] Task 2: Replace request-time stats usage in the Containers tab
	- [ ] 2.1 remove direct dependency on `docker stats` for normal container usage rendering
	- [ ] 2.2 render CPU, memory, and network telemetry from monitor-backed data
	- [ ] 2.3 preserve all existing inventory-driven actions and inspect flows
- [ ] Task 3: Keep non-container tabs unchanged
	- [ ] 3.1 do not migrate Images to monitor-backed collection in this story
	- [ ] 3.2 do not migrate Networks to monitor-backed collection in this story
	- [ ] 3.3 do not migrate Volumes to monitor-backed collection in this story
- [ ] Task 4: Validate degraded and partial-data UX
	- [ ] 4.1 stale telemetry state test coverage
	- [ ] 4.2 missing telemetry state test coverage
	- [ ] 4.3 inventory-and-actions remain usable when telemetry is unavailable

## Acceptance Criteria

- [ ] AC1: The Server Detail Docker containers view can render current CPU and memory usage from monitor-backed container telemetry.
- [ ] AC2: Container telemetry joins to Docker inventory through a stable container identity without persisting full container inventory in monitoring storage.
- [ ] AC3: The UI can show a short-window usage trend for supported container telemetry series using only allowlisted monitor queries.
- [ ] AC4: Container actions, inspect, and logs continue to work through Docker ext APIs and are not blocked by telemetry availability.
- [ ] AC5: Images, Networks, and Volumes tabs remain inventory-driven and unchanged in this story.
- [ ] AC6: Missing or stale telemetry degrades explicitly in the UI without showing misleading zero values.
- [ ] AC7: The browser does not gain arbitrary TSDB query capability to render container telemetry.

## Implementation Notes

- prefer monitor-backed `latest + short-window trend` reads over raw TSDB-shape exposure in the browser
- keep telemetry naming user-facing and operational; avoid leaking collector-native series names into the UI
- keep the current row-first container table model unless usability clearly fails after telemetry lands
- if monitor telemetry quality is insufficient for some optional labels, keep those labels out of the contract instead of guessing joins

## File Targets

- `web/src/components/docker/ContainersTab.tsx`
- `web/src/components/connect/DockerPanel.tsx`
- `web/src/routes/_app/_auth/resources/-servers.test.tsx`
- `web/src/lib/monitor-api.ts`
- monitor read-model helpers under `web/src/pages` or `web/src/lib`

## Out of Scope

- replacing Docker inventory APIs
- moving image, network, or volume inventory to Monitor
- adding a standalone container observability workspace
- arbitrary PromQL or TSDB query building in the browser