# Story 20.7: Server Detail Components Tab

**Epic**: Epic 20 - Servers
**Status**: Draft | **Priority**: P1 | **Depends on**: Story 20.6, Story 29.3

## Scope Positioning

This story defines the product-facing UI contract for the `Components` tab inside Server Detail.

It exists because the previous `Software` label is too easy to confuse with application-level software, while this surface actually combines two server-scoped concerns:

- platform baseline requirements needed before AppOS-managed server components can operate
- AppOS-managed server components and their lifecycle actions

This story owns the information architecture, naming, and operator-facing wording for that tab.

This story does not replace Story 29.3 ownership of server software lifecycle data, action contracts, or readiness semantics. Story 29.3 continues to own the operational component domain behavior that feeds this tab.

## User Story

As a superuser, I can understand which baseline requirements are missing and which AppOS-managed components are available on a server from one clear detail tab, so that I do not confuse platform requirements with applications or guess what to fix next.

## Goals

1. Replace the ambiguous `Software` tab label with `Components` in Server Detail.
2. Make platform prerequisites visible before addon lifecycle operations.
3. Keep Docker-style baseline requirements out of the addon inventory group.
4. Reduce confusion between AppOS-managed components and application-level software.
5. Preserve one compact operational surface instead of fragmenting detail navigation.
6. Make control-plane-reporting addons readable through separate `Service Status` and `AppOS Connection` signals.

## Out of Scope

- supported software discovery page IA
- AppOS-local software inventory IA
- lifecycle execution worker behavior
- backend action availability contract changes
- monitor runtime telemetry design

## Naming Decision

### Tab name

Use `Components` as the Server Detail tab name.

Do not use:

- `Software` as the primary tab label, because operators may read it as applications or generic installed software
- `Requirements` as the primary tab label, because it is too narrow for lifecycle actions and managed component inventory
- `Addons` as the primary tab label, because baseline requirements such as Docker are not optional addons

### Section names

Inside `Components`, use two top-level sections:

1. `Prerequisites`
2. `Addons`

`Prerequisites` explains platform baseline requirements.

`Addons` lists the remaining AppOS-managed server components that can be inspected and operated.

## Information Architecture

The `Components` tab should answer, in order:

1. does this server satisfy the platform baseline
2. if not, which prerequisite is blocking progress
3. which AppOS-managed components exist for this server
4. what state each component is in now
5. what lifecycle action the operator can take next

Recommended top-to-bottom structure:

1. `Prerequisites`
2. `Addons`

## `Prerequisites`

Purpose:

- explain whether the selected server satisfies the baseline needed by managed components
- isolate platform requirements from the addon inventory
- provide the shortest corrective path when a baseline requirement is missing or degraded

### Presentation Rule

`Prerequisites` should prefer a checklist-style presentation over explanatory cards.

Why:

- ordinary operators need a fast pass/fail read more than a long technical explanation
- baseline questions are naturally binary: ready or blocked
- a checklist reduces interpretation effort and makes the next fix obvious

The preferred first-read shape is:

1. one prerequisite group header, such as `Docker Engine`
2. engine version and compose version shown as compact facts
3. a short checklist of baseline checks
4. one corrective action only when the prerequisite is blocked or degraded

The preferred visual hierarchy is:

1. group title plus overall readiness badge
2. compact fact rows for `Docker Engine` version and `Docker Compose` version or missing state
3. binary checklist rows using checked / blocked markers
4. one compact blocking summary line
5. one primary corrective action aligned to the bottom-right or final row

Avoid leading with paragraph explanations. Explanatory text should stay secondary and short.

Show for each prerequisite:

- label
- short role statement
- readiness status
- short impact statement when missing or degraded
- one primary corrective action when backend-supported action exists
- compact readiness issue text when relevant

Do not show in this section:

- full component lifecycle history
- broad component catalog prose
- the complete lifecycle action set
- unrelated application inventory

### First rollout rule

For the first rollout, only `Docker Engine` appears in `Prerequisites`.

Reason:

- Docker is a platform baseline capability, not an addon
- it is the clearest example of a requirement that should not be mixed into the addon list

Future prerequisites may include other baseline capabilities, but they should be promoted into this section only when they are truly platform-gating rather than ordinary managed components.

