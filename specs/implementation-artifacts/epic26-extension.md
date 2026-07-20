# Epic 26: Extensions

**Module**: Platform Extensions | **Status**: Proposed | **Priority**: P2 | **Depends on**: Epic 8, Epic 20, Epic 29

## Overview

AppOS should expose one platform-level `Extensions` domain.

From the domain perspective, an extension is an AppOS-managed capability package that extends the platform and is anchored to an explicit deployment target.

The initial target types are:

1. `server` — deployed to a managed server
2. `platform` — deployed inside the AppOS platform runtime

This epic defines the domain language for `Extensions`. It does not assume a generic third-party plugin SDK in the first phase.

## Why This Domain Exists

Current product surfaces already imply two extension-like concepts, but under different names:

1. server-target managed software shown through `Supported Software` and server `Components`
2. AppOS-local bundled software shown through local software inventory

Without one extension domain, these surfaces keep drifting between `software`, `addons`, `components`, and `resources` language even though the product intent is similar: AppOS is extending itself through managed capability packages deployed to different targets.

## Domain Positioning

`Extensions` is a product domain, not a resource family.

It answers:

1. what extension capability AppOS provides
2. where that extension is deployed
3. whether the operator is browsing catalog, inventory, or operational state
4. which lower-level domain owns delivery or lifecycle execution

It does not answer:

1. long-lived shared resource ownership
2. app deployment workflow
3. generic external connection modeling
4. arbitrary user-supplied plugin execution

## Core Domain Model

### `Extension`

The canonical product object representing one AppOS extension capability.

Minimum identity semantics:

1. stable extension identity
2. explicit target type
3. operator-facing label and description
4. one owning delivery/runtime contract

### `ExtensionTargetType`

Defines where the extension lives.

Initial values:

1. `server`
2. `platform`

### `ExtensionSurfaceType`

Defines which operator view is being presented.

Initial values:

1. `catalog` — what AppOS supports
2. `inventory` — what exists on a specific target
3. `operations` — what lifecycle actions can run on a specific target

### `ExtensionCapability`

The operator-facing capability the extension adds to AppOS or to a managed server.

Examples may include:

1. container runtime support
2. reverse proxy support
3. monitor agent support
4. control-plane built-in runtime roles

## Initial Taxonomy

The first domain split is by deployment target, not by resource family.

### `Server Extensions`

Extensions deployed to managed servers and operated through server-scoped lifecycle flows.

Current product mapping:

1. `Supported Software` trends toward `Server Extensions Catalog`
2. server `Components` with `Prerequisites` and `Addons` trend toward `Server Extensions Inventory` and `Operations`

### `Platform Extensions`

Extensions deployed inside the AppOS platform runtime.

Current product mapping:

1. AppOS-local software inventory trends toward `Platform Extensions Inventory`

## Platform Extensions Presentation Direction

`Platform Extensions` should start as a lightweight directory-style inventory, not as a marketplace-style catalog.

Reason:

1. the current platform-side extension set is mostly AppOS-bundled and platform-managed
2. operators need to understand what the platform runtime contains
3. operators do not need an early plugin-store interaction model for platform-side extensions

The first operator-facing surface should answer:

1. what platform extensions AppOS currently includes
2. what role each extension plays inside the platform
3. whether the extension is present, degraded, or unavailable
4. which built-in services or runtime responsibilities belong to that extension when relevant

This means the first-pass product shape should be:

1. one read-only `Platform Extensions` list or directory
2. dense, explanatory, admin-facing presentation
3. no marketplace, install gallery, or user-authored extension upload model

If AppOS later supports optional platform-side extensions, a separate `Platform Extensions Catalog` may be introduced. That should be a later phase, not the default assumption of this epic.

## Extensions Homepage IA

AppOS should expose one top-level `Extensions` homepage.

That homepage should not flatten `Server Extensions` and `Platform Extensions` into one mixed table.

The homepage should act as a switchboard with two clearly separated entry areas:

1. `Server Extensions`
2. `Platform Extensions`

### Homepage Responsibilities

The `Extensions` homepage should answer only:

1. AppOS extends which targets
2. where the operator should go next
3. whether they are entering discovery or runtime composition

It should not become:

1. one mixed extension inventory table
2. one marketplace-like gallery
3. one operational control panel

### Recommended Structure

#### Top-level page

`Extensions`

Two primary sections:

1. `Server Extensions`
2. `Platform Extensions`

#### Server Extensions branch

This branch should support the full three-surface model:

1. `Catalog` — what AppOS can manage on managed servers
2. `Inventory` — what exists on a selected server
3. `Operations` — what lifecycle actions can run on that selected server

First-pass routing direction may remain:

1. `Supported Software` as the catalog-oriented entry
2. server `Components` as the inventory and operations entry

#### Platform Extensions branch

