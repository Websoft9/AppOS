---
title: 'System Cron Effective Interval and Monitor Defaults'
type: 'feature'
created: '2026-07-08'
baseline_revision: '0d139e664c016474eea94507751edd26cc42710a'
baseline_commit: '0d139e664c016474eea94507751edd26cc42710a'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/specs/project-context.md'
warnings:
  - multiple-goals
---

<intent-contract>

## Intent

**Problem:** Monitor reachability-related jobs still default to aggressive one-minute effective intervals, the System Cron list does not proactively show `Last Status` and `Last Run`, and the page has no way to communicate the user-facing cadence when monitor jobs are gated by monitor scheduling settings instead of their raw cron expression.

**Approach:** Lower the relevant monitor scheduling defaults to 60 minutes, keep the existing fixed one-minute cron ticks, preload log summaries for list display, add a minimal `Effective Interval` column derived from monitor scheduling settings for gated jobs, and surface help text in monitor settings so users understand the allowed interval range and the relationship between configured cadence and raw cron schedule.

## Boundaries & Constraints

**Always:** Preserve the current backend model of static cron registration plus runtime interval gating; keep changes minimal and within existing system cron and monitor settings surfaces; use existing settings schema/help-text rendering instead of introducing custom frontend copy blocks where possible; keep native PocketBase cron jobs readable even when no AppOS summary exists; run `make build`, `make test`, and browser verification against the deployed app.

**Block If:** Browser authentication cannot be completed from the checked-in environment details; local build or test failures are caused by unrelated pre-existing issues that prevent verification of the touched areas; system cron summaries require backend API shape changes that conflict with existing consumers.

**Never:** Do not redesign cron scheduling to dynamically re-register jobs; do not add new dependencies; do not change non-reachability monitor defaults beyond what the request needs; do not remove the raw `Schedule` column or hide PocketBase-native jobs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Monitor defaults fallback | No persisted `monitor/scheduling` row | Reachability-related settings use 60-minute defaults and settings UI hydrates the same values | Settings API continues returning validated fallback payload |
| Cron list initial load | System Cron page loads with AppOS monitor jobs and settings fetch succeeds | `Last Status`, `Last Run`, and `Effective Interval` populate without opening the log drawer | Per-job summary fetch failures degrade to `—` without breaking the table |
| Native or untracked cron job | Cron row has no monitor gating or no AppOS terminal logs | `Effective Interval` falls back to raw schedule semantics or `—` where no better value exists; `Last Status`/`Last Run` remain placeholder-safe | No row-level crash; actions still work |
| User edits monitor interval | Superuser changes monitor scheduling interval in settings | Help text communicates valid minimum/range expectations while saved values continue driving effective interval display | Validation errors remain inline from existing settings API |

</intent-contract>

## Code Map

- `backend/domain/monitor/settings.go` -- runtime default scheduling values consumed by cron handlers.
- `backend/domain/config/sysconfig/schema/schema.go` -- settings schema metadata and fallback defaults rendered by the frontend settings UI.
- `backend/domain/routes/settings_test.go` -- backend coverage for settings fallback/default payloads.
- `web/src/routes/_app/_auth/_superuser/system-tasks.tsx` -- System Cron table, log drawer, run action, and list-fetch behavior.
- `web/src/routes/_app/_auth/_superuser/-system-tasks.test.tsx` -- System Cron page regression coverage.
- `web/src/routes/_app/_auth/_superuser/-settings-sections/monitor-section.tsx` -- existing help text rendering for monitor settings fields.

## Tasks & Acceptance

