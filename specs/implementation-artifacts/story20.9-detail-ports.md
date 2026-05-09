# Story 20.9: Server Detail Inspect Ports Tab

**Epic**: Epic 20 - Servers
**Status**: Draft | **Priority**: P1 | **Depends on**: Story 20.4, Story 20.6

## Scope Positioning

This story defines the product-facing UI contract for refactoring `Inspect Ports` inside Server Detail.

It moves the current port inspection experience toward the same list-and-detail interaction model used by `Systemd`, while keeping the ports domain specific to occupancy, reservation, and safe release actions.

This story owns:

- the `Inspect Ports` tab information architecture
- port inventory search, filtering, sorting, and pagination behavior
- selected-port detail behavior
- action placement for port release flows
- migration direction away from the legacy terminal modal-style port inspector

This story does not replace Story 20.4 ownership of the backend ports domain and release operations.

## User Story

As a superuser, I can inspect and act on server ports from a searchable Server Detail tab, so that I can understand occupancy and reservation state without working through a dense modal table.

## Goals

1. Make `Inspect Ports` a first-class list-and-detail tab in Server Detail.
2. Improve scan speed for large port inventories through search, filtering, sorting, and pagination.
3. Separate port inventory browsing from selected-port inspection.
4. Keep dangerous release actions explicit and confirm-gated.
5. Converge the product-facing UX away from the legacy terminal port inspector.

## Out of Scope

- redesigning backend port detection algorithms
- multi-server or bulk port actions
- arbitrary process management beyond the existing release flow
- replacing Story 20.4 backend route ownership

## Information Architecture

The `Inspect Ports` tab should use two primary sections:

1. `Port Inventory`
2. `Selected Port`

Recommended first-read structure:

1. search, filters, protocol switch, summary, and refresh controls
2. port inventory list
3. selected-port detail pane

## Interaction Contract

### Inventory

The inventory should support:

- protocol switch: `TCP` / `UDP`
- search by port number, process label, or reservation source label
- status filter: `All`, `Occupied`, `Reserved`
- sortable columns for port, status, and reservation-source weight
- pagination for long results
- explicit empty state when no rows match

The inventory remains the primary scan surface.

### Selection

- selecting a row populates `Selected Port` in the same tab
- the tab starts with an explicit empty state, not an auto-selected first row
- selection clears if the selected port leaves the visible inventory scope

### Actions

- row-level actions should use a compact action menu
- `Release port` remains confirm-gated
- force release remains a second-step choice inside confirmation, not a primary inline action

## Selected Port

The detail pane should show, when available:

- port number
- protocol
- current status
- listener addresses
- process name and PID set
- reservation sources
- container probe summary when relevant
- release-action context and outcome messaging

The detail pane should focus on inspection first and action second.

## Backend Contract Expectations

The existing ports list route should continue to provide the base inventory for this tab.

The frontend may continue to apply client-side sorting, filtering, and pagination unless payload size or missing detail fields require backend expansion.

Preferred current contract:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/servers/:serverId/ops/ports` | Port inventory with occupancy and reservation metadata |
| POST | `/api/servers/:serverId/ops/ports/:port/release` | Release flow for the selected port |

## Compatibility Direction

The Server Detail `Inspect Ports` tab is the authoritative product-facing UX.

The legacy port inspector in terminal/connect flows should either:

- reuse the same panel implementation, or
- be reduced to a secondary utility surface without redefining this story's UX contract

## Acceptance Criteria

- [ ] AC1: Server Detail exposes `Inspect Ports` as a list-and-detail tab.
- [ ] AC2: The tab supports protocol switching, search, status filtering, sorting, and pagination.
- [ ] AC3: The inventory populates a `Selected Port` pane in the same tab.
- [ ] AC4: The tab starts with an explicit empty selected-port state.
- [ ] AC5: Port release remains confirm-gated, with force release as a secondary choice.
- [ ] AC6: The selected-port pane shows occupancy and reservation details drawn from the existing ports domain.
- [ ] AC7: The Server Detail tab becomes the authoritative UX direction for port inspection.
