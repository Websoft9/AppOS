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
- install, upgrade, verify, and repair actions
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
- install, upgrade, verify, and repair flows should resolve through templates, not component-specific branching

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
- `control_plane`
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
| GET | `/api/software/local` | list AppOS-local software inventory |
| GET | `/api/software/local/{componentKey}` | read one AppOS-local component |

Notes:

- keep `componentKey` as the canonical identity field in API and model layers
- async action APIs remain server-scoped
- AppOS-local software uses the same domain language through a separate read-only inventory surface instead of being mixed into server detail APIs

## Interaction Rules

- read inventory and capability state synchronously
- run install, upgrade, verify, and repair actions asynchronously
- keep long-running action execution separate from lifecycle release execution
- let monitor consume installed snapshots and action outcomes, but do not fold runtime observation into this domain

## Stories

### 29.1 Model

- define core language for software component, target, capability, template, and snapshot

### 29.2 Boundary

- classify current `components` and software-delivery execution responsibilities into `catalog`, `inventory`, `provisioning`, and `target-readiness`

### 29.3 Template

- define template schema and executor contract
- keep install, upgrade, verify, and repair flows template-driven

### 29.4 Catalog

- register AppOS-managed software components as catalog entries
- keep component expansion data-driven

### 29.5 Target Readiness

- define capability readiness queries for each delivery target
- preserve OS, privilege, and network preflight as explicit readiness signals

### 29.6 Surface

- expose one minimal software delivery surface for installed state, readiness, and actions

### 29.7 Worker

- wire install, upgrade, verify, and repair actions through Asynq worker with full phase tracking and audit output