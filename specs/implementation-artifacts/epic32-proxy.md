# Epic 32: Proxy

**Module**: Proxy | **Status**: Proposed | **Priority**: P1 | **Depends on**: Epic 12, 19, 20, 23

## Overview

AppOS Proxy is the unified HTTP ingress control plane for applications distributed across different servers.

It gives operators one place to bind domains, manage certificate lifecycle, route traffic to remote application backends, and define controlled HTTP connectivity between applications.

This epic is not a general multi-node platform or service mesh. It is a focused ingress and interconnect control surface designed for AppOS's single-server-first product strategy, extended to support multi-server application exposure.

## Problem Statement

AppOS can already manage servers, certificates, and deployed applications through separate modules. What is missing is the operator-facing control plane that turns those pieces into one coherent entry layer.

Operators need to:

- expose applications running on different servers through one managed domain system
- request, bind, renew, and replace certificates without per-node manual work
- route external HTTP traffic to distributed backends
- establish controlled HTTP connectivity between applications on different servers
- inspect route, backend, certificate, and health status from one place

Without this module, multi-server application exposure becomes fragmented across manual reverse proxy config, ad hoc certificate handling, and inconsistent cross-server addressing.

## Definition

`Proxy` owns the control plane for HTTP ingress and controlled application-to-application HTTP interconnect.

It owns:

- domain binding for exposed applications
- route and backend definitions for HTTP and HTTPS traffic
- certificate binding and renewal orchestration for proxy consumers
- backend health and effective exposure status
- controlled HTTP interconnect records between AppOS-managed applications
- operator-facing inventory of proxy entries, domains, certificates, and backend targets

It does not own:

- raw server registration or SSH connectivity
- low-level certificate storage primitives
- application lifecycle execution
- generic TCP and UDP gatewaying in phase 1
- full east-west service mesh behavior
- distributed scheduler, cluster management, or global traffic management

## Boundary

Use `Proxy` when the product needs to make an application reachable through a managed HTTP endpoint or when one managed application needs a controlled HTTP path to another managed application.

Do not use `Proxy` as a general networking domain, generic load balancer abstraction, or catch-all inter-service connectivity platform.

Phase 1 is explicitly limited to HTTP and HTTPS control-plane use cases.

## Product Direction

AppOS should treat this module as a unified HTTP Proxy console, not as a full multi-node orchestration platform.

The intended user outcome is simple:

- an operator selects an application running on any managed server
- AppOS assigns or binds a domain
- AppOS applies and maintains the certificate association
- AppOS publishes the route through one managed ingress layer
- AppOS shows whether the route is healthy and where it terminates

For application-to-application connectivity, phase 1 should support controlled HTTP reachability, not transparent mesh networking.

## Scope Boundaries

| In scope | Out of scope |
|----------|-------------|
| Domain binding for distributed app backends | Generic L4 proxying |
| HTTP and HTTPS route definitions | Full service mesh |
| Certificate assignment and renewal orchestration | Cross-region traffic management |
| Backend target registration by server/app context | Kubernetes-style scheduling |
| Backend health checks and exposure status | Arbitrary non-HTTP network policy |
| Controlled app-to-app HTTP interconnect records | Automatic workload migration |
| Operator console for routes, domains, certs, and targets | Global distributed configuration consensus |

## Core Capabilities

Proxy provides:

- managed domain inventory
- route definitions with host and path matching
- backend target registration for applications on managed servers
- certificate attachment and renewal orchestration
- health checks for backend availability
- exposure status and failure reason surfaces
- controlled HTTP interconnect between managed applications
- operator audit visibility for proxy changes

## MVP

Phase-1 MVP should deliver the smallest coherent operator loop.

### MVP user flow

1. Choose a managed application running on a managed server.
2. Bind a domain or subdomain.
3. Attach an existing certificate record or request managed renewal behavior.
4. Publish an HTTP or HTTPS route to the selected backend.
5. Observe route health, certificate expiry status, and backend reachability.

