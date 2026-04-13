# Story 8.9: Resource Hub Information Architecture Alignment

**Epic**: Epic 8 - Resources
**Priority**: P1
**Status**: proposed
**Depends on**: Story 8.1, Story 8.4, Story 8.8

## User Story

As an AppOS operator,
I want one unified resource entry that reflects how infrastructure is actually used,
so that I can quickly understand the difference between deployment targets, app dependencies, external connections, and platform identities without learning backend terminology first.

## Goal

Define the information architecture and UX contract for the Resource Hub so the canonical five-family taxonomy becomes understandable in product experience, not only in backend naming.

This story makes `Servers` a first-class part of the unified resource center while explicitly distinguishing them from dependency-oriented resource families.

## Why Now

AppOS already has the canonical five-family taxonomy, but the current resource-center experience still exposes a legacy card layout and mixed naming. Without a dedicated IA story, future UI work may flatten `Servers`, `Service Instances`, `AI Providers`, `Platform Accounts`, and `Connectors` into one visually uniform set even though they answer different user questions.

That would create two recurring UX failures:

1. operators would confuse host infrastructure with reusable dependencies
2. navigation could follow backend domain symmetry instead of user intent symmetry

## In Scope

- define the Resource Hub entry structure for the five canonical families
- define how `Servers` should be positioned relative to `Service Instances`, `AI Providers`, `Connectors`, and `Platform Accounts`
- define the first-step decision model for the global `Add Resource` flow
- define product-facing grouping and explanatory copy for host infrastructure vs dependency infrastructure
- define relationship expectations for resource detail views so the four families feel connected rather than merely co-located
- define migration guidance from legacy `Databases` and `Cloud Accounts` hub labels toward canonical labels

## Out of Scope

- implementing the final dashboard UI
- changing backend CRUD or route contracts
- delivering full detail-page redesigns for every resource family
- migrating all legacy resources in one release
- introducing provisioning or lifecycle automation for any family

## UX Positioning Contract

The Resource Hub must present one unified entry into platform infrastructure, but it must not flatten all five families into the same conceptual role.

### Canonical user questions

Each top-level family answers a different operator question:

| Family | Product label | User question |
| --- | --- | --- |
| `server` | `Servers` | where does the workload run? |
| `instance` | `Service Instances` | what runtime dependency cannot be separated from the app because it cannot start without it? |
| `ai_provider` | `AI Providers` | which model provider gives AppOS AI capability? |
| `connector` | `Connectors` | how does AppOS reach an external capability? |
| `provider_account` | `Platform Accounts` | which external platform identity or scope does this belong to? |

### Required hub grouping

The hub must distinguish two product-facing infrastructure groups:

1. `Runtime Infrastructure`
2. `External Integrations`

`Servers` and `Service Instances` belong to `Runtime Infrastructure`.

`AI Providers`, `Connectors`, and `Platform Accounts` belong to `External Integrations`.

This grouping is a UX-level framing device. It does not replace the canonical five-family taxonomy.

### Required add-resource intent model

The first-step `Add Resource` experience must route users by intent before asking them to think in backend taxonomy:

1. `Add a deployment target` -> `Servers`
2. `Register an application dependency` -> `Service Instances`
3. `Choose an AI capability source` -> `AI Providers`
4. `Configure an external connection` -> `Connectors`
5. `Save a platform account` -> `Platform Accounts`

The flow may later reveal the canonical family names, but the first step must be intention-led.

## Proposed Hub Structure

The Resource Hub should move from one flat taxonomy grid toward one staged overview page with two visible sections.

### Section A: Host Infrastructure

This section contains one primary family:

1. `Servers`

Recommended card purpose:

1. emphasize deployment targets, connectivity, and host operations
2. keep the current operator mental model of SSH targets and managed hosts intact
3. avoid describing servers as reusable external integrations

Recommended short description:

`Deployment targets and host environments where workloads run.`

### Section B: External Integrations

This section contains three canonical families:

1. `AI Providers`
2. `Connectors`
3. `Platform Accounts`

Recommended short descriptions:

1. `AI Providers` -> `Reusable AI provider definitions such as OpenAI or Ollama endpoints.`
2. `Connectors` -> `Reusable ways for AppOS to reach external capabilities.`
3. `Platform Accounts` -> `External platform identities that back providers, instances, and connectors.`

