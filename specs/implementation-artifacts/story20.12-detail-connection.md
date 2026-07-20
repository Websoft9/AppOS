# Story 20.12: Server Detail Connection Tab

**Epic**: Epic 20 - Servers
**Status**: Draft | **Priority**: P1 | **Depends on**: Story 20.6, Story 16.3

## Scope Positioning

This story defines the product-facing interaction contract for `Server Detail > Connection`.

It narrows the earlier connection-tab direction into a simpler operator experience.
The tab is no longer a broad diagnostics surface.
It is the place where the operator judges current usability, takes the next action, and reviews the most recent connection events.

This story owns:

- the default information architecture for the `Connection` tab
- the connection-specific state vocabulary shown to operators
- the primary action model for connection recovery or entry
- the event-oriented activity record shown in the tab

This story does not own:

- server create/edit form fields
- low-level tunnel setup workflow details
- terminal workspace behavior
- monitor, components, docker, or systemd workflows
- backend transport implementation details

## Consolidated Source Transfer

This story supersedes the earlier, heavier `Connection Tab Information Architecture` guidance in:

- `specs/implementation-artifacts/story20.6-server-ui.md`

After this change, `story20.12-detail-connection.md` is the source of truth for the Connection tab experience.

## User Story

As a superuser, I can open the Connection tab and understand whether this server is usable now, what I should do next, and what just happened, so that I can recover or enter the server without parsing technical diagnostics.

## Product Direction

The Connection tab should default to an extreme-simple two-column decision surface:

1. current connection judgment and next action
2. recent connection activity

The tab should not ask the operator to interpret a matrix of mode, endpoint, evidence source, failure fields, and recovery categories before acting.

The core product principle is:

`Connection = judgment + action + record`

## Core Questions

The tab should answer only these four questions:

1. can AppOS use this server now
2. how does AppOS connect to this server
3. is there an active interactive session now
4. what happened recently

If a piece of information does not help answer one of those questions, it should not appear in the default view.

## Information Architecture

The default Connection tab contains exactly two columns:

1. `Current State`
2. `Activity Log`

Do not lead with diagnostic grids, mode-specific sections, or multiple action clusters.

### 1. Current State

The left column contains:

- one product-facing state badge
- one strong status title
- one compact summary board
- one primary action

The summary board should answer:

- `Connection Status`
- `Mode`
- `Interactive Session`
- `Last Activity`
- `Recommended Action`

This explanation should be human-readable, not internal-domain wording.

Good examples:

- `Tunnel active`
- `Waiting for first connection`
- `Last heartbeat 8 min ago`
- `Connection lost`

Avoid exposing raw system language such as:

- evidence source names
- internal reason codes
- transport-specific state codes
- endpoint details unless immediately needed for action

### 2. Activity Log

The right column is a compact event log.

It should contain only recent operator-readable connection events.
This panel should feel denser and more like a console event stream than a marketing card.

Allowed examples:

- `SSH verified`
- `Authentication failed`
- `Heartbeat received`
- `Tunnel connected`
- `Session opened`
- `Session closed`
- `Connection lost`

The Connection tab is not a control center with many parallel buttons.
If secondary actions are needed, keep them out of the default visual emphasis.

## State Model

The Connection tab should default to a reduced state family:

1. `Connected`
2. `Connecting`
3. `Needs Attention`

These states are product-facing states.
They are intentionally fewer than backend lifecycle codes.

### State Meanings

| Product state | Meaning |
|---------------|---------|
| `Connected` | AppOS can use the server now. |
| `Connecting` | setup or verification is in progress, or the server is waiting for the first usable connection. |
| `Needs Attention` | the server is not currently usable and the operator must take action. |

### Notes on Specialized States

- `Paused` should normally appear as a reason under `Needs Attention`, not as a top-level state.
- tunnel freshness problems should normally appear as explanation text such as `Last heartbeat 8 min ago`, not as a separate top-level state family.
- backend state richness is still allowed internally, but the UI should collapse that richness into the reduced state family by default.

## Primary Action Contract

Each visible state should map to one clear primary action.

| Product state | Direct SSH common action | Tunnel common action |
|---------------|--------------------------|----------------------|
| `Connected` | `Open Terminal` | `Open Terminal` |
| `Connecting` | `Test Connection` | `Continue Setup` |
| `Needs Attention` | `Edit Connection` or `Test Connection` | `Reconnect` |

Selection rule:

- choose the action most likely to move the user forward immediately
- do not make the user choose among several equally prominent actions
- recovery should dominate when the server is not usable

## Mode Handling

The page structure should remain the same for `Direct SSH` and `Tunnel`.

Do not create two visually different information architectures.
The difference should appear mainly in:

- explanation text under the state
- the chosen primary action
- the labels that appear in recent activity

Examples:

- Direct SSH: `SSH verified`, `TCP connection failed`, `Authentication failed`
- Tunnel: `Heartbeat received`, `Tunnel paused`, `Session replaced`, `Keepalive timeout`

Mode is a supporting fact, not the center of the screen.

## Tunnel-Specific Product Rule

Tunnel mode needs stronger recency signaling than Direct SSH.

However, that does not justify a larger default UI.
Instead, tunnel freshness should be expressed through short status copy and activity events.

Preferred examples:

- `Tunnel active`
- `Last heartbeat 2 min ago`
- `Waiting for first connection`
- `Connection lost`

Do not promote tunnel internals into a dedicated diagnostics block in the default view.

## Content Exclusions

The default Connection tab should not show these as first-order sections:

- `Connection Summary`
- `Primary Next Step`
- `Mode-Specific Setup or Recovery`
- `Diagnostics`
- endpoint grids
- evidence source grids
- multiple recovery columns

That information may exist behind secondary affordances in the future, but it should not define the default page.

## ASCII Draft

### Final Recommended Layout

```text
+----------------------------------------------------------------------------------+
| Connection                                                                       |
+----------------------------------------------------------------------------------+

+-------------------------------------------+--------------------------------------+
| CURRENT STATE                             | ACTIVITY LOG                         |
|-------------------------------------------|--------------------------------------|
| [Connected]   [Direct SSH]                | 13:39:17  SSH verified              |
|                                           | 13:12:40  Session closed            |
| Connection Status                         | 12:58:03  Session opened            |
| SSH verified                              |                                      |
|                                           |                                      |
| Mode                                      |                                      |
| Direct SSH                                |                                      |
|                                           |                                      |
| Interactive Session                       |                                      |
| None                                      |                                      |
|                                           |                                      |
| Last Activity                             |                                      |
| 2026/05/19 13:39:17                       |                                      |
|                                           |                                      |
| Recommended Action                        |                                      |
| [ Open Terminal ]                         |                                      |
+-------------------------------------------+--------------------------------------+
```

### Failure Example

```text
+----------------------------------------------------------------------------------+
| Connection                                                                       |
+----------------------------------------------------------------------------------+

+-------------------------------------------+--------------------------------------+
| CURRENT STATE                             | ACTIVITY LOG                         |
|-------------------------------------------|--------------------------------------|
| [Needs Attention]   [Tunnel]              | 13:39:17  Connection failed         |
|                                           | 13:38:44  Heartbeat received        |
| Connection Status                         | 13:31:02  Tunnel connected          |
| Connection lost                           |                                      |
|                                           |                                      |
| Mode                                      |                                      |
| Tunnel via AppOS relay                    |                                      |
|                                           |                                      |
| Interactive Session                       |                                      |
| None                                      |                                      |
|                                           |                                      |
| Last Activity                             |                                      |
| 2026/05/19 13:39:17                       |                                      |
|                                           |                                      |
| Recommended Action                        |                                      |
| [ Reconnect ]                             |                                      |
+-------------------------------------------+--------------------------------------+
```

## Interaction Rules

1. The left column must answer `can connect / mode / interactive session / next action` in under three seconds.
2. The page must present one primary action only.
3. The right column must read like a compact event log, not a general-purpose timeline.
4. Events should use user language, not internal transport vocabulary.
5. The default view should not require the user to infer status from multiple fields.
6. The page should feel denser and more like a control surface than a marketing-style card.

## Acceptance Criteria

- [ ] AC1: `Connection` defaults to a two-column layout: `Current State` and `Activity Log`.
- [ ] AC2: The default view does not show diagnostics-heavy sections such as evidence grids or mode-specific recovery columns.
- [ ] AC3: Product-facing top-level states are reduced to `Connected`, `Connecting`, and `Needs Attention`.
- [ ] AC4: Each visible state maps to one clear primary action.
- [ ] AC5: The `Current State` column shows `Connection Status`, `Mode`, `Interactive Session`, `Last Activity`, and one `Recommended Action`.
- [ ] AC6: `Activity Log` uses operator-readable connection events instead of raw logs or internal reason codes.