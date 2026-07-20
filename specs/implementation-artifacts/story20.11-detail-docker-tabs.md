# Story 20.11: Server Detail Docker Tabs

**Epic**: Epic 20 - Servers
**Status**: Draft | **Priority**: P1 | **Depends on**: Story 20.6, Story 20.8, Story 4.3, Story 28.6, Story 28.7

## Scope Positioning

This story defines the product-facing UI contract for how Docker operations are carried inside Server Detail.

It does not move Docker domain ownership out of Epic 4.
It defines the Server Detail shell, navigation, and tab-level information architecture that host the Docker workspace for one server.

This story owns:

- `Docker` as a Server Detail tab
- server-scoped route entry and handoff behavior
- inherited server context for the Docker workspace
- the information architecture of the Docker tab and its internal sub-tabs
- adjacency rules with `Connection`, `Systemd`, and `Monitor`

This story does not replace:

- Story 4.3 ownership of Docker inventory, actions, and Docker-specific interaction rules
- Story 28.6 ownership of monitor-backed container telemetry behavior
- Story 28.7 ownership of Docker/Monitor handoff rules

## Consolidated Source Transfer

This story consolidates the Server Detail hosting guidance that was previously described inside:

- `specs/implementation-artifacts/story4.3-docker-workspace-replan.md`

After this change, `story20.11-detail-docker-tabs.md` is the source of truth for where Docker operations live inside Server Detail.

## User Story

As a superuser, I can open Docker operations inside the current server detail context, so that I can inspect and operate Docker resources without leaving the surrounding server workspace.

## Goals

1. Make `Docker` a first-class Server Detail tab.
2. Remove the need to reselect server context inside the main Docker workflow.
3. Keep Docker operations adjacent to `Connection`, `Systemd`, and `Monitor` for the same server.
4. Preserve Docker as an inventory-first and action-ready workspace.
5. Reduce `/docker` to a transitional entry or redirect surface instead of a parallel long-term control plane.

## Out of Scope

- Docker backend route redesign beyond known server-scoped convergence work
- redefining Docker object-level action contracts owned by Epic 4
- moving Docker actions into Monitor
- multi-server fleet-level Docker operations
- monitor telemetry contract changes beyond layout and handoff expectations

## Ownership Note

Use this rule:

- Epic 4 owns what the Docker workspace can do
- Epic 20 owns where the Docker workspace lives in the server product surface

This means Docker is feature-owned by Epic 4, but product-located inside Server Detail.

## Information Architecture

### Primary Surface

The authoritative product-facing destination is:

- `Resources > Servers > [Server Detail] > Docker`

`Docker` should be treated as a first-class server detail workspace, parallel to:

- `Connection`
- `Systemd`
- `Monitor`

### Layout Model

Use the same high-level workspace shape as the `Systemd` tab.

The `Docker` tab should be divided into two vertical regions:

1. header region
2. workspace region

The workspace region is then divided into two columns:

1. left navigation menu
2. right content pane

The right content pane is then divided into two stacked regions:

1. breadcrumb row
2. primary content area

This means Docker should no longer be presented as a top-row horizontal tabs surface.
The Docker category switcher belongs in the left workspace menu instead.

### Route Strategy

Use these rules:

1. deep links may still target `/docker`
2. `/docker` behaves as an entry page or redirect shell
3. the first-class operational destination is the selected server's Docker tab

Preferred MVP behavior:

- if a server context is already known, `/docker` redirects to that server detail Docker view
- if no server context is known, `/docker` shows a lightweight server picker and then opens the selected server's Docker tab

`/docker` should not remain a second fully independent control plane.

## Docker Tab Structure

Inside `Server Detail > Docker`, use this structure:

1. `Overview`
2. `Containers`
3. `Compose`
4. `Images`
5. `Volumes`
6. `Networks`

Rationale:

- `Overview` provides a quick shape-of-runtime summary for one server
- `Containers` and `Compose` remain the highest-frequency operational tabs
- lower-frequency maintenance inventories follow afterward

The left navigation menu should switch between these sections.
The right pane should reflect the currently selected section.

## Header Contract

The header region should contain:

- page title: `Docker`
- one short descriptive sentence
- one primary `Refresh` action

The header is not the place for section switching.
Its job is orientation and one high-frequency refresh control.

## Toolbar Contract

The Docker tab inherits the active server from Server Detail.

Therefore:

- do not show a primary multi-server selector inside the main Docker tab workspace
- keep `Refresh` visible as a first-order action
- keep `Run Command` available, but do not let it dominate the layout
- keep search and filters local to the relevant inner tab, not global when unnecessary

The toolbar should support the inventory, not compete with it.

Preferred placement:

- `Refresh` stays in the top header region
- section-specific search, filters, and secondary actions live inside the selected content view
- breadcrumb stays above the selected content view, not inside the global header

## Breadcrumb Contract

The right content pane should start with a breadcrumb row.

Initial breadcrumb examples:

- `Docker / Overview`
- `Docker / Containers`
- `Docker / Compose`
- `Docker / Images`
- `Docker / Volumes`
- `Docker / Networks`

If the selected view later adds object-level drill-down, the breadcrumb should extend naturally instead of introducing a new top-level navigation model.

Example future shapes:

- `Docker / Containers / nginx`
- `Docker / Compose / app-stack`

## Content Pane Contract

Below the breadcrumb row, render the actual working content for the selected Docker section.

Examples:

- `Containers`: searchable inventory table and row actions
- `Volumes`: searchable inventory table and maintenance actions
- `Compose`: project inventory, logs entry, and config entry
- `Overview`: compact runtime summary for this server's Docker state

The content area should own all section-specific controls.
Do not duplicate content controls into the global Docker header.

## ASCII Draft

```text
+--------------------------------------------------------------------------------------------------+
| Docker                                                            Manage Docker resources        |
| Inspect containers, compose projects, images, volumes, and networks on this server.   [Refresh] |
+--------------------------------------------------------------------------------------------------+
|                                                                                                  |
|  +----------------------------+  +------------------------------------------------------------+  |
|  | Docker Navigation          |  | Breadcrumb                                                 |  |
|  |                            |  | Docker / Containers                                        |  |
|  |  > Overview                |  +------------------------------------------------------------+  |
|  |  > Containers              |  |                                                            |  |
|  |  > Compose                 |  | Content Area                                               |  |
|  |  > Images                  |  |                                                            |  |
|  |  > Volumes                 |  |  +------------------------------------------------------+  |  |
|  |  > Networks                |  |  | Containers                                            |  |  |
|  |                            |  |  | Search [..............]   Status [All v]              |  |  |
|  |                            |  |  +------------------------------------------------------+  |  |
|  |                            |  |  | Name        Image          State      Ports    Action |  |  |
|  |                            |  |  | nginx       nginx:1.27     running    80/tcp   [...]  |  |  |
|  |                            |  |  | redis       redis:7        exited     6379     [...]  |  |  |
|  |                            |  |  | app-web     myapp:v12      running    8080     [...]  |  |  |
|  |                            |  |  +------------------------------------------------------+  |  |
|  |                            |  |                                                            |  |
|  +----------------------------+  +------------------------------------------------------------+  |
|                                                                                                  |
+--------------------------------------------------------------------------------------------------+
```

The same shell should remain stable when switching to `Volumes`, `Images`, `Compose`, or `Networks`.
Only the selected left-nav item, breadcrumb, and right-side content should change.

## Interaction Direction

### Core Principle

Keep Docker object-first, not dashboard-first.

The tab should answer:

1. what Docker objects exist on this server
2. what action can the operator take now
3. when should the operator hand off to an adjacent server tab

### Adjacent Tab Relationship

- `Connection` answers server reachability and setup/recovery questions
- `Systemd` answers host service management questions
- `Monitor` answers telemetry, freshness, and diagnosis questions
- `Docker` answers container/image/volume/network/compose inventory and actions

Do not blur these boundaries by duplicating large sections of one tab inside another.

## Handoff Expectations

Allowed handoffs:

- Docker container row to `Monitor` for deeper runtime diagnosis
- `Monitor` back to Docker for inspect, logs, terminal, or lifecycle action
- Docker to `Connection` when the issue is access or server usability
- Docker to `Systemd` when the issue is host service state rather than container inventory

The handoff should keep server context stable.

## Acceptance Criteria

- [ ] AC1: Server Detail exposes `Docker` as the canonical product-facing Docker workspace for one server.
- [ ] AC2: The Docker workspace inherits server context from Server Detail instead of requiring a primary in-page server selector.
- [ ] AC3: The Docker tab uses a two-level layout: top header plus lower workspace, with the lower workspace split into left navigation and right content.
- [ ] AC4: `/docker` is treated as an entry, redirect, or lightweight server picker rather than a parallel long-term workspace.
- [ ] AC5: The Docker tab stays adjacent to `Connection`, `Systemd`, and `Monitor` without duplicating their core ownership.
- [ ] AC6: Handoffs between Docker and Monitor preserve one-server context and keep ownership explicit.
- [ ] AC7: This story does not redefine Docker object-level action contracts owned by Epic 4.
- [ ] AC8: The left navigation uses `Overview`, `Containers`, `Compose`, `Images`, `Volumes`, and `Networks` as the section switcher instead of a horizontal top-tabs strip.
- [ ] AC9: The right content pane includes a breadcrumb row above the selected section content.

## References

- `specs/implementation-artifacts/story20.6-server-ui.md`
- `specs/implementation-artifacts/story20.8-detail-systemd.md`
- `specs/implementation-artifacts/story4.3-docker-workspace-replan.md`
- `specs/implementation-artifacts/story28.6-container-stats-ui.md`
- `specs/implementation-artifacts/story28.7-docker-monitor-handoff.md`