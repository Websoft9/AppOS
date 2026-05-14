# Epic 29: Software Delivery

**Module**: Software Delivery | **Status**: Proposed | **Priority**: P1 | **Depends on**: Epic 12, 20

## Overview

Own the software supply path AppOS actually manages.

This epic covers:

- what software components AppOS owns
- how AppOS-local software and server-target software stay under one domain language
- how they are delivered, installed, upgraded, and verified
- whether a target node is ready to satisfy required capabilities
- what installed snapshot currently exists on each target

Servers are delivery targets, not assets.

For the MVP phase, keep one epic only. Software Delivery owns target readiness as a first-class concern rather than burying it as a minor preflight detail.

## Scope

### In

- AppOS-local bundled software inventory and metadata
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
- **Monitor** answers: is it running right now, and is it healthy?
  Monitor is a consumer of Software Delivery inventory events. It does not own
  install, upgrade, or readiness workflows.

For control-plane-reporting components such as the monitor agent, the operator-facing inventory needs two dimensions:

- `Service Status`: whether the managed component itself is installed and running on the selected server.
- `AppOS Connection`: whether that component is connected to, authenticated with, and reporting to the AppOS control plane.

Story 29.1 owns the backend contract for projecting these fields into component inventory responses. Monitor/control-plane telemetry remains the evidence source for reporting freshness and history. Health/status projection must be implemented as an explicit decision tree or rule table so precedence is reviewable and reusable across components, not as scattered component-specific `if/else` logic.

New monitoring direction: Software Delivery should not deliver or manage a custom `appos-agent`. Managed servers keep Netdata as the only continuous monitoring agent. Any non-metric facts, runtime snapshots, or manageability checks are collected by the AppOS control plane through SSH/tunnel pull or temporary collectors, not by a Software Delivery-managed AppOS agent component.

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
- `Capability`

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

Legacy implementation history from the superseded split stories is preserved in `specs/implementation-artifacts/epic29-legacy-implementation-record.md`.

### 29.1 Software Contract and Catalog

- define the shared software-delivery language across catalog, inventory, provisioning, and target-readiness
- consolidate boundary, template, and catalog rules into one canonical contract story
- keep component identity, template kinds, capability mapping, and initial managed catalog entries explicit
- define reporting-aware `Service Status` / `AppOS Connection` projection and the decision-tree health resolver contract

### 29.2 Software Lifecycle Execution

- define readiness evaluation, lifecycle task types, async execution flow, persistence, and operation state
- keep install, upgrade, verify, reinstall, and uninstall behavior routed through the shared worker contract
- preserve phase tracking and audit expectations for long-running execution

### 29.3 Server Software Operational Surface

- expose the server-scoped `Software` tab for installed state, readiness, last result, and supported lifecycle actions
- keep the UI operational, compact, and strictly scoped to the current server

### 29.4 Supported Software Discovery Surface

- expose the read-only `Supported Software` page for server-target software under `Resources`
- separate support discovery from installed inventory and server operations

### 29.5 Local Software Inventory Surface

- expose the read-only AppOS-local software inventory under `Resources`
- keep AppOS-local inventory first-class without mixing it into server operations or discovery surfaces