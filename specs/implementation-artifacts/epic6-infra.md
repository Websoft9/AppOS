# Epic 6: Infra Modules

## Overview

Codify the shared backend infrastructure modules that live under `backend/infra/` and are consumed by domain, route, worker, and runtime code without carrying product-facing business rules.

**Status**: in-progress | **Priority**: P1 | **Depends on**: Epic 1 DevOps

This epic exists to give the `backend/infra` layer an explicit planning home.

First rollout focus:

- `backend/infra/fileutil` as the first foundation of a shared files service

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

## Notes

- Story boundaries in this epic should follow reusable infrastructure packages, not UI pages.
- Infra modules should stay dependency-light and reusable from multiple domains.
- The first story intentionally formalizes code that already exists in `backend/infra/fileutil`, but positions it as the first layer of a broader shared file service.
