---
title: 'Make Gate Output Cleanup'
type: 'refactor'
created: '2026-07-28'
status: 'in-progress'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '4ad4a646b1f731a43a394bb7dee5a4e4fd75f608'
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** `Makefile` Testing & Quality commands currently emit repeated multi-layer error summaries that make failures noisy and harder to scan. The output also lacks a consistent, centralized color model for failure and success summaries.

**Approach:** Refactor the Testing & Quality command family to use one shared shell helper model for colored summary lines, preserve raw tool output, reduce intermediate duplicate summaries, and keep final stage/gate rollups concise and actionable.

## Boundaries & Constraints

**Always:** Preserve current command coverage and execution order; keep leaf command raw logs intact; reduce duplicate summary layers rather than removing end-of-stage visibility entirely; support red error summaries and green success summaries; degrade cleanly when color is disabled or unsupported; re-run every affected command after implementation.

**Block If:** The new output model would require changing unrelated non-Testing/Quality command behavior outside the targeted Makefile section.

**Never:** Remove the actual underlying tool output; silently skip failing steps; introduce shell behavior that depends on interactive prompts; change gate semantics just to simplify printing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| LEAF_FAILURE | A leaf command like lint, test, or source security fails | Raw tool output is shown once, followed by one concise colored leaf summary | Parent stage captures failure for final rollup |
| STAGE_FAILURE | A composite command like `make qa check` or `make sec source` has one or more child failures | Child failures remain visible, stage summary is concise, and final gate rollup stays readable | Exit non-zero after reporting failed child stages |
| NO_COLOR | `NO_COLOR=1` or non-TTY context | Messages remain readable without ANSI escape noise | No special error expected |

</intent-contract>

## Code Map

- `Makefile` -- owns all Testing & Quality targets, summary printing, and gate aggregation behavior.

## Tasks & Acceptance

**Execution:**
- [ ] `Makefile` -- add reusable shell-level color/output helpers for info, success, warning, and error summaries with color-safe fallback behavior -- centralizes presentation logic.
- [ ] `Makefile` -- refactor `test`, `qa`, `sec`, `gate`, and their `_test-*`, `_qa-*`, `_sec-*` leaf targets to reduce duplicate summary layers while preserving raw failure logs -- produces cleaner output without changing gate semantics.
- [ ] `Makefile` -- verify every affected command path at least once after refactor, including success and failing/usage branches where practical -- ensures the new output model is real, not assumed.

**Acceptance Criteria:**
- Given a Testing & Quality leaf command fails, when it runs, then raw tool output remains visible and the summary line is concise and colored red when color is enabled.
- Given a composite stage like `qa`, `sec`, or `gate` fails, when it finishes, then it prints a single concise stage summary instead of repeating all nested summaries.
- Given `NO_COLOR=1` or a non-interactive environment is used, when the same commands run, then the output remains readable without raw ANSI sequences.

## Spec Change Log

## Review Triage Log

## Design Notes

The key tradeoff is to keep the Makefile behavior end-to-end visible while collapsing summary duplication. The cleanest approach is to let leaf targets own detailed failure labels, let composite targets own one-line stage labels, and let `gate` own the final top-level rollup.

## Verification

**Commands:**
- `make test backend TARGET=./domain/secrets/...` -- expected: backend leaf target still reports success cleanly.
- `make test web` -- expected: web leaf target still reports success cleanly.
- `make test e2e runtime` -- expected: e2e runtime leaf target still reports success cleanly.
- `make qa lint` -- expected: lint stage runs with new summary model.
- `make qa format` -- expected: format stage runs with new summary model.
- `make qa openapi` -- expected: openapi stage runs with new summary model.
- `make qa check` -- expected: composite QA stage runs with concise rollup.
- `make sec source` -- expected: source security stage runs with concise rollup.
- `make test e2e smoke` -- expected: smoke stage runs with concise rollup.
- `make gate pr` -- expected: top-level gate summary is clean.
- `make gate merge` -- expected: merge gate still passes with unchanged semantics.
