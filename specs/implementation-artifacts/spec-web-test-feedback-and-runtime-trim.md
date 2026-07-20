---
title: 'Web test feedback and runtime trim'
type: 'chore'
created: '2026-07-11'
status: 'done'
baseline_revision: '27c1373'
review_loop_iteration: 0
followup_review_recommended: false
final_revision: '27c1373'
context:
  - '../project-context.md'
warnings:
  - 'multiple-goals'

<intent-contract>

## Intent

**Problem:** Local `make test web` appears hung because output is buffered until Vitest exits, while several feeds and servers UI tests are heavy enough to take tens of seconds or hit timeout thresholds. This degrades developer feedback and makes the web test suite feel unreliable even when it eventually completes.

**Approach:** Keep CI-friendly failure signaling, but restore live progress for local web test runs and trim the slowest tests by reducing unnecessary dataset size, repeated wait cycles, and overly broad interaction flows without weakening the behavior each test proves.

## Boundaries & Constraints

**Always:** Preserve current test coverage intent; keep `make test web` compatible with existing `npm test` usage; prefer local-only ergonomics improvements over CI-specific churn; keep assertions focused on user-visible behavior rather than implementation details.

**Block If:** Runtime reduction would require deleting a behavior check with no smaller equivalent, or the Makefile change would break CI failure detection semantics.

**Never:** Do not change application production behavior just to make tests faster; do not hide failing tests by increasing timeouts alone; do not introduce watch-mode behavior into `make test web`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Local web tests | Developer runs `make test web` in terminal | Vitest progress is visible while tests run and failures still surface clearly | Non-zero exit must still fail the make target |
| Multi-page feeds loading | Feed list spans multiple pages | Test still proves repeated bottom-scroll loading across several page fetches | No error expected |
| Slow dialog/list settings tests | Servers UI tests need async menu/dialog updates | Tests remain behaviorally equivalent while using tighter waits or smaller interaction surface | No error expected |

</intent-contract>

## Code Map

- `Makefile` -- local vs CI web-test logging and failure propagation for `make test web` and the generic JS test path.
- `web/src/routes/_app/_auth/-feeds.test.tsx` -- feeds UI integration tests, including article actions, bookmark workflows, and repeated bottom-scroll pagination.
- `web/src/routes/_app/_auth/resources/-servers.test.tsx` -- servers UI tests for list settings and inline secret editing flows.


## Tasks & Acceptance

**Execution:**
- [x] `Makefile` -- make local `make test web` stream Vitest output while preserving non-zero failure behavior and concise CI semantics -- removes the “hung” local feedback problem.
- [x] `web/src/routes/_app/_auth/-feeds.test.tsx` -- reduce the runtime cost of the heaviest feeds tests by shrinking unnecessary fixture size and tightening async waits while preserving pagination/reader-action intent -- removes the current timeout hotspot.
- [x] `web/src/routes/_app/_auth/resources/-servers.test.tsx` -- reduce the slowest server test runtimes by trimming redundant waits and over-broad interaction sequences without reducing assertions -- addresses the third “search and fix while investigating” requirement.
- [x] `web` tests -- run targeted Vitest commands and `make test web` to verify the optimized suite still passes end to end -- proves the changes improved runtime without breaking test coverage.

**Acceptance Criteria:**
- Given a local terminal run of `make test web`, when Vitest is executing, then progress output is visible before the suite exits and failures still make the target fail.
- Given the feeds pagination regression test, when repeated bottom-scroll loads are simulated, then the test still proves incremental page loading across multiple fetches without relying on an oversized 148-item dataset or timing out.
- Given the slowest servers UI tests, when they complete, then they still cover list settings and inline secret editing behavior with materially lower runtime and no assertion loss.

## Review Triage Log

### 2026-07-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 1, medium 0, low 0)
- defer: 0
- reject: 4: (high 0, medium 3, low 1)
- addressed_findings:
  - `[high]` `[patch]` restored fast-mode web test failure propagation in `Makefile` so CI cannot silently pass on web-test failures.

## Design Notes

Prefer reducing runtime by shrinking mock data and collapsing unnecessary polling boundaries before touching timeout ceilings. For Makefile behavior, local streaming and CI readability can coexist by branching on `CI` rather than forcing one logging style for every environment.

The repeated-scroll feeds test only needs enough rows to cross multiple pagination boundaries. Reducing it from 148 to 41 preserves the behavior under test while removing the jsdom rendering cost that was driving the previous timeout.

The servers optimizations stay inside test setup and interaction scope. They avoid changing product behavior and instead narrow fixtures to what each test actually asserts.

## Verification

**Commands:**
- `cd /data/dev/appos/web && npx vitest run src/routes/_app/_auth/-feeds.test.tsx src/routes/_app/_auth/resources/-servers.test.tsx --reporter=verbose` -- expected: both optimized slow files pass; observed: 2 files, 46 tests passed in 29.56s.
- `cd /data/dev/appos && make test web` -- expected: live Vitest progress is visible locally and the full web suite passes; observed: 76 files, 550 tests passed in 191.31s.

## Auto Run Result

Status: done

Summary: Improved local web-test feedback by streaming Vitest output outside CI, reduced the heaviest feeds pagination test to a smaller multi-page fixture, split bookmark-heavy reader coverage into a focused test, and trimmed the slowest servers test flows with narrower fixtures and waits.

Files changed:
- `Makefile` — split local vs CI web-test logging paths and preserved explicit failure handling in both strict and fast flows.
- `web/src/routes/_app/_auth/-feeds.test.tsx` — added shared paged-feed fixture helper, reduced repeated-scroll data volume, and split bookmark-heavy coverage out of the article reader flow.
- `web/src/routes/_app/_auth/resources/-servers.test.tsx` — simplified list-settings assertions and isolated the inline secret-edit test onto a minimal fixture.

Review findings breakdown: 1 high-severity patch applied; 0 deferred; 4 rejected as non-actionable or not caused by this change set.

Verification performed: targeted Vitest run for the two optimized files passed; full `make test web` passed with live progress visible locally.

Residual risks: the full web suite is still large, so overall wall-clock remains substantial even though the primary hotspots were reduced. Pre-existing test warnings from i18next, router-devtools, Radix dialog accessibility, and jsdom canvas remain unchanged.