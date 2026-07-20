# Epic 29: Software

**Module**: Software Delivery | **Status**: Proposed | **Priority**: P1 | **Depends on**: Epic 12, 20

## Overview

Own the software supply path AppOS actually manages.

Epic 29 absorbs the Epic 6 local inventory and detection-pipeline scope. AppOS-local inventory now belongs here rather than under a separate `System / Components` domain.

This epic covers:

- what software components AppOS owns
- which built-in platform services each local software component defines
- how service identity and log-access metadata are described for AppOS-owned software
- how AppOS-local software and server-target software stay under one domain language
- how they are delivered, installed, upgraded, and verified
- whether a target node is ready to satisfy required capabilities
- what installed snapshot currently exists on each target

Servers are delivery targets, not assets.

For the MVP phase, keep one epic only. Software Delivery owns target readiness as a first-class concern rather than burying it as a minor preflight detail.

## Scope

### In

- AppOS-local bundled software inventory and metadata
- built-in service definitions owned by AppOS-local software components
- service-to-component bindings and log-access metadata for AppOS-owned services
- component catalog and software identity
- target-scoped installed component snapshots (for both `local` and `server` targets)
- install, upgrade, verify, and reinstall actions
- version detection and availability checks
- preflight checks for OS, privilege, and network reachability
- capability queries derived from installed software
- audit trail for software delivery actions

### Out

- source code build pipeline
- artifact registry management
- runtime service observation (active state, uptime, CPU, memory, logs) — that belongs to Monitor
- arbitrary package management outside AppOS-owned software

### Boundary with Monitor

For the same software component, the split is:

- **Software Delivery** answers: what is installed, at what version, and is it available?
  This applies to both `local` targets (AppOS container components) and `server` targets.
- **Software Delivery** also answers: which built-in services belong to that component,
  how those services should be named in operator-facing inventory, and how logs for
  those services can be accessed.
- **Monitor** answers: is it running right now, and is it healthy?
  Monitor is a consumer of Software Delivery inventory events. It does not own
  install, upgrade, or readiness workflows.

For AppOS-local built-in services, the contract split should remain:

- **Software Delivery owns service definitions**
  - service identity
  - component-to-service binding
  - role description
  - log access metadata such as supervisor/file access details
- **Monitor owns service observations**
  - running/missing/degraded state
  - uptime
  - CPU and memory usage
  - freshness/history evidence
  - health judgment and degraded reason

This avoids introducing a third standalone `runtime` domain only to hold a thin
service catalog. The catalog/definition side belongs to Software Delivery; the
live observation side belongs to Monitor.

For control-plane-reporting components such as the monitor agent, the operator-facing inventory needs two dimensions:

- `Service Status`: whether the managed component itself is installed and running on the selected server.
- `AppOS Connection`: whether that component is connected to, authenticated with, and reporting to the AppOS control plane.

Story 29.1 owns the backend contract for projecting these fields into component inventory responses. Monitor/control-plane telemetry remains the evidence source for reporting freshness and history. Health/status projection must be implemented as an explicit decision tree or rule table so precedence is reviewable and reusable across components, not as scattered component-specific `if/else` logic.

Current monitoring direction: Software Delivery should deliver and manage the AppOS `monitor-agent` as the continuous managed-side collector. Any non-metric facts, runtime snapshots, or manageability checks are collected by the AppOS control plane through SSH/tunnel pull or temporary collectors, not by a second Software Delivery-managed monitoring component.

Restricted local runtime note: when AppOS runs without host PID access and without Docker socket access, platform self-observation is limited to AppOS control-plane roles and AppOS-container-self runtime telemetry. Software Delivery should not imply host or peer-container local monitoring in that mode.

## Subdomains

- `catalog`: what software AppOS manages
- `inventory`: what software is installed on each target
- `provisioning`: how software is installed, upgraded, and verified
- `target-readiness`: whether the target environment satisfies required capabilities

Catalog data should distinguish two target scopes:

- `local`: software bundled inside the AppOS container/runtime envelope
- `server`: software managed on connected delivery targets

## Implementation Principle

Keep implementation template-driven.

Rules:

