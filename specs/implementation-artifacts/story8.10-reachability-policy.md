# Story 8.10: Resource Reachability and Availability Policy

**Epic**: Epic 8 - Resources
**Priority**: P1
**Status**: ready-for-dev
**Depends on**: Story 8.9, Story 28.1, Story 28.3

## User Story

As an AppOS operator,
I want resource status terms and checks to stay simple and trustworthy,
so that I can understand whether a resource can be reached and whether it can actually be used without learning a different status model for every resource family.

## Goal

Define one simple, implementation-ready policy for resource connectivity checks.

This story intentionally narrows the model to two operator-facing concepts:

1. `Reachability`
2. `Availability`

The story also defines which one is global, which one is selective, and what the first delivery slice should be.

## Why Now

AppOS already has multiple status and probe behaviors across `Servers`, `Runtime Instances`, `External Services`, and `AI Providers`, but they do not mean the same thing.

Today the main problems are:

1. the word `reachability` is used for different semantics on different pages
2. some routes and UIs mix TCP connectivity with credential or functional validation
3. a universal `credential + health + protocol` framework would add too much complexity too early

Without a narrower policy, the implementation will expand into a kind-specific matrix that is expensive to maintain and hard to explain.

## Decision Summary

AppOS should adopt the following simple model:

1. `Reachability` is a global platform capability.
2. `Availability` is a selective enhanced capability.
3. `Credential` and `Health` should not be separate product-facing top-level concepts in this story.
4. `Credential` and `Health` may exist internally as failure reasons or implementation details of `Availability`.
5. The first `Availability` slice should be limited to `AI Providers`.

## Core Boundary

### Reachability

`Reachability` answers one narrow question:

Can AppOS establish the expected base connection to this target from AppOS?

Examples:

- TCP dial to an instance host and port
- TCP dial to an SMTP server host and port
- connect-level access to an AI provider endpoint host and port
- SSH or tunnel manageability for servers, exposed separately as `control_reachability`

`Reachability` does not mean:

- credentials are valid
- the service completed a protocol handshake
- the service returned a good business response
- the provider can actually serve the requested capability

### Availability

`Availability` answers a broader question:

Can AppOS actually use this resource for its intended product action right now?

`Availability` is allowed to include richer checks, but those richer checks should stay behind one simple product-facing conclusion.

Examples of internal `Availability` failure reasons:

- `unreachable`
- `auth_failed`
- `protocol_failed`
- `service_unhealthy`
- `timeout`
- `unsupported`

## Simplicity Rule

This story deliberately does not promote `credential`, `health`, or `protocol` into separate product-level columns or first-class operator concepts.

Why:

1. they vary too much by resource kind
2. they create large kind-specific implementation cost
3. they are harder to explain consistently in the UI
4. they can still be represented as `Availability` failure reasons without losing diagnostic value

## In Scope

- define the strict meaning of `Reachability`
- define the broader meaning of `Availability`
- define that `Reachability` is global and `Availability` is selective
- define that `Credential` and `Health` are not separate product-level concepts in this story
- define the current first implementation slice
- define how scheduled and real-time checks should be used for `Reachability`
- define how `Availability` should be introduced without expanding to every resource family
- define consumer-side behavior for unreachable resources

## Out of Scope

- adding full availability checks to every resource family
- adding separate `credential` and `health` columns to resource list pages
- designing a universal per-kind active-check framework for all resources
- making every route or monitoring projection converge in this story
- implementing deep SMTP, HTTP, Redis, database, or platform-account functional probes
- turning `Platform Accounts` into plain endpoint reachability targets

## Resource Policy

### Global capability: Reachability

`Reachability` should be the only global connectivity capability across resource families.

It should be used wherever the target naturally has a base connection path.

Applies to:

- `Runtime Instances`
- endpoint-based `External Services`
- `AI Providers`
- `Servers`, but represented as `control_reachability` because the operator question is manageability

Does not naturally apply to:

- many `Platform Accounts`

### Selective capability: Availability

`Availability` should not be required for every resource family.

It should be added only where all of the following are true:

1. there is a clear product value
2. there is one bounded, safe, non-destructive proof action
3. operators can understand the result easily
4. the implementation cost does not explode across kinds

### First availability slice

The first `Availability` slice should be limited to `AI Providers`.

Why `AI Providers` first:

1. the operator value is direct and obvious
2. the product already has strong user-facing dependency on usable AI providers
3. a minimal proof action is easier to define than for many connector or instance kinds
4. current implementation already mixes broader availability logic into the `reachability` route, so this area needs clarification first

## Execution Policy

### Reachability execution

`Reachability` should support both scheduled and real-time usage.

#### Scheduled reachability

Purpose:

- maintain last-known state
- support list badges, filters, and monitoring projections
- avoid relying only on page-triggered probes

Policy:

- scheduled `Reachability` is allowed globally where the target supports a stable base probe
- default schedule should be moderate rather than aggressive
- `1m` is too eager as a default for broad resource coverage
- the preferred direction is to move toward a default such as `5m`

