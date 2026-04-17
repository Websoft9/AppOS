# Story 8.12: Resource Hub Usability Baseline

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an AppOS operator,
I want the Resource Hub to remain clear and usable across common interaction, screen-size, and accessibility contexts,
so that I can rely on it as a stable entry surface instead of a desktop-only navigation shortcut.

## Acceptance Criteria

1. Supporting states such as metadata, empty states, or loading states remain visually secondary to the grouped navigation structure and do not compete with the primary task of choosing a destination.
2. On desktop, the Resource Hub preserves full grouped layout, stable hierarchy, breathable spacing, and a visible but non-dominant `Add Resource` action.
3. On tablet, the page preserves the same mental model and section order while reducing columns or spacing before removing structural meaning.
4. On mobile, the layout collapses to a single-column flow with the same canonical ordering and section logic, and secondary enhancement areas such as `Recent Activity` are hidden by default.
5. All primary actions and canonical card entries are reachable by keyboard, and focus-visible treatment is stronger than hover-only styling.
6. The page uses semantic headings, non-color-dependent entry cues, and near-WCAG AA baseline clarity and contrast for interactive text, helper text, and action states.

## Tasks / Subtasks

- [ ] Reinforce supporting-state hierarchy so navigation remains primary (AC: 1)
  - [ ] Keep counts, loading indicators, helper metadata, and any future empty-state guidance visually subordinate to section and card hierarchy.
  - [ ] Avoid turning loading or empty states into detached dashboard alerts that overwhelm the page's orientation role.
  - [ ] If optional enhancement modules are introduced, ensure they do not outrank the canonical groups.
- [ ] Tighten responsive layout behavior across desktop, tablet, and mobile (AC: 2, 3, 4)
  - [ ] Preserve the canonical section order and resource-card ordering at every breakpoint.
  - [ ] Confirm the grid degrades progressively from multi-column desktop/tablet layouts to a single-column mobile layout.
  - [ ] Keep `Add Resource` visible without allowing action chrome to dominate narrow layouts.
- [ ] Strengthen keyboard and non-pointer interaction baseline (AC: 5)
  - [ ] Ensure the page header actions, chooser trigger, and canonical cards are fully tab-reachable.
  - [ ] Preserve stronger focus-visible treatment than hover-only treatment.
  - [ ] Avoid interaction designs that depend solely on pointer hover to communicate clickability.
- [ ] Improve semantic structure and contrast guardrails (AC: 6)
  - [ ] Preserve real heading hierarchy and section labeling.
  - [ ] Ensure entry affordances remain understandable without relying only on color changes.
  - [ ] Review muted helper text, metadata, and action states against the project's near-WCAG AA baseline.
- [ ] Add regression coverage for responsive and accessibility-critical behavior (AC: 1, 2, 3, 4, 5, 6)
  - [ ] Extend `ResourceHub.test.tsx` for semantics and keyboard-reachability assertions that are practical at component-test scope.
  - [ ] Add targeted tests for loading or metadata presentation where hierarchy could regress.
  - [ ] Keep broad visual validation manual if exact spacing or contrast cannot be asserted reliably in unit tests.

## Dev Notes

- This story is about baseline usability and resilience of the Resource Hub, not about introducing a large new feature set.
- `Recent Activity` is optional and currently absent in the existing Resource Hub implementation. This story does not require shipping it, but any supporting enhancement area introduced now or later must remain secondary and hidden by default on mobile.
- Preserve the homepage's role as a resource map. Do not convert it into a dense status dashboard in the name of usability.
- Responsiveness should preserve mental model first. Reduce columns and spacing before reordering or renaming the canonical structure.

### Developer Context

**Business and UX intent**

- The homepage must stay usable for novice-to-intermediate operators without sacrificing experienced-user speed.
- Usability success here means low hesitation under real-world contexts: smaller screens, keyboard-only navigation, loading states, and less-than-ideal visual conditions.
- The strongest failure mode is turning supporting information into visual competition with the canonical navigation structure.

**Story relationships**

- Story 8.10 established the canonical structure and basic card affordances.
- Story 8.11 handles the `Add Resource` chooser interaction and direct create-entry behavior.
- Story 8.12 hardens the homepage so the canonical structure remains usable and understandable across breakpoints and accessibility contexts.
- Keep this story focused on baseline page resilience rather than destination-page CRUD behavior.

### Technical Requirements

