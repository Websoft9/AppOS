# Story 20.6: Server UI Unification

**Epic**: Epic 20 - Servers
**Status**: Draft | **Priority**: P1 | **Depends on**: Story 20.1, Story 20.5, Epic 16

## Scope Positioning

This story is the canonical UI specification for the server surfaces under `/resources/servers`.

It unifies three concerns that were previously spread across multiple artifacts:

- server registry form UX
- server list page information architecture
- server detail page information architecture

This story does not redefine backend ownership from Story 20.1 or Story 20.5. It defines the product-facing UI contract that those stories feed.

## Consolidated Source Transfer

This story consolidates UI guidance that previously lived in:

- `specs/planning-artifacts/server-connection-ux-decision.md`
- Story 20.1 `Connection Type UX`
- Story 20.1 `Servers List Information Architecture`
- Story 20.5 server-list row action guidance

After this change, `story20.6-server-ui.md` is the source of truth for server list and detail UX in Epic 20.

## User Story

As a superuser, I can understand, configure, verify, and operate server connection state from one consistent server list and detail experience, so that I can move from setup to usable access without stitching together multiple pages or mental models.

## Goals

1. Separate connection lifecycle from workspace entry.
2. Unify Direct SSH and Tunnel presentation without pretending they use the same technical flow.
3. Make the list page scan-friendly and action-oriented.
4. Make the detail page the authoritative surface for setup, recovery, and diagnostics.
5. Keep one stable naming system across list, form, and detail.

## Out of Scope

- terminal workspace layout and tools
- Docker exec terminal flows
- SFTP/file manager workflows
- tunnel fleet management page IA
- backend API route ownership changes

## Terminology

### Mode

How AppOS reaches the server.

- `Direct SSH`
- `Tunnel`

### Connection

`Connection` is the lifecycle state for making a server usable.

It answers:

1. can AppOS use this server now
2. if not, why not
3. what should the operator do next

`Connection` must be reserved for setup, readiness, recovery, and diagnostics.

### Open Terminal

`Open Terminal` is the action that enters the remote operations workspace.

It is not the same concept as `Connection` and must not be labeled `Connect` in the server list or detail surface.

## Create/Edit Form UX

The server form remains owned by Story 20.1 from a data-contract perspective, but its UX contract is maintained here.

### Connection Type

- `Connection Type` is a mode decision, not a low-context enum.
- It should be presented as two parallel choice cards, not a plain dropdown.
- Field helper copy should stay short: `Choose how this server connects to AppOS.`
- Each card should use one decision-oriented sentence.
- `Direct SSH`: `Use when AppOS can reach this server directly over SSH.`
- `Tunnel`: `Use when this server is in a private or restricted network and must connect back to AppOS.`
- Avoid tooltip-only explanation for the primary decision.

### Conditional Fields

- `credential` remains required for all server records.
- `tunnel_server` is shown only when `connect_type = tunnel`.
- Host, port, and user remain visible configuration fields for direct servers.
- Tunnel-specific runtime or mapped-service details must not be collected in the create/edit form.

## List Page Information Model

The recommended default columns are:

1. `Name`
2. `Mode`
3. `Connection`
4. `Monitor`
5. `Host`
6. `User`
7. `Secret Type`
8. `Last Activity`
9. `Action`

### Column meanings

#### `Name`

Primary identity and default detail entry.

#### `Mode`

Displays `Direct SSH` or `Tunnel`.

#### `Connection`

Single lifecycle signal used in place of the old split `Access` and `Tunnel` model.

It should show:

- status label
- one short reason line

#### `Host`

Mode-aware host summary:

- Direct SSH: host only, without port
- Tunnel: `via AppOS tunnel`

This column should remain optional in list settings.

#### `User`

Operator login identity, such as `root` or `ubuntu`.

Rules:

- this column should remain optional in list settings
- it should support list filtering

#### `Secret Type`

Credential kind used by the server, such as `Password` or `SSH Key`.

Rules:

- this column should remain optional in list settings
- it should support list filtering
- it should describe the credential type, not the concrete secret name

#### `Last Activity`

Mode-aware recency signal:

- last successful connection
- last successful check
- last seen time

#### `Monitor`

Compact monitoring presence signal.

Rules:

- show a lightweight icon when the server already has monitoring state
- icon entry should lead operators toward the `Monitor` detail tab
- when the server is not yet under monitoring, keep the cell visually quiet
- this column should remain optional in list settings

#### `Action`

Exactly one primary text link plus one overflow menu.

Rules:

