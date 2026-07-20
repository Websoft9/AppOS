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

## AppOS and rclone Relationship

AppOS is the product layer for storage.

`rclone` is the execution kernel for backend connectivity and file transfer behavior.

Implications:

- AppOS does not model storage as a thin pass-through to raw `rclone` commands
- AppOS owns the operator-facing resource, permissions, logs, audit, async lifecycle, and UX
- `rclone` owns backend-specific protocol handling, transfer execution, and backend option parsing
- AppOS should treat `rclone` as an embedded Go dependency first, not as an external CLI-first integration
- if AppOS later swaps or supplements `rclone`, the AppOS `storage` API and operation model should remain stable

## Responsibility Split

| Concern | AppOS owns | `rclone` owns |
| --- | --- | --- |
| Product object model | `storage` resource identity, metadata, capability projection | none |
| Permissions | route auth, superuser-only mutations, secret access rules | none |
| UX | list/create/edit flows, browser surface, operation history | none |
| Async lifecycle | accepted/executing/verifying/succeeded/failed states, queueing, retries, cancellation policy | none |
| Audit and logs | audit events, operation log persistence, operator-visible status | transfer/library logs emitted during execution |
| Secret management | credential storage, encryption, access control, resolve-time injection | consumes resolved values only |
| Config schema | product-level template selection, field filtering, grouping, defaults, i18n | backend option definitions (`fs.Option`) |
| Backend execution | chooses adapter, constructs execution input, maps errors to product errors | protocol-specific connect/list/upload/download/sync behavior |
| Transfer internals | high-level policy only | concurrency, checksums, multipart behavior, protocol quirks |

## Configuration Model

AppOS should not maintain a fully separate hand-authored clone of every `rclone` backend configuration shape.

AppOS should also not expose every raw `rclone` option directly to operators.

Recommended model:

- `rclone` `fs.Option` metadata is the upstream schema source for backend field definitions
- AppOS builds a Storage Template Adapter layer on top of `fs.Option`
- the adapter performs a controlled projection from backend options to product fields
- AppOS stores a stable product template contract while minimizing drift from upstream `rclone`

The adapter layer should own:

- filtering of non-product or unsafe `rclone` options
- grouping and ordering fields for UI
- marking secret-bearing fields for AppOS secret flows instead of inline config storage
- adding AppOS-specific labels, descriptions, and i18n keys
- mapping root/path semantics that are not simple backend options
- backend-specific overrides when AppOS intentionally narrows the surface

Decision:

- `fs.Option` is the upstream schema source
- AppOS template contracts are a controlled projection of that source, not an uncontrolled direct mirror
- for MVP backends (`s3`, `r2`, `sftp`), AppOS may start with a narrow curated subset while keeping the adapter architecture ready for wider reuse later

## Storage Template Adapter

Minimal-maintenance direction:

- AppOS imports `rclone` backend registrations and reads backend metadata from code
- AppOS derives candidate field definitions from backend `RegInfo` and `fs.Option`
- AppOS applies a thin policy layer to produce product-safe storage templates
- AppOS executes backends through `configmap.Mapper` and `configstruct`-style config binding instead of hand-building large parallel config models

This gives AppOS a practical balance:

- less manual template duplication
- lower drift risk when `rclone` evolves
- stable AppOS-facing contracts
- explicit room to hide, rename, or constrain fields when product needs differ from backend flexibility

## Secret Delivery and Execution Boundary

AppOS secrets remain the source of truth for credential material.

Rules:

- storage records store secret references, not raw credential values
- AppOS resolves secrets at execution time only
- resolved secret values are injected into the adapter input passed to `rclone`
- `rclone` must not become a second credential store owned by AppOS users or operators
- AppOS should avoid persistent on-disk `rclone` config files for normal storage operations

Execution direction:

- prefer embedded Go integration with `rclone` packages over shelling out to the `rclone` CLI
- create backend config in memory for each operation
- pass cancellation and timeout control through AppOS-managed context boundaries
- map backend errors into stable AppOS operation errors and status phases

If a backend requires temporary files for execution, such as an SSH private key file for a specific auth path, the file must be:

- created under AppOS-managed runtime paths
- permission-restricted
- short-lived
- deleted after operation completion

## Async Boundary

`rclone` is not the async orchestrator.

`rclone` may use internal concurrency during transfer execution, but AppOS remains responsible for the product-level async model.

Implications:

- AppOS creates and persists the storage operation record before execution
- AppOS enqueues and supervises long-running storage work through the existing async substrate
- worker code calls `rclone` from inside the AppOS async job boundary
- AppOS owns retries, cancellation semantics, timeout policy, and progress projection into operation logs/status
- `rclone` is a blocking execution dependency inside an AppOS-managed job, not a competing job system

## Product Guardrails

To keep the integration maintainable:

- do not expose raw arbitrary `rclone` command passthrough in MVP
- do not let backend option sprawl dictate the initial product UX
- do not couple AppOS route design or operation states to `rclone` CLI output formats
- do not store long-lived reusable backend configs in a separate `rclone` config domain outside AppOS resource ownership
- keep AppOS capability vocabulary stable even when backend-specific options vary underneath

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
storage template adapter
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
