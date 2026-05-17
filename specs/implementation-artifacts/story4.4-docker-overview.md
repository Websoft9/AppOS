# Story 4.4: Docker Overview Simplification

**Epic**: Epic 4 - Docker Operations Layer  
**Priority**: P1  
**Status**: Complete  
**Depends on**: Story 4.3 canonical replan (`story4.3-canonical-docker-workspace-replan.md`), Story 4.3 UI supplement (`story4.3-supplement-docker-tabs-ui.md`), Story 28.6 Container Stats UI

---

## Objective

Simplify the `Server Detail > Docker > Overview` tab into a fast scan surface focused on two operator questions:

1. What Docker resources exist on this server?
2. What needs attention now?

The Overview should stop acting like a full dashboard with repeated inventory, health, and compose sections. It should become a compact entry point into resource tabs and action flows.

---

## Product Rationale

The current Overview exposes too many parallel summaries:

- top resource cards
- container health grid
- needs-attention list
- compose stacks list
- inventory split chart

Each section is individually reasonable, but together they compete for the user's attention and repeat the same facts in different forms.

For AppOS users, especially SMBs and teams without dedicated DevOps expertise, the Overview should prioritize clarity over analytical completeness.

The intended mental model is:

- **Resource cards**: what exists
- **Needs Attention**: what may require action
- **Quick Actions**: what the user can do next

Detailed tables, health breakdowns, compose project lists, and object-level operations belong in the dedicated Docker tabs.

---

## User Story

As an operator,
I want the Docker Overview to show resource counts and problems first,
so that I can quickly understand the server's Docker state and jump to the right corrective action without parsing a dense dashboard.

---

## Scope

In scope:

- simplify the Docker Overview tab layout
- keep all Docker resource types visible at a glance
- show normal and abnormal counts where meaningful
- promote `Needs Attention` as the primary decision area
- provide compact quick actions for common next steps
- preserve links into resource-specific tabs

Out of scope:

- replacing dedicated Containers, Compose, Images, Volumes, or Networks tabs
- adding new backend health judgment routes
- turning Docker Overview into a monitor dashboard
- introducing multi-server aggregate Docker health
- redesigning row-level actions in resource tabs

---

## UX Direction

### Core Principle

Overview is not the place for all Docker details.

It should answer:

1. **What do I have?**
2. **Is anything wrong?**
3. **Where do I go next?**

### Recommended Layout