- the primary action should read like inline text rather than a filled button
- the primary action text should use the main action area of the cell and stay left-aligned
- the overflow menu trigger should occupy only a compact trailing area on the right side of the same cell
- the overflow menu should remain a separate control with left-aligned menu content

## Connection States

The list page and detail page should share one status family:

- `Not Configured`
- `Awaiting Connection`
- `Online`
- `Paused`
- `Needs Attention`

Direct SSH copy may use `Awaiting Verification` where that reads more naturally.

| State | Direct SSH meaning | Tunnel meaning |
|------|--------------------|----------------|
| `Not Configured` | required SSH inputs are incomplete | tunnel setup has not been started or prepared |
| `Awaiting Connection` | config is ready but waiting for verification | install/bootstrap is ready but first callback has not happened |
| `Online` | SSH access is usable now | tunnel session is usable now |
| `Paused` | usually not applicable | reconnect is intentionally paused |
| `Needs Attention` | config exists but access currently fails | tunnel existed but is broken, stale, or failed |

## Primary Action Model

Each server row renders one primary action chosen by current lifecycle state.

| Connection state | Direct SSH primary action | Tunnel primary action |
|------------------|---------------------------|-----------------------|
| `Not Configured` | `Complete Setup` | `Start Setup` |
| `Awaiting Connection` | `Test Connection` | `Continue Setup` |
| `Online` | `Open Terminal` | `Open Terminal` |
| `Paused` | not applicable | `Resume Access` |
| `Needs Attention` | `Fix Configuration` | `View Issue` |

The overflow menu holds secondary actions such as:

- `View Details`
- `Edit Server`
- `View Connection`
- `Test Connection`
- `View Diagnostics`
- `Copy Install Command`
- `View Checklist`
- `Restart`
- `Shutdown`
- `Delete`

## List Interaction Rules

### `Name`

- `Name` opens the server detail surface.
- It lands on `Overview` by default.

### `Connection`

- `Connection` opens the same detail surface.
- It lands directly on the `Connection` tab.

### Primary action button

- Executes the best next step for the current state.
- It is not the generic detail entry.

### Overflow menu

- Holds important secondary actions.
- It must not compete visually with the primary action.

## No Row Expansion on Servers

The Servers list should not use inline row expansion as an active interaction pattern.

Reasons:

1. `Name` already opens a dedicated detail surface.
2. Server objects are operationally heavy and do not stay lightweight once expanded.
3. Scanability and row stability matter more than inline richness on this page.

## Detail Page Information Architecture

The server detail surface should have a stable tab model.

Recommended tabs:

1. `Overview`
2. `Connection`
3. `Monitor`
4. `Runtime`
5. `Software`

### Tab responsibilities

#### `Overview`

Default descriptive summary for the server record.

It should include:

- identity
- host/user/port
- credential reference
- created/updated metadata
- non-lifecycle descriptive notes

#### `Connection`

The authoritative lifecycle tab.

It owns:

- current status
- reason
- next step
- setup or recovery guidance
- diagnostics summary
- activity timeline

It must not be named `Setup`, because setup is only one part of the lifecycle.

Tunnel-specific runtime details, including mapped services, should live inside `Connection` rather than in a separate tab.

#### `Monitor`, `Runtime`, `Software`

These remain domain tabs. They must not duplicate the core `Connection` diagnosis or next-step guidance.

## Connection Tab Information Architecture

The `Connection` tab should answer, in order:

1. what mode this server uses
2. whether it is usable now
3. why it is or is not usable
4. what the operator should do next
5. what evidence supports that recommendation

Recommended top-to-bottom structure:

1. `Connection Summary`
2. `Primary Next Step`
3. `Mode-Specific Setup or Recovery`
4. `Diagnostics`
5. `Activity Timeline`

### `Connection Summary`

This is the persistent top card.

It should always show:

- `Mode`
- `Connection Status`
- `Reason`
- `Last Check or Last Seen`
- `Current Endpoint`
- `Primary Action`

Rules:

1. status and reason must always appear together
2. `Open Terminal` is available only when the effective state is usable
3. if the server is blocked, the primary action must be lifecycle-forwarding, not workspace-entry

### `Primary Next Step`

This block explains the recommendation in plain language.

It contains:

- action title
- one-sentence explanation
- one primary button
- optional one or two secondary links

This block should mirror the list-row primary action.

### `Mode-Specific Setup or Recovery`

For Direct SSH:

- `Configuration`
- `Verification`
- `Recovery`

For Tunnel:

- `Setup`
- `Runtime Session`
- `Recovery`

### `Diagnostics`

Evidence-oriented support section.

It should include:

- latest connectivity check result
- latest tunnel callback or heartbeat
- latest failure reason
- relevant system hint
- timestamped evidence

### `Activity Timeline`

Compact lifecycle timeline rather than raw logs.

Recommended events:

- server created
- credential attached or changed
- setup started
- verification passed
- tunnel paused or resumed
- last failure observed
- last healthy seen

## State-Based Rendering Rules

### `Not Configured`

Emphasize missing prerequisites and setup CTA. De-emphasize diagnostics history.

### `Awaiting Connection`

Emphasize what is already prepared, what external step is pending, and how success is confirmed.

### `Online`

Emphasize healthy summary, recent evidence, and `Open Terminal`.

### `Paused`

Emphasize intentional pause state and resume action.

### `Needs Attention`

Emphasize latest failure reason, reinstall action, and evidence. The error reason must be visible above the fold.

## Server Ops Placement in This UI Model

Story 20.5 still owns the backend and terminal workspace operations. Within the server list/detail UI defined here:

- `Restart` and `Shutdown` are secondary actions on the server list/detail surface
- they belong in the overflow menu, not as competing inline primary buttons
- connectivity check entry for the list/detail surface must follow the same primary-action rules defined here

## Acceptance Criteria

- [ ] AC1: `/resources/servers` uses the unified `Connection` model instead of split lifecycle naming.
- [ ] AC2: Each server row has exactly one primary action plus one overflow menu.
- [ ] AC3: `Name` opens detail `Overview`; `Connection` opens detail `Connection`.
- [ ] AC4: The list page does not use inline row expansion.
- [ ] AC5: The create/edit form presents `Connection Type` as decision cards.
- [ ] AC6: The detail page exposes `Overview` and `Connection` as distinct tabs, with tunnel-specific details folded into `Connection`.
- [ ] AC7: The `Connection` tab follows the section order defined in this story.
- [ ] AC8: `Open Terminal` is the only workspace-entry label on the list/detail surface.
- [ ] AC9: `Restart` and `Shutdown` remain available as secondary actions without competing with the lifecycle primary action.
- [ ] AC10: Tunnel mapped services and other implementation details stay out of the main list scan while remaining available inside `Connection`.

## Guardrails

1. Do not use `Connection` as the label for entering the remote workspace.
2. Do not expose multiple competing primary buttons on one row.
3. Do not move tunnel runtime implementation details into the main table.
4. Do not collapse `Name` and `Connection` into one ambiguous click target.
5. Do not treat the `Connection` tab as a raw field dump.
6. Do not make diagnostics the first thing the user sees above the lifecycle summary.

## Developer Context

### Architecture Compliance

- Follow [coding-decisions-ui.md](../planning-artifacts/coding-decisions-ui.md) for dialog and drawer tier usage.
- Server detail should use the shared drawer tier model, with `lg` as the default width tier for the server detail surface.
- Do not hardcode one-off drawer widths for the final implementation; use a shared helper or mapping where practical.
- Keep list and detail responsibilities separate: list for scan + next step, detail for explanation + recovery.
- Treat `/api/servers/connection` as the current backend fact source and map its fields into the UI model defined in this story.

### Frontend Surfaces Likely Touched

- `web/src/routes/_app/_auth/resources/servers.tsx`
- `web/src/routes/_app/_auth/resources/-servers.test.tsx`
- `web/src/components/resources/ResourcePage.tsx`
- `web/src/components/resources/resource-page-types.ts`
- any new feature-scoped server UI helpers under `web/src/components/servers/`
- locale files if user-facing copy changes require translation coverage

### Implementation Strategy

Implement in this order:

1. stabilize naming and action hierarchy on the list page
2. stabilize list-to-detail navigation responsibilities
3. stabilize detail tab structure
4. implement `Connection` tab IA sections
5. align form presentation and copy

Do not begin by polishing secondary visuals before the list/detail interaction contract is correct.

## Tasks / Subtasks

- [ ] Task 1: Align server list terminology and row model
	- [ ] 1.1 Replace lifecycle naming with the unified `Connection` concept on the list surface
	- [ ] 1.2 Ensure each row shows exactly one primary action plus one overflow menu
	- [ ] 1.3 Ensure `Name` and `Connection` have distinct click behaviors
	- [ ] 1.4 Remove or avoid inline row expansion for the Servers page
- [ ] Task 2: Align server detail surface structure
	- [ ] 2.1 Ensure detail opens to `Overview` from `Name`
	- [ ] 2.2 Ensure detail opens to `Connection` from the `Connection` cell
	- [ ] 2.3 Ensure `Tunnel` tab appears only for tunnel-backed servers
	- [ ] 2.4 Ensure `Overview`, `Connection`, and domain tabs do not duplicate responsibilities
