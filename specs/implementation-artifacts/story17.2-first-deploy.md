# Story 17.2: First Deploy Closed Loop

Status: in-progress

## Story

As a platform operator,
I want a working first-deploy path from request to execution result,
so that the deploy engine is proven as a real closed loop before more adapters and recovery features expand scope.

## Acceptance Criteria

1. Support first deploy from ManualOps compose input through one shared async pipeline.
2. The first closed loop must create a deployment record, validate compose input, prepare the execution workspace, run compose apply, verify runtime health, and persist terminal status.
3. The worker execution path must use the canonical lifecycle progression `queued -> validating -> preparing -> running -> verifying -> success|failed`, with timeout and cancellation semantics available when needed.
4. First deploy failure without a last-known-good release must clean up residual runtime state instead of entering rollback.
5. The same deploy pipeline must support local execution as the MVP baseline and allow remote-target reuse through the same worker path without introducing a second orchestration path.
6. Deployment detail and execution logs must be queryable while the job is active and after completion.

## Tasks / Subtasks

- [ ] Implement first deploy execution flow (AC: 1,2,3)
  - [ ] Create deployment records from normalized manual compose input
  - [ ] Validate compose before execution
  - [ ] Prepare local or remote project workspace
  - [ ] Run compose apply and verification stages
- [ ] Implement failure semantics (AC: 3,4)
  - [ ] Distinguish first deploy cleanup from rollback flow
  - [ ] Persist timeout and failure summaries
- [ ] Keep one shared execution path (AC: 5)
  - [ ] Reuse the same worker contract across local and remote targets
  - [ ] Avoid target-specific lifecycle forks
- [ ] Expose runtime visibility (AC: 6)
  - [ ] Keep detail and log surfaces aligned with active execution

## Dev Notes

- This story is the execution proof point for Epic 17.
- Do not let Store entry, Git retrieval, or Installed-app operations redefine this story's scope.
- If a feature cannot be explained as part of the first deploy closed loop, it probably belongs to 17.4 or 17.5.

### References

- [Source: specs/implementation-artifacts/epic17-deploy.md#Phase 1: First Deploy Closed Loop (Recommended Starting Point)]
- [Source: specs/implementation-artifacts/epic17-deploy.md#Minimal Delivery Path]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List


### File List
