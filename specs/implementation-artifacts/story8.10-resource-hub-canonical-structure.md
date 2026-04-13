# Story 8.10: Resource Hub Canonical Structure

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an AppOS operator,
I want the Resources homepage to present the canonical resource families through clear grouping and entry cards,
so that I can quickly understand the resource map and enter the correct destination.

## Acceptance Criteria

1. The `/resources` page displays the title `Resources`, a one-sentence description of shared platform resources, `Add Resource` as the primary action, and `Resource Groups` as the secondary action.
2. The homepage renders two visible groups in this order: `Runtime Infrastructure` and `External Integrations`, and the grouping remains UX framing rather than a replacement for canonical family labels.
3. The `Runtime Infrastructure` group contains `Servers` and `Service Instances`, and `Service Instances` uses helper copy that explains it as runtime dependencies an application cannot start without.
4. The `External Integrations` group contains `AI Providers`, `Connectors`, and `Platform Accounts`, and each card uses concise product-facing copy instead of backend terminology.
5. Each canonical family card shows a stable canonical label, a one-line explanation, lightweight metadata when available, and acts as a full-card click target to the relevant family page.
6. Canonical family cards provide stronger hover and keyboard-focus affordances so the entry target feels clearly enterable and remains keyboard reachable with visible focus indication.

## Tasks / Subtasks

- [ ] Refine the Resource Hub page shell and canonical section structure (AC: 1, 2)
  - [ ] Confirm the header copy matches the approved canonical homepage language and does not drift into backend vocabulary.
  - [ ] Preserve the existing top-right action layout with `Resource Groups` secondary action and `Add Resource` primary action.
  - [ ] Ensure section order remains `Runtime Infrastructure` first and `External Integrations` second.
- [ ] Refine canonical card content and grouping semantics (AC: 3, 4, 5)
  - [ ] Keep `Servers`, `Service Instances`, `AI Providers`, `Connectors`, and `Platform Accounts` as the only primary canonical cards on the page.
  - [ ] Tighten helper copy so `Service Instances` is clearly framed as an app runtime dependency the app cannot start without.
  - [ ] Keep metadata lightweight and subordinate to title and description.
  - [ ] Preserve full-card navigation to the existing family route for each card.
- [ ] Improve enterability and keyboard reachability for canonical cards (AC: 5, 6)
  - [ ] Use interactive semantics that support full-card navigation without nested interactive conflicts.
  - [ ] Add visible focus treatment that is stronger than hover-only styling.
  - [ ] Preserve or strengthen current hover affordances so entry feels obvious.
- [ ] Update regression coverage for Resource Hub structure and interaction semantics (AC: 1, 2, 3, 4, 5, 6)
  - [ ] Extend `ResourceHub.test.tsx` to validate canonical section order and approved copy.
  - [ ] Add or update assertions for full-card navigation behavior.
  - [ ] Add or update assertions for keyboard-reachable or focus-visible entry semantics where practical in unit tests.

## Dev Notes

- This story is intentionally limited to the canonical homepage structure and canonical entry cards.
- Do not redesign the `Add Resource` chooser behavior here; that belongs to Story 8.11. In Story 8.10, keep the action present and correctly positioned, but do not expand scope into chooser redesign.
- Do not implement `Recent Activity` here; that belongs to Story 8.12 scope.
- Do not introduce legacy compatibility or migration UI in this story. The current MVP direction explicitly avoids compatibility-first implementation.

### Developer Context

**Business and UX intent**

- The homepage must behave as an orientation-first resource map, not a management dashboard or schema browser.
- The core success condition is that users know where to click within a few seconds.
- `Service Instances` is the highest-risk concept for confusion and therefore deserves the strongest helper copy.
- Grouping helps users interpret the map, but it must not replace canonical labels. Users still need to see the five canonical families directly.

**Story relationships**

- Story 8.10 establishes the canonical homepage structure.
- Story 8.11 will deepen the `Add Resource` interaction model.
- Story 8.12 will handle baseline usability, responsive refinement, and accessibility completion.
- Keep Story 8.10 independent: the page should already deliver user value even if 8.11 and 8.12 are not yet implemented.

### Technical Requirements

