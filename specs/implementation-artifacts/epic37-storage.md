# Epic 37: Storage

**Module**: Storage | **Status**: Proposed | **Priority**: P1 | **Depends on**: Epic 8, Epic 12, Epic 19

## Overview

AppOS Storage is the platform resource domain for external and remote storage backends.

It gives storage a first-class home outside `instances` so AppOS can manage heterogeneous backends such as `s3`, `r2`, and `sftp` through one product surface and one execution model.

## Definition

Storage owns:

- storage resource identity and metadata
- backend type classification
- credential and secret references needed to access a storage target
- capability-aware file operations such as browse, upload, download, and sync
- async execution, logs, and status for long-running storage operations

Storage does not own:

- generic secrets management
- app deployment ownership
- server lifecycle ownership
- local filesystem internals of unrelated domains
- a standalone storage service outside AppOS

## Boundary

Use `Storage` when the object is a reusable storage target with operator-facing file operations.

Do not model storage as an `instance` when AppOS needs to browse, upload, sync, or otherwise operate on it as a first-class product object.

## Direction

Storage becomes a new top-level resource family under `Resources`.

Initial target backends:

- `s3`
- `r2`
- `sftp`

Additional backends may be added later through the same template-driven model.

## Execution Decision

AppOS owns the Storage domain model and API.

`rclone` is the initial execution adapter, not the product model.

Phase 1 integration direction:

- no standalone `rclone` service
- run `rclone` locally from the AppOS backend execution boundary
- keep AppOS API and job semantics stable even if the storage adapter changes later

## Capability Model

Storage operations must be capability-aware instead of assuming all backends behave the same.

Initial capability vocabulary:

- `browse`
- `read`
- `write`
- `delete`
- `sync`

Future capabilities may add richer semantics such as signed URLs, server-side copy, or mount support.

## MVP

Phase 1 should stay intentionally small:

- top-level `storage` resource family
- template-driven backend definitions for `s3`, `r2`, and `sftp`
- credential-backed connection configuration
- `test connection`
- `list files`
- `upload`
- `download`
- async `sync`
- operation status and basic logs

## Out of Scope

- mount as a core phase-1 capability
- full replacement of existing local filesystem storage used by unrelated domains
- provider-specific advanced features beyond the common capability surface
- turning storage operations into raw `rclone` command passthrough
- a separate distributed storage control plane

## Migration Direction

Current `s3-compatible` registration under `instances` is not the long-term home for storage.

Epic 37 should define a migration path from instance-owned object storage records to first-class `storage` resources without forcing one destructive cutover.

## Minimal Architecture

```text
storage resource
  ↓
storage API
  ↓
storage service
  ↓
storage adapter interface
  ↓
rclone adapter
  ↓
remote backend (s3 / r2 / sftp / ...)
```

Long-running operations run through the existing AppOS async substrate.

## Stories

### Story 37.1: Storage Domain Foundation

- define the canonical `storage` resource model
- define backend type and capability metadata
- define secret and credential reference rules
- define migration stance relative to `s3-compatible` instances

### Story 37.2: Storage Templates and CRUD

- add template-driven backend definitions for `s3`, `r2`, and `sftp`
- add minimal CRUD routes and persistence
- add connection test behavior

### Story 37.3: Storage Operations MVP

- add browse, upload, download, and sync contracts
- execute long-running work asynchronously
- persist basic operation status and logs
- integrate the first `rclone` adapter

### Story 37.4: Storage UI MVP

- add storage list and create/edit flows
- add basic file browser and operation entry points
- expose operation history and current status

## Risks

- backend capability differences may leak through a falsely uniform UI or API
- `rclone` integration may introduce config, logging, or upgrade complexity
- migration from `instances` may create temporary overlap if boundaries are not enforced early
- large-file operations require strict async handling and resource limits

## Decision

Proceed with `Storage` as a first-class resource domain, with `rclone` as the initial execution adapter and a deliberately small capability-based MVP.