### Checklist Shape

For the first rollout, the Docker prerequisite should read like a baseline checklist.

Recommended items:

1. `Docker Engine installed`
2. `Docker Engine version available`
3. `Docker Compose available`
4. `Docker Compose version available`
5. `OS support confirmed`
6. `Privileged access available`
7. `Network access available`
8. `Dependency readiness confirmed`

Status rendering rules:

- use a checked state for ready items
- use an unchecked or blocked state for failed items
- keep each row one line when possible
- show the failure reason only under the first failed item or in one compact summary line
- keep corrective action below the checklist, not repeated on every row
- prefer checklist icons or checkbox-like markers over badge-heavy subcards
- avoid long descriptive copy under every checklist row

Version rendering rules:

- Docker Engine version should appear as a compact value, not a paragraph
- Docker Compose version should appear as a compact value, not a paragraph
- if Compose is missing, show that state explicitly instead of hiding the version row

### Copy Rules

Keep `Prerequisites` copy short and operator-directed.

Preferred labels:

- `Docker Engine installed`
- `Docker Engine version available`
- `Docker Compose available`
- `Docker Compose version available`
- `OS support confirmed`
- `Privileged access available`
- `Network access available`
- `Dependency readiness confirmed`

Preferred failure summary pattern:

- `Blocking issue: <short reason>`

Do not use paragraph-first explanatory copy such as:

- long role descriptions above the checklist
- repeated impact statements under every row
- multi-sentence setup guidance inside the prerequisite group itself

Those explanations may exist in supporting help or detail states, but not as the primary first-read surface.

## `Addons`

Purpose:

- present the remaining AppOS-managed server components in one compact operational inventory
- preserve lifecycle actionability without implying these items are baseline requirements

Show for each addon:

- label
- health/status summary, using `Service Status` and `AppOS Connection` when the component reports back to AppOS
- detected version; show upgrade-available hint when `packaged_version` is newer
- **artifact** (`package` / `binary` / `docker` / `script`) — how the component is distributed and installed
- available lifecycle actions driven by backend `available_actions[]`

Do not show in this section:

- Docker-style baseline requirements already promoted to `Prerequisites`
- AppOS-local inventory
- product discovery marketing content
- generic package-manager controls

### Health Semantics

Health represents the component's current operator-facing condition, not just whether files are present.

For ordinary addons, the compact inventory cell may show one service-oriented line. For control-plane-reporting addons such as the monitor agent, the UI must show two distinct dimensions:

1. `Service: <status>` — whether the component itself is installed and running on the server.
2. `AppOS: <status>` — whether the component is connected to, authenticated with, and reporting to the AppOS control plane.

The detail panel uses the full field labels:

| Detail label | Meaning |
|--------------|---------|
| `Service Status` | The addon/software runtime state on the selected server. |
| `AppOS Connection` | The addon's connection and reporting state with the AppOS control plane. |

Do not use `Host Status`, `Local Health`, or `Reporting Health` for these fields. The first dimension describes the managed software, not the host. The second dimension should name AppOS directly because the operator needs to know whether the component is connected to this control plane.

Recommended value sets:

| Field | Values |
|-------|--------|
| `Service Status` | `Running`, `Stopped`, `Installed`, `Not Installed`, `Needs Attention`, `Unknown` |
| `AppOS Connection` | `Connected`, `Stale`, `Not Connected`, `Auth Failed`, `Misconfigured`, `Unknown` |

Baseline service status still derives from backend software evidence such as `installed_state` and `verification_state`.

| `installed_state` | `verification_state` | Display    | Color intent |
|-------------------|----------------------|------------|--------------|
| `not_installed`   | (any)                | Not Installed | muted gray |
| `installed`       | `healthy`            | ● Running  | green       |
| `installed`       | `unknown`            | ○ Installed | gray        |
| `installed`       | `degraded`           | ✕ Needs Attention | red         |

Rules:

- Do not use `Installed` as a synonym for `Running`. `Installed` means the component is deployed but its runtime health has not been confirmed in this session.
- Do not omit the status indicator for degraded items; it is the primary affordance for knowing where to act next.
- `unknown` verification is expected after initial install before the first verify cycle completes.
- For connection-aware addons, do not collapse a failed `AppOS Connection` into only a generic `Needs Attention` label. Show the connection dimension explicitly so the operator can distinguish a running service from a reporting problem.
- The frontend displays backend-resolved service and connection fields. It should not duplicate the backend health decision tree with component-specific conditional logic.

