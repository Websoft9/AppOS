# Epic 6: Infra Modules

## Overview

Codify the shared backend infrastructure modules that live under `backend/infra/` and are consumed by domain, route, worker, and runtime code without carrying product-facing business rules.

**Status**: in-progress | **Priority**: P1 | **Depends on**: Epic 1 DevOps

This epic exists to give the `backend/infra` layer an explicit planning home.

First rollout focus:

- `backend/infra/fileutil` as the first foundation of a shared files service
- a follow-on system media service for Branding, avatar, and future user-uploaded images

## Layer Boundary

`backend/infra` owns reusable infrastructure helpers such as:

- filesystem safety and copy helpers
- network and tunnel support primitives
- persistence and migration utilities
- Docker, supervisor, and VM client adapters

This epic should not absorb:

- product IA or navigation
- domain-specific policy decisions
- HTTP route contracts as the primary abstraction
- user-facing permission semantics beyond the reusable helper boundary

## Historical Note

The older pre-2026-05 Epic 6 `Components` scope was retired after its responsibilities split to Epic 28 `Monitoring` and Epic 29 `Software Delivery`.

This document reuses Epic 6 for the infrastructure-module planning surface that matches the current `backend/infra/` code layout.

## Story Status

| Story | Title | Status |
|-------|-------|--------|
| [6.1](story6.1-files-service.md) | Files Service Foundation | ✅ Done |
| [6.2](story6.2-system-media-service.md) | System Media Service | Planned |
| [6.3](story6.3-network-proxy.md) | Unified Network Proxy Runtime | Planned |
| [6.4](story6.4-egress-domain-consolidation.md) | Egress Domain Consolidation | ✅ Done |
| [6.5](story6.5-fetch-store-runtime.md) | Fetch-Store Download Runtime | Planned |
| [6.7](story6.7-schema-migration.md) | Schema Baseline and Versioned Migration Governance | In Progress |

## Notes

- Story boundaries in this epic should follow reusable infrastructure packages, not UI pages.
- Infra modules should stay dependency-light and reusable from multiple domains.
- The first story intentionally formalizes code that already exists in `backend/infra/fileutil`, but positions it as the first layer of a broader shared file service.
- Story 6.2 must reuse Story 6.1 as the path-safety and file-operation substrate. Media metadata, validation, public/private access, and lifecycle rules must remain in the system-media layer.
- `/appos/data` is already the persisted runtime data root in deployment. Media storage should live under a stable subpath such as `/appos/data/media` rather than introducing an unpersisted side path.
- Story 6.4 is the canonical consolidation point for `egress` as the parent outbound-network domain; legacy `safefetch` and empty `downloader` shims should not be reintroduced.
- Story 6.5 should keep network-governance concerns in `infra/egress`, put large-file fetch-for-store execution in an `infra/egress/fetchstore` subpackage, and reuse `infra/filesvc` only as the local persistence substrate.
- Story 6.7 makes `backend/infra/schema` the current table-structure source of truth. Collection creation and field/index changes land there directly; `backend/infra/migrations` stays intentionally small for MVP. Migration work should live in one versioned file per release window (`vXX.YY.ZZ_*.go`) that bundles schema bootstrap plus the minimum seeds still needed by fresh installs. Old files are never renamed after release. Field or index changes incrementally update the schema files, not migration files.
