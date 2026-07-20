# Story 6.7: Schema Baseline and Versioned Migration Governance

**Epic**: Epic 6 - Infra Modules
**Status**: in-progress | **Priority**: P1 | **Depends on**: Story 6.4 Egress Domain Consolidation

---

## Goal

Make `backend/infra/schema` the single source of truth for current table structure and keep `backend/infra/migrations` minimal for MVP: one versioned release file per release window that bundles the schema bootstrap and the idempotent seeds needed by a fresh install.

## Scope

- keep one table per file under `backend/infra/schema`
- move collection creation and field or index evolution out of per-change migration files and into schema ensure functions
- keep migrations only for initial schema bootstrap and a very small number of seed migrations needed by fresh installs
- drop historical compatibility backfills from the MVP migration set unless they are still required for current product behavior
- add repository tests that guard the above rules

## Non-Goals

- retrofitting every historical migration name to semantic versions
- preserving old migration-by-migration schema history during MVP cleanup
- carrying a broad legacy upgrade story in the MVP migration directory
- auto-generating schema code from PocketBase metadata in this story

## Acceptance Criteria

1. Every AppOS-owned collection shape lives under `backend/infra/schema` with one table per file.
2. App startup enforces `schema.EnsureAllCollections()` so structure changes apply without writing a structural migration.
3. `backend/infra/migrations` keeps only the initial schema bootstrap and the smallest seed set still needed by fresh installs.
4. Repository docs and tests reflect the new rule that field or index changes belong in schema files, not standalone structural migrations, and that MVP backfills are not kept by default.
5. `make build` succeeds after the refactor.

## Implementation Notes

- `backend/infra/schema` should remain flat and explicit enough that developers can inspect one table at a time.
- For MVP, structure changes land directly in schema files; migration count should stay intentionally small.
- Seed migrations should be idempotent and safe to keep long-term.
- Legacy data backfills should only remain when the current release explicitly supports that historical upgrade path.
- All migration work for one release window should live in a single file named `vXX.YY.ZZ_*.go` (zero-padded semver). A new release that needs a migration creates a new file; old files are never renamed or deleted after release.
- The release migration file may contain schema bootstrap (`EnsureAllCollections`) plus seed functions; execution order inside the file is explicit in the registered `func(app core.App) error`.