Use the minimal version below as the target layout.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Docker                                                                                 ↻     │
│ Inspect containers, compose projects, images, volumes, and networks on this server.           │
├───────────────┬──────────────────────────────────────────────────────────────────────────────┤
│ Overview      │ Overview                                                                     │
│ Containers    │                                                                              │
│ Images        │ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────┐ │
│ Volumes       │ │ Containers   │ │ Compose      │ │ Images       │ │ Volumes      │ │ Net. │ │
│ Networks      │ │ 4            │ │ 2            │ │ 26           │ │ 11           │ │ 5    │ │
│ Compose       │ │ 2 stopped ⚠ │ │ all running  │ │ all tagged   │ │ clean        │ │ ok   │ │
│               │ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ └──────┘ │
│               │                                                                              │
│               │ ┌──────────────────────────────────────────────────────────────────────────┐ │
│               │ │ Needs Attention                                             2 issues     │ │
│               │ │                                                                          │ │
│               │ │ ⚠  hopeful_hawking        exited        View →                           │ │
│               │ │ ⚠  compassionate_jepsen   exited        View →                           │ │
│               │ │                                                                          │ │
│               │ │ [View containers]                                                        │ │
│               │ └──────────────────────────────────────────────────────────────────────────┘ │
│               │                                                                              │
│               │ ┌──────────────────────────────────────────────────────────────────────────┐ │
│               │ │ Quick Actions                                                            │ │
│               │ │ [Create Compose]   [Pull Image]   [Prune Resources]   [Refresh]          │ │
│               │ └──────────────────────────────────────────────────────────────────────────┘ │
└───────────────┴──────────────────────────────────────────────────────────────────────────────┘
```

---

## Information Architecture Rules

### 1. Resource Cards Stay First

The first row should contain one card per Docker resource family:

- Containers
- Compose
- Images
- Volumes
- Networks

Each card should expose:

- primary count
- one compact state line
- warning state only when meaningful

Examples:

- `Containers`: `4` / `2 stopped ⚠`
- `Compose`: `2` / `all running`
- `Images`: `26` / `all tagged`
- `Volumes`: `11` / `clean`
- `Networks`: `5` / `ok`

### 2. Needs Attention Is the Main Work Area

`Needs Attention` should be visually dominant after resource cards.

It should list actionable issues, not raw statistics.

Candidate issue types:

- exited containers
- unhealthy containers
- paused containers, if unexpected
- failed compose projects
- dangling volumes
- unused images, if prune is recommended
- orphaned compose containers, if detectable

Each issue row should include:

- severity icon or badge
- object name
- short reason
- direct action or navigation target

### 3. Quick Actions Are Secondary

Quick actions should be compact and below `Needs Attention`.

Recommended actions:

- Create Compose
- Pull Image
- Prune Resources
- Refresh

These actions should not overpower the issue list.

### 4. Remove Redundant Sections

The simplified Overview should remove or fold these current sections:

- `Container Health` grid
- `Compose Stacks` list
- `Inventory Split` chart

Their useful facts should be absorbed into resource cards or dedicated tabs.

---

## Data Contract Expectations

The Overview should reuse existing Docker inventory data where possible.

No new backend route is required for the MVP if current list endpoints already provide enough data.

Expected sources:

- `/api/servers/{serverId}/docker/containers`
- `/api/servers/{serverId}/docker/compose/ls`
- `/api/servers/{serverId}/docker/images`
- `/api/servers/{serverId}/docker/volumes`
- `/api/servers/{serverId}/docker/networks`
- optional existing metadata endpoints for compose/container enrichment

If issue detection requires expensive inspection, prefer async enrichment and keep the initial Overview render fast.

---

## Developer Handoff

### Primary File

Implement this story in the existing `OverviewTab` inside `web/src/components/connect/DockerPanel.tsx`.

Do not create a parallel Docker overview page. This story refines the existing `Server Detail > Docker > Overview` surface.

### Existing Sections to Replace

Replace the current Overview body that contains:

- top four summary cards
- `Container Health`
- `Needs Attention`
- `Compose Stacks`
- `Inventory Split`

with the simplified structure:

1. five resource cards
2. `Needs Attention`
3. compact `Quick Actions`

### Resource Card Definitions

Use these cards and derivation rules for the first implementation:

| Card | Primary Count | State Line | Warning Rule |
|------|---------------|------------|--------------|
| Containers | `containers.length` | `{stoppedCount} stopped` when `stoppedCount > 0`, otherwise `all running` | warning when any container is not `running` |
| Compose | `projects.length` | `all running` when all project statuses include `running`; otherwise `{nonRunningProjects} attention` | warning when a project status does not include `running` |
| Images | `images.length` | `{taggedImages} tagged` | no warning in MVP unless data shows untagged images |
| Volumes | `volumes.length` | `clean` | no warning in MVP unless dangling detection already exists without extra inspect |
| Networks | `networks.length` | `ok` | no warning in MVP |

Definitions:

- `stoppedCount = containers.filter(c => c.State !== 'running').length`
- `taggedImages = images.filter(image => image.Tag && image.Tag !== '<none>').length`
- `nonRunningProjects = projects.filter(project => !(project.Status || '').toLowerCase().includes('running')).length`

### Needs Attention Issue Rules

For MVP, list only issues derivable from existing Overview queries.

Issue types:

1. `unhealthy-container`
	- condition: `(container.Status || '').toLowerCase().includes('unhealthy')`
	- label: `Unhealthy container`
	- severity: warning/destructive

2. `stopped-container`
	- condition: `container.State !== 'running'`
	- label: `Stopped container` or `{container.State} container`
	- severity: warning

3. `compose-attention`
	- condition: project status does not include `running`
	- label: `Compose project needs attention`
	- severity: warning

Ordering:

1. unhealthy containers
2. stopped/non-running containers
3. compose project issues

Limit:

- show at most 6 issues in the Overview
- if more than 6 exist, show a `View all issues` or `View containers` affordance

Empty state:

- title: `No issues detected`
- body: `All discovered Docker resources look operational from current inventory data.`

### Navigation and Actions

Add explicit navigation callbacks from `DockerPanel` into `OverviewTab` instead of introducing global route jumps.

Recommended props:

```text
onSelectTab(tabId)
onFilterContainersByNames(names)
onOpenPullImage()
onOpenPruneVolumes()
onOpenPruneImages()
```

Expected behavior:

- clicking `Containers` card selects the `containers` tab
- clicking `Compose` card selects the `compose` tab
- clicking `Images` card selects the `images` tab
- clicking `Volumes` card selects the `volumes` tab
- clicking `Networks` card selects the `networks` tab
- clicking a container issue selects the `containers` tab and filters to that container name when practical
- clicking a compose issue selects the `compose` tab
- `Create Compose` keeps the existing deploy-create link pattern already used by the Compose header
- `Pull Image` reuses the existing Images tab pull dialog callback
- `Prune Resources` may be implemented as a compact menu with `Prune images` and `Prune volumes`, reusing existing tab refs/callbacks; do not add a new combined backend prune route
- `Refresh` reuses the existing DockerPanel refresh action if available; otherwise omit from Quick Actions because the global header already contains refresh

### Responsive Behavior

- Resource cards should wrap naturally.
- Preferred grid:
  - `sm`: 1 column
  - `md`: 2 columns
  - `xl`: 5 columns if space allows, otherwise 3 + 2 wrap is acceptable
- `Needs Attention` should remain full-width below cards.
- `Quick Actions` should remain compact and full-width below `Needs Attention`.

### Loading and Error Behavior

- Keep current single error alert behavior for failed overview load.
- During initial loading, show skeleton or `...` counts in cards.
- Do not block cards on optional metadata enrichment.
- Do not show progress bars in Overview.

### Testing Expectations

Add or update frontend tests for:

- resource cards render all five Docker object families
- stopped container count appears on the Containers card
- `Needs Attention` lists non-running containers
- empty attention state appears when all containers are running and compose projects are running
- clicking a container issue switches to the Containers tab or invokes the expected callback
- removed sections (`Container Health`, `Compose Stacks`, `Inventory Split`) are not rendered

---

## Acceptance Criteria

- [ ] AC1: Overview first row shows compact cards for Containers, Compose, Images, Volumes, and Networks.
- [ ] AC2: Each resource card shows a primary count plus one concise state line.
- [ ] AC3: Resource cards surface abnormal states only when actionable or meaningful.
- [ ] AC4: `Needs Attention` is the primary section below resource cards and lists actionable issues.
- [ ] AC5: Issue rows include object name, reason, and a direct navigation/action affordance.
- [ ] AC6: Empty `Needs Attention` state clearly communicates that no issues were detected.
- [ ] AC7: Quick Actions are available but visually secondary to `Needs Attention`.
- [ ] AC8: Existing `Container Health`, `Compose Stacks`, and `Inventory Split` sections are removed or folded into the simplified model.
- [ ] AC9: The Overview does not duplicate full resource tables already available in dedicated tabs.
- [ ] AC10: The Overview remains server-scoped and inherits the current Server Detail context.
- [ ] AC11: The initial render remains fast; expensive metadata enrichment must not block the core resource cards.

---

## Implementation Notes

- Keep `DockerPanel` as the owner of the tab shell and section header.
- Prefer derived summaries from already-loaded Docker list queries.
- Avoid adding chart-like visualizations unless they directly improve action selection.
- Use warning styling sparingly; only abnormal or actionable states should draw attention.
- Route issue links to the most specific existing tab and filter when practical.
- If a resource card is clicked, open the corresponding Docker tab.

---

## Dev Agent Record

### Agent Model Used

GitHub Copilot / GPT-5.5

### Debug Log References

- `npm run test -- DockerPanel.test.tsx`
- `npm run typecheck`

### Completion Notes

- Replaced the dense Overview with five resource cards, a primary `Needs Attention` section, and compact `Quick Actions`.
- Added explicit Overview-to-tab navigation callbacks for resource cards and attention issues.
- Added reusable quick actions for create compose, pull image, prune images, prune volumes, and refresh.
- Added focused frontend regression tests for Story 4.4 acceptance behavior.

## File List

- `web/src/components/connect/DockerPanel.tsx`
- `web/src/components/connect/DockerPanel.test.tsx`
- `specs/implementation-artifacts/story4.4-docker-overview.md`

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-05-17 | 1.0 | Implemented Docker Overview simplification and marked story complete. | Amelia |

---

## References

- `specs/implementation-artifacts/story4.3-canonical-docker-workspace-replan.md`
- `specs/implementation-artifacts/story4.3-supplement-docker-tabs-ui.md`
- `specs/implementation-artifacts/story28.6-container-stats-ui.md`
- `web/src/components/connect/DockerPanel.tsx`
- `web/src/components/docker/OverviewTab.tsx` if created during implementation