### Layout behavior

The hub implementation does not need a completely different page shell, but it must visually communicate section boundaries.

Minimum acceptable behavior:

1. section headers are visible above grouped cards
2. `Servers` appear in the first group and are not visually buried among dependency cards
3. external-integration families appear together in the second group
4. legacy non-canonical cards may remain during transition, but they must not compete with the canonical five-family story

## Page-Level Hub Specification

The Resource Hub should preserve the current page shell pattern while changing the information hierarchy.

### Header block

The page header should continue to present:

1. page title: `Resources`
2. one-sentence explanation of shared infrastructure
3. `Resource Groups` secondary action
4. `Add Resource` primary action

Recommended supporting copy:

`Shared infrastructure for where workloads run, what they depend on, and how AppOS connects outward.`

### Section order

The page should render sections in the following order:

1. `Host Infrastructure`
2. `Dependency Infrastructure`
3. optional transitional section for legacy cards, only if needed during migration

The first two sections are canonical. A transitional section is optional and temporary.

### Card order within sections

Recommended order:

1. `Runtime Infrastructure`
2. `Servers`
3. `Service Instances`

1. `External Integrations`
2. `AI Providers`
3. `Connectors`
4. `Platform Accounts`

Recommended rationale:

1. `Service Instances` stays adjacent to `Servers` because it is the most direct app runtime dependency category
2. `AI Providers` comes first in `External Integrations` because AI is a primary product-facing capability source
3. `Connectors` comes second because it represents generic external capability access
4. `Platform Accounts` comes third because it supports the previous two rather than replacing them

### Card contents

Each canonical card should contain:

1. icon
2. product label
3. live count when available
4. one-sentence explanation
5. full-card click target to the family list page

Cards should not try to expose every subtype on the hub itself. The job of the hub is classification and orientation, not subtype browsing.

## Canonical Copy Matrix

The hub and create entry should use stable, repeatable copy.

| Family | Hub label | Short description | Add Resource intent label |
| --- | --- | --- | --- |
| `server` | `Servers` | `Deployment targets and host environments where workloads run.` | `Add a deployment target` |
| `instance` | `Service Instances` | `Runtime dependencies your apps cannot start without.` | `Register an application dependency` |
| `ai_provider` | `AI Providers` | `Reusable AI provider definitions AppOS uses for model capability.` | `Choose an AI capability source` |
| `connector` | `Connectors` | `Reusable ways for AppOS to reach external capabilities.` | `Configure an external connection` |
| `provider_account` | `Platform Accounts` | `External platform identities that back providers, instances, and connectors.` | `Save a platform account` |

This copy should be preferred over older family labels whenever the UI surface is meant to communicate canonical taxonomy.

## Add Resource Flow Contract

The `Add Resource` experience should evolve from a raw type picker toward an intent-first chooser.

### Step 1: Intent selection

The first screen or popover state must present operator goals in plain language:

1. `Add a deployment target`
2. `Register an application dependency`
3. `Choose an AI capability source`
4. `Configure an external connection`
5. `Save a platform account`

### Step 2: Canonical family confirmation

After the user chooses an intent, the UI may reveal the canonical family label and route them to the relevant creation surface:

1. `Add a deployment target` -> `/resources/servers?create=1`
2. `Register an application dependency` -> `/resources/service-instances?create=1` or the transitional route for the current implementation
3. `Choose an AI capability source` -> `/resources/ai-providers?create=1`
4. `Configure an external connection` -> `/resources/connectors?create=1`
5. `Save a platform account` -> `/resources/platform-accounts?create=1` or the transitional route for the current implementation

### Interaction model

The shortest acceptable interaction is a two-step popover flow:

1. click `Add Resource`
2. choose intent
3. land directly on the relevant family create surface

If the implementation stays as a one-layer dropdown during transition, the menu must still prioritize canonical intent wording over raw legacy type labels.

### State behavior

The create entry should support three implementation states:

1. `canonical` state: all four intent choices route to canonical family pages
2. `transitional` state: one or more intent choices route to legacy pages with canonical framing
3. `legacy fallback` state: old destination pages remain, but the menu order and wording still align with the canonical five-family story