#### Real-time reachability

Purpose:

- give operators a fresher answer when viewing or refreshing a page
- support manual troubleshooting

Policy:

- list pages should load cached status first
- list pages may refresh visible rows in background
- refresh buttons should be able to trigger a fresh probe

### Availability execution

`Availability` should not be treated like global `Reachability`.

Policy:

- `Availability` should default to on-demand checks, not high-frequency global cron
- `Availability` may store last known result for display
- low-frequency background refresh is allowed later for selected resource families, but is not required in this story

Allowed first-slice triggers:

1. save-time validation where safe
2. explicit operator `Test Available` style action
3. selected detail or list refresh when the cost is bounded

## Current State in AppOS

As of July 2026, the codebase already contains partial pieces of both concepts, but they are not aligned.

### Reachability today

- `Runtime Instances` have a scheduled monitoring reachability sweep, but coverage is registry-gated and limited
- `Runtime Instances` also have `POST /api/instances/reachability`
- `External Services` have `GET /api/connectors/reachability` and already refresh the list UI in request time
- `Servers` blend cached state with request-time connection checks under a manageability-oriented model
- `AI Providers` have a route named `GET /api/ai-providers/reachability`, but its implementation is broader than narrow reachability

### Availability today

- there is no clean, explicit product-level `Availability` model yet
- the main existing broad-availability behavior is effectively hidden inside the current AI provider `reachability` route
- monitoring also contains credential and app-health mechanisms, but they should not be surfaced as separate product concepts in this story

## Required Normalization

This story defines the following normalization rules.

### Rule 1

If a route or UI says `Reachability`, it must mean narrow base connectivity only.

### Rule 2

If a route or UI proves more than base connectivity, it should be treated as `Availability`, not `Reachability`.

### Rule 3

`Availability` should be introduced only for selected resource families, beginning with `AI Providers`.

### Rule 4

`Credential` and `Health` may appear in internal code, monitor summaries, or failure-reason payloads, but they should not become separate product-level status concepts in this story.

## Consumer-Side Policy

Resource selectors must not silently hide resources only because `Reachability` is currently bad.

Policy:

1. keep the resource visible
2. show degraded or warning state when useful
3. allow selection by default
4. warn or hard-block only when the concrete action truly needs live access now

This applies especially to resource consumption flows where configuration identity matters even when current connectivity is temporarily bad.

## First Delivery Slice

This story is dev-ready for the following concrete slice.

### Slice A: Reachability normalization

Implement:

1. keep `Reachability` narrow everywhere
2. align `Runtime Instances` list behavior to cached-first plus background refresh
3. keep `External Services` request-time overlay behavior, but continue to treat it as narrow reachability
4. preserve `Servers` as `control_reachability`, not generic resource reachability
5. lower default scheduled resource reachability interval from `1m` toward a calmer default such as `5m`

### Slice B: Availability boundary setup

Implement:

1. stop treating the current AI provider route behavior as plain `Reachability`
2. define `AI Provider Availability` as the first selective availability capability
3. keep failure details behind one operator-facing `Availability` result

### Slice C: Explicit non-goals for this story

Do not implement here:

1. general availability for all connectors
2. general availability for all instances
3. general availability for platform accounts
4. separate product-level `credential` status surfaces
5. separate product-level `health` status surfaces

## Implementation Notes

### API direction

Near-term direction:

- keep resource-family-specific reachability routes if necessary
- normalize their semantics before trying to unify all URLs
- for AI providers, either narrow the existing `reachability` route or introduce a separate `availability` route

Recommended first rule:

- do not keep a broad availability probe behind a route named `reachability`

### UI direction

Near-term direction:

- resource list pages keep a single primary connectivity status concept
- do not add multiple new status columns in this story
- AI provider availability can be introduced as a selected enhanced signal later without forcing the same pattern onto every family immediately

## Acceptance Criteria

- [ ] The story defines `Reachability` as narrow base connectivity only
- [ ] The story defines `Availability` as a broader, selective capability
- [ ] The story explicitly says `Credential` and `Health` are not separate product-level concepts in this story
- [ ] The story limits the first `Availability` slice to `AI Providers`
- [ ] The story keeps `Reachability` as the only global connectivity capability
- [ ] The story defines `Reachability` as both scheduled and real-time
- [ ] The story defines `Availability` as primarily on-demand in the first slice
- [ ] The story defines that unreachable resources stay visible in consumer selectors by default
- [ ] The story defines a concrete first delivery slice that engineering can implement without expanding to all resource kinds

## Development Readiness Notes

Engineering should treat this story as a boundary-setting and first-slice execution story, not as a universal active-check framework story.

The intended implementation order is:

1. normalize `Reachability` semantics and list behavior
2. correct the AI provider semantic mismatch
3. introduce `AI Provider Availability` as the only first-slice enhanced availability capability

If later stories want to extend `Availability` to other resource families, they must justify the product value and the bounded proof action for that family explicitly.