# Story 20.8: Server Detail Systemd Tab

**Epic**: Epic 20 - Servers
**Status**: Implemented | **Priority**: P1 | **Depends on**: Story 20.5, Story 20.6

## Scope Positioning

This story defines the product-facing UI contract for the `Systemd` tab inside Server Detail.

It replaces the earlier `Manage Services` modal model from Story 20.5 with a stable detail-tab experience that is better suited for scanning, filtering, and operating a large number of services on one server.

The legacy terminal modal is considered removed, not deprecated. This story does not preserve or design for backward compatibility with that flow.

This story owns:

- the `Systemd` tab naming
- the service-list information architecture
- search, filtering, and pagination behavior
- AppOS focus-service pinning behavior inside the main inventory sort order
- list-level and detail-level action placement
- malformed systemd row handling expectations for the UI-facing list contract

This story does not replace Story 20.5 ownership of the backend systemd operation domain. Story 20.5 continues to own the core route family and low-level service operation capabilities that feed this tab.

## User Story

As a superuser, I can find and operate systemd services from a searchable, paginated server detail tab, so that I can manage common platform services quickly without opening a narrow modal and stepping through one service at a time.

## Goals

1. Rename the old `Manage Services` surface to `Systemd`.
2. Move systemd operations from an interruptive modal to a first-class Server Detail tab.
3. Make large service inventories scan-friendly through pagination, search, and filters.
4. Keep AppOS-common services pinned near the top of the inventory so operators can reach the likely targets first.
5. Keep lifecycle diagnosis in `Connection` while making `Systemd` the operational service inventory.

## Out of Scope

- redesigning connection or lifecycle diagnosis owned by the `Connection` tab
- multi-server or bulk systemd operations
- full journal analytics or historical log retention
- arbitrary `systemctl` command passthrough
- advanced unit authoring workflow redesign beyond placement and access rules

## Naming Decision

### Tab Name

Use `Systemd` as the Server Detail tab name.

Do not use:

- `Manage Services` as the primary tab label, because it describes an action entry rather than the domain
- `Services` as the primary tab label, because it is too broad and can be confused with app-level services or mapped tunnel services
- `Daemon` as the primary tab label, because it is less recognizable for the target audience than `Systemd`

### Internal Section Names

Inside `Systemd`, use these top-level sections:

1. `Service Inventory`
2. `Selected Service`

`Service Inventory` is the primary list surface.

`Selected Service` is the contextual detail area for the currently selected service.

## Information Architecture

The `Systemd` tab should answer, in order:

1. which services on this server matter most right now
2. whether a target service can be found quickly
3. what state that service is in now
4. which safe high-frequency action the operator can take immediately
5. where to inspect deeper status, logs, and unit configuration if needed

Recommended first-read structure:

1. `Search and Filters`
2. `Service Inventory`
3. `Selected Service`

## `AppOS Focus Services`

Purpose:

- surface AppOS-most-common services before the operator searches manually
- reduce time-to-target for routine server checks
- keep common AppOS services discoverable without adding a second inventory block

Default AppOS focus services include:

- `docker`
- `netdata`
- `appos-tunnel`
- `appos-agent`

### Source of Truth Rule

These services should be predefined in frontend code.

For first rollout:

- AppOS ships with the fixed focus-service list above
- the product does not expose user customization for this list
- the backend does not need a settings contract or focus-service maintenance logic
- the frontend is responsible for matching and highlighting these services in the tab

This keeps the behavior simple: AppOS declares which services it cares about, and the UI makes those services easier to reach.

### Presentation Rule

The final implementation does not use a separate `AppOS Focus Services` strip.

Instead:

- focus services are pinned to the top of the inventory before non-focus services
- pinned services preserve their fixed frontend-defined order
- missing focus services are omitted entirely
- the UI does not render placeholder cards or `Not present` rows

This keeps the page denser and avoids duplicating the same service in two surfaces.

## `Search and Filters`

Purpose:

- make the service inventory usable when a server has many systemd units
- help operators narrow the list without relying on exact-name recall

### Search Contract

The primary search field should support service-name lookup with:

- prefix match
- substring match
- normalized matching that tolerates `.service` suffix omission in the query

The first rollout does not require full-text search across unit content or logs.

### Filter Contract

The first rollout should support:

- `Status`: `All`, `Running`, `Exited`, `Failed`, `Inactive`

### UX Rules

- search input should stay visible above the table at all times
- filter changes should update the current page results without navigating away from the tab
- entering search should reset pagination to page 1
- status option labels should show counts based on the current search result scope
- empty-result state should explain whether the query or filter caused the mismatch
- search matching should tolerate omission of the `.service` suffix
- malformed list rows without a valid `.service` unit name must not be shown to the operator

