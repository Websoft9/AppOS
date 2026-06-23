# Epic 34: Publish

**Module**: Publish | **Status**: Proposed | **Priority**: P1 | **Depends on**: Epic 12, 19, 20, 23

## Overview

Publish lets operators expose applications running on different managed servers through domains and HTTPS from one AppOS console.

The user-facing outcome is simple: bind a domain, connect it to an application, manage certificate lifecycle, and see status in one place.

Phase 1 is HTTP and HTTPS only.

Traefik is bundled with the default AppOS deployment as the publication runtime. It is an internal runtime dependency, not a separate product the operator must install first.

## Product Definition

`Publish` is the AppOS control plane for external application exposure.

It owns:

- domain binding
- HTTP and HTTPS publication
- certificate policy and status
- backend target selection
- app-to-app HTTP exposure rules
- unified publication status across managed servers

It does not own:

- server connectivity and tunnels
- application lifecycle execution
- generic TCP and UDP gatewaying
- service mesh behavior
- shared-config proxy clustering

## Core Decision

AppOS is the only control plane.

Traefik runs on each managed server as an independent local data plane. Each node has its own configuration. AppOS does not broadcast one shared configuration to all nodes.

For the AppOS host itself, Traefik is also the default local publication runtime. It can publish:

- applications on the AppOS host through `host.docker.internal:port`
- sibling container applications through `container-name:port` on a shared Docker network
- tunneled remote applications through local tunnel endpoint ports

Why this shape:

- the product needs one unified view
- each server needs different routes
- AppOS can already reach managed servers directly by IP or tunnel
- adding Consul or etcd would create a second source of truth with no clear benefit

## Architecture

```
                    +-----------------------------------+
                    |        AppOS Control Plane        |
                    |                                   |
                    |  Publish UI                       |
                    |  Publish domain model             |
                    |  Traefik config adapter           |
                    |  Secrets for DNS credentials      |
                    +-----------------+-----------------+
                                      |
                         IP / SSH / tunnel delivery
                                      |
          +---------------------------+---------------------------+
          |                           |                           |
          v                           v                           v
   +-------------+             +-------------+             +-------------+
   | Managed A   |             | Managed B   |             | Managed C   |
   |             |             |             |             |             |
   | Traefik     |             | Traefik     |             | Traefik     |
   | local only  |             | local only  |             | local only  |
   |             |             |             |             |             |
   | www -> 9009 |             | api -> 9009 |             | app -> 9009 |
   +------+------+             +------+------+             +------+------+
          |                           |                           |
          v                           v                           v
      local app                    local app                    local app
```

## Runtime Model

- AppOS stores the source of truth.
- AppOS renders one Traefik dynamic config file per application on the target server.
- AppOS writes files to the managed server through existing server access.
- Traefik watches the dynamic config directory and hot-reloads automatically.
- AppOS reads local Traefik status after apply and shows desired vs applied state.

For the bundled AppOS-host Traefik runtime, publication also owns the on-demand service hook:

- first active publication on the AppOS host writes the route file and runs `sv up /etc/service/traefik`
- subsequent route changes rely on Traefik file-watch reload and do not restart the process
- removing the last AppOS-host publication route removes the file and runs `sv down /etc/service/traefik`

Supported backend target shapes in phase 1:

- `host.docker.internal:port`
- `container-name:port`
- `127.0.0.1:tunnel-port`

No dedicated proxy agent is added.

## Certificate Strategy

Two ACME paths are supported:

| Path | When used | Executor |
|------|-----------|----------|
| HTTP-01 | Domain already resolves to the managed server | Traefik locally |
| DNS-01 | Wildcard domain, internal domain, or port 80 unavailable | Traefik locally with AppOS-managed DNS credentials |

Rules:

- Traefik is always the ACME executor.
- AppOS manages DNS provider credentials through Secrets.
- DNS credentials are delivered only when needed.
- Certificates remain local to the managed server.

## Configuration Delivery

Recommended layout on managed servers:

```
/etc/traefik/dynamic/
├── {app-id}.yml
├── {app-id}.yml
└── shared-middlewares.yml
```

Delivery flow:

1. AppOS renders per-node YAML.
2. AppOS writes a temp file on the managed server.
3. AppOS optionally validates the config locally.
4. AppOS atomically renames the file into place.
5. Traefik hot-reloads through file watch.
6. AppOS queries local Traefik status and records the applied result.

This keeps configuration persistent across Traefik restarts and avoids exposing a remote Traefik admin surface.

## Compatibility Strategy

Most open-source applications document Nginx examples rather than Traefik examples.

Phase 1 handling:

- standard reverse-proxy patterns are translated into Traefik config
- common policy needs such as headers, redirects, basic auth, upload size limits, and rate limiting use Traefik middlewares
- rare Nginx-specific edge cases may use a local Nginx sidecar as the backend target

The product language stays vendor-neutral even if Traefik is the runtime.

## Scope

Phase 1 includes:

- domain binding
- HTTP and HTTPS publication
- per-node independent routing
- HTTP-01 and DNS-01 certificate automation
- backend health and publication status
- unified console view across managed servers
- app-to-app HTTP exposure rules
- configuration rollback

Phase 1 excludes:

- TCP and UDP publication
- WAF as a first-class product surface
- dynamic response caching
- shared-config gateway clusters
- service mesh behavior

## Domain Language

User-facing language should stay product-oriented:

- `Publication`
- `Domain`
- `Backend Target`
- `Certificate Binding`
- `Exposure Rule`

Implementation language may remain runtime-oriented internally:

- Traefik config
- router
- service
- middleware

## Story Breakdown

### Story 34.1: Publish Domain Model

Define the canonical Publish model and boundaries.

### Story 34.2: Publish Control API

Expose CRUD and status APIs for publications, domains, backend targets, and certificate bindings.

### Story 34.3: Traefik Config Adapter

Render vendor-neutral publication data into per-node Traefik config and deliver it to managed servers.

### Story 34.4: Publish Console UI

Deliver the unified Publish surface for creation, status, certificate management, and per-node visibility.

## Acceptance Criteria

- Operators can publish an application on any managed server through HTTP or HTTPS.
- Different managed servers can have different publication configs.
- AppOS shows all publications in one unified view.
- Traefik reloads changes without process restart.
- HTTP-01 and DNS-01 certificate flows are both supported.
- The public product surface uses Publish language rather than proxy-infrastructure language.