# Story 35.4: RuleProfile Strategy Layer

Status: proposed

## Story

As a lifecycle architect,
I want policy variation to live in a first-class `RuleProfile`,
so that AppOS can scale execution modes and risk-sensitive behavior without growing worker-side conditional complexity.

## Acceptance Criteria

1. `RuleProfile` must exist as an explicit runtime concept selected per operation.
2. Pipeline selection must depend on operation context plus `RuleProfile`, not only on hard-coded branching.
3. Retry, compensation, manual-gate, verification, and publication policy must be attributable to the selected rule profile.
4. The initial implementation may use a small bounded profile matrix, but the selection mechanism must be explicit and testable.
5. Worker executors must consume resolved policy inputs rather than re-derive strategy ad hoc.
6. Adding a new deployment mode or risk posture should primarily require profile and metadata changes, not broad worker rewrites.

## Scope

- rule-profile selection contract
- pipeline-definition selection inputs
- policy surfaces for retry, compensation, verification, publication, and manual gates
- executor consumption of resolved strategy inputs

## Out of Scope

- a general-purpose rules engine
- large profile matrices before the first four profiles are stable

## Implementation Notes

- Begin with a small set of profiles, for example: standard compose install, high-risk change, publication-sensitive change, recovery/rollback.
- Avoid over-generalizing into a full rules engine; use boring metadata-first strategy selection.

## Touch Points

- `specs/adr/app-lifecycle-domain-model.md`
- lifecycle pipeline-definition selection code
- lifecycle operation creation/normalization code
- lifecycle worker/executor policy consumption paths
- pipeline family metadata under `backend/domain/lifecycle/metadata/`

## Suggested Order

1. define minimal `RuleProfile` shape
2. implement selection at operation creation time
3. wire pipeline-definition choice through the selected profile
4. wire retry/compensation/manual-gate/verification/publication policy consumption
5. add profile-selection and policy-application tests

## Risks

- Introducing `RuleProfile` too early without execution-core convergence can freeze bad seams.
- Overly broad profile dimensions can create accidental complexity.

## References

- `specs/adr/app-lifecycle-domain-model.md`
- `specs/planning-artifacts/deployment-core-target-architecture.md`
