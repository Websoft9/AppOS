# Story 8.11: Add Resource Canonical Entry

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an AppOS operator,
I want Add Resource to guide me to the correct canonical resource type,
so that I can start creating the right resource without taxonomy confusion.

## Acceptance Criteria

1. From the `/resources` homepage, activating `Add Resource` opens a lightweight chooser panel instead of navigating away immediately, and the chooser remains visually subordinate to the page shell while still clearly actionable.
2. The chooser presents all four canonical families together: `Servers`, `Service Instances`, `Connectors`, and `Platform Accounts`, without forcing a prior group-level decision.
3. `Service Instances`, `Connectors`, and `Platform Accounts` include concise helper text in user-task language, and `Service Instances` explains runtime dependency meaning more explicitly than the other families.
4. Each family can reveal inline example items without leaving the chooser, and the expanded content remains secondary to the main family selection.
5. Choosing a family routes directly to the corresponding create flow for that family without exposing legacy taxonomy decisions during the path to creation.
6. The chooser supports predictable keyboard navigation, visible focus treatment, escape-to-close behavior, and focus return to the `Add Resource` trigger when closed.

## Tasks / Subtasks

- [ ] Replace the current quick-create dropdown with a canonical chooser panel interaction (AC: 1, 2)
  - [ ] Rework the existing `Add Resource` control in `dashboard/src/components/resources/ResourceHub.tsx` so it opens a lightweight chooser panel instead of a simple dropdown list.
  - [ ] Keep the chooser visually subordinate to the page shell; do not turn this into a dedicated full-page wizard or route.
  - [ ] Present the four canonical families together in one chooser surface with no extra group-first step.
- [ ] Define canonical family options, helper copy, and inline examples (AC: 2, 3, 4)
  - [ ] Keep the primary action on each option focused on the canonical family itself rather than intent-only wording.
  - [ ] Retain concise helper copy in user-task language and give `Service Instances` the strongest explanatory support.
  - [ ] Add secondary expandable examples for each family without allowing the examples to overshadow the main selection action.
- [ ] Standardize direct create routing across family destinations (AC: 5)
  - [ ] Preserve direct navigation from chooser selection to the target family create flow.
  - [ ] Normalize create-entry behavior so all four destination pages can honor the same create handoff contract, rather than only some routes supporting `?create=1`.
  - [ ] Keep transitional routing compatibility only where necessary, but maintain canonical user-facing wording throughout the chooser.
- [ ] Add focused regression coverage for chooser behavior and route handoff (AC: 1, 2, 3, 4, 5, 6)
  - [ ] Extend `dashboard/src/components/resources/ResourceHub.test.tsx` to cover chooser open/close behavior, canonical option copy, and inline example toggles.
  - [ ] Add or update route-level tests for family pages that must now respond consistently to create-entry handoff.
  - [ ] Verify keyboard and focus-return behavior in component tests where practical.

## Dev Notes

- This story upgrades the existing `Add Resource` interaction already present on the Resource Hub; it should not introduce a second competing create surface.
- The current implementation uses a `DropdownMenu` with intent-first labels. Story 8.11 should evolve that into a lightweight chooser panel that exposes canonical families clearly while still using approachable helper copy.
- Keep the chooser lightweight. A modal, sheet, or popover-style panel is acceptable if it remains visually subordinate and does not interrupt orientation more than necessary.
- Do not add a preliminary `Runtime Infrastructure` versus `External Integrations` choice inside the chooser. Grouping belongs to the homepage orientation layer, not to the creation decision path.
- Inline examples are explanatory support only. The family choice remains the primary call to action.

### Developer Context

**Business and UX intent**

- The user should be able to decide what to create without translating backend terms first, but the final visible choice must still reinforce the canonical four-family model.
- `Service Instances` remains the highest-risk concept for confusion. The chooser should make this family easier to understand than a generic resource-type picker does today.
- The chooser must feel like a short assistive layer attached to the homepage, not like a separate flow that breaks the page's orientation-first value.

**Story relationships**

