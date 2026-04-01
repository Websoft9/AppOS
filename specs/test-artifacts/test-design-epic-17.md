---
stepsCompleted: ['step-02-load-context', 'step-03-risk-and-testability', 'step-04-coverage-plan', 'step-05-generate-output']
inputDocuments:
  - specs/planning-artifacts/prd.md
  - specs/planning-artifacts/architecture.md
  - specs/implementation-artifacts/epic17-app-execution.md
  - specs/implementation-artifacts/iteration2-epic17-install-resolution-convergence-slice.md
  - specs/implementation-artifacts/story17.4e-a-resolver-boundary-consolidation.md
  - backend/domain/routes/deploy_test.go
  - backend/domain/lifecycle/service/install_preflight_test.go
date: '2026-04-01'
epic_num: '17'
epic_title: 'Lifecycle Execution Core'
story_scope: '17.4e-A Resolver Boundary Consolidation'
status: 'Draft'
---

# Test Design: Epic 17 - Lifecycle Execution Core

**Date:** 2026-04-01
**Author:** Websoft9
**Status:** Draft

---

## Executive Summary

**Scope:** Epic-level test design focused on Story 17.4e-A `Resolver Boundary Consolidation` inside Epic 17.

This slice is backend-heavy and testable without browser automation. The dominant risk is semantic drift between install `check` and install `create` paths after the ingress-boundary refactor. Existing route tests already prove some positive-path parity for Manual Compose and Git Compose, plus helper-level preflight coverage, but there are still material gaps in negative-path parity, service-boundary isolation, and route-local shaping regression detection.

**Risk Summary:**

- Total risks identified: 7
- High-priority risks (score >= 6): 4
- Critical categories: TECH, DATA, BUS, OPS

**Coverage Summary:**

- P0 scenarios: 4
- P1 scenarios: 6
- P2 scenarios: 4
- P3 scenarios: 2
- **Estimated effort**: ~4-7 days

---

## Not in Scope

| Item | Reasoning | Mitigation |
| --- | --- | --- |
| Resolution preview UI | Story 17.4e-E owns backend-authored preview and create-page consumption | Defer to preview API coverage once contract stabilizes |
| Worker pipeline redesign | Story explicitly excludes queue or worker contract redesign | Keep regression assertions at ingress and orchestration boundaries only |
| Publication execution and certificate flows | This slice preserves intent shape, not publish execution | Cover exposure intent normalization only; publication execution belongs to later slices |
| Full end-to-end browser flows | No meaningful UI change in this slice; backend semantics are the risk center | Prefer Go route/service tests for fast signal and lower flake rate |

---

## Evidence Base

Artifacts reviewed:

- PRD and architecture baseline for AppOS single-server PocketBase + React architecture
- Epic 17 planning artifacts and Iteration 2 convergence slice
- Story 17.4e-A acceptance criteria and delivered-now notes
- Current route tests in `backend/domain/routes/deploy_test.go`
- Current service tests in `backend/domain/lifecycle/service/install_preflight_test.go`

Existing relevant coverage observed:

- Positive-path parity tests for Manual Compose `check` vs `create`
- Positive-path parity tests for Git Compose `check` vs `create`
- Preflight helper coverage for disk metadata parsing, published-port extraction, and blocking-resource evaluation

Important gaps observed:

- No explicit negative-path parity matrix for invalid compose/env/exposure across both `check` and `create`
- Limited direct service-level tests for the shared ingress builder introduced by this slice
- No explicit regression test proving route handlers stopped owning lifecycle-meaningful normalization rules
- Limited coverage for source-specific auth/fetch failure behavior after convergence

---

## Risk Assessment

### High-Priority Risks (Score >= 6)