### Transitional compatibility rule

During migration, the first-step chooser may still route to legacy pages such as `Databases` or `Cloud Accounts`, but the user-facing framing must already use the canonical intent and label system.

## Migration Copy Guidance

The taxonomy migration should feel like clarification, not renaming for its own sake.

### `Databases` migration guidance

When legacy `Databases` surfaces remain in use, copy should explain that they are becoming part of `Service Instances` rather than appearing as a disconnected category.

Recommended pattern:

`Databases is moving under Service Instances so all long-lived app dependencies share one home.`

### `Cloud Accounts` migration guidance

When legacy `Cloud Accounts` surfaces remain in use, copy should explain that they are becoming part of `Platform Accounts` because the scope is broader than cloud vendors alone.

Recommended pattern:

`Cloud Accounts is moving under Platform Accounts so cloud, source-control, and edge-provider identities share one home.`

## Transitional Mapping Rules

During rollout, AppOS may temporarily keep legacy cards or routes. The following mapping should govern that period.

| Legacy surface | Canonical meaning | Transitional treatment |
| --- | --- | --- |
| `Databases` | subset of `Service Instances` | keep route if needed, but frame as part of `Service Instances` |
| `Cloud Accounts` | early subset of `Platform Accounts` | keep route if needed, but frame as part of `Platform Accounts` |
| `Connectors` | canonical `Connectors` | keep as-is and expand by taxonomy |
| `Servers` | canonical `Servers` | keep as-is but elevate as host infrastructure |

If a legacy card remains on the hub, it should appear only as a transitional affordance and should not visually outrank its canonical parent family.

## Incremental Delivery Guidance

This story should support staged implementation rather than waiting for every new page to be complete.

### Stage 1: Framing first

1. update Resource Hub section labels and card copy
2. update `Add Resource` entry framing
3. preserve existing list pages where needed

### Stage 2: Canonical labels second

1. expose `Service Instances` and `Platform Accounts` labels in navigation and page chrome
2. keep transitional routes or redirects where needed
3. reduce reliance on legacy hub labels such as `Databases` and `Cloud Accounts`

### Stage 3: Relationship visibility third

1. add related-resource modules to detail views
2. show how instances and connectors can be backed by platform accounts
3. show how servers differ from dependency families by their host and operation role

## Dashboard Implementation Guidance

The story is still UX specification, but it should be specific enough to guide the first dashboard pass.

### Resource Hub implementation target

The first implementation pass should update the existing hub component rather than replacing the whole route architecture.

Expected first-pass changes:

1. split the card grid into sectioned groups
2. replace legacy-first descriptions with canonical descriptions for the five families
3. keep count behavior and full-card navigation
4. preserve `Resource Groups` and `Add Resource` actions in the header

### Server page positioning

The `Servers` list page already exposes actions such as connectivity checks and power operations. That operational depth is a reason to elevate `Servers` as host infrastructure in the hub rather than flattening it into dependency categories.

### Detail-view follow-up modules

Future detail pages should converge on a small set of relationship modules:

1. `Used By`
2. `Backed By Platform Account`
3. `Credential / Secret`
4. `Host / Runs On` for server-adjacent experiences where relevant

### Detail-view relationship expectations

The resource center should communicate relationship direction clearly:

1. `Servers` host apps and operational surfaces
2. `Service Instances` are app-facing long-lived dependencies
3. `Connectors` are connection profiles consumed by settings, workflows, or integrations
4. `Platform Accounts` can back zero or more instances and connectors

The UI does not need to implement all relationship widgets in this story, but future detail pages must preserve these meanings.

## Acceptance Criteria

1. Epic 8 Phase 2 documentation explicitly defines `Servers` as part of the unified resource center, not as an out-of-band system surface.
2. The Resource Hub IA explicitly distinguishes `Host Infrastructure` from `Dependency Infrastructure`.
3. `Servers` are positioned under `Host Infrastructure`, while `Service Instances`, `Connectors`, and `Platform Accounts` are positioned under `Dependency Infrastructure`.
4. The global `Add Resource` entry is documented as an intent-led decision flow rather than a raw domain-term selector.
5. The story documents the four canonical user questions so navigation and copy decisions can be evaluated against operator mental models.
6. The story documents a migration direction from legacy labels such as `Databases` and `Cloud Accounts` toward `Service Instances` and `Platform Accounts`.
7. The story preserves the canonical backend taxonomy from Story 8.1 and does not redefine any family boundaries.
8. The story defines a concrete two-section hub structure that implementation can follow without inventing a new IA during delivery.
9. The story defines a staged `Add Resource` flow with intent-first entry behavior and transitional compatibility guidance.
10. The story defines a stable copy matrix for the canonical four families.
11. The story defines page-level section order and canonical card order for the Resource Hub.

