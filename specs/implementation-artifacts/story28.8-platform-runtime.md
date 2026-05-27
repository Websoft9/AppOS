# Story 28.8: Platform Runtime Surface

**Epic**: Epic 28 - Monitoring
**Priority**: P1
**Status**: Implemented
**Depends on**: Story 28.4, Story 28.5, Epic 29

## Objective

Expose one system-level runtime surface that explains what AppOS is made of at runtime, which platform components are currently running, and how operators should interpret the current platform composition without turning this page into a service-control console.

## Naming Decision

Use `Platform Runtime` as the user-facing page name.

Do not use bare `Runtime` as the top-level menu label.

Reasoning:

- `Runtime` alone is too ambiguous and can be misread as language runtime, container runtime, or generic run state.
- `Platform Runtime` makes the ownership explicit: this page describes AppOS itself, not monitored business targets.
- The page is adjacent to `Status`, but it answers a different question.

Recommended navigation placement:

- `System > Status`
- `System > Platform Runtime`

## User Story

As an operator,
I want one page that shows which AppOS platform components and runtime processes currently make up the system,
so that I can understand what is running, what each part is responsible for, and where to go next when something is missing or unhealthy.

## Core Question

`Status` answers:

- is the platform healthy
- what is degraded or unavailable
- what needs intervention

`Platform Runtime` answers:

- what AppOS is currently composed of
- which platform components and runtime processes are present
- what each component is responsible for
- which surface owns deeper diagnosis or operational action

## Boundary

This page is read-oriented and explanation-oriented.

It should not become:

- a replacement for `Status`
- a replacement for `Components`
- a raw process explorer
- a service-control panel
- a full topology editor

Ownership split:

- `Status` owns health conclusion, alerting posture, and degraded-state diagnosis
- `Platform Runtime` owns runtime composition, component presence, and process/service explanation
- `Components` owns install, enable, disable, repair, and lifecycle actions for platform software
- `Monitor` owns telemetry freshness, trends, and monitor-specific diagnosis

## Scope

In scope for MVP:

- show a read-only built-in component list for the current AppOS runtime
- show a compact active services table for the current AppOS runtime
- keep both sections lightweight and explanation-oriented rather than operational
- expose enough runtime metadata for quick operator awareness without turning the page into a control console

Out of scope for MVP:

- process kill / restart buttons
- inline install, repair, or upgrade actions
- full Linux process table
- arbitrary host-level process inspection
- raw Docker inventory takeover
- custom dashboards or charts

## Implemented Surface

The current MVP surface is intentionally minimal.

Implemented sections:

1. `Runtime Summary`
	- short sentence describing the current AppOS runtime shape
	- compact counts for built-in components, available, unavailable, and active services

2. `Built-in Components`
	- dense read-only list with these columns only:
	  - `Name`
	  - `Version`
	  - `Availability`
	  - `Service`
	  - `Updated at`
	- `OS` is pinned first and `AppOS` second
	- no cards, grouping, search, filters, or inline actions

3. `Active Services`
	- one merged runtime-services table
	- diagnostic services are not split into a separate section in the current MVP
	- logs remain reachable from the service table where available

## Built-in Components Contract

The built-in components list is runtime-registry-driven and intentionally compact.

Displayed fields are limited to:

- `id` / `name`
- detected `version`
- boolean availability
- whether the component is a service
- `updated_at` when a reliable timestamp source exists

The exact managed set remains AppOS-owned and curated rather than inferred from every host process.

## Active Services Contract

The runtime-services section remains intentionally small.

It shows one merged table of AppOS-local services with runtime state and log access when available.

Guardrails:

- do not expose a raw `ps` page as the default experience
- do not show unrelated host processes
- do not split diagnostic services into a second operator section unless a future story explicitly restores that distinction

## UX Contract

- The page should feel explanatory, not diagnostic-first.
- Health color and severity cues may appear, but the page should not compete with `Status` for operator attention hierarchy.
- Every row or card should make the next owning surface obvious.
- Copy should answer `what is this` before `what is wrong with this`.

## Data Loading Direction

Recommended load order:

1. runtime summary and component list
2. curated runtime process list
3. optional handoff metadata

Do not block the whole page on monitor or trend data.

If monitor-backed health information is unavailable, the page should still explain platform composition.

## Existing Backend Inventory

This story should begin from existing runtime and component read paths rather than assume a blank-slate backend.

Verified reusable surfaces in the current codebase:

- `GET /api/software/local`
	- current source for the built-in runtime component list
	- now returns the full AppOS-local runtime registry, with software metadata attached when available
- `GET /api/software/local/services`
	- current source for the merged active-services table
- `GET /api/software/local/services/{name}/logs`
	- current source for service log access from the runtime page
- `GET /api/servers/{serverId}/docker/containers`
	- server-scoped Docker container inventory
	- useful for handoff or future expansion, but should not define the MVP page by itself