### Artifact Column

Display the artifact distribution format of the component, sourced from `template_kind` in the backend.

| `template_kind` value | Display label | Meaning                                      |
|-----------------------|---------------|----------------------------------------------|
| `package`             | package       | Installed via system package manager (apt/yum/rpm) |
| `binary`              | binary        | Downloaded and placed as a standalone binary |
| `docker`              | docker        | Runs as a Docker container or Compose service |
| `script`              | script        | Installed via a shell/installer script       |

Rules:

- Render as a compact muted badge or plain text label; not an action affordance.
- If `template_kind` is absent or unrecognised, omit the cell rather than showing a placeholder.
- `docker` is planned as a future `template_kind` value; the column should handle it when the backend exposes it.
- Use `Artifact` as the column label. Do not use `Package Type` or `Format` as the final product-facing column label.

### Version Column

- Primary line: `Installed: <detected_version>` from the latest verification pass.
- If `detected_version` is absent, show `Installed: —`.
- Secondary line: `Latest: <packaged_version>` when backend `packaged_version` is available.
- If `packaged_version` is newer or different from `detected_version`, emphasize the `Latest` line as an upgrade hint.
- Do not show `packaged_version` as the only value without making clear that the installed version is unknown.

### Actions Pattern

- Each row exposes one primary recommended action plus a vertical three-dot dropdown.
- The dropdown lists the complete known action set, grouped as `Recommended`, `Secondary`, and `Dangerous`.
- The full action set is `Install`, `Check`, `Start`, `Restart`, `Stop`, `Upgrade`, `Repair`, `Remove`.
- Product-facing labels must map backend actions as follows:
  - `verify` → `Check`
  - `reinstall` → `Repair`
  - `uninstall` → `Remove`
- Unavailable actions remain visible but disabled/locked so the operator can understand the lifecycle model without guessing what is hidden.
- While any addon operation is in flight, disable other addon action controls to prevent overlapping lifecycle mutations.
- Lifecycle actions are asynchronous. On trigger, the API returns `202 Accepted` with an `operation_id`. The UI must not block waiting for the response to become `succeeded`.

### Async Operation Progress

When the operator triggers a lifecycle action, the UI keeps the operator in the Addons context and opens the affected component in the `Selected Addon` panel.

The `Selected Addon` panel has three tabs:

1. `Details`
2. `Live Log`
3. `History`

`Live Log` is always visible. Before any action runs, its empty state is:

`No live log yet. Run an action to stream updates here.`

When an action starts, the panel switches to `Live Log` and shows:

1. **Component name and action being run**, e.g. `Monitor Agent — upgrade in progress`
2. **Phase indicator**: current phase from `accepted → preflight → executing → verifying → succeeded / failed`
3. **Live execution log**: request, acceptance, and operation poll events from the operation record, updated by polling `GET /software/operations/{operation_id}` every 2 seconds while `terminal_status = none`
4. **Failure reason** when the terminal state is failed or attention-required

Polling stops when `terminal_status` is `success` or `failed`.

On terminal state:
- **success**: reload the component list to reflect the new state and switch the selected component panel back to `History`
- **failed**: keep the log and failure reason visible, then allow the operator to inspect `History` or run a retry/repair action when available

Only one addon lifecycle operation should be active at a time in this tab. While one addon operation is in flight, other addon actions are disabled/locked until the operation completes.

Data source for the progress area (`SoftwareOperation` record):

| Field            | Use                                              |
|------------------|--------------------------------------------------|
| `id`             | poll target: `GET /software/operations/{id}`     |
| `action`         | label in progress header                         |
| `phase`          | phase indicator; step through the phase sequence |
| `terminal_status`| `none` = in-flight; `success` / `failed` = done  |
| `failure_reason` | displayed when `terminal_status = failed`        |
| `execution_log` or `event_log` | scrolling tail in the Live Log area |
| `updated`        | used to derive elapsed time                      |

## UX Contract

### Layout