## Tasks / Subtasks

- [ ] Task 1: Freeze Resource Hub IA contract
  - [ ] 1.1 Define host-infrastructure vs dependency-infrastructure grouping
  - [ ] 1.2 Define the role of `Servers` inside the unified resource center
  - [ ] 1.3 Define the four operator questions that anchor the top-level resource families

- [ ] Task 2: Freeze creation-entry behavior
  - [ ] 2.1 Define the first-step `Add Resource` intent choices
  - [ ] 2.2 Map each intent choice to one canonical family
  - [ ] 2.3 Define when canonical family labels become visible in the flow

- [ ] Task 3: Freeze migration and copy guidance
  - [ ] 3.1 Define migration wording from `Databases` to `Service Instances`
  - [ ] 3.2 Define migration wording from `Cloud Accounts` to `Platform Accounts`
  - [ ] 3.3 Define short explanatory copy for `Servers`, `Service Instances`, `Connectors`, and `Platform Accounts`

- [ ] Task 3b: Freeze page-level hub behavior
  - [ ] 3b.1 Define section order and canonical card order
  - [ ] 3b.2 Define stable header and card copy for the first implementation pass
  - [ ] 3b.3 Define how transitional cards may remain without outranking canonical families

- [ ] Task 4: Prepare dashboard follow-up
  - [x] 4.1 Identify the Resource Hub sections or card groups needed for implementation
  - [x] 4.2 Identify which existing list pages can remain while labels and entry framing change first
  - [ ] 4.3 Identify which detail-page relationship modules should be introduced incrementally

## Notes

- This story is the UX bridge between the taxonomy contract and the eventual dashboard implementation.
- The goal is not to make all resource families look identical. The goal is to make them feel coherent while preserving their different roles in the operator mental model.
- `Servers` remain a canonical resource family, but they must be framed as host infrastructure rather than treated as just another reusable dependency.
- Transitional routes may remain temporarily, but transitional labels should not drive the top-level IA once the taxonomy-aware hub work begins.

## Dev Agent Record

### File List

- dashboard/src/components/resources/ResourceHub.tsx
- dashboard/src/components/resources/ResourceHub.test.tsx
- dashboard/src/components/layout/Sidebar.tsx
- dashboard/src/components/layout/Sidebar.test.tsx
- dashboard/src/components/resources/ResourcePage.tsx
- dashboard/src/routes/_app/_auth/resources/service-instances.tsx
- dashboard/src/routes/_app/_auth/resources/-service-instances.test.tsx
- dashboard/src/routes/_app/_auth/resources/platform-accounts.tsx
- dashboard/src/routes/_app/_auth/resources/-platform-accounts.test.tsx
- dashboard/src/pages/apps/AppDetailPage.tsx
- dashboard/src/pages/apps/AppDetailPage.test.tsx
- dashboard/src/pages/apps/AppDetailSecondaryTabs.tsx
- dashboard/src/pages/apps/AppDetailTabPanelTypes.ts
- dashboard/src/pages/apps/app-detail-utils.ts
- dashboard/src/lib/object-types.ts
- dashboard/src/routeTree.gen.ts
- backend/domain/routes/resources.go
- backend/domain/routes/resources_test.go
- specs/implementation-artifacts/story8.9-resource-hub-information-architecture-alignment.md

### Completion Notes

