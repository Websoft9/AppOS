---
name: AppOS
status: final
updated: 2026-07-11
sources:
  - ../../prd.md
  - ../../architecture.md
  - ../../coding-decisions-ui.md
  - ../../../web/src/components/resources/ResourceHub.tsx
  - ../../../web/src/locales/en/resources.json
  - ../../../web/src/routes/_app/_auth/resources/servers.tsx
  - ../../../web/src/components/servers/ServerOverviewTab.tsx
  - ../../../web/src/components/servers/ServerConnectionTab.tsx
  - ../../../web/src/components/servers/ServerMonitorTab.tsx
  - ../../../web/src/components/servers/ServerComponentsPanel.tsx
  - ../../../web/src/components/servers/ServerServicesPanel.tsx
  - ../../../web/src/components/servers/ServerCronPanel.tsx
---

# AppOS - Experience Spine

## Foundation

Responsive web application. React 19 + TanStack Router + shadcn/ui + Tailwind CSS. AppOS is click-first, keyboard-complete, and optimized for operators working in a browser on desktop or laptop. Mobile support must preserve meaning, but desktop remains the primary surface.

`DESIGN.md` is the visual identity reference. This spine owns information architecture, behavioral patterns, states, interaction rules, and journey contracts. Unless a story explicitly introduces a better justified pattern, future UI work should inherit the current AppOS shell and list/detail conventions.

Current contract scope:

- Product-wide list/index page conventions from `coding-decisions-ui.md`
- The Resources hub as the most fully specified orientation surface
- Resource-family list and detail surfaces for servers, runtime instances, AI providers, external services, and platform accounts

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| Overview | Main app nav | Dashboard and platform summary |
| Resources hub | Main app nav -> Resources | Resource map and entry surface for canonical resource families |
| Servers | Resources hub / direct nav | Manage managed servers and open server detail workspaces |
| Runtime Instances | Resources hub / direct nav | Manage startup-critical runtime dependencies |
| AI Providers | Resources hub / direct nav | Manage model capability sources |
| External Services | Resources hub / direct nav | Manage outbound services, MCP, webhook, DNS, registry, and similar integrations |
| Platform Accounts | Resources hub / direct nav | Manage cloud and platform identities |
| Server detail workspace | Servers list | Multi-tab operational workspace for a specific server |
| Server detail -> Overview | Server detail tabs | Readable metadata, host facts, and cloud-provider context |
| Server detail -> Connection | Server detail tabs | Connection health, recommended action, and recent activity |
| Server detail -> Components | Server detail tabs | Prerequisite recovery and addon lifecycle operations |
| Server detail -> Monitor | Server detail tabs | Metric charts, monitor dependency status, and derived conclusions |
| Server detail -> Crontab | Server detail tabs | Managed cron inventory plus selected-entry inspection/edit flow |
| Server detail -> Systemd | Server detail tabs | Service inventory plus selected-service overview, logs, and unit editing |

Resource IA rules:

- Canonical resource families remain stable across the homepage, add flow, and destination pages.
- The homepage teaches the taxonomy through grouping and helper copy, not through alternative labels.
- Grouping is an orientation aid only. It must not replace the canonical family model downstream.

## Voice and Tone

Microcopy should sound direct, calm, and operational.

| Do | Don't |
|---|---|
| "Add Resource" | "Let's get started" |
| "Open family" | "Explore more" |
| "Waiting for the first metrics sample" | "Great news, data is on the way" |
| "Needs Attention" | "Oops" |
| "No matching resources found." | "Nothing here yet, try another adventure" |

Rules:

- Prefer precise operator language over friendly filler.
- Keep helper copy short enough to survive dense admin layouts.
- Use explanatory copy only where the domain model is genuinely ambiguous.
- Success feedback should be quiet; warning and recovery copy should be concrete.

## Component Patterns