- `GET /api/servers/{serverId}/ops/systemd/services`
	- server-scoped system service list
	- useful only when the page intentionally bridges into managed-server runtime details
- `GET /api/monitor/servers/{id}/container-telemetry`
	- telemetry and runtime health signal for containers
	- diagnostic adjunct, not the source of truth for component composition

Current state summary:

- the runtime page currently reuses `software/local` and `software/local/services`
- the built-in component list is backed by the single local runtime registry in `components_local.yaml`
- there is not yet one dedicated `system/runtime` read route, and that is acceptable for the current MVP

Implication for MVP:

- do not invent a raw host-process explorer
- keep the page on curated local AppOS components plus merged active services
- treat Docker inventory and systemd services as secondary handoff surfaces unless the story scope expands

## API Direction

The target architecture is one dedicated runtime read model, but MVP may compose from existing read routes first.

This read model is a `Platform Runtime` contract, not a monitoring contract.

`Host/Kernel Facts` on this page describe runtime-visible system facts that AppOS can read from inside the current runtime.

They must not be presented as full host monitoring, host trend telemetry, or a claim that AppOS has privileged host inspection.

Preferred end-state route:

- `GET /api/system/runtime`

Pragmatic delivery guidance:

1. MVP may aggregate existing component and service routes in the frontend or a thin backend adapter.
2. Introduce `GET /api/system/runtime` only when the composition logic becomes repeated, unstable, or too leaky for the UI.
3. Do not route this page through monitor trend APIs.
4. Do not redefine Docker inventory as the canonical platform-runtime model.

### Minimal Host/Kernel Facts Contract

When this page exposes host-adjacent facts, keep them minimal and split them from monitoring semantics.

- `host_kernel_facts`
	- `kernel_release`
	- `architecture`
	- `cpu_topology_visible`
		- `model_name`
		- `online_cpu_count`
- `runtime_limits`
	- `cpuset_effective`
	- `cpu_quota`
	- `memory_limit_bytes`

Guardrails:

- do not label these fields as host monitoring
- do not treat `/etc/os-release` from the AppOS container as canonical host OS distribution
- do not collapse kernel-visible facts and runtime limits into one mixed summary label

### Backend Read Model Contract

The backend contract for these fields belongs here because the owning surface is `Platform Runtime`.

- `software/local` continues to own built-in component inventory
- `software/local/services` continues to own active local service observation
- `system/runtime` owns the aggregated read model for this page when a dedicated backend route is introduced

Suggested response shape:

```json
{
	"summary": {
		"runningComponents": 5,
		"degradedComponents": 1,
		"missingComponents": 0,
		"runtimeShape": "single-container appos with embedded control-plane services"
	},
	"components": [
		{
			"componentKey": "worker",
			"displayName": "Worker",
			"state": "running",
			"runtimeKind": "process",
			"ownedCapability": "background jobs",
			"detailHref": "/system/status"
		}
	],
	"processes": [
		{
			"name": "worker",
			"state": "running",
			"pid": 123,
			"startedAt": "2026-05-23T09:00:00Z",
			"componentKey": "worker"
		}
	],
	"host_kernel_facts": {
		"kernel_release": "6.8.0-57-generic",
		"architecture": "x86_64",
		"cpu_topology_visible": {
			"model_name": "Intel(R) Xeon(R) Platinum 8175M CPU @ 2.50GHz",
			"online_cpu_count": 4
		}
	},
	"runtime_limits": {
		"cpuset_effective": "0-3",
		"cpu_quota": "unrestricted",
		"memory_limit_bytes": null
	}
}
```

## Acceptance Criteria

- [ ] AC1: `System` navigation contains `Platform Runtime` immediately after `Status`.
- [x] AC2: The page explains AppOS runtime composition through a curated built-in component list rather than a raw process dump.
- [x] AC3: The built-in component list is dense and minimal, showing `Name`, `Version`, `Availability`, `Service`, and `Updated at` only.
- [x] AC4: `OS` appears first and `AppOS` second in the built-in component list.
- [x] AC5: The page exposes one merged `Active Services` table; diagnostic services are not split into a second MVP section.
- [x] AC6: The page remains read-only in MVP and does not absorb component lifecycle actions.
- [x] AC7: Service logs remain reachable from the active-services table when available.
- [x] AC8: MVP reuses existing `software/local` and `software/local/services` read paths.
- [x] AC9: MVP does not require a generic host-process or full-container inventory view to be considered complete.

## Implementation Notes

- Keep the page dense, plain, and read-only.
- Keep built-in components registry-driven and avoid extra grouping or explanatory chrome.
- Treat `Updated at` as best-effort metadata: show it when a reliable file-backed timestamp exists, otherwise allow `-`.

## References

- [Source: specs/implementation-artifacts/epic28-monitoring.md]
- [Source: specs/implementation-artifacts/story28.4-operator-surfaces.md]
- [Source: specs/implementation-artifacts/story28.5-platform-status-frontend.md]