- Keep implementation inside the existing dashboard frontend stack: React, Vite, TanStack Router, shadcn/ui, Tailwind CSS, lucide-react. [Source: specs/planning-artifacts/architecture.md#Key Decisions]
- Preserve the shared PocketBase client access pattern already used by `ResourceHub.tsx` for counts and API-backed cards. [Source: specs/planning-artifacts/architecture.md#API and Interaction Model]
- Do not introduce backend contract changes or new route conventions for this story. Existing route targets should remain valid. [Source: specs/planning-artifacts/architecture.md#API and Interaction Model]
- Keep secrets outside the resource family model. This homepage story must not reframe secrets as a primary canonical resource card. [Source: specs/planning-artifacts/architecture.md#Domain boundary]

### Architecture Compliance

- AppOS is single-server-first; avoid any story implementation assumptions that depend on clustered or multi-node infrastructure. [Source: specs/planning-artifacts/prd.md#Project-Type Requirements]
- Dashboard and CLI share the same HTTP API and auth model, so homepage changes must stay at the UI layer and not imply parallel API shapes. [Source: specs/planning-artifacts/architecture.md#Overview]
- External reverse proxy responsibilities stay outside the container. Do not imply ownership changes through homepage copy or new flows. [Source: specs/planning-artifacts/architecture.md#Runtime Topology]
- The canonical resource family model for this story is `Servers`, `Service Instances`, `AI Providers`, `Connectors`, and `Platform Accounts`. [Source: specs/implementation-artifacts/epic8-resources.md#Phase 2 Canonical Resource Families]

### Library / Framework Requirements

- Reuse existing shadcn/ui primitives already used in the component: `Button`, `Card`, `CardContent`, and dropdown primitives. [Source: dashboard/src/components/resources/ResourceHub.tsx]
- Preserve TanStack Router navigation patterns already used in `dashboard/src/routes/_app/_auth/resources/index.tsx` and `useNavigate` inside `ResourceHub.tsx`. [Source: dashboard/src/routes/_app/_auth/resources/index.tsx] [Source: dashboard/src/components/resources/ResourceHub.tsx]
- Keep lucide-react icons for consistency with the current resource cards. [Source: dashboard/src/components/resources/ResourceHub.tsx]
- Prefer strengthening current card semantics over introducing a new component framework or custom navigation abstraction.

### File Structure Requirements

- Primary implementation file: `dashboard/src/components/resources/ResourceHub.tsx`.
- Primary regression file: `dashboard/src/components/resources/ResourceHub.test.tsx`.
- Route entry should remain `dashboard/src/routes/_app/_auth/resources/index.tsx` unless a change is strictly necessary.
- Family destination routes already exist under `dashboard/src/routes/_app/_auth/resources/` and should remain the navigation targets for the canonical cards.
- Do not scatter homepage structure logic into unrelated resource page files unless needed for a route constant or shared type.

### Testing Requirements

- Keep or improve coverage for canonical section titles, canonical helper copy, and card counts. [Source: dashboard/src/components/resources/ResourceHub.test.tsx]
- Add coverage for full-card navigation behavior and stronger entry semantics.
- Prefer focused component tests over broad end-to-end work for this story.
- Run at least the focused Resource Hub test file after implementation.

### Previous Story Intelligence

- Story 8.9 established the IA contract: one unified resource entry, visible grouping, canonical family labels, full-card click targets, and approved copy matrix.
- Story 8.9 originally framed the two groups as `Host Infrastructure` and `Dependency Infrastructure`, but the later approved UX direction moved the page to `Runtime Infrastructure` and `External Integrations`. Follow the final approved UX spec and current implementation direction, not the earlier intermediary label set.
- Story 8.9 also carried Add Resource intent work, but only the page-level placement matters in Story 8.10. Do not absorb the chooser redesign into this story.

### Git Intelligence Summary

- Recent commits indicate active work on service instances, tunnels, and resource templating. Preserve local patterns instead of inventing a parallel homepage implementation style.
- Relevant recent commits:
  - `2b56155` `update instances page`
  - `0c7e1f1` `tunnul improve`
  - `f69f43d` `tunnel improve to DDD model`
  - `fa3c270` `add service instances backend`
  - `c12ae95` `improve resource templating`

### Latest Technical Information

- No external web research is required for this story because it refines an already-established frontend stack rather than introducing a new library or external API.
- Use the project-approved stack versions and patterns already captured in architecture and current code.

### Project Structure Notes

- The current `ResourceHub` already contains most of the structural implementation for this story. This is a refinement story, not a greenfield build.
- The existing component already fetches counts asynchronously with `Promise.allSettled`; preserve that non-blocking loading pattern unless there is a compelling regression fix.
- The current grid uses `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`. Preserve responsive intent unless a focused story requirement demands a layout change.
- The current full-card navigation is implemented with `onClick` on `Card`. Review whether this is sufficient for keyboard reachability; if not, improve semantics without breaking testability or introducing nested button/link conflicts.

### References

- [Source: specs/planning-artifacts/epics.md#Story 8.10: Resource Hub Canonical Structure]
- [Source: specs/planning-artifacts/ux-design-specification.md#Executive Summary]
- [Source: specs/planning-artifacts/ux-design-specification.md#Core User Experience]
- [Source: specs/planning-artifacts/ux-design-specification.md#Design Direction Decision]
- [Source: specs/planning-artifacts/ux-design-specification.md#Component Strategy]
- [Source: specs/planning-artifacts/ux-design-specification.md#UX Consistency Patterns]
- [Source: specs/planning-artifacts/ux-design-specification.md#Responsive Design & Accessibility]
- [Source: specs/planning-artifacts/architecture.md#Key Decisions]
- [Source: specs/planning-artifacts/architecture.md#Domain boundary]
- [Source: specs/planning-artifacts/architecture.md#API and Interaction Model]
- [Source: specs/implementation-artifacts/epic8-resources.md#Phase 2 Canonical Resource Families]
- [Source: specs/implementation-artifacts/story8.9-resource-hub-information-architecture-alignment.md#Page-Level Hub Specification]
- [Source: dashboard/src/components/resources/ResourceHub.tsx]
- [Source: dashboard/src/components/resources/ResourceHub.test.tsx]
- [Source: dashboard/src/routes/_app/_auth/resources/index.tsx]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References

- None yet.

### Completion Notes List

- Comprehensive context prepared for Story 8.10.
- Scope explicitly constrained to canonical homepage structure and entry-card behavior.
- Story 8.11 and 8.12 concerns intentionally excluded except where needed for scope boundaries.
- Sprint tracking entry added for Epic 8 / Story 8.10 because no prior tracker entries existed for this epic.

### File List

- specs/implementation-artifacts/story8.10-resource-hub-canonical-structure.md