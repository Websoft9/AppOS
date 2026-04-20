# Story 29.2: Boundary

**Epic**: Epic 29 - Software Delivery
**Status**: review | **Priority**: P1 | **Depends on**: Story 29.1, Epic 20

## Objective

Classify the current `components` and software-delivery execution material into one Software Delivery boundary with explicit subdomains.

## Scope

- map existing capabilities into `catalog`, `inventory`, `provisioning`, and `target-readiness`
- separate Software Delivery concerns from Monitor concerns
- keep server targets as delivery targets, not managed assets
- define the minimum boundary needed for MVP implementation

## Boundary Decision

### Software Delivery Owns

- managed component identity
- component catalog metadata
- installed component inventory per target
- install, upgrade, verify, and repair workflows
- target readiness and prerequisite capability checks

### Monitor Owns

- runtime observation
- health trend projection
- heartbeat, active checks, and health summaries
- operator-facing status timelines and degraded-state visibility

### Current Mapping

| Current Material | Target Subdomain | Reason |
|------------------|------------------|--------|
| `components` inventory output | `inventory` | describes installed state on a target |
| component registry/config | `catalog` | defines what AppOS manages |
| software delivery install/upgrade/verify execution | `provisioning` | executes delivery actions |
| OS / privilege / network checks | `target-readiness` | determines whether actions can safely run |

## Tasks / Subtasks

- [x] Task 1: Freeze subdomain ownership
  - [x] 1.1 classify current `components` responsibilities
  - [x] 1.2 classify current software-delivery execution responsibilities
  - [x] 1.3 list explicit out-of-boundary concerns for Monitor
- [x] Task 2: Freeze contract handoff
  - [x] 2.1 capability query ownership
  - [x] 2.2 action command ownership
  - [x] 2.3 event handoff to Monitor
- [x] Task 3: Document MVP implementation boundary
  - [x] 3.1 identify code areas that define provisioning and target-readiness first
  - [x] 3.2 identify code areas that should converge first
- [x] Task 4: Rename audit action constants
  - [x] 4.1 `AuditActionInstall/Upgrade/Verify/Repair` constants use `server.software.*` in `backend/domain/serverbase/model.go`
  - [x] 4.2 no existing audit records with old names; migration note added in `boundary.go` package doc

## Guardrails

- do not create a separate `platform` domain
- do not let Monitor own install or readiness workflows
- do not treat the server itself as a managed asset aggregate

## Acceptance Criteria

- [x] every current `components` and software-delivery execution responsibility is mapped to one Software Delivery subdomain
- [x] Monitor and Software Delivery have a clear handoff boundary
- [x] MVP scope remains one epic, one bounded context, and one operator-facing goal
- [x] audit action constants use `server.software.*` naming

## Notes

- this story fixes the planning boundary first, then implementation follows the same Software Delivery naming and package structure

## Dev Agent Record

### Implementation Plan

- Task 1-3: Create `boundary.go` encoding subdomain classification as typed constants + commentary
- Task 4: Audit constants already renamed to `server.software.*` (done in remediation); verify + add migration note

### Debug Log

- boundary_test.go written first (RED: 10 undefined symbols at build).
- boundary.go created with `Subdomain` type, 4 subdomain constants, `MaterialSubdomainMap`, and `CapabilityComponentMap`.
- GREEN: all 20 serverbase tests pass (`go test ./domain/serverbase/... -v`).
- Full build clean: `go build ./...` produced no errors.

### Completion Notes

All boundary classification is encoded in `backend/domain/serverbase/boundary.go` as typed Go constants and maps:
- `Subdomain` string type with 4 constants covering all MVP concerns
- `MaterialSubdomainMap` maps existing `components` material to subdomains
- `CapabilityComponentMap` maps Capability keys to ComponentKey — used by provisioning and target-readiness stories
- Package godoc records the Monitor handoff boundary and an audit-constant migration note
20 tests pass (5 new boundary tests + 15 existing model tests). Full build is clean.

## File List

- `backend/domain/serverbase/boundary.go` (new)
- `backend/domain/serverbase/boundary_test.go` (new)
- `backend/domain/serverbase/model.go` (audit constants confirmed correct)

## Change Log

| Date | Change |
|------|--------|
| 2025-07 | Story implemented: boundary.go + boundary_test.go created; all 20 serverbase tests GREEN; story status → review |

## Status

review