# Story 29.5: Target Readiness

**Epic**: Epic 29 - Software Delivery
**Status**: review | **Priority**: P1 | **Depends on**: Story 29.1, Story 29.3, Story 29.4, Epic 20

## Objective

Define the minimal target-readiness contract so Software Delivery can decide whether a server is ready for install, upgrade, or verify actions.

This story is specifically about `server` targets, not AppOS-local bundled software.

## Scope

- define readiness signals for OS, privilege, network, and prerequisite capability state
- expose readiness query results alongside component state
- keep readiness explicit instead of burying it inside action-only preflight logs

## Readiness Contract

### Readiness Dimensions

| Field | Meaning |
|------|---------|
| `os_supported` | target OS is supported by the template |
| `privilege_ok` | required privilege is available |
| `network_ok` | required network path is reachable |
| `dependency_ready` | prerequisite capability is already available |
| `ready` | overall readiness decision |
| `issues` | operator-readable blocking issues |

### Query Surface

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/servers/{serverId}/software/capabilities` | list readiness and capability state |
| GET | `/api/servers/{serverId}/software/{componentKey}` | include readiness result for one component |

## Tasks / Subtasks

- [x] Task 1: Define readiness DTOs
  - [x] 1.1 target readiness result shape (`TargetReadinessResult` in model.go; verified with JSON test)
  - [x] 1.2 readiness issue codes and messages (`ReadinessIssueCode` type + 4 constants in readiness.go)
- [x] Task 2: Bind readiness to templates and catalog entries
  - [x] 2.1 supported OS rules (`PreflightSpec.SupportedOS` in templates.yaml; evaluated by EvaluateReadiness)
  - [x] 2.2 privilege requirements (`PreflightSpec.RequireRoot`; evaluated by EvaluateReadiness)
  - [x] 2.3 network requirements (`PreflightSpec.RequireNetwork`; evaluated by EvaluateReadiness)
- [x] Task 3: Add query integration
  - [x] 3.1 expose readiness in component detail (`TargetReadinessResult` embedded in `SoftwareComponentDetail.Preflight`)
  - [x] 3.2 expose capability-level readiness projection (`CapabilityStatus.ReadinessResult` in interfaces.go)
  - [x] 3.3 add backend tests for blocking and ready states (readiness_test.go: 9 tests)

## Guardrails

- readiness is a first-class query result, not only an action-time side effect
- readiness does not replace runtime monitoring
- readiness failures should stay operator-readable and deterministic

## Acceptance Criteria

- [x] operators can inspect whether a target is ready before triggering actions
- [x] readiness covers OS, privilege, network, and prerequisite dependency state
- [x] readiness result is available from the Software Delivery API surface

## Notes

- MVP should prefer a compact readiness summary over a large diagnostics tree
- monitor may consume readiness outcomes later, but readiness ownership stays in Software Delivery

## Dev Agent Record

### Implementation Plan

- Task 1–2: add `ReadinessIssueCode` type + 4 constants + `TargetInfo` struct + `EvaluateReadiness` function to new `readiness.go`
- Task 3: TDD — `readiness_test.go` written first (RED), then implementation (GREEN)

### Debug Log

- readiness_test.go written first; RED: 5+ undefined symbols.
- readiness.go created with ReadinessIssueCode, 4 constants, TargetInfo, EvaluateReadiness.
- GREEN: all 45 software-domain tests pass. Full build clean.

### Completion Notes

- `EvaluateReadiness(preflight PreflightSpec, target TargetInfo, dependencyReady bool) TargetReadinessResult` is the core function.
- OS matching is case-insensitive; empty SupportedOS list accepts any OS.
- Issues slice accumulates one message per failing dimension (OS, privilege, network, dependency).
- `TargetInfo` is produced by the infra layer only; no user-supplied input can reach the evaluator.
- AppOS-local software now exposes a parallel read-only inventory surface under `/api/software/local`; it does not reuse the server readiness route family directly.

## File List

- `backend/domain/software/readiness.go` (new)
- `backend/domain/software/readiness_test.go` (new)

## Change Log

| Date | Change |
|------|--------|
| 2025-07 | Story implemented: readiness.go + readiness_test.go (9 tests); all 45 software-domain tests GREEN; story status → review |

## Status

review