**Execution:**
- [x] `backend/domain/monitor/settings.go` and `backend/domain/config/sysconfig/schema/schema.go` -- change reachability-related monitor scheduling defaults to 60 minutes and add concise help text/range guidance for monitor scheduling fields -- align runtime fallback, settings fallback, and UI guidance.
- [x] `backend/domain/routes/settings_test.go` and `backend/domain/routes/settings_rules.go` -- extend fallback/default assertions and enforce the documented `1-1440` monitor scheduling range -- prevent drift between settings guidance and backend validation.
- [x] `web/src/routes/_app/_auth/_superuser/system-tasks.tsx` -- preload cron log summaries for list display, add an `Effective Interval` column, and map monitor job IDs to configured effective intervals while keeping non-monitor rows minimal and safe -- solve the blank summary problem and expose user-facing cadence semantics.
- [x] `web/src/routes/_app/_auth/_superuser/-system-tasks.test.tsx` -- cover summary preloading, settings-fetch fallback, and effective interval rendering -- lock down the new cron list behavior.
- [x] Browser verification against the deployed app -- hot-reload the local container with `make run`, verify `System Tasks` shows `Effective Interval` plus populated `Last Status`, and verify `Settings > Monitor` shows the new help text and rejects `1441` before restoring the persisted value to `10`.

**Acceptance Criteria:**
- Given no persisted monitor scheduling entry, when the settings API or monitor settings UI loads, then `reachabilityIntervalMinutes` and `controlReachabilityIntervalMinutes` default to 60 and the scheduling field help text communicates the valid interval floor/range.
- Given the System Cron page loads with AppOS cron logs available, when the list renders, then `Last Status` and `Last Run` are visible without opening the log drawer.
- Given a monitor cron row whose effective cadence is controlled by monitor scheduling settings, when the System Cron list renders, then an `Effective Interval` column shows the user-facing interval derived from current settings rather than the fixed one-minute cron tick.
- Given a cron row with no effective-interval mapping or no AppOS summary logs, when the list renders, then the row still renders safely with minimal placeholder output and working actions.
- Given a user changes the monitor scheduling interval, when the value saves successfully, then later System Cron loads reflect the new effective interval while the raw cron `Schedule` column remains unchanged.

## Spec Change Log

## Review Triage Log

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 1, medium 1, low 0)
- defer: 1: (high 0, medium 1, low 0)
- reject: 1: (high 0, medium 0, low 1)
- addressed_findings:
  - `[high] [patch]` Enforced the documented `1-1440` monitor scheduling range in backend validation and added a route test for invalid `1441` input.
  - `[medium] [patch]` Sanitized monitor scheduling interval parsing in the System Cron UI and added a fallback test so settings fetch failures cannot render `NaN min`.

### 2026-07-08 — Final review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 1: (high 0, medium 0, low 1)
- addressed_findings:
  - none

## Design Notes

The blank `Last Status` / `Last Run` behavior is currently self-inflicted by the frontend: the list page stores summaries only after the log drawer fetch completes. The minimal fix is to background-fetch summaries after `/api/crons` resolves instead of changing backend route shape.

`Effective Interval` should explicitly explain the runtime-gated cadence confusion that triggered the request. For gated monitor jobs, derive a friendly minutes-based string from current monitor settings. For non-gated jobs, keep output minimal; the raw `Schedule` column remains the source of truth.

## Verification

**Commands:**
- `make build` -- expected: backend and web build succeed.
- `make test` -- expected: backend and web test suites pass.

**Manual checks (if no CLI):**
- Log into the deployed app, open `Settings > System > Monitor`, and confirm the scheduling defaults/help text reflect the new reachability defaults and interval guidance.
- Open `System Tasks`, verify `Last Status`, `Last Run`, and `Effective Interval` render as expected for monitor rows, and confirm raw `Schedule` still shows `*/1 * * * *` for gated monitor jobs.

## Auto Run Result

Status: done
Summary:
- Lowered the reachability scheduling fallback default to 60 minutes while leaving raw monitor cron ticks at one minute.
- Fixed the System Cron list to preload summaries, show `Last Status`, and add an `Effective Interval` column that reflects monitor settings or parsed cron cadence.
- Added monitor scheduling help text plus enforced `1-1440` validation and verified it interactively in the browser after `make run` hot reload.