Behavioral rules. Visual rules live in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
|---|---|---|
| Resource group section | Resources hub | Non-interactive section wrapper. Contains one group title, one short explanation, and the resource card grid. |
| Resource entry card | Resources hub | Full card is the click target. Hover/focus must clearly indicate navigation. No inline secondary actions on the hub card. |
| Add Resource dialog | Resources hub header action | Search-first chooser that lets users jump directly into the target family list page with create mode opened. No extra decision tree before the family choice. |
| Add Resource option row | Inside Add Resource dialog | Title first, practical helper text second, examples third. One click selects and routes. |
| Standard list/index page | Resource family pages | Search input; Refresh and Create on the right; minimal chrome; sortable tables; empty state replaces table header when there are no records. |
| Inline row expansion | Resource lists without separate detail page | Triggered from the name cell with a chevron affordance. Expanded content stays inside the row context. |
| Three-dot action menu | Resource rows | Holds secondary actions by default. Inline actions are reserved for the single best next step only. |
| Detail drawer | Resource pages with side detail workflow | Right-side sheet by default. Width uses standardized drawer tiers from `coding-decisions-ui.md`. |
| Server detail workspace | Servers page | Multi-tab operational workspace. Tabs segment tasks; they do not duplicate each other. |
| Inventory + selected-item split view | Server operational tabs such as Components, Systemd, and Crontab | Left side is the searchable/selectable inventory. Right side is the selected item's detail or log workspace. The right pane must still explain itself when nothing is selected. |
| Overview metadata grid | Server detail -> Overview | Read-only key/value presentation. Primary facts stay in a dense grid; edit and refresh remain lightweight header actions rather than inline controls on every field. |
| Connection hero card | Server detail -> Connection | Lead with state, connection mode, last activity, and one recommended primary action. Recent activity stays adjacent rather than below a long form. |
| Monitor split workspace | Server detail -> Monitor | Left side is charts/current values. Right side is conclusions and triage. If monitoring is unavailable, the recovery alert appears above both instead of replacing the whole surface. |
| Prerequisite card | Server Components tab | Collapsible operational card with header summary, inline actions, and secondary panel modes such as checklist, live log, and history. |
| Addon selected-item workspace | Server Components tab | Inventory selection on the left drives a richer detail workspace on the right: detail rows, live operation stream, or operation history depending on context. |
| Operation conflict alert | Server Components tab | If an action is already in flight, the alert must explain that clearly and route attention to the active component/history context instead of silently failing. |
| Monitor callback address chooser | Server Components tab | When detected browser callback URL and configured App URL differ for Monitor Agent actions, force an explicit address choice before continuing. |
| Service selected-item workspace | Systemd tab | Selecting a service swaps the right pane between overview, logs, and unit editing without leaving the surrounding server detail workspace. |
| Systemd inventory row | Systemd tab | Whole row selects the service; per-row action menu must not also trigger selection while opening. Focus services may be visually pinned or starred ahead of generic inventory. |
| Cron selected-item workspace | Crontab tab | Selecting a cron job reveals metadata, command body, and live-log/history tabs; create/edit happens in a modal editor rather than inline in the list. |
| Cron editor dialog | Crontab tab | Multi-section modal editor: name, command, optional flags, frequency builder, and generated cron expression. Editing is modal because the list remains the source-of-truth inventory. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Cold load | Resources hub | Preserve layout and show loading counts or skeleton-like placeholders instead of collapsing structure. |
| Empty list | Any resource family list page | Hide table header. Show dedicated empty state with one clear create action. |
| No create-search matches | Add Resource dialog | Keep the dialog open; show a quiet empty message instead of closing or clearing input. |
| Hover / focus targetable | Resource entry card and chooser row | Entry affordance becomes stronger through border/lift/icon treatment; focus must be stronger than hover. |
| Selected item | Detail workspaces and inventories | Selection should persist long enough for inspection and follow-up action. |
| Reachability unknown | Runtime instances / providers / connectors | Use explicit unknown status rather than implying failure. |
| Offline / waiting for first sample | Monitor-heavy server surfaces | Explain that data has not arrived yet; do not imply a user error unless evidence exists. |
| Permission denied | Navigation and protected routes | Hide or gate surfaces through auth guards; do not reveal dead-end screens for admin-only sections when routing can prevent entry. |
| In-progress operation | Server components / crontab / systemd | Keep the current item context visible; surface phase and recent updates in-place. |
| Error | Forms and live operations | Show concrete, recovery-oriented copy. Errors must describe what failed, not just that something failed. |
| No selected inventory item | Components / Systemd / Crontab right pane | Show a quiet prompt telling the user to choose one item from the left-side inventory; do not leave the pane visually empty. |
| Operation already in progress | Server Components | Surface a conflict alert that points the user straight to the current operation history or live status for that component. |
| Streaming live operation | Server Components | Switch the selected detail workspace into a live-log mode and preserve both acceptance and progress messages. |
| Missing monitor dependency | Server Monitor | Show an alert with the direct repair path from the same tab, usually by handing off into Components. |
| No host facts yet | Server detail -> Overview | Preserve the section structure and replace only the facts grid with a compact empty message. |
| No service or cron matches | Systemd / Crontab inventory | Filtering empties the list but keeps filters, pagination, and the selected-item pane shell visible. |
| No live log yet | Components / Crontab | Explain that the user must run an action before log streaming exists. |
| Dismissed monitor conclusions | Server Monitor | If all conclusions are dismissed, keep the panel present and explain that refresh will rebuild the list. |
| Destructive prerequisite action pending confirmation | Server Components | `upgrade` / `reinstall` for prerequisites must pause on a confirm dialog before execution. |

