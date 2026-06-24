# Story 7.4: Embedded Iframe Page Framework

**Epic**: Epic 7 - Dashboard Foundation  
**Priority**: P1  
**Status**: Draft  
**Depends on**: Story 7.2, Story 7.6

## Objective

Provide one standard AppOS mechanism for embedding external pages inside the AppOS content frame.

This story defines the framework, not a single consumer page.

## User Story

As an AppOS user,
I want externally hosted pages that AppOS can already reach through a same-origin proxy to open inside the AppOS shell,
so that I can use infrastructure consoles without leaving AppOS navigation and layout context.

## First Target Pages

- Traefik Dashboard
- Redis Insight

These are examples of the first consumers of the framework, not the framework itself.

## Scope

In scope for the first slice:

- define a standard iframe-page route pattern inside AppOS
- render embedded pages inside the AppOS content area frame
- preserve the AppOS shell around the embedded content
- inject a top-header breadcrumb using the existing breadcrumb pattern
- support externally hosted pages that AppOS can access through a same-origin proxy
- define a minimal page contract for future embedded consoles
- define failure fallback behavior when an embedded page cannot be rendered
- reserve an authentication strategy extension point for future logged-in embeds

## Non-Goals

Out of scope for the first slice:

- arbitrary user-supplied URLs
- direct cross-origin iframe embedding
- universal SSO implementation
- full third-party login orchestration
- solving every target page CSP or frame-ancestor limitation
- dynamic navigation composition across all modules

## Product Boundary

This capability is an AppOS-managed embedded console framework.

It is not a general-purpose browser surface.

Only pages explicitly adopted by AppOS should use this mechanism.

## UX Contract

- the embedded page lives inside the AppOS content frame
- AppOS header, sidebar, and surrounding shell remain visible
- breadcrumb is shown in the top header area
- default breadcrumb shape is: iframe page > current page
- the embedded page should provide a clear page title
- if embedding fails, AppOS should show an in-frame fallback state instead of a blank region
- fallback should include an open-in-new-window action when feasible

## Access Model

First version restriction:

- only pages that AppOS can expose through a same-origin proxy are supported

Implication:

- the framework assumes AppOS owns the browser-facing route
- the browser should not connect directly to the target service origin

## Embed Page Contract

Each embedded iframe page should define at least:

- id
- title
- routePath
- proxyPath
- parentLabel
- accessMode
- authStrategy
- fallbackBehavior

Recommended first-version defaults:

- parentLabel: iframe page
- accessMode: proxied
- authStrategy: none

## Authentication Direction

The first slice does not implement SSO.

However, the framework must leave room for future authenticated embeds, such as:

- session bridge
- token handshake
- future SSO-backed access

The framework should treat authentication as an explicit strategy field, not hidden page-specific logic.

## Minimal Consumer: Traefik Dashboard

The first validation consumer of this framework is the embedded Traefik Dashboard page.

Minimal consumer contract:

- id: `traefik-dashboard`
- title: `Traefik Dashboard`
- routePath: `/publish/traefik`
- proxyPath: `/api/settings/public/traefik/dashboard/`
- parentLabel: `iframe page`
- accessMode: `proxied`
- authStrategy: `none`
- fallbackBehavior: `open in new window`

Minimal consumer expectations:

- the page renders the Traefik dashboard inside the AppOS content frame
- the page injects the breadcrumb `iframe page > Traefik Dashboard` into the top header area
- the page exposes a direct open action to the proxied Traefik page
- if the proxied page is unavailable, the page shows an in-frame fallback state instead of a blank iframe

## Acceptance Criteria

- [ ] AppOS can define an embedded iframe page through a standard contract
- [ ] The embedded page renders inside the AppOS content area rather than replacing the AppOS shell
- [ ] The page can target a same-origin proxy route owned by AppOS
- [ ] The page injects a top-header breadcrumb using the existing AppOS breadcrumb pattern
- [ ] The default breadcrumb format is iframe page > current page
- [ ] The framework supports a clear fallback state when the embedded page cannot render
- [ ] The fallback state can provide an open-in-new-window action when appropriate
- [ ] The framework exposes an explicit authentication strategy field for future logged-in pages

## Initial Delivery Slice

The first implementation slice should deliver:

- the reusable embedded iframe page framework
- one working consumer page for Traefik Dashboard

## Follow-up Consumer Stories

- Traefik Dashboard page
- Redis Insight page

## Open Questions

- Should AppOS eventually allow module-specific parent labels instead of the default iframe page root?
- What is the minimum approved authentication strategy for the first logged-in embedded console?
- Should AppOS maintain an allowlist registry for eligible embedded console targets?