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
- component key
- installed state
- detected version and packaged version when known
- verification state or readiness summary
- latest action result and timestamp when available
- action buttons driven by backend-supported lifecycle actions

Do not show in this section:

- Docker-style baseline requirements already promoted to `Prerequisites`
- AppOS-local inventory
- product discovery marketing content
- generic package-manager controls

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

### Language

- prefer operational, platform-oriented language
- avoid calling managed server components `applications`
- avoid calling baseline prerequisites `addons`

## ASCII Wireframe

```text
+----------------------------------------------------------------------------------+
| Server Detail / Components                                                       |
+----------------------------------------------------------------------------------+

PREREQUISITES

+----------------------------------------------------------------------------------+
| Docker Engine                                                  [Ready]           |
| Version: 27.0.1                                                                   |
| Docker Compose: 2.27.0                                                            |
|----------------------------------------------------------------------------------|
| [x] Docker Engine installed                                                       |
| [x] Docker Engine version available                                               |
| [x] Docker Compose available                                                      |
| [x] Docker Compose version available                                              |
| [x] OS support confirmed                                                          |
| [ ] Privileged access available                                                   |
| [x] Network access available                                                      |
| [x] Dependency readiness confirmed                                                |
|----------------------------------------------------------------------------------|
| Blocking issue: privileged access is required for managed install actions         |
| Action: [Fix]                                                                     |
+----------------------------------------------------------------------------------+

ADDONS
AppOS-managed components available for this server.

+----------------------------------------------------------------------------------+
| Component             Installed   Version     Readiness     Last Result   Action  |
|----------------------------------------------------------------------------------|
| Reverse Proxy         Yes         2.11.0      Ready         Verify OK     Upgrade |
| Monitor Agent         No          --          Ready         --            Install |
| Control Plane Agent   No          --          Blocked       --            Why?    |
| Runtime Helper        Yes         1.5.2       Ready         Upgrade OK    Verify  |
+----------------------------------------------------------------------------------+
```

The wireframe is directional rather than literal. Final implementation may use compact cards for `Prerequisites` and a table for `Addons`, as long as the section order and semantic split remain intact.

## Implementation-Facing Visual Draft

This is the preferred near-final structure for the first rollout.

```text
+----------------------------------------------------------------------------------+
| Prerequisites                                                     [Refresh]      |
+----------------------------------------------------------------------------------+
| Docker Engine                                                    [Ready]         |
| Version: 27.0.1                                                                  |
| Docker Compose: 2.27.0                                                           |
|----------------------------------------------------------------------------------|
| [x] Docker Engine installed                                                      |
| [x] Docker Engine version available                                              |
| [x] Docker Compose available                                                     |
| [x] Docker Compose version available                                             |
| [x] OS support confirmed                                                         |
| [ ] Privileged access available                                                  |
| [x] Network access available                                                     |
| [x] Dependency readiness confirmed                                               |
|----------------------------------------------------------------------------------|
| Blocking issue: privileged access is required for managed install actions        |
|                                              [Fix]                               |
+----------------------------------------------------------------------------------+
```

Implementation notes for this draft:

- keep the prerequisite block as one compact group, not a stack of explanatory cards
- keep version facts above the checklist
- keep checklist rows visually lighter than the group header
- reserve stronger color only for the group badge, failed checklist items, and blocking summary
- if all checks pass, hide the blocking summary and action row
- if Docker Compose is missing, render `Docker Compose: Missing` in the fact row and leave the version-available checklist item unchecked

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

## Implementation Notes

- preferred first implementation shape: `Components` tab + `Prerequisites` section + compact addon table
- if future prerequisite capability coverage grows, keep the section compact and summary-first rather than turning it into a second full inventory grid
- if a capability is not truly platform-gating, keep it in `Addons`