### MVP committed capabilities

- register HTTP backends using AppOS server and application context
- bind host-based routes to those backends
- support HTTPS termination with certificate record references
- support managed renewal orchestration for proxy-bound certificates
- show route inventory and basic route detail status
- show backend health and last known failure reason
- define controlled app-to-app HTTP exposure records for managed applications

### MVP non-goals

- automatic topology-wide discovery of every service endpoint
- transparent mutual TLS across all internal traffic
- advanced WAF policy authoring as a first-class AppOS product surface
- advanced response caching policy authoring as a first-class AppOS product surface
- multi-cluster or cross-region ingress federation

## Dependencies

- Epic 20 `Servers` provides the managed node inventory and remote execution context.
- Epic 23 `Certificates` provides certificate records and lifecycle metadata.
- Epic 19 `Secrets` provides encrypted sensitive material where certificate or provider secrets are needed.
- Epic 12 `Audit` records operator-visible change history for routing and certificate binding actions.

## Initial Domain Model

Recommended user-facing concepts:

- Proxy Entry
- Domain Binding
- Backend Target
- Certificate Binding
- Interconnect Policy

Recommended internal concepts:

- `ProxyRoute`
- `DomainBinding`
- `BackendTarget`
- `CertificateBinding`
- `InterconnectRule`
- `RouteHealth`

### Minimal fields

`ProxyRoute`

- `id`
- `name`
- `host`
- `path_prefix`
- `protocol`
- `status`
- `certificate_id`

`BackendTarget`

- `id`
- `server_id`
- `app_ref`
- `target_url`
- `health_status`
- `last_error`

`InterconnectRule`

- `id`
- `source_app_ref`
- `target_app_ref`
- `access_mode`
- `exposed_host`
- `status`

## Technical Direction

The product abstraction should remain vendor-neutral: AppOS exposes a Proxy module, not a brand-specific reverse proxy product.

For the first implementation, the primary evaluation target should be a Go-native proxy runtime that is strong in:

- dynamic backend registration
- centralized route management
- automated certificate lifecycle
- HTTP-focused ingress for distributed backends

Current recommendation:

- prefer Traefik as the leading implementation candidate when the requirement is one unified ingress console for multiple distributed backends
- keep Caddy as the simplicity-first alternative for narrower single-node or low-complexity deployments

Reasoning:

- Traefik is a better fit for AppOS Proxy if the product must manage many backends across different servers through one control plane
- Caddy remains strong for simple automatic HTTPS and low-friction deployment, but it is less aligned with the multi-backend control-plane shape of this epic

This recommendation is an implementation direction, not a public product commitment.

## Story Breakdown

### Story 32.1: Proxy Domain Model

Define the canonical Proxy model, boundaries, and persistence shape.

Output:

- `backend/domain/proxy` package boundary
- canonical route, backend, certificate binding, and interconnect entities
- status model for route health and publication state
- explicit HTTP and HTTPS-only phase-1 boundary

### Story 32.2: Proxy Control API

Expose the backend API for route, backend, and certificate-binding management.

Output:

- create/read/update/delete contract for proxy routes
- backend target registration contract
- certificate binding and renewal orchestration contract
- route health and status query contract
- app-to-app interconnect contract

### Story 32.3: Proxy Console UI

Deliver the first operator-facing Proxy surface.

Output:

- Proxy list page
- route create and edit flow
- domain and certificate binding workflow
- backend target selection by server and app context
- route detail status view
- interconnect management view for controlled app-to-app HTTP exposure

## Acceptance Criteria

- Operators can create a managed HTTP or HTTPS proxy entry for an application running on a managed server.
- Operators can bind a domain and certificate record to that proxy entry.
- AppOS can show whether the route is healthy and which backend it targets.
- Operators can inspect expiring or failed certificate bindings from the Proxy surface.
- Operators can define a controlled HTTP interconnect between managed applications without introducing a full service mesh abstraction.
- The module remains HTTP-focused and does not become a generic networking catch-all.