# Story 4.3 Replan: Server Detail Docker Workspace

**Epic**: Epic 4 - Docker Operations Layer  
**Priority**: P1  
**Status**: Proposed Replan  
**Depends on**: Story 4.1, Story 4.2, Story 20.6, Story 20.8, Story 28.6, Story 28.7

## Objective

Replan the Docker interface so AppOS has one primary Docker operations surface anchored in Server Detail, instead of continuing to evolve a standalone multi-host Docker console as the main product contract.

## Why This Replan Exists

The originally delivered Story 4.3 succeeded as an implementation slice, but it no longer matches the product information architecture AppOS is converging toward.

Current mismatch:

- Story 4.3 established `/docker` as a standalone operations page with its own server selector.
- Server operations in AppOS are now converging on server-scoped detail tabs such as `Connection`, `Systemd`, `Monitor`, and the existing embedded `DockerPanel`.
- Monitoring follow-up stories already assume Docker lives inside Server Detail and explicitly forbid turning Docker into a monitoring console.

The root product issue is not missing buttons. It is split ownership and split navigation.

## Product Decision

Use one primary rule:

1. `Server Detail > Docker` is the canonical Docker workspace.
2. `/docker` becomes a lightweight entry surface, not the main operating surface.
3. Docker remains inventory-first and action-ready.
4. Monitor remains telemetry-first and diagnosis-first.

This replan consolidates Docker around the same server-scoped mental model already used by Server Detail.

## Ownership Model

This UI belongs to two layers, not one:

### Domain Ownership: Epic 4

Epic 4 owns the Docker capability itself:

- containers, images, networks, volumes, and compose inventories
- Docker inspect, logs, terminal entry, and lifecycle actions
- Docker-specific page rules, table structures, action placement, and safety expectations

If the question is `what Docker object exists` or `what Docker action can be executed`, that is Epic 4 scope.

### Surface Ownership: Server Detail

Server Detail owns where this capability lives in the product IA:

- the server-scoped tab container
- inherited server context
- adjacency with `Connection`, `Systemd`, and `Monitor`
- route entry and handoff behavior for one server workspace

That hosting contract now lives in `specs/implementation-artifacts/story20.11-detail-docker-tabs.md`.

If the question is `where should the operator encounter Docker for this server` or `how does Docker fit beside other server operations`, that is Server Detail scope.

### Decision Rule

Use this rule to remove ambiguity:

- Epic 4 owns the Docker workspace contract
- Server Detail owns the shell that hosts that workspace

So the UI is product-located under Server Detail, but feature-owned by Epic 4.

## User Story

As a superuser,
I want Docker operations to live inside the current server context,
so that I can inspect containers, images, volumes, networks, and compose projects without switching into a disconnected global console and without losing the surrounding server diagnosis context.

## Scope

In scope:

- redefine Story 4.3 as the product contract for the Server Detail Docker workspace
- simplify Docker navigation so server context is inherited instead of reselected for the main flow
- preserve Epic 4 ownership of Docker inventory and Docker actions
- preserve compatibility with monitor handoff stories by keeping telemetry secondary inside Docker
- define the future role of `/docker` as an entry or redirect surface

Out of scope:

- redesigning Docker backend routes beyond the already-known server-scoped convergence follow-up
- moving Docker actions into Monitor
- replacing Docker inventory APIs with monitor-backed inventory
- introducing multi-server bulk Docker operations in this story
- rewriting container observability beyond the handoff and inline evidence contracts already planned in Epic 28

## Information Architecture

### Primary Surface

Primary ownership moves to:

- `Resources > Servers > [Server Detail] > Docker`

The Docker tab should be treated as a first-class server detail workspace, parallel to `Connection`, `Systemd`, and `Monitor`.

The Server Detail shell, tab placement, and route-entry contract are now tracked in `story20.11-detail-docker-tabs.md`.

### Route Strategy

Use these rules:

1. deep links may still target `/docker`
2. `/docker` should behave as an entry page or redirect shell
3. the first-class operational destination should be the selected server's Docker tab

Preferred MVP behavior:

- if a server context is already known, `/docker` redirects to that server's Docker detail view
- if no server context is known, `/docker` shows a minimal server picker and then opens the selected server's Docker tab

`/docker` should not remain a second fully independent control plane with its own long-term IA.

## UX Contract

### Core Principle

Keep Docker object-first, not dashboard-first.

The operator's main questions here are:

1. what containers, images, networks, volumes, and compose projects exist on this server
2. what action can I safely execute now
3. what needs deeper diagnosis in Monitor or adjacent server tabs

### Workspace Structure

Inside `Server Detail > Docker`, use this structure:

1. `Overview`
2. `Containers`
3. `Compose`
4. `Images`
5. `Volumes`
6. `Networks`

Rationale:

- `Overview` gives one fast scan of runtime shape for the current server
- `Containers` and `Compose` stay closest to the operator's highest-frequency tasks
- lower-frequency object inventories follow after the operational tabs

### Toolbar Rules

The Docker tab inherits the server context from Server Detail.

Therefore:

- remove the primary server selector from the main Docker workspace contract
- keep `Refresh` as a visible first-order action
- keep `Run Command` available, but demote it behind a clearer context label or overflow action if toolbar density becomes a problem
- keep tab-local search and filters close to the inventory they affect

The toolbar should not compete with the page for attention.

### Containers

Containers remain the anchor inventory.

Rules:

- keep row-first inventory and actions
- keep inspect, logs, terminal, and lifecycle actions reachable from the row
- allow compact telemetry evidence later, but do not make telemetry the primary layout model
- prefer row menus or compact action groupings over wide inline action bars when density becomes too high

### Compose

Compose remains a Docker-owned operational surface.

Rules:

- project list first
- logs and config are contextual drill-down flows
- compose actions stay adjacent to project identity
- compose is not promoted above containers as the default tab unless usage evidence later justifies it

### Images, Volumes, Networks

These remain inventory and maintenance surfaces.

Rules:

- optimize for scanning and safe maintenance actions
- keep destructive actions explicit and confirmable
- do not add monitoring-style summary chrome to these tabs in this story

## Handoff Rules

Use existing cross-surface ownership rules consistently:

- Docker answers what exists and what action can be executed
- Monitor answers what is unhealthy, what is consuming resources, and whether telemetry is trustworthy
- Server Detail tabs answer adjacent server questions without forcing a route jump back to a global workspace

Allowed handoffs:

- Docker container row to `Monitor` tab for deeper runtime diagnosis
- `Monitor` tab back to Docker for inspect, logs, terminal, or lifecycle action
- Docker to `Connection` or `Systemd` when the question is about server access or service state rather than container inventory

## Acceptance Criteria

- [ ] AC1: Story 4.3 product ownership is redefined so `Server Detail > Docker` is the canonical Docker workspace.
- [ ] AC2: The primary Docker workflow no longer depends on a multi-host selector embedded inside the main Docker workspace.
- [ ] AC3: `/docker` is reduced to an entry, redirect, or lightweight server-picking surface instead of remaining a parallel long-term control plane.
- [ ] AC4: The Docker workspace preserves Epic 4 ownership of inventory and actions for containers, compose projects, images, volumes, and networks.
- [ ] AC5: The Docker workspace stays inventory-first and does not become a monitoring console.
- [ ] AC6: `Overview`, `Containers`, `Compose`, `Images`, `Volumes`, and `Networks` are organized as one server-scoped workspace with the current server inherited from Server Detail.
- [ ] AC7: Container-level handoff to Monitor is explicit, but Monitor does not duplicate Docker actions or non-container inventories.
- [ ] AC8: The replan preserves a clear migration path for existing `/docker` links and existing DockerPanel-based implementation.

## Delivery Notes

This replan should be treated as a product-contract correction, not as a request to discard all implementation from the original Story 4.3.

What is preserved:

- the existing resource tabs and action models
- the embedded `DockerPanel` foundation
- compose logs, config editing, and container action flows

What changes:

- the primary navigation anchor
- server-context ownership
- toolbar emphasis and page hierarchy
- the role of `/docker`

## Suggested Implementation Breakdown

1. convert `/docker` into an entry or redirect shell
2. make `Server Detail > Docker` the product-facing destination for normal operations
3. simplify the Docker tab toolbar to inherit server context
4. retune tab order and emphasis around server-scoped operations
5. preserve monitor handoff without duplicating monitor ownership

## References

- `specs/implementation-artifacts/story4.3-docker-dashboard.md`
- `specs/implementation-artifacts/story20.8-detail-systemd.md`
- `specs/implementation-artifacts/story28.6-container-stats-ui.md`
- `specs/implementation-artifacts/story28.7-docker-monitor-handoff.md`
- `web/src/components/connect/DockerPanel.tsx`
- `web/src/pages/docker/DockerPage.tsx`