- [ ] Task 3: Implement `Connection` tab information architecture
	- [ ] 3.1 Add `Connection Summary` block
	- [ ] 3.2 Add `Primary Next Step` block
	- [ ] 3.3 Add mode-specific setup/recovery sections for Direct SSH and Tunnel
	- [ ] 3.4 Add diagnostics evidence section
	- [ ] 3.5 Add compact lifecycle activity timeline
- [ ] Task 4: Align create/edit form UX
	- [ ] 4.1 Present `Connection Type` as decision cards instead of a low-context dropdown
	- [ ] 4.2 Keep conditional fields aligned with Story 20.1 data dependencies
	- [ ] 4.3 Ensure copy stays short, decision-oriented, and consistent with AppOS naming
- [ ] Task 5: Align server ops placement with the new UI contract
	- [ ] 5.1 Keep `Restart` and `Shutdown` as secondary actions, not inline competing primary actions
	- [ ] 5.2 Keep connectivity-check entry aligned with the row primary-action model
	- [ ] 5.3 Preserve terminal workspace ops ownership in Story 20.5
- [ ] Task 6: Validation
	- [ ] 6.1 Update focused server page tests for the new list/detail contract
	- [ ] 6.2 Run frontend typecheck for touched surfaces
	- [ ] 6.3 Run relevant frontend tests or focused route tests covering `/resources/servers`

## Testing Requirements

- Verify list rows render one and only one primary action in each lifecycle state.
- Verify `Name` opens `Overview` and `Connection` opens the `Connection` tab.
- Verify tunnel servers show `Tunnel` tab and direct servers do not.
- Verify the `Connection` tab top section is understandable above the fold before diagnostics.
- Verify no regression in server CRUD form conditional fields.
- Verify no regression in server ops secondary actions.

## Suggested Validation Commands

- frontend typecheck for the web app
- focused frontend tests for the servers route
- optional targeted build validation if route structure or shared resources were changed

Use the narrowest command set that validates the touched surface.

## Frontend Implementation Checklist

This section translates the story into a file-level implementation checklist for the current frontend codebase.

### Route Surface: `web/src/routes/_app/_auth/resources/servers.tsx`

This is the primary implementation surface for Story 20.6.

#### Current role

- owns `/resources/servers` list page
- owns server create/edit form field definitions
- owns server detail drawer and tab structure
- owns row actions and connectivity/power entry points

#### Required changes

- [ ] Replace list-level lifecycle presentation from the old split `Access` + `Tunnel` model to the unified `Connection` model.
- [ ] Rename workspace-entry action from `Connect` to `Open Terminal` on the server list/detail surface.
- [ ] Ensure list rows expose exactly one inline primary action determined by lifecycle state.
- [ ] Keep `Restart` and `Shutdown` inside the overflow menu as secondary actions.
- [ ] Make `Name` the `Overview` entry and `Connection` the `Connection` tab entry.
- [ ] Ensure the detail drawer tab model matches this story: `Overview`, `Connection`, optional `Tunnel`, then domain tabs.
- [ ] Introduce the `Connection` tab sections in this order:
	- `Connection Summary`
	- `Primary Next Step`
	- `Mode-Specific Setup or Recovery`
	- `Diagnostics`
	- `Activity Timeline`
- [ ] Keep tunnel mapped services in the `Tunnel` tab or equivalent secondary detail surface, not in the main list scan.
- [ ] Keep create/edit form conditional field behavior aligned with Story 20.1 while updating `Connection Type` presentation.

#### Guardrails for this file

- Do not reintroduce inline row expansion.
- Do not keep both `Connect` and `Connection` as competing labels.
- Do not make the primary action a generic detail button.
- Do not duplicate lifecycle diagnosis in `Overview` and `Connection`.

### Focused Tests: `web/src/routes/_app/_auth/resources/-servers.test.tsx`

This is the primary regression surface for Story 20.6.

#### Required test updates

- [ ] Replace assertions based on `Access` and `Tunnel` columns with assertions based on unified `Connection` presentation.
- [ ] Add coverage that verifies only one primary row action is rendered for a given state.
- [ ] Add coverage that clicking `Name` opens `Overview`.
- [ ] Add coverage that clicking `Connection` opens the `Connection` tab.
- [ ] Add coverage that direct servers do not render the `Tunnel` tab.
- [ ] Add coverage that tunnel servers do render the `Tunnel` tab.
- [ ] Add coverage that `Restart` and `Shutdown` remain in overflow actions, not inline primary actions.
- [ ] Add coverage for `Open Terminal` label where the server is usable.
- [ ] Add coverage for lifecycle-specific primary actions such as `Continue Setup`, `Test Connection`, or `Resume Access`.