## `Service Inventory`

Purpose:

- provide a dense, paginated systemd service list for one server
- make service state and common actions visible at scan speed

### Table Shape

The inventory should be a paginated table rather than an endless list or modal picker.

Show these columns in the first rollout:

1. `Name`
2. `Status`
3. `Summary`
4. `Actions`

### Column Meanings

#### `Name`

- primary identity for the unit
- should display the normalized service name without the `.service` suffix
- AppOS focus matches are pinned by sort order rather than marked with extra row chrome

#### `Status`

- current runtime state such as `running`, `exited`, `failed`, `dead`, `inactive`
- status color should be meaningful but not the only signal

#### `Summary`

- one compact line for recent or current service meaning
- preferred content: backend description when present, otherwise compact load/sub-state fallback
- do not place multi-line logs here

#### `Actions`

- list actions live inside a row menu rather than inline buttons
- final rollout actions: `Open overview`, `Open logs`, `Open unit`, `Edit unit`, `Start`, `Restart`, `Stop`, `Enable`, `Disable`

The dense row stays compact because actions are moved into a kebab menu, not because lower-frequency actions are forbidden.

### Pagination Contract

- table must support pagination
- default page size is 20 rows
- page size may be configurable later, but first rollout only requires standard next/previous or numbered page control
- the current implementation uses previous/next controls plus `current/total` page text near the list toolbar
- total visible-service count and failed count should be visible near the list header

### Selection Contract

- selecting a row should populate the `Selected Service` pane in the same tab
- row selection should not navigate away from Server Detail
- no default service should be auto-selected on first load
- selection should clear automatically if the selected service leaves the visible inventory scope

## `Selected Service`

Purpose:

- keep deep inspection available without overloading the list itself
- provide a second-level detail area for the current service

Recommended sections and entry points:

1. `Overview`
2. `Logs`
3. `Unit` via row action entry when deeper inspection or editing is needed

### `Overview`

Show:

- service name
- description directly below name in the overview field list
- runtime state
- unit file path
- main PID when available
- load state
- active state
- sub state
- unit file state when available
- last transition or last known state timestamp when available

The final implementation renders overview as a compact label/value list, not as grouped cards.

### `Logs`

Show a recent journal slice for the selected service.

Keep logs secondary to the inventory and search experience. The log area supports copy-to-clipboard and recent-entry inspection, but it does not need analytics features.

### `Unit`

Show unit inspection and any existing safe edit flow already supported by backend contracts.

For first rollout:

- viewing unit content is in scope
- existing validate/apply capabilities remain accessible from here when supported
- unit editing is allowed only within existing guardrails from Story 20.5

Implementation note:

- `Unit` is opened from the inventory action menu and uses the same right-side detail surface rather than a separate modal
- validate/apply actions remain confirm-gated

## Interaction Model

### Page-Level Behavior

- `Systemd` lives in the existing Server Detail tab rail defined by Story 20.6
- it is a domain tab, not a replacement for `Connection`
- it must not repeat server-level readiness diagnosis or setup guidance
- it is the primary UX for server-detail systemd management in Epic 20

There is still a legacy systemd utility inside `ConnectServerPage`, but it is not the product-facing primary server-detail UX. That surface should follow the same malformed-row filtering rules and should not redefine this story's IA contract.

## Implementation Notes

The final implementation should be read as a product contract, not a frozen layout spec.

Keep these points stable in the story:

- the table remains the primary scan surface
- the selected-service pane stays visible without replacing the table
- AppOS focus services are pinned in the table rather than rendered as a separate strip
- pagination belongs to the inventory toolbar, not to the whole detail page

Do not treat the story as the source of truth for:

- exact split ratios or column widths
- exact control placement within the toolbar
- search input width or responsive breakpoints
- micro-copy or spacing decisions

Those details should evolve in source code and, when needed, in separate design artifacts rather than in this story.

### List-Level Actions

Row-level actions are exposed via a kebab menu and include both navigation and operations:

- `Open overview`
- `Open logs`
- `Open unit`
- `Edit unit`
- `Start`
- `Restart`
- `Stop`
- `Enable`
- `Disable`

All service mutations use the existing confirmation flow.

### Detail-Level Actions

`Selected Service` is now focused on inspection rather than action density:

- `Overview` and `Logs` are top-level detail tabs
- unit editing flows are still available, but entry happens from the row menu
- confirmation-gated validate/apply remains part of the existing backend-supported flow

## Backend Contract Adjustments

Story 20.5 already defines the core route family. This story adds the UI-driven requirements for the list endpoint actually used by the final implementation.