- Keep implementation inside the existing dashboard stack: React, Vite, TanStack Router, shadcn/ui, Tailwind CSS 4, and lucide-react. [Source: specs/planning-artifacts/architecture.md#Key Decisions]
- Continue using the existing `ResourceHub` component as the implementation center for homepage behavior rather than splitting responsive logic across unrelated pages. [Source: web/src/components/resources/ResourceHub.tsx]
- Preserve the current async count-loading model or improve it without introducing blocking fetch behavior that delays the full page from rendering. [Source: web/src/components/resources/ResourceHub.tsx]
- Do not require backend changes for this story. Usability baseline work should remain within the current UI and route architecture. [Source: specs/planning-artifacts/architecture.md#API and Interaction Model]

### Architecture Compliance

- AppOS remains single-server-first; the Resource Hub must remain a simple orientation surface rather than a multi-environment orchestration console. [Source: specs/planning-artifacts/prd.md#Project-Type Requirements]
- Dashboard and CLI continue to share one API and auth model; homepage usability work must not imply a dashboard-only backend branch. [Source: specs/planning-artifacts/architecture.md#Overview]
- Secrets remain outside the canonical homepage family model. Accessibility or responsive refinements must not reintroduce extra primary-family cards. [Source: specs/planning-artifacts/architecture.md#Domain boundary]
- Canonical family ordering and labels must remain stable under responsive adaptation. [Source: specs/implementation-artifacts/epic8-resources.md#Phase 2 Canonical Resource Families]

### Library / Framework Requirements

- Preserve current semantic section structure already present in `ResourceHub.tsx`, including `section` landmarks and heading relationships, and strengthen it where useful. [Source: web/src/components/resources/ResourceHub.tsx]
- Reuse existing focus and interactive styling conventions from the current card-link pattern instead of inventing a new interaction system. [Source: web/src/components/resources/ResourceHub.tsx]
- Keep action and card composition within existing shadcn/ui primitives such as `Button`, `Card`, and any chooser primitive introduced in Story 8.11. [Source: web/src/components/ui/button.tsx] [Source: web/src/components/ui/card.tsx]
- Prefer utility-class refinements and compositional cleanup over large-scale layout rewrites.

### File Structure Requirements

- Primary implementation file: `web/src/components/resources/ResourceHub.tsx`.
- Primary regression file: `web/src/components/resources/ResourceHub.test.tsx`.
- If chooser behavior from Story 8.11 affects focus management or action layout, keep those adjustments co-located with `ResourceHub` or a nearby extracted subcomponent under `web/src/components/resources/`.
- Route shell file should remain `web/src/routes/_app/_auth/resources/index.tsx` unless a strictly necessary metadata change is identified.

### Testing Requirements

- Add practical component-level tests for section headings, action reachability, focus-visible or semantic cues, and loading-state hierarchy. [Source: web/src/components/resources/ResourceHub.test.tsx]
- Validate that canonical links remain present and correctly ordered even while counts are loading or unavailable.
- Manual verification remains appropriate for viewport-specific spacing, contrast perception, and mobile hiding behavior that is awkward to assert in unit tests.
- Run at least the focused Resource Hub test file after implementation.

### Previous Story Intelligence

- Story 8.9 established that the homepage should be a resource map rather than a schema browser or dashboard. Story 8.12 must preserve that orientation-first behavior when improving usability.
- Story 8.10 already improved full-card navigation and visible group structure. Story 8.12 should harden those affordances across breakpoints and keyboard usage rather than redefining them.
- Story 8.10 explicitly deferred `Recent Activity`. Treat it as optional support, not as a required centerpiece of this story.

### Git Intelligence Summary

- Recent commits show continued dashboard and resource-surface iteration. Favor incremental hardening of the current implementation rather than speculative redesign.
- Relevant recent commits:
  - `2b56155` `update instances page`
  - `0c7e1f1` `tunnul improve`
  - `f69f43d` `tunnel improve to DDD model`
  - `fa3c270` `add service instances backend`
  - `c12ae95` `improve resource templating`

### Latest Technical Information

- No external web research is required for this story because the work is a refinement of the current frontend composition and accessibility baseline.
- Use the project's existing semantic HTML, Tailwind utility patterns, and wrapped Radix primitives where interaction behavior needs strengthening.

### Project Structure Notes

- The current `ResourceHub` already uses `section` landmarks, heading IDs, full-card links, loading spinners for counts, and `focus-visible` styles. Story 8.12 should harden and verify these patterns rather than replacing them.
- The current grid is `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, which already trends toward the desired responsive model. Refine this deliberately instead of reworking the entire composition.
- No `Recent Activity` module exists in the current component. If one is introduced incidentally, it must remain secondary and be hidden by default on mobile.

### References

- [Source: specs/planning-artifacts/epics.md#Story 8.12: Resource Hub Usability Baseline]
- [Source: specs/planning-artifacts/ux-design-specification.md#Executive Summary]
- [Source: specs/planning-artifacts/ux-design-specification.md#Core User Experience]
- [Source: specs/planning-artifacts/ux-design-specification.md#Desired Emotional Response]
- [Source: specs/planning-artifacts/architecture.md#Key Decisions]
- [Source: specs/planning-artifacts/architecture.md#Domain boundary]
- [Source: specs/planning-artifacts/architecture.md#API and Interaction Model]
- [Source: specs/implementation-artifacts/epic8-resources.md#Phase 2 Canonical Resource Families]
- [Source: specs/implementation-artifacts/story8.9-resource-hub-information-architecture-alignment.md#Page-Level Hub Specification]
- [Source: specs/implementation-artifacts/story8.10-resource-hub-canonical-structure.md#Developer Context]
- [Source: web/src/components/resources/ResourceHub.tsx]
- [Source: web/src/components/resources/ResourceHub.test.tsx]
- [Source: web/src/routes/_app/_auth/resources/index.tsx]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References

- None yet.

### Completion Notes List

- Comprehensive context prepared for Story 8.12.
- Story scope explicitly constrained to responsive, accessibility, and supporting-state baseline hardening for the Resource Hub.
- Existing implementation strengths and gaps captured so the developer can refine instead of rebuilding.
- Optional `Recent Activity` behavior framed as subordinate support rather than required primary scope.

### File List

- specs/implementation-artifacts/story8.12-resource-hub-usability-baseline.md