## Interaction Primitives

- **Primary mode:** click-first navigation with keyboard-complete focus order.
- **Cards:** the whole card is the target; no tiny "open" link inside a mostly decorative surface.
- **Dialogs and drawers:** `Esc` closes the topmost overlay; focus returns predictably to the trigger.
- **List surfaces:** search narrows content; row actions stay secondary; state changes should be immediate when safe.
- **Hover:** may enrich navigation cues on desktop, but must degrade gracefully on touch and keyboard.
- **Responsive adaptation:** reduce columns before reducing conceptual structure. On small screens, secondary enhancements disappear before primary navigation does.
- **Selected-item workspaces:** inventory rows select context; selection should be reversible, preserved long enough for inspection, and keyboard reachable.
- **Operational tabs:** tabs inside the server detail drawer change concern, not object identity. Tabs inside a selected-item workspace change representation of the same object, such as overview vs logs.
- **Live operations:** destructive or repair actions may require explicit confirmation before execution; once accepted, the UI should pivot into progress/history rather than leaving the user in an ambiguous idle state.
- **Action-menu isolation:** row action menus inside selectable inventories must stop event propagation so opening a menu does not unintentionally switch selection.
- **Recommended next step bias:** when one next action is clearly best, show exactly one inline primary action and demote all others into the menu.
- **Context handoff:** when a monitor or docker dependency issue originates elsewhere, the receiving server tab should open with the relevant component/card/panel already focused.

Banned or discouraged by default:

- Deep multi-step taxonomy trees before a user can create a resource
- Dashboard-style overload on orientation surfaces
- Hover-only meaning on touch-relevant views
- Multiple equally prominent primary actions on a list page

## Accessibility Floor

Behavioral accessibility contract. Visual contrast rules live in `DESIGN.md`.

- WCAG 2.2 AA baseline for text, interactive states, focus visibility, and keyboard reachability.
- Semantic page heading, section heading, and landmark structure on index pages and complex detail workspaces.
- Full-card navigation targets must have clear accessible names and descriptions.
- Add Resource chooser, expandable helper content, and all overlays must be keyboard reachable and screen-reader coherent.
- Focus order must follow the visual/reading order and avoid hidden secondary areas on mobile.
- Explanatory meaning must never depend on color alone.

## Key Flows