- Story 8.10 established the canonical homepage structure and card hierarchy.
- Story 8.11 deepens the `Add Resource` interaction model and normalizes create-entry routing behavior.
- Story 8.12 will finish broader responsive, keyboard, and accessibility baseline work for the hub surface.
- Keep Story 8.11 focused on creation entry. Do not absorb broad page-layout or empty-state redesign into this story.

### Technical Requirements

- Keep implementation inside the existing dashboard frontend stack: React, Vite, TanStack Router, shadcn/ui, Tailwind CSS 4, and lucide-react. [Source: specs/planning-artifacts/architecture.md#Key Decisions]
- Reuse existing UI primitives already present in the repo such as dialog, sheet, collapsible, dropdown-menu, button, and card before introducing any new dependency. [Source: dashboard/src/components/ui/dialog.tsx] [Source: dashboard/src/components/ui/sheet.tsx] [Source: dashboard/src/components/ui/collapsible.tsx]
- Preserve the existing Resource Hub route entry at `dashboard/src/routes/_app/_auth/resources/index.tsx`; the chooser should remain a component-level interaction on the homepage rather than a new route. [Source: dashboard/src/routes/_app/_auth/resources/index.tsx]
- Do not require backend contract changes for this story. The main change is UI flow and route handoff consistency for existing create surfaces. [Source: specs/planning-artifacts/architecture.md#API and Interaction Model]

### Architecture Compliance

- AppOS remains single-server-first, so this chooser must not imply cluster-specific or multi-environment resource semantics. [Source: specs/planning-artifacts/prd.md#Project-Type Requirements]
- Dashboard and CLI share the same HTTP API and auth model; this story should not create a dashboard-only API contract for resource creation entry. [Source: specs/planning-artifacts/architecture.md#Overview]
- Secrets remain outside the canonical four-family resource taxonomy and must not appear as a primary chooser option. [Source: specs/planning-artifacts/architecture.md#Domain boundary]
- Canonical family labels remain `Servers`, `Service Instances`, `Connectors`, and `Platform Accounts`. Do not regress to legacy top-level labels such as `Databases` or `Cloud Accounts`. [Source: specs/implementation-artifacts/epic8-resources.md#Phase 2 Canonical Resource Families]

### Library / Framework Requirements

- The current `ResourceHub` already uses `Button`, `Card`, `DropdownMenu`, and TanStack Router navigation. Extend or replace this implementation rather than creating a parallel resource-entry abstraction. [Source: dashboard/src/components/resources/ResourceHub.tsx]
- If the chooser needs expandable example rows, prefer existing Radix-backed primitives already wrapped in the repo, such as `Collapsible`, rather than a custom disclosure system. [Source: dashboard/src/components/ui/collapsible.tsx]
- If the chooser needs stronger focus trapping and focus return guarantees than the current dropdown provides, prefer the existing dialog or sheet primitives already available in the codebase. [Source: dashboard/src/components/ui/dialog.tsx] [Source: dashboard/src/components/ui/sheet.tsx]
- Preserve TanStack Router navigation patterns and use the same route destinations already used by the hub cards. [Source: dashboard/src/components/resources/ResourceHub.tsx] [Source: dashboard/src/routes/_app/_auth/resources/index.tsx]

### File Structure Requirements

- Primary homepage interaction file: `dashboard/src/components/resources/ResourceHub.tsx`.
- Primary chooser regression file: `dashboard/src/components/resources/ResourceHub.test.tsx`.
- Likely route files needing create-entry normalization: `dashboard/src/routes/_app/_auth/resources/servers.tsx`, `dashboard/src/routes/_app/_auth/resources/service-instances.tsx`, `dashboard/src/routes/_app/_auth/resources/connectors.tsx`, and `dashboard/src/routes/_app/_auth/resources/platform-accounts.tsx`.
- If a chooser subcomponent is extracted for maintainability, keep it under `dashboard/src/components/resources/` rather than introducing a separate feature area.

### Testing Requirements

- Add focused component-level regression coverage for chooser open state, canonical family labels, helper copy, example expansion, keyboard dismissal, and direct create routing. [Source: dashboard/src/components/resources/ResourceHub.test.tsx]
- Add or update route-level tests so all destination pages respond consistently to create-entry handoff, especially where only `servers` currently appears to read `search.create`. [Source: dashboard/src/routes/_app/_auth/resources/servers.tsx] [Source: dashboard/src/routes/_app/_auth/resources/-service-instances.test.tsx] [Source: dashboard/src/routes/_app/_auth/resources/-platform-accounts.test.tsx] [Source: dashboard/src/routes/_app/_auth/resources/-connectors.test.tsx]
- Prefer targeted component and route tests over broad end-to-end coverage for this story.

### Previous Story Intelligence

- Story 8.9 defined Add Resource as an intent-led flow, but Story 8.11 must implement the later refined requirement: one chooser surface with all four canonical families visible together and explanatory support inline.
- Story 8.10 already shipped the canonical homepage structure and top-right action placement. Reuse that shell instead of rethinking header layout.
- Story 8.10 explicitly deferred chooser redesign. This story is the intended place to absorb that deferred work.

### Git Intelligence Summary

- Recent commits show active refinement in resource-adjacent surfaces and domain-backed implementations. Follow current dashboard patterns rather than introducing one-off create-entry behavior.
- Relevant recent commits:
  - `2b56155` `update instances page`
  - `0c7e1f1` `tunnul improve`
  - `f69f43d` `tunnel improve to DDD model`
  - `fa3c270` `add service instances backend`
  - `c12ae95` `improve resource templating`

### Latest Technical Information

- No external web research is required for this story because the work stays inside the existing frontend stack and current TanStack Router + shadcn/ui patterns.
- Use the project's wrapped Radix primitives already present in `dashboard/src/components/ui/` instead of adding a new overlay library.

### Project Structure Notes

- The current `ResourceHub` already includes canonical create labels and helper descriptions. The implementation should evolve this existing data model instead of rebuilding resource metadata from scratch.
- The existing create interaction is a plain dropdown list, which is too limited for inline examples and stronger keyboard/focus requirements. Expect to refactor the interaction layer rather than only tweaking copy.
- Only the `servers` route currently shows explicit `search.create` handling in route search validation. Story 8.11 should close that create-entry parity gap across the target family pages.

### References

- [Source: specs/planning-artifacts/epics.md#Story 8.11: Add Resource Canonical Entry]
- [Source: specs/planning-artifacts/ux-design-specification.md#Executive Summary]
- [Source: specs/planning-artifacts/ux-design-specification.md#Core User Experience]
- [Source: specs/planning-artifacts/ux-design-specification.md#Effortless Interactions]
- [Source: specs/planning-artifacts/architecture.md#Key Decisions]
- [Source: specs/planning-artifacts/architecture.md#Domain boundary]
- [Source: specs/planning-artifacts/architecture.md#API and Interaction Model]
- [Source: specs/implementation-artifacts/epic8-resources.md#Phase 2 Canonical Resource Families]
- [Source: specs/implementation-artifacts/story8.9-resource-hub-information-architecture-alignment.md#Add Resource Flow Contract]
- [Source: specs/implementation-artifacts/story8.10-resource-hub-canonical-structure.md#Dev Notes]
- [Source: dashboard/src/components/resources/ResourceHub.tsx]
- [Source: dashboard/src/components/resources/ResourceHub.test.tsx]
- [Source: dashboard/src/routes/_app/_auth/resources/index.tsx]
- [Source: dashboard/src/routes/_app/_auth/resources/servers.tsx]
- [Source: dashboard/src/routes/_app/_auth/resources/service-instances.tsx]
- [Source: dashboard/src/routes/_app/_auth/resources/connectors.tsx]
- [Source: dashboard/src/routes/_app/_auth/resources/platform-accounts.tsx]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References

- None yet.

### Completion Notes List

- Comprehensive context prepared for Story 8.11.
- Story scope anchored to the existing Resource Hub create interaction instead of a new route or parallel entry surface.
- Create-entry parity risk across destination routes explicitly called out for implementation.
- Keyboard, focus-return, and inline-example behavior captured as first-class acceptance work rather than optional polish.

### File List

- specs/implementation-artifacts/story8.11-add-resource-canonical-entry.md