| Risk ID | Category | Description | Probability | Impact | Score | Mitigation | Owner | Timeline |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-001 | TECH | `check` and `create` drift in normalized spec fields after refactor, especially project name, source, adapter, env, metadata, and exposure intent | 3 | 3 | 9 | Add shared-contract parity tests at route and service layers; block merge on parity mismatch | Backend | Before story review |
| R-002 | DATA | Invalid or partial normalization of env/metadata/exposure causes persisted operation specs to differ from validation specs | 2 | 3 | 6 | Add negative and mixed-type input tests covering env booleans, numeric ports, metadata merge, and invalid exposure fields | Backend | Before story review |
| R-003 | BUS | Operator sees a successful preflight but queued action behaves differently, breaking trust in install flow | 2 | 3 | 6 | Assert semantic equivalence for success and rejection paths; add conflict and bad-request parity tests | Backend + QA | Before story review |
| R-004 | OPS | Route-local shaping remains duplicated, so future edits reintroduce divergence silently | 3 | 2 | 6 | Add service-focused ingress builder tests and keep route tests limited to transport/auth wiring | Backend | This slice |

### Medium-Priority Risks (Score 4-5)

| Risk ID | Category | Description | Probability | Impact | Score | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-005 | OPS | Git raw URL auth/fetch behavior diverges between `check` and `create` under private repository access | 2 | 2 | 4 | Add parity tests for auth header success and fetch failure semantics | Backend |
| R-006 | TECH | Preflight resource warnings versus blocking statuses regress during helper refactor | 2 | 2 | 4 | Expand service tests for warning/conflict/failed state transitions | Backend |
| R-007 | DATA | App-required disk metadata conversion from bytes vs GiB overwrites unexpectedly | 2 | 2 | 4 | Add explicit normalization tests for precedence and round-trip expectations | Backend |

### Residual Low Risks (Score 1-3)

| Risk ID | Category | Description | Probability | Impact | Score | Action |
| --- | --- | --- | --- | --- | --- | --- |
| R-008 | PERF | Added builder/helper indirection creates negligible latency in request handling | 1 | 2 | 2 | Monitor only |
| R-009 | SEC | This slice does not introduce new auth model, only reuses existing request auth | 1 | 2 | 2 | Monitor only |

### Risk Category Legend

- **TECH**: Architecture and normalization-boundary correctness
- **SEC**: Authentication or data exposure risk
- **PERF**: Throughput or latency degradation
- **DATA**: Incorrect persisted or derived lifecycle data
- **BUS**: User-visible product trust and flow correctness
- **OPS**: Maintainability, operational regressions, deployment safety

---

## Entry Criteria

- [ ] Story 17.4e-A acceptance criteria remain stable for this review cycle
- [ ] Current route and service tests run green on baseline branch
- [ ] Test environment can exercise Manual Compose and Git Compose route handlers
- [ ] Private raw URL fixture or stub server available for auth-header scenarios
- [ ] Team agrees that this slice is backend-only and excludes preview UI validation

## Exit Criteria

- [ ] All P0 scenarios pass
- [ ] All P1 scenarios pass or have triaged waivers with owners
- [ ] No open TECH/DATA/BUS risk >= 6 without mitigation
- [ ] Route and service coverage prove parity for both success and invalid-input paths
- [ ] Team accepts residual OPS risk related to future source-candidate work as deferred to 17.4e-B/C

---

## Test Coverage Plan

Priority legend: `P0/P1/P2/P3` expresses business and risk priority, not execution timing.

### P0

**Criteria:** Blocks core install validation/creation correctness, high risk, no acceptable workaround.

| Scenario | Requirement / Risk Link | Test Level | Owner | Notes |
| --- | --- | --- | --- | --- |
| Manual Compose `check` and `create` produce identical normalized spec for project/source/adapter/env/exposure/metadata | AC1, AC4, R-001, R-003 | API | Backend | Existing positive-path test; retain as merge gate |
| Git Compose `check` and `create` produce identical normalized spec including source metadata from fetch path | AC1, AC4, R-001, R-003 | API | Backend | Existing positive-path test; extend when metadata fields evolve |
| Invalid compose payload returns equivalent bad-request semantics for `check` and `create` | AC5, R-002, R-003 | API | Backend | Currently missing; highest-value regression guard |
| Invalid env/exposure payload yields equivalent rejection or sanitized normalization across both paths | AC1, AC3, R-002 | API + Integration | Backend | Covers mixed-type ingress and exposure intent handling |

### P1

**Criteria:** Important contract and maintainability coverage for this slice.

| Scenario | Requirement / Risk Link | Test Level | Owner | Notes |
| --- | --- | --- | --- | --- |
| Shared ingress builder clones env, exposure intent, and metadata without aliasing mutable maps | AC1, AC2, R-004 | Unit | Backend | Needed to prove lifecycle service owns semantics |
| Route handlers keep transport/auth concerns only; normalization semantics live in service builder | AC2, AC3, R-004 | Integration | Backend | Assert route helper output delegates to service-owned contract |
| Duplicate app-name conflict parity is preserved between `check` and `create` | AC4, R-003 | API | Backend | Existing check-only behavior should be paired with create-path assertion |
| Git raw URL auth-header success/failure semantics stay consistent after convergence | AC5, R-005 | API | Backend | Private repo path is a likely regression hotspot |
| Disk metadata normalization handles `app_required_disk_bytes` and `app_required_disk_gib` deterministically | AC5, R-007 | Unit + Integration | Backend | Existing parser tests cover partial behavior only |
| Preflight-plus-create orchestration still returns expected operation family and lifecycle envelope after boundary cleanup | AC4, R-001 | Integration | Backend | Protects service-owned orchestration path |

### P2

**Criteria:** Secondary but useful regression and helper coverage.

| Scenario | Requirement / Risk Link | Test Level | Owner | Notes |
| --- | --- | --- | --- | --- |
| Resource warning vs blocking statuses remain unchanged for disk/docker/port checks | R-006 | Unit | Backend | Existing coverage present; extend only if helper logic changes |
| Published-port extraction handles mixed short and long compose syntax | AC5 | Unit | Backend | Existing helper coverage already present |
| Manual Compose default server handling and normalized compose project naming remain stable | AC5 | API | Backend | Good low-cost protection for future refactors |
| Git metadata merge preserves repository_url/ref/compose_path/raw_url plus user metadata | AC2, R-002 | Integration | Backend | Confirms source-specific attribution survives convergence |

### P3

**Criteria:** Nice-to-have coverage or deferred exploratory checks.

| Scenario | Requirement / Risk Link | Test Level | Owner | Notes |
| --- | --- | --- | --- | --- |
| Light exploratory review of logs/messages for operator clarity on parity failures | R-003 | Manual | QA | Low automation value for this slice |
| Micro-benchmark around builder/helper overhead | R-008 | Unit | Backend | Only if performance concern appears in review |

---

## Execution Strategy

Use a simple `PR / Nightly / Weekly` model.

### PR

- Run all functional Go tests covering route, service, and orchestration layers for lifecycle install flows
- Keep this slice browser-free unless a later UI contract is added
- Target <15 minutes total by favoring unit, integration, and API tests over E2E

### Nightly

- Run full backend lifecycle regression suite including broader worker/orchestration tests
- Include auth-header remote fetch variants and any larger fixture combinations that would slow PR feedback

### Weekly

- Run any heavier exploratory checks, log review, and optional micro-benchmarks
- Revisit deferred P2/P3 scenarios if candidate-input scope expands

---

## Execution Order

1. Unit helpers: ingress builder cloning, disk metadata normalization, resource-check blocking logic
2. API parity tests: Manual Compose and Git Compose success and invalid-input paths
3. Integration tests: preflight-plus-create orchestration and route-to-service boundary assertions
4. Extended nightly regressions: auth-header fetch paths, metadata merge breadth, exploratory diagnostics

---

## Resource Estimates

| Priority | Estimated Effort | Notes |
| --- | --- | --- |
| P0 | ~10-16 hours | New negative-path parity tests and hard release gate coverage |
| P1 | ~12-18 hours | Service-boundary assertions and orchestration regressions |
| P2 | ~4-8 hours | Low-cost helper and metadata regression coverage |
| P3 | ~1-3 hours | Exploratory or benchmark-only work |
| **Total** | **~27-45 hours** | **~4-7 days depending on fixture reuse and failure triage** |

### Prerequisites

**Test Data / Fixtures**

- Existing `newTestEnv` route harness in backend route tests
- Stub HTTP server for Git raw URL fetch scenarios
- Minimal compose payload fixtures for success, duplicate, invalid, and auth-protected cases

**Tooling**

- `go test` for backend route/service/orchestration suites
- Standard httptest server support for remote compose retrieval simulations

**Environment**

- Local backend test execution with PocketBase test env support
- No browser or external Docker daemon dependency required for most parity scenarios

---

## Quality Gate Criteria

### Pass / Fail Thresholds

- **P0 pass rate**: 100%
- **P1 pass rate**: >=95%
- **P2/P3 pass rate**: >=90% informational
- **High-risk mitigations complete**: 100% for R-001 through R-004 before release from story review

### Coverage Targets

- Critical parity scenarios: >=80%
- Invalid-input parity scenarios: 100% for compose/env/exposure paths touched by this slice
- Source-specific metadata normalization: >=80%
- Helper-level normalization edge cases: >=70%

### Non-Negotiable Requirements

- [ ] All P0 tests pass
- [ ] No open parity defect where `check` and `create` disagree on normalization outcome
- [ ] No unmitigated TECH/DATA/BUS risk with score >= 6
- [ ] Route-local shaping must not reintroduce lifecycle-meaningful normalization outside service boundary

---

## Mitigation Plans

### R-001: Semantic drift between `check` and `create` (Score: 9)

**Mitigation Strategy:**

1. Keep positive-path parity tests mandatory for Manual Compose and Git Compose
2. Add invalid-input parity cases for compose/env/exposure
3. Require any new normalization field to be asserted in both paths before merge

**Owner:** Backend
**Timeline:** Before story review
**Status:** In progress
**Verification:** Route test suite proves equivalent spec or equivalent rejection for both entry paths

### R-002: Incorrect normalized env/metadata/exposure persistence (Score: 6)

**Mitigation Strategy:**

1. Add unit tests for builder cloning and normalization helpers
2. Add integration assertions for merged metadata and exposure intent shape
3. Review precedence rules for disk metadata fields explicitly

**Owner:** Backend
**Timeline:** This slice
**Status:** Planned
**Verification:** Unit + integration tests cover mixed inputs and precedence rules

### R-003: Preflight result diverges from queued-action behavior (Score: 6)

**Mitigation Strategy:**

1. Treat parity mismatch as release-blocking for this story
2. Add conflict and bad-request equivalence tests
3. Preserve operator-visible semantics where `ok/message/spec` differ only for side-effect reasons

**Owner:** Backend + QA
**Timeline:** Before story review
**Status:** Planned
**Verification:** Route-level parity matrix across success, duplicate, and invalid cases

### R-004: Route-local normalization duplication survives refactor (Score: 6)

**Mitigation Strategy:**

1. Add direct service-builder tests
2. Keep route tests focused on transport inputs and outputs
3. Flag any new route-local normalization helper as review concern

**Owner:** Backend
**Timeline:** This slice
**Status:** Planned
**Verification:** Test additions plus code review show normalization is service-owned

---

## Open Assumptions

1. Story 17.4e-A remains backend-only for the current iteration.
2. Private Git fetch scenarios can be fully simulated with httptest rather than real network dependencies.
3. Current existing parity tests represent the intended product contract and should be strengthened, not replaced.
4. Candidate-input model work in 17.4e-B/C will add new scenarios later; this document covers only current compose-backed ingress.

---

## Recommended Next Workflow

- `AT` if you want failing acceptance tests for the P0 matrix before more refactor work
- `TA` if you want me to directly expand the missing P0/P1 automated tests in code