The service-list route should support:

- optional keyword query parameter for backend-assisted narrowing
- enough fields for frontend-side pagination, sorting, focus pinning, and status filtering
- output normalization that rejects malformed rows without a valid `.service` unit name

Final implemented route contract:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/servers/:serverId/ops/systemd/services` | Full service inventory with optional `keyword`; frontend applies pagination, sorting, and status filtering |

The existing detail routes from Story 20.5 remain valid for the selected-service pane:

- status
- logs
- action
- unit read/write
- verify
- apply

## Acceptance Criteria

- [x] AC1: Server Detail exposes a domain tab named `Systemd`.
- [x] AC2: The earlier `Manage Services` modal is no longer the primary systemd entry surface for server detail operations.
- [x] AC3: The `Systemd` tab shows a paginated service inventory with columns `Name`, `Status`, `Summary`, and `Actions`.
- [x] AC4: The inventory supports service-name search with suffix-tolerant matching and updates results without leaving the tab.
- [x] AC5: The inventory supports `Status` filtering for `All`, `Running`, `Exited`, `Failed`, and `Inactive`, with counts scoped to the current search result set.
- [x] AC6: AppOS-common services `docker`, `netdata`, `appos-tunnel`, and `appos-agent` are pinned through a frontend-predefined focus-service list.
- [x] AC7: The final UX does not render a separate focus strip; focus services are surfaced by pinned sort order without backend-managed focus-service logic.
- [x] AC8: Row-level actions are available through a compact action menu that includes navigation, lifecycle actions, and enable/disable operations.
- [x] AC9: Selecting a service populates a contextual `Selected Service` area in the same tab, and the tab starts with an explicit empty state rather than auto-selecting the first row.
- [x] AC10: The selected-service area exposes `Overview` and `Logs` directly, with unit workflows accessible from the row action menu without turning the tab into a second connection-diagnostics surface.
- [x] AC11: Malformed systemd rows without a valid `.service` unit name are excluded from the operator-visible inventory.
- [x] AC12: The service list API supports the implemented keyword query and returns normalized service metadata needed by the frontend inventory.

## Guardrails

- Keep server readiness, setup, and recovery guidance in `Connection`.
- Keep the `Systemd` tab focused on service inventory and service operations.
- Do not overload the first-read surface with logs or unit editor chrome.
- Do not expose arbitrary command execution or unrestricted systemd operations.
- Preserve Story 20.5 safety constraints and audit expectations for backend operations.

## Tasks / Subtasks

- [x] Task 1: Define and implement the `Systemd` tab shell inside Server Detail
  - [x] 1.1 Add `Systemd` to the stable detail tab model
  - [x] 1.2 Remove `Manage Services` as the primary interaction pattern for server-detail systemd work
- [x] Task 2: Build paginated service inventory
  - [x] 2.1 Add service table with `Name`, `Status`, `Summary`, and `Actions`
  - [x] 2.2 Add pagination controls and total-count display
  - [x] 2.3 Add row selection behavior tied to contextual detail
- [x] Task 3: Add findability features
  - [x] 3.1 Add service-name search with `.service` suffix-tolerant matching
  - [x] 3.2 Add `Status` filter with `Exited` support and search-scoped counts
  - [x] 3.3 Pin AppOS focus services from a frontend-predefined list
  - [x] 3.4 Exclude malformed non-service rows from visible inventory
- [x] Task 4: Add selected-service inspection area
  - [x] 4.1 Add `Overview` section
  - [x] 4.2 Add `Logs` section using existing route family
  - [x] 4.3 Keep unit workflows accessible through the same detail surface and existing safety guardrails
- [x] Task 5: Align backend list contract
  - [x] 5.1 Support keyword-based narrowing for the list endpoint used by both Systemd UIs
  - [x] 5.2 Return normalized service metadata and reject malformed rows without valid service-unit names
- [x] Task 6: Validation
  - [x] 6.1 UX review against Story 20.6 tab-responsibility rules
  - [x] 6.2 Backend route tests for malformed-row parsing and keyword behavior
  - [x] 6.3 Frontend tests for search, status counts, and visible-inventory filtering

## Open Product Decisions Resolved In This Story

The following decisions are intentionally fixed here so implementation can proceed without reopening basic IA debate:

1. AppOS focus services are predefined in frontend code, not user-configurable and not backend-managed
2. first-rollout search targets service names, not unit-content full text
3. focus services are pinned in the main table rather than rendered in a separate strip
4. list actions use a compact menu so navigation and operations can coexist without widening rows
5. malformed rows are filtered at both backend parse time and frontend render time