- Keep `Components` inside the existing Server Detail tab set.
- `Prerequisites` appears before `Addons`.
- `Prerequisites` should read as a compact readiness block, not as a second inventory table.
- `Addons` should remain dense and scan-friendly.

### Interaction

- Prerequisites should surface one best corrective action when available.
- Addons should continue to expose supported lifecycle actions from backend truth.
- Blocked addons should explain which prerequisite is missing instead of silently disabling actionability.
- Triggering a lifecycle action on an addon must select/open that addon and show progress in the `Selected Addon` panel; do not navigate away or open a modal.
- While an addon operation is in flight, disable addon action controls globally until that operation reaches a terminal state.

### Language

- prefer operational, platform-oriented language
- avoid calling managed server components `applications`
- avoid calling baseline prerequisites `addons`

## ASCII Wireframe

The wireframes below are directional rather than literal. Final implementation may adjust spacing and component selection; the semantic structure and section ordering remain binding.

### Normal state (all components at rest)

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Server Detail / Components                                                      │
├─────────────────────────────────────────────────────────────────────────────────┤

PREREQUISITES

┌─────────────────────────────────────────────────────────────────────────────────┐
│ Docker Engine                                                    [Ready]        │
│ Version: 27.0.1  │  Docker Compose: 2.27.0                                      │
│─────────────────────────────────────────────────────────────────────────────────│
│ [x] Docker Engine installed                                                     │
│ [x] Docker Engine version available                                             │
│ [x] Docker Compose available                                                    │
│ [x] Docker Compose version available                                            │
│ [x] OS support confirmed                                                        │
│ [ ] Privileged access available                                                 │
│ [x] Network access available                                                    │
│ [x] Dependency readiness confirmed                                              │
│─────────────────────────────────────────────────────────────────────────────────│
│ Blocking issue: privileged access is required for managed install actions       │
│                                                              [Fix]              │
└─────────────────────────────────────────────────────────────────────────────────┘

ADDONS

┌─────────────────────────────────────────────────────────────────────────────────┐
│ Addons                                                                         [↻ Refresh] │
│ Optional components AppOS can inspect, verify, install or repair.                          │
├──────────────────┬────────────────────┬────────────────┬──────────────┬─────────────┤
│ Component        │ Health             │ Version        │ Artifact     │ Actions     │
├──────────────────┼────────────────────┼────────────────┼──────────────┼─────────────┤
│ Reverse Proxy    │ Service: Running   │ Installed: 1.26│ package      │ [Check] [⋮] │
│                  │                    │ Latest: 1.26   │              │             │
├──────────────────┼────────────────────┼────────────────┼──────────────┼─────────────┤
│ Monitor Agent    │ Service: Running   │ Installed: 1.44│ script       │ [Check] [⋮] │
│                  │ AppOS: Connected   │ Latest: 1.45   │              │             │
├──────────────────┼────────────────────┼────────────────┼──────────────┼─────────────┤
│ Web Cache        │ Service: Needs Attn│ Installed: 2.1 │ binary       │ [Repair][⋮] │
│                  │                    │ Latest: 2.1    │              │             │
├──────────────────┼────────────────────┼────────────────┼──────────────┼─────────────┤
│ Certbot          │ Service: Not Inst. │ Installed: —   │ binary       │ [Install][⋮]│
│                  │                    │ Latest: 1.2    │              │             │
└──────────────────┴────────────────────┴────────────────┴──────────────┴─────────────┘
```

### In-flight state (operation triggered on Monitor Agent)

The selected addon panel switches to `Live Log`. No modal, no page change.

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Addons                                                                         [↻ Refresh] │
├──────────────────┬────────────────────┬────────────────┬──────────────┬─────────────┤
│ Component        │ Health             │ Version        │ Artifact     │ Actions     │
├──────────────────┼────────────────────┼────────────────┼──────────────┼─────────────┤
│ Reverse Proxy    │ Service: Running   │ Installed: 1.26│ package      │ [⋮] locked │
├──────────────────┼────────────────────┼────────────────┼──────────────┼─────────────┤
│ Monitor Agent    │ Service: Running   │ Installed: 1.44│ script       │ [⋮] active │
│                  │ AppOS: Connected   │ Latest: 1.45   │              │             │
├──────────────────┼────────────────────┼────────────────┼──────────────┼─────────────┤
│ Certbot          │ Service: Not Inst. │ Installed: —   │ binary       │ [⋮] locked │
└──────────────────┴────────────────────┴────────────────┴──────────────┴─────────────┘

SELECTED ADDON
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Monitor Agent                                                   [Check] [⋮]     │
│ [Details] [Live Log] [History]                         Monitor Agent Log       │
│                                                                                 │
│ → Check requested...                                                            │
│ → Check accepted (op-123)                                                       │
│ → phase: executing                                                              │
│ → Verifying netdata.service                                                     │
│ → Checking AppOS remote-write configuration                                     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Failed state (operation ended with failure_reason)

```text
SELECTED ADDON
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Monitor Agent                                                   [Repair] [⋮]    │
│ [Details] [Live Log] [History]                         Monitor Agent Log       │
│                                                                                 │
│ → phase: failed                                                                 │
│ → Failure: remote-write credentials are missing                                 │
│ → netdata.service is running                                                    │
│ → AppOS connection is not configured                                            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Ownership Boundary