- Implemented the first dashboard pass for Story 8.9 in `ResourceHub` by splitting the hub into `Host Infrastructure`, `Dependency Infrastructure`, and a temporary supporting-resources section.
- Reframed the canonical hub cards to `Servers`, `Service Instances`, `Connectors`, and `Platform Accounts` while keeping transitional navigation targets to the existing `Databases` and `Cloud Accounts` pages.
- Replaced the raw resource-type create menu with an intent-first `Add Resource` menu that routes to the currently available creation surfaces.
- Refined hub and create-entry copy to include concrete product and platform examples such as `MySQL`, `PostgreSQL`, `Redis`, `AWS`, `Azure`, and `Google Cloud`.
- Updated the transitional `Databases` and `Cloud Accounts` pages to use canonical page titles `Service Instances` and `Platform Accounts` with explicit transitional descriptions.
- Removed `Scripts` from the Resource Hub and moved its primary navigation entry under `Collaboration`, reflecting the decision that it no longer belongs to the long-term `Resources` family.
- Replaced the legacy `Databases` resource page with a new template-aware `Service Instances` page backed by `/api/instances` and `/api/instances/templates`.
- Exposed backend instance profiles in the frontend create flow, including grouped service kinds and profile-specific dynamic fields.
- Refined `Service Instances` create UX into a product-first flow: the user now chooses from a searchable product list before the connection form opens.
- Normalized product labels so standard templates surface the product name directly, while product-specific templates keep their real names such as `Amazon Aurora MySQL`.
- Expanded the service-instance connection form dialog to the `lg` 896px width tier for multi-field connection setup.
- Replaced the legacy `Cloud Accounts` resource page with a new template-aware `Platform Accounts` page backed by `/api/provider-accounts` and `/api/provider-accounts/templates`.
- Exposed backend provider-account profiles in the frontend create flow, including grouped platform kinds and profile-specific dynamic fields.
- Refined `Platform Accounts` create UX into a product-first flow: the user now chooses from a searchable product list before the account form opens.
- Expanded the platform-account form dialog to the `lg` 896px width tier for multi-field account setup.
- Migrated the App Detail `Data` tab from legacy database projections to canonical service instance projections and updated its navigation target to `/resources/service-instances`.
- Removed the legacy `/api/ext/resources/databases` route registration and replaced its CRUD test with a route-removal test.
- Removed the legacy `/api/ext/resources/cloud-accounts` route registration and replaced its CRUD test with a route-removal test.
- Updated generated route metadata and object-type registration so the canonical route is `/resources/service-instances` across the dashboard.
- Updated generated route metadata and object-type registration so the canonical route is `/resources/platform-accounts` across the dashboard.
- Preserved the existing count-loading behavior and Resource Groups header action.
- Added component tests covering canonical section rendering, canonical copy, and intent-first create navigation.
- Added a service-instances page test covering the product picker, search filtering, and selected-template field rendering.
- Added a platform-accounts page test covering the product picker, search filtering, and selected-template field rendering.
- Added sidebar coverage for the new `Scripts` placement under `Collaboration`.
- Verified `dashboard` with targeted Vitest coverage, full `npm test`, and `npm run typecheck`.
- Verified the updated dashboard bundle with `npm run build`.
- Verified backend route migration with `go test ./domain/routes/...`.
- Verified full project build with `make build`.

### Change Log

- 2026-04-10: Implemented the first taxonomy-aware Resource Hub pass with sectioned canonical families, intent-first create actions, and passing dashboard tests.
- 2026-04-10: Refined Resource Hub and create-flow copy with concrete examples, renamed transitional list-page chrome to canonical labels, moved Scripts under Collaboration, and re-verified dashboard tests plus full build.
- 2026-04-10: Migrated legacy database frontend/backend surfaces to canonical `Service Instances`, exposed instance templates in the create flow, updated the App Detail data tab, removed the ext databases route, and re-verified frontend tests, backend route tests, and full build.
- 2026-04-10: Migrated legacy cloud-account frontend/backend surfaces to canonical `Platform Accounts`, exposed provider-account templates in the create flow, removed the ext cloud-accounts route, and re-verified frontend tests, backend route tests, and full build.
- 2026-04-10: Changed `Service Instances` creation to a searchable product-first chooser, hid raw kind/profile controls from the connection form, widened the form dialog to 896px, and re-verified dashboard tests, typecheck, and build.
- 2026-04-10: Changed `Platform Accounts` creation to a searchable product-first chooser, hid raw kind/profile controls from the account form, widened the form dialog to 896px, and re-verified dashboard tests, typecheck, and build.