- components are template instances, not story boundaries
- story boundaries should follow shared capability layers
- install, upgrade, verify, and reinstall flows should resolve through templates, not component-specific branching

## Package Naming Decision

The Go package for this domain is `backend/domain/software`. Specs, code paths, and implementation planning must use the same Software Delivery naming throughout the domain.

## Model

Core language:

- `SoftwareComponent`
- `DeliveryTarget`
- `ComponentTemplate`
- `InstalledComponentSnapshot`
- `BuiltInComponent`
- `ServiceDefinition`
- `ServiceLogAccess`
- `Capability`

For `local` targets, Software Delivery may project a richer built-in-component shape
than the old lightweight components list. That richer local contract may include:

- component identity and role
- detected version and availability
- built-in service definitions
- log-access metadata for those services
- packaged/support notes for the AppOS runtime envelope

Target types:

- `local`
- `server`

Managed capabilities currently include:

- `container_runtime`
- `monitor_agent`
- `reverse_proxy`

## Current Mapping

- `components` trends toward `inventory`
- current software-delivery execution material trends toward `provisioning` and `target-readiness`
- monitor remains a separate observation domain

## API Draft

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/servers/{serverId}/software` | list installed component state |
| GET | `/api/servers/{serverId}/software/{componentKey}` | read one component |
| POST | `/api/servers/{serverId}/software/{componentKey}/install` | install component |
| POST | `/api/servers/{serverId}/software/{componentKey}/upgrade` | upgrade component |
| POST | `/api/servers/{serverId}/software/{componentKey}/verify` | verify component |
| GET | `/api/servers/{serverId}/software/capabilities` | list target capability status |
| GET | `/api/software/server-catalog` | list read-only server-target catalog entries |
| GET | `/api/software/server-catalog/{componentKey}` | read one server-target catalog entry |
| GET | `/api/software/local` | list AppOS-local software inventory |
| GET | `/api/software/local/{componentKey}` | read one AppOS-local component |

Notes:

- keep `componentKey` as the canonical identity field in API and model layers
- async action APIs remain server-scoped
- AppOS-local software uses the same domain language through a separate read-only inventory surface instead of being mixed into server detail APIs

## Interaction Rules

- read inventory and capability state synchronously
- run install, upgrade, verify, and reinstall actions asynchronously
- keep long-running action execution separate from lifecycle release execution
- let monitor consume installed snapshots and action outcomes, but do not fold runtime observation into this domain

## Lifecycle Phase Model

| Phase | Semantics |
|-------|-----------|
| `accepted` | request accepted and operation created |
| `preflight` | readiness and execution prerequisites evaluated |
| `executing` | primary action work runs |
| `verifying` | post-action state is confirmed |
| `succeeded` | terminal success |
| `failed` | terminal failure |
| `attention_required` | terminal state requiring operator review |

## Stories

The epic now uses five canonical story documents. Earlier split stories 29.1-29.7 are treated as source material that has been consolidated into the reorganized set below.

### 29.1 Software Contract Catalog

- define the shared software-delivery language across catalog, inventory, provisioning, and target-readiness
- consolidate boundary, template, and catalog rules into one canonical contract story
- keep component identity, template kinds, capability mapping, and initial managed catalog entries explicit
- define reporting-aware `Service Status` / `AppOS Connection` projection and the decision-tree health resolver contract

### 29.2 Software Lifecycle Execution

- define readiness evaluation, lifecycle task types, async execution flow, persistence, and operation state
- keep install, upgrade, verify, reinstall, and uninstall behavior routed through the shared worker contract
- preserve phase tracking and audit expectations for long-running execution

### 29.3 Server Components Contract

- define the server-scoped contract for installed state, readiness, latest result, and supported lifecycle actions
- keep Story 20.7 as the UI owner for naming, layout, and interaction details

### 29.4 Supported Software Page

- expose the read-only `Supported Software` page for server-target software under `Resources`
- separate support discovery from installed inventory and server operations

### 29.5 Local Software Inventory

- expose the read-only AppOS-local software inventory under `Resources`
- keep AppOS-local inventory first-class without mixing it into server operations or discovery surfaces
- treat built-in components and their service definitions as Software Delivery-owned local inventory data