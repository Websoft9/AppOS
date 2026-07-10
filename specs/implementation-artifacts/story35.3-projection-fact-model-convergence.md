# Story 35.3: Projection Fact Model Convergence

Status: proposed

## Story

As a platform operator,
I want AppInstance state to be resolved from canonical normalized facts,
so that product-facing lifecycle state remains stable, explainable, and auditable as execution complexity grows.

## Acceptance Criteria

1. Projection inputs must come from explicit normalized fact sources for runtime, health, exposure/publication, and operation activity.
2. String normalization and source-specific cleanup must move to ingestion boundaries wherever possible, not remain mixed into projection resolution.
3. `AppInstance` primary state must remain a projection over canonical facts rather than a catch-all for execution or monitor ambiguity.
4. `state_reason` generation must be structured and traceable to fact sources or operation outcomes.
5. Projection code must not infer lifecycle semantics from loosely typed maps when a typed source contract can be defined instead.
6. Existing UI-facing state vocabulary must remain stable unless an explicit product decision changes it.

## Scope

- projection source contracts
- evidence normalization boundaries
- lifecycle-state and state-reason resolution
- app list/detail read-path convergence on the unified projection

## Out of Scope

- changing user-facing state vocabulary unless explicitly required
- redesigning monitor or exposure subsystems beyond their projection-facing contracts

## Implementation Notes

- This story is a convergence/refactor story, not a vocabulary-redefinition story.
- Reuse the existing state matrix intent from Story 17.3 but tighten evidence boundaries and precedence handling.

## Touch Points

- `backend/domain/lifecycle/projection/app_instance_state.go`
- `backend/domain/lifecycle/projection/updater.go`
- `backend/domain/monitor/status/*`
- `backend/domain/monitor/signals/snapshots/runtime_status.go`
- lifecycle app list/detail route serializers
- `specs/implementation-artifacts/story17.3-instance-state-matrix.md`

## Suggested Order

1. define typed fact inputs for runtime/health/exposure/activity
2. move normalization to ingestion boundaries
3. simplify projection resolution rules
4. make `state_reason` structured and source-traceable
5. update API serializers and regression tests

## Risks

- Over-correcting projection may break existing UI expectations if fact sourcing changes without contract review.
- Runtime, monitor, and exposure signals may need staged normalization before the projection layer can simplify.

## References

- `specs/implementation-artifacts/story17.3-instance-state-matrix.md`
- `specs/planning-artifacts/deployment-architecture-assessment.md`