### Flow 1 - Understand the resource map and enter the right destination (Mina, solo operator, Tuesday morning)

1. Mina opens AppOS and chooses Resources.
2. She sees two groups immediately: Runtime Infrastructure and External Integrations.
3. She reads just enough helper copy to decide whether her task is about where an app runs, what it depends on, or how AppOS connects outward.
4. She recognizes the correct family card and clicks once.
5. **Climax:** the destination page opens and the category label still matches the card she chose, so there is no taxonomy translation gap.

Failure path: if the category still feels ambiguous, helper copy and example-based create flows must resolve that ambiguity without sending Mina into trial-and-error navigation.

### Flow 2 - Start resource creation from the homepage (Victor, repeat user, late afternoon)

1. Victor lands on Resources knowing he wants to add something new.
2. He clicks `Add Resource` in the page header.
3. The dialog opens with search and practical resource descriptions.
4. He types `postgres` or `webhook` and the list narrows to the relevant family.
5. He selects the matching option.
6. **Climax:** AppOS routes directly to the family list page with the create dialog already open, so the homepage remains shallow and fast.

Failure path: if there are no matches, the dialog stays open and invites another search term rather than collapsing the workflow.

### Flow 3 - Re-enter operational work on a server (Asha, small-team maintainer, after an alert)

1. Asha opens the Servers list and finds the target host.
2. She opens the server detail workspace.
3. Tabs expose focused operational surfaces such as Overview, Connection, Components, Monitor, Docker, and Runtime-related views.
4. She chooses the tab that matches the job instead of hunting through one long mixed screen.
5. **Climax:** the selected tab presents one coherent task surface with live status, current actions, and only the controls relevant to that concern.

Failure path: if a dependency like Monitor Agent is not ready, the surface should explain the missing prerequisite and offer the recovery action from the same context.

### Flow 4 - Repair a server prerequisite from the detail workspace (Leo, operator, after Docker-dependent work fails)

1. Leo opens a server detail workspace because a Docker-related action failed elsewhere in AppOS.
2. He lands in the `Components` tab with Docker prerequisite context already opened or highlighted.
3. The Docker prerequisite card shows its current status, checklist, and next available recovery actions.
4. He opens the appropriate panel mode, confirms the repair if the action is risky, and starts the operation.
5. **Climax:** the same card pivots into live log or history mode so Leo can see acceptance, progress, and terminal status without hunting through another page.

Failure path: if another operation is already in flight, AppOS should block the duplicate action and take Leo straight to the active history context instead of leaving him guessing.

### Flow 5 - Inspect and act on one selected operational item (Nora, maintainer, during routine checks)

1. Nora opens `Systemd` or `Crontab` from the server detail workspace.
2. She scans the inventory list on the left, using search, filters, and pagination as needed.
3. She selects one item.
4. The right pane switches from the empty prompt to a concrete selected-item workspace with details and the relevant tabs or actions.
5. **Climax:** Nora can inspect logs, metadata, or edit context for that exact item without losing her place in the broader inventory.

Failure path: if no item matches the filter or nothing is selected yet, the right pane should continue to explain what action is expected next.

## Responsive & Platform

| Breakpoint | Behavior |
|---|---|
| `< md` (< 768px) | Single-column hierarchy. Preserve group meanings; keep Add Resource reachable; hide secondary acceleration modules first. |
| `md` (768-1023px) | Reduced columns and spacing before structural simplification. |
| `lg+` (>= 1024px) | Full desktop expression with grouped orientation surfaces, side drawers, and multi-column lists where useful. |

AppOS is responsive web, not separate mobile and desktop products.

## Inspiration & Anti-patterns

- **Lifted from Cloudflare:** restrained composition, low-noise grouping, and calm surfaces.
- **Lifted from AWS Console:** infrastructural seriousness and stable destination naming.
- **Rejected:** category-specific color coding, dashboard clutter on orientation pages, decorative emptiness that weakens trust, and verbose teaching copy that slows expert use.
