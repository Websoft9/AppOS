# Story 18.1c: Desired State Projection Completion

Status: proposed

## Story

As an operator,
I want the management projection to expose `desired_state` clearly,
so that I can distinguish intended app state from current lifecycle state when interpreting Installed-side status and action outcomes.

## Acceptance Criteria

1. The backend app-management projection exposes `desired_state` where it is part of the intended `AppInstance` aggregate meaning.
2. Frontend Installed-side types and views can consume `desired_state` without relying on ad hoc local derivation.
3. `desired_state` is not treated as a duplicate of execution status or pipeline phase.
4. The story clarifies how `desired_state` should be interpreted relative to `lifecycle_state`.
5. The story does not expand `desired_state` into a full policy engine or orchestration planner.

## Delivered Now

- [x] `desired_state` already exists in the lifecycle domain model and projection structure.
- [x] The boundary assessment identifies its under-expression in the current management contract.
- [ ] Backend and frontend management surfaces fully expose and interpret `desired_state`.

## Still Deferred

- [ ] More advanced intent-policy modeling.
- [ ] Automated drift remediation tied to desired state.
- [ ] Fleet-wide desired-state reporting.

## Current Baseline (2026-04-01)

The lifecycle model already has a place for `desired_state`, but current API and dashboard management contracts do not surface it consistently enough for Installed-side reasoning.

This matters because:

1. `desired_state` is part of the long-lived app intent model.
2. Operators need to separate intent from current lifecycle or execution status.
3. If it stays hidden, future UI logic may keep inferring intent from execution residue or current state only.

## Dev Notes

- This is a projection-completion story, not a new domain-model story.
- Keep the semantics simple: intended state versus current lifecycle state.
- Avoid binding `desired_state` too tightly to transient execution phases.

## Implementation Breakdown

### 1. Backend contract completion

- Ensure `desired_state` is exposed in the relevant `/api/apps` projection payloads.
- Confirm naming and serialization align with existing lifecycle vocabulary.

### 2. Frontend type and view alignment

- Add `desired_state` to Installed-side types.
- Use it in app detail or summary views only where it helps operator reasoning.
- Avoid noisy or redundant rendering where current state already conveys enough.

### 3. Interpretation rule

- Document or encode the operator-facing distinction between `desired_state` and `lifecycle_state`.
- Keep execution phase and pipeline progress out of this meaning.

### 4. Tests

- Add route tests ensuring `desired_state` is present.
- Add or update frontend tests where type/contract coverage exists.

## Minimal Acceptance Test Checklist

- [ ] `/api/apps` list and detail payloads expose `desired_state` where expected.
- [ ] Installed-side TypeScript types include `desired_state`.
- [ ] UI does not confuse `desired_state` with current execution phase.
- [ ] Existing status rendering does not regress.

## References

- [Source: specs/implementation-artifacts/epic17-18-app-instance-subdomain-assessment.md]
- [Source: specs/adr/app-lifecycle-domain-model.md]
- [Source: specs/implementation-artifacts/story18.1a-app-detail-boundary-classification.md]