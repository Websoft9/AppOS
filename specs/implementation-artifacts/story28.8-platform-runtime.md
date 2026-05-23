# Story 28.8: Platform Runtime Surface

**Epic**: Epic 28 - Monitoring
**Priority**: P1
**Status**: Proposed
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

- list the core AppOS platform components that make up the running system
- show whether each component is currently present and running
- show the runtime form of each component, such as internal process, worker, service, or embedded dependency
- show a short role description for each component
- show a compact runtime-process section for key platform processes
- provide handoff links to `Status`, `Monitor`, `Components`, or logs when deeper action is needed

Out of scope for MVP:

- process kill / restart buttons
- inline install, repair, or upgrade actions
- full Linux process table
- arbitrary host-level process inspection
- raw Docker inventory takeover
- custom dashboards or charts

## Surface Model Draft

The page should be structured as a platform-composition surface, not a monitor dashboard.

Suggested sections:

1. `Runtime Summary`
   - one short sentence about the current AppOS runtime shape
   - counts such as running components, degraded components, and missing optional components

2. `Core Components`
   - each item represents one AppOS platform component
   - show name, current state, runtime form, and responsibility summary

3. `Runtime Processes`
   - show the key platform processes or services that are actually running
   - keep this compact and curated, not a full host process list

4. `Next Surface`
   - explicit handoff links such as `View Status`, `Open Monitor`, `Manage Components`, or `Open Logs`

## Component Model Draft

Each platform component card should answer:

- what this component is
- whether it is running now
- what runtime form it uses
- what responsibility it owns
- where the operator should go for deeper action

Suggested fields:

- `component_key`
- `display_name`
- `state` such as `running`, `degraded`, `missing`, `stopped`, `unknown`
- `runtime_kind` such as `process`, `worker`, `service`, `embedded dependency`
- `owned_capability`
- `detail_href`

Examples of likely MVP items:

- reverse proxy
- PocketBase / API server
- worker
- scheduler
- monitor ingest path
- time-series backend

The exact list should remain AppOS-owned and curated rather than inferred from every OS process.

## Process Model Draft

The runtime-process section should remain intentionally small.

Show only key platform processes or services that help explain current platform composition.

Suggested fields:

- `name`
- `state`
- `pid` or equivalent runtime identifier when cheap to provide
- `started_at` when available
- `component_key` linkage

Guardrails:

- do not expose a raw `ps` page as the default experience
- do not show unrelated host processes
- do not require operators to understand low-level supervisor internals to use the page

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

- `GET /api/components`
  - curated AppOS component inventory
  - good fit for platform composition and component presence
- `GET /api/components/services`
  - supervisord-managed local service/process list
  - good fit for the MVP runtime-process section
- `GET /api/software/local`
  - software and component catalog view for the local AppOS instance
  - useful as supporting metadata, but not the primary runtime-process source
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

- the backend already exposes component and process-like data
- the data is split across `components`, `software`, `docker`, `monitor`, and `server ops`
- there is not yet one unified `platform runtime` read model

Implication for MVP:

- do not invent a raw host-process explorer
- do not force the page to unify every runtime source on day one
- start from curated local AppOS components and supervisord services
- treat Docker inventory and systemd services as secondary handoff surfaces unless the story scope expands

## API Direction

The target architecture is one dedicated runtime read model, but MVP may compose from existing read routes first.

Preferred end-state route:

- `GET /api/system/runtime`

Pragmatic delivery guidance:

1. MVP may aggregate existing component and service routes in the frontend or a thin backend adapter.
2. Introduce `GET /api/system/runtime` only when the composition logic becomes repeated, unstable, or too leaky for the UI.
3. Do not route this page through monitor trend APIs.
4. Do not redefine Docker inventory as the canonical platform-runtime model.

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
  ]
}
```

## Acceptance Criteria

- [ ] AC1: `System` navigation contains `Platform Runtime` immediately after `Status`.
- [ ] AC2: The page explains AppOS runtime composition through curated platform components rather than a raw process dump.
- [ ] AC3: Each listed component shows current state, runtime kind, and owned responsibility.
- [ ] AC4: The page can show a compact curated process/service list for key AppOS runtime parts.
- [ ] AC5: The page remains read-only in MVP and does not absorb component lifecycle actions.
- [ ] AC6: The page provides explicit handoff paths to `Status`, `Monitor`, `Components`, or logs.
- [ ] AC7: The page remains useful even when monitor telemetry is degraded or unavailable.
- [ ] AC8: MVP reuses existing component or service read paths unless a dedicated adapter is clearly needed.
- [ ] AC9: MVP does not require a generic host-process or full-container inventory view to be considered complete.

## Implementation Notes

- Prefer a dedicated system-read model instead of forcing platform-runtime composition through monitor trend APIs.
- Keep the component catalog AppOS-owned and curated; do not auto-promote every observed process into the page.
- Reuse existing platform status and software/component knowledge where possible.
- Treat this page as a system operator surface, not as a developer debugging console.
- Current best-fit reuse path is `components` plus `components/services`; `software/local` is supplementary metadata, not the primary runtime-process feed.
- If a backend adapter is introduced later, it should normalize ownership and handoff metadata rather than merely proxy raw Docker or systemd payloads.

## References

- [Source: specs/implementation-artifacts/epic28-monitoring.md]
- [Source: specs/implementation-artifacts/story28.4-operator-surfaces.md]
- [Source: specs/implementation-artifacts/story28.5-platform-status-frontend.md]