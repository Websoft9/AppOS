# Story 17.2: First Install Closed Loop

Status: review

## Story

As a platform operator,
I want a working first-install path from request to execution result,
so that the lifecycle execution core is proven as a real closed loop before more adapters, publication flows, and recovery features expand scope.

## Acceptance Criteria

1. Support first install from ManualOps compose input through one shared async lifecycle pipeline.
2. The first closed loop must create an `app_instance` in `registered` or `installing` state, create an `app_operation` with `operation_type=install`, and initialize a related `pipeline_run`.
3. The worker execution path must use the canonical lifecycle progression `queued -> validating -> preparing -> executing -> verifying -> success|failed`, represented through `phase`, `terminal_status`, `failure_reason`, and `app_outcome` fields instead of one overloaded state field.
4. The first install closed loop must validate compose input, prepare the execution workspace, run compose apply, verify runtime health, persist node-level execution history, and project the result back to `app_instances`.
5. Successful first install must create an active `app_release`, set `app_instances.current_release`, and project the app to `running_healthy` or `running_degraded`.
6. First install failure without a last-known-good release must clean up residual runtime state, persist `terminal_status=failed`, and must not enter rollback semantics.
7. The same install pipeline must support local execution as the MVP baseline and allow remote-target reuse through the same worker path without introducing a second orchestration path.
8. Operation detail, timeline, and execution logs must be queryable while the operation is active and after completion.

## Delivered Now

- [x] Manual Compose install creates `app_instances`, `app_operations`, `pipeline_runs`, and `pipeline_node_runs` on one shared execution contract.
- [x] The worker path advances the canonical execution phases and persists separate terminal result fields.
- [x] First install validates compose, prepares the workspace, runs compose apply, verifies runtime health, and updates the app projection.
- [x] Successful first install creates and activates the first `app_releases` baseline.
- [x] Failed first install records failure without inventing rollback semantics.
- [x] Operation detail, timeline, logs, cancellation, and stream updates are queryable during and after execution.

## Still Deferred

- [ ] Broader remote-target execution coverage beyond reusing the same executor contract.
- [ ] Richer verification and compensation behavior for non-install operation families.
- [ ] Expansion from install into upgrade, rollback, recover, and publication-sensitive operations.

## Dev Notes

- This story is the execution proof point for Epic 17 and the first real validation of the new lifecycle collections.
- The primary persistence contract for this story is `app_instances`, `app_operations`, `app_releases`, `pipeline_runs`, and `pipeline_node_runs`.
- `app_exposures` is not required for first install completion unless the install path explicitly includes publication, which MVP does not require.
- Do not let Store entry, Git retrieval, publication flows, or Installed-app management redefine this story's scope.
- If a feature cannot be explained as part of the first install closed loop, it probably belongs to 17.4, 17.5, or 17.6.

### References

- [Source: specs/implementation-artifacts/epic17-app-execution.md#Phase 1: First Install Closed Loop (Recommended Starting Point)]
- [Source: specs/implementation-artifacts/epic17-app-execution.md#Minimal Delivery Path]
- [Source: specs/adr/app-lifecycle-pocketbase-collections.md#3.1 `app_instances`]
- [Source: specs/adr/app-lifecycle-pocketbase-collections.md#3.2 `app_operations`]
- [Source: specs/adr/app-lifecycle-pocketbase-collections.md#3.3 `app_releases`]
- [Source: specs/adr/app-lifecycle-pocketbase-collections.md#3.5 `pipeline_runs`]
- [Source: specs/adr/app-lifecycle-pocketbase-collections.md#3.6 `pipeline_node_runs`]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List

- The current backend already proves the first install closed loop on the shared worker path.
- Release activation, app projection updates, and execution-log persistence happen inside the lifecycle execution flow.
- This story should now be treated as a reviewed MVP slice, not as future design work.


### File List