Story 20.7 owns:

- tab naming in Server Detail
- section naming in the tab
- information architecture and operator wording
- the rule that baseline requirements appear before addons

Story 29.3 owns:

- server software lifecycle action semantics
- readiness data and backend-supported action contracts
- component inventory behavior for the addon rows

## Acceptance Criteria

- Server Detail uses `Components` instead of `Software` as the tab label
- the tab is split into `Prerequisites` and `Addons`
- baseline platform requirements are visually separated from addon inventory
- Docker is represented as a prerequisite in the first rollout rather than as an addon row
- the prerequisite group uses a checklist-first visual instead of explanation-heavy cards
- Docker Engine and Docker Compose version facts are visible as compact prerequisite facts
- addon rows remain operational and lifecycle-oriented rather than becoming a discovery catalog
- the tab language reduces confusion between managed server components and application-level software
- addon `Health` column reflects service status using the semantics: `Running`, `Stopped`, `Installed`, `Needs Attention`, `Not Installed`, `Unknown` — derived from backend-resolved component status
- connection-aware addons show `Service: <status>` and `AppOS: <status>` in the inventory row, and `Service Status` plus `AppOS Connection` in the selected addon detail panel
- the UI does not use `Host Status`, `Local Health`, or `Reporting Health` for the addon status dimensions
- `Running` and `Installed` are never used interchangeably: `Running` requires `verification_state = healthy`
- the version column shows `Installed: <detected_version>` and `Latest: <packaged_version>` when available, emphasizing `Latest` when it differs from the installed version
- each addon row shows an `Artifact` cell (`package` / `binary` / `docker` / `script`) derived from `template_kind`; the cell is omitted when `template_kind` is absent
- each addon row exposes a primary recommended action plus a vertical three-dot dropdown
- the dropdown shows the complete known lifecycle action set with unavailable actions visible but disabled/locked
- triggering a lifecycle action selects the addon and opens the `Live Log` tab in the `Selected Addon` panel (no modal, no page navigation)
- `Live Log` is always visible and shows the empty-state text `No live log yet. Run an action to stream updates here.` before any action runs
- the `Live Log` tab shows: current phase, request/acceptance messages, live execution log tail, and failure reason when present
- the progress area polls `GET /software/operations/{operation_id}` every 2 seconds while `terminal_status = none`
- on terminal success: the component list reloads and the selected addon panel switches to `History`
- on terminal failure: the log remains available with `failure_reason` displayed and retry/repair affordances when available
- addon action controls are disabled globally while an addon operation is in flight

## Implementation Notes

- preferred first implementation shape: `Components` tab + `Prerequisites` section (checklist card) + `Addons` section (table plus `Selected Addon` detail panel)
- Health display derives from backend-resolved service and connection fields; never display only raw `installed_state` as the full status
- addon operation progress should be anchored in the `Selected Addon` panel, not in a portal/overlay, so the user keeps context of what triggered it
- polling is safe to implement with a `useEffect` cleanup that clears the interval when `terminal_status` is no longer `none` or the component unmounts
- if future prerequisite capability coverage grows, keep the Prerequisites section compact and summary-first rather than turning it into a second full inventory grid
- if a capability is not truly platform-gating, keep it in `Addons`