This branch should start with one surface only:

1. `Directory` or `Inventory` — what the AppOS platform runtime currently includes

It should not assume a first-pass `Catalog` unless AppOS later supports optional platform-side extension installation.

### IA Rules

1. `Server Extensions` and `Platform Extensions` may share one homepage, but not one mixed row model
2. target type must stay explicit in labels and page copy
3. `Server Extensions` is action-oriented after server selection
4. `Platform Extensions` is understanding-oriented in the first phase
5. if one shared page is used, separation should be by section, cards, or tabs rather than by one undifferentiated list

### First-pass Product Shape

Recommended first-pass navigation shape:

1. `Extensions`
2. `Extensions > Server Extensions`
3. `Extensions > Platform Extensions`

Recommended first-pass operator flow:

1. user enters `Extensions`
2. chooses `Server Extensions` when asking what AppOS can place on managed servers
3. chooses `Platform Extensions` when asking what AppOS itself currently includes

This keeps one product umbrella while preserving different target semantics.

## Boundary with Resources

`Resources` remains the shared container for long-lived reusable objects such as servers, service instances, AI providers, platform accounts, and connectors.

`Extensions` is not a resource family.

Rules:

1. resources may be consumed by extensions
2. extensions may require or manage software on top of resources
3. resources keep object ownership and reference semantics
4. extensions keep capability packaging and target-scoped presentation semantics

## Boundary with Software Delivery

For the first phase, `Software Delivery` remains the implementation substrate for software-backed extensions.

Rules:

1. Software Delivery owns software catalog, installed inventory, provisioning, and readiness
2. Extensions owns the higher-level product taxonomy that groups those software surfaces under one platform extension model
3. not every future extension must imply a new software-delivery engine, but the MVP should avoid inventing a second execution system

In other words:

1. `Software Delivery` is the lower-level execution and truth domain
2. `Extensions` is the higher-level platform capability domain

## Boundary with Integrations

`Integrations` should remain reserved for external capability access or external-platform connection concepts.

`Extensions` should not be collapsed into `Integrations`.

Reason:

1. an integration connects AppOS outward
2. an extension expands AppOS itself

## Boundary with Apps

`Apps` are operator workloads delivered through the app/store/deploy flows.

`Extensions` are platform capabilities AppOS itself provides or manages.

An app may depend on resources. An extension may enable platform capability. These must not share the same domain language by default.

## Scope

### In

1. extension domain language and taxonomy
2. target-based classification: `server` vs `platform`
3. initial platform-extension directory/inventory direction
4. surface classification: `catalog`, `inventory`, `operations`
5. mapping from current software/addon/local-inventory surfaces into one extension model
6. homepage information architecture and naming direction for product surfaces

### Out

1. generic third-party plugin SDK
2. arbitrary executable extension upload
3. user-authored extension runtime
4. replacing Software Delivery execution internals in this epic
5. replacing Resources taxonomy in this epic

## Initial Mapping Direction

| Current surface | Extension view |
| --- | --- |
| `Supported Software` | `Server Extensions Catalog` |
| server `Components > Prerequisites` | `Server Extensions Inventory` for platform-gating extensions |
| server `Components > Addons` | `Server Extensions Inventory` for non-gating extensions |
| `Local Software Inventory` | `Platform Extensions Inventory` |

## Risks

1. `extension`, `software`, `addon`, and `resource` may stay overloaded unless one product label wins
2. introducing `Extensions` too broadly may accidentally imply a public plugin SDK that the platform does not yet support
3. UI may mix `catalog` and `inventory` semantics if target scope is not explicit

## Acceptance Conditions

This epic is considered successful when:

1. AppOS has one clear domain definition for `Extensions`
2. the product distinguishes `Server Extensions` from `Platform Extensions`
3. `Extensions` is explicitly separated from `Resources`, `Integrations`, and `Apps`
4. current software-backed surfaces can be explained through the extension model without changing their execution truth

## Initial Story Direction

### 26.1 Extension Taxonomy Contract

Define canonical extension language, target types, and surface types.

### 26.2 Server Extensions Mapping

Map supported server software and server components into the extension model without breaking server-scoped lifecycle truth.

### 26.3 Platform Extensions Mapping

Map local software inventory into the platform-extension model.

### 26.4 Platform Extensions Directory

Define the first-pass read-only directory or inventory surface for platform-side extensions.

### 26.5 Navigation and Product Label Alignment

Define where `Extensions` should appear in product navigation and how current pages are renamed or grouped.

### 26.6 Extensions Homepage IA

Define the top-level homepage structure that separates `Server Extensions` from `Platform Extensions` without mixing them into one flat list.

## Notes

The MVP interpretation of `Extensions` should stay narrow: platform-managed extensions only.

Do not let this epic become a generic plugin-system promise before the domain language, target model, and current-surface mapping are stable.