#### Test fixture guidance

Model fixtures around lifecycle-oriented examples:

- direct SSH, awaiting verification
- tunnel, awaiting first callback
- tunnel, online
- tunnel, paused
- direct SSH, needs attention

### Shared List Infrastructure: `web/src/components/resources/ResourcePage.tsx`

This is the supporting infrastructure surface, not the place to encode server-specific lifecycle rules.

#### Current role

- page header layout
- list controls
- search container sizing
- pagination behavior
- generic row/action rendering support

#### Required review items

- [ ] Confirm the component can support one inline primary action plus one overflow menu for this page without introducing server-specific branching into the shared component unnecessarily.
- [ ] Confirm search, pagination, and header actions still align with the minimal list pattern after server-page customization.
- [ ] Avoid encoding `Connection` lifecycle logic into this shared component unless it is abstracted as a generic extension point.

#### Preferred approach

- keep lifecycle decision logic in `servers.tsx`
- keep shared layout and spacing primitives in `ResourcePage.tsx`

### Shared Types: `web/src/components/resources/resource-page-types.ts`

This file should only change if the final server implementation needs an additional generic extension point.

#### Change rule

- [ ] Only extend this file if the same hook/prop would be reusable for other resource pages.
- [ ] Do not add server-only naming or lifecycle types here.

### Server Feature Components: `web/src/components/servers/*`

Use this area for extracted server-specific UI blocks when `servers.tsx` becomes too dense.

#### Candidate extractions

- [ ] `ServerConnectionSummary`
- [ ] `ServerPrimaryNextStep`
- [ ] `ServerConnectionDiagnostics`
- [ ] `ServerConnectionTimeline`
- [ ] `ServerConnectionStateBadge`

#### Extraction rule

- Extract when the section has its own render logic or state branching.
- Do not extract purely to move trivial markup around.

### Supporting API Surface: `web/src/lib/connect-api.ts`

This file is not the owner of Story 20.6, but it may need alignment if UI naming or state mapping changes expose missing helpers.

#### Review checklist

- [ ] Confirm existing connectivity-check helpers can support the new `Connection` tab evidence and next-step UX.
- [ ] Add shared helper functions only if they reduce duplication between the list surface and the detail `Connection` tab.
- [ ] Keep API naming backend-oriented; UI terminology mapping should stay in the page or feature layer.

### Copy and Locale Files: `web/src/locales/*`

If user-facing labels change, translation coverage must be updated alongside the UI.

#### Expected copy migration

- [ ] replace `Connect` with `Open Terminal` where it refers to workspace entry on the server surface
- [ ] introduce unified `Connection` labels and lifecycle reason copy
- [ ] add mode-specific next-step labels if they become localized strings

### Recommended Delivery Sequence

1. Update list terminology and action hierarchy in `servers.tsx`.
2. Update drawer/detail navigation behavior.
3. Implement `Connection` tab structure.
4. Update focused tests in `-servers.test.tsx`.
5. Extract server-specific sections into `web/src/components/servers/*` only if needed.
6. Update locale strings if copy is externalized.

### Definition of Done for Frontend Slice

- [ ] List page uses unified `Connection` presentation.
- [ ] List page shows one primary row action plus overflow menu.
- [ ] Detail drawer separates `Overview` and `Connection` responsibilities.
- [ ] `Connection` tab follows this story's section order.
- [ ] Focused tests reflect the new interaction contract.
- [ ] No regressions in form conditional fields or server ops secondary actions.

## Implementation Notes

- Story 20.1 remains the source of truth for registry data shape and form field dependencies.
- Story 20.5 remains the source of truth for server ops APIs and terminal workspace ops flows.
- `/api/servers/connection` should expose `connection.state_code`, `connection.reason_code`, and `connection.config_ready` as the primary lifecycle aggregate. `access` and `tunnel` remain supporting diagnostics for evidence, timeline, and fallback behavior.
- This story becomes the UI contract the frontend should follow when implementing `/resources/servers` list and detail surfaces.

## Dev Agent Record

### File List

- To be populated during implementation.

### Completion Notes

- To be populated during implementation.

### Change Log

- 2026-04-23: Created Story 20.6 as the canonical UI contract for Epic 20 server form, list, and detail surfaces.
- 2026-04-23: Consolidated prior server connection UX decision content plus Story 20.1 and Story 20.5 server-surface UI guidance into this story.