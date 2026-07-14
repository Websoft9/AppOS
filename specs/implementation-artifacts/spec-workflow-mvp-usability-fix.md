---
title: 'Workflow MVP Usability Fix'
type: 'bugfix'
created: '2026-07-14'
status: 'in-progress'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '4e29270'
context:
  - '{project-root}/specs/project-context.md'
  - '{project-root}/specs/implementation-artifacts/story36.5-workflow-web-mvp.md'
  - '{project-root}/specs/implementation-artifacts/epic36-workflow.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** The current Workflow feature looks present but misses key MVP behaviors from Epic 36 and Story 36.5. Operators cannot reliably select a target server, UI metadata is misleading because backend persistence derives from YAML, active runs are hard to observe, cancel is not runtime-truthful, and cron-triggered executions can fail when credentials or secrets are owned by a user rather than the synthetic `system` actor.

**Approach:** Tighten the Workflow feature into one truthful, usable MVP slice. Align the editor with YAML-backed persistence, replace free-text server entry with real server selection and name display, improve run observation and refresh, implement cooperative cancellation in the runner/worker path, and make workflow execution resolve server/AI credentials under a durable workflow execution actor that works for both manual and cron runs.

## Boundaries & Constraints

**Always:** Preserve the YAML-backed definition model as source of truth; keep using `pb.send` as the only frontend HTTP client; keep route/auth patterns consistent with existing superuser-only workflow mutations; prefer the smallest cross-layer changes that make current behavior truthful rather than expanding the product surface; verify with build, targeted tests, and browser-driven workflow page interaction.

**Block If:** Fixing cron/manual execution requires changing secret ownership semantics globally beyond workflow execution context; existing committed workflow code is internally inconsistent in a way that prevents a minimal safe patch.

**Never:** Introduce a visual DAG editor, redesign the whole workflow domain, add speculative new node types, or hardcode server/secret bypasses that weaken existing access controls.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Editor save happy path | Operator opens workflow editor, selects a server, edits YAML and metadata consistently, saves | Persisted workflow reflects the YAML-backed definition and the UI fields shown to the operator | No error expected |
| Invalid YAML | Operator enters malformed or invalid definition YAML | Save is blocked and the page shows actionable validation feedback | Surface validation error without persisting |
| Run detail observation | Operator opens runs for an active or waiting workflow | Run summary shows trigger/requester/timing/server truth and can be refreshed without closing the sheet | On fetch failure, preserve current data and show error |
| Cancel active run | Operator cancels a workflow while a node is running | Persisted run ends in cancelled state and the runner stops scheduling further nodes | If cancellation races with terminal completion, surface persisted final state truthfully |
| Cron run with owned credentials | Enabled cron workflow references a server or provider credential owned by a user | Cron-dispatched execution can resolve required credentials through workflow execution ownership | If the owner cannot be determined, fail clearly and persist the error |

</intent-contract>

## Code Map

- `web/src/routes/_app/_auth/_superuser/workflows.tsx` -- workflow list/editor/run detail UI and current usability gaps
- `web/src/lib/workflows-api.ts` -- workflow API client surface used by the UI
- `web/src/components/servers/server-detail-shared.ts` -- shared server read model type reused for server display/selection
- `backend/domain/routes/workflows.go` -- workflow HTTP endpoints and run/cancel/approve behavior
- `backend/domain/workflow/model.go` -- YAML definition contract and validation rules
- `backend/domain/workflow/service.go` -- definition persistence shaping and workflow service logic
- `backend/domain/workflow/engine.go` -- workflow run preparation path
- `backend/domain/workflow/runner.go` -- ready-node execution loop and cancellation behavior
- `backend/domain/workflow/executors.go` -- server-target, AI, and template execution semantics
- `backend/domain/worker/workflow.go` -- Asynq workflow task handler
- `backend/cmd/appos/bootstrap/cron.go` -- cron dispatch path for workflow runs
- `backend/domain/routes/workflows_test.go` -- route-level regression coverage
- `web/src/routes/_app/_auth/_superuser/-workflows.test.tsx` -- workflow UI regression coverage

## Tasks & Acceptance

**Execution:**
- [ ] `web/src/routes/_app/_auth/_superuser/workflows.tsx` -- replace raw server ID entry with server selection, make editor metadata truthful for YAML-backed persistence, display server names, add run summary/refresh behavior, and keep cancel/run actions aligned with persisted truth -- closes the main Story 36.5 usability gaps.
- [ ] `web/src/lib/workflows-api.ts` and related frontend types/usages -- add any small client helpers needed for server lookup or refreshed run detail loading -- keeps UI integration minimal and consistent.
- [ ] `backend/domain/workflow/service.go`, `engine.go`, `runner.go`, `executors.go`, `worker/workflow.go`, and `cmd/appos/bootstrap/cron.go` -- carry a durable execution actor/owner through prepared runs, make cancellation cooperative and truthful, and ensure cron/manual runs can resolve required credentials without bypassing existing access rules -- restores MVP execution semantics.
- [ ] `backend/domain/routes/workflows.go` -- return and update workflow run state in ways the improved UI can observe truthfully, especially around cancellation and run detail refresh -- keeps API and UI behavior aligned.
- [ ] `backend/domain/routes/workflows_test.go` and `web/src/routes/_app/_auth/_superuser/-workflows.test.tsx` -- cover server selection/display, validation failure, run detail observation, and cancellation/runtime ownership regressions -- protects the repaired MVP slice.

**Acceptance Criteria:**
- Given a superuser editing a workflow, when the editor is opened, then the target server is selectable from real servers and the displayed metadata does not disagree with the YAML definition that will be persisted.
- Given an invalid workflow definition, when the operator tries to save, then persistence is blocked and the UI shows a concrete validation error.
- Given a workflow with existing runs, when the operator opens run detail, then the UI shows trigger type, requester, timing, target server, node statuses, and can refresh without closing the sheet.
- Given an active workflow run, when the operator cancels it, then the persisted final state remains truthful and no further nodes are scheduled after cancellation is observed.
- Given an enabled cron workflow that uses valid bound server/provider credentials, when the cron dispatcher starts a run, then the workflow can resolve those credentials through workflow execution ownership instead of failing solely because the trigger actor is `system`.

## Spec Change Log

## Review Triage Log

## Design Notes

The smallest safe slice is to make workflow execution own a durable actor distinct from the trigger actor. Manual runs can still record who requested them, but runtime credential resolution should use the workflow creator/owner so that cron and superuser-triggered runs behave consistently with the definition they are executing.

For the UI, the key principle is truthfulness over convenience: fields shown outside YAML must either be derived from YAML or kept synchronized with it so the operator is never editing one thing while persisting another.

## Verification

**Commands:**
- `make build` -- expected: backend and web build succeed
- `make test backend-targeted TARGET=TestWorkflow` -- expected: workflow backend regression tests pass
- `cd web && npx vitest run src/routes/_app/_auth/_superuser/-workflows.test.tsx` -- expected: workflow UI regression tests pass

**Manual checks (if no CLI):**
- Open `http://cdl.dev.websoft9.cn:9091`, sign in with the superuser from `build/.env`, navigate to Workflow, create/edit/run/cancel using simulated inputs, and verify the page behavior matches the acceptance criteria.
