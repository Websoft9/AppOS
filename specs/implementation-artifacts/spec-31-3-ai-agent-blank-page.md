---
title: 'Fix ai-agent blank page'
type: 'bugfix'
created: '2026-07-12'
status: 'done'
baseline_revision: '6038e5e2559dbf32cce4167d8a22e87fb8718dfa'
final_revision: '6038e5e2559dbf32cce4167d8a22e87fb8718dfa'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/specs/implementation-artifacts/epic-31-context.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** The authenticated `/ai-agent` page loads its AppOS shell and OpenCode iframe, but the embedded OpenCode SPA renders as a blank gray panel. Browser investigation shows the upstream HTML, CSS, JS, and startup APIs all load, yet the SPA only renders an empty root shell when served under the `/api/ai/agent` proxy prefix.

**Approach:** Keep the reverse proxy and OpenCode upstream in place, but make the embedded mode initialize OpenCode against a root-like client route so the SPA can mount correctly inside the iframe. Add an explicit embedded-mode contract between the frontend iframe URL and the backend HTML rewrite path, and preserve clear failure behavior instead of another silent blank state.

## Boundaries & Constraints

**Always:** Preserve authenticated access through the existing AppOS route and token/cookie bridge. Keep OpenCode upstream traffic behind AppOS proxying. Keep the fix minimal to the ai-agent slice, and verify the browser behavior after implementation. Maintain `pb.send` as the only frontend HTTP client outside the iframe-backed upstream.

**Block If:** The fix requires changing OpenCode upstream source code, introducing a new deployment/runtime dependency, or altering unrelated AppOS routing semantics outside the ai-agent slice.

**Never:** Do not replace the iframe architecture with a custom AppOS reimplementation of OpenCode. Do not expose provider credentials to the browser. Do not spend time on `make test web` in this run.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Embedded load | Authenticated user opens `/ai-agent` | OpenCode renders visible UI inside the iframe instead of an empty gray panel | No silent blank page |
| Direct proxy access | Authenticated user opens `/api/ai/agent` directly | Existing proxy behavior remains available for non-embedded use | Existing auth and proxy errors remain explicit |
| Missing upstream | OpenCode upstream unavailable | AppOS still returns an explicit proxy failure response | No false-success blank render |

</intent-contract>

## Code Map

- `backend/domain/routes/ai_agent.go` -- Reverse proxy, response rewriting, and ai-agent auth bridge
- `web/src/routes/_app/_auth/ai-agent.tsx` -- Authenticated AppOS wrapper page and iframe source construction
- `backend/domain/routes/routes.go` -- Confirms ai-agent route registration in the custom route tree

## Tasks & Acceptance

**Execution:**
- [x] `backend/domain/routes/ai_agent.go` -- add an embedded-mode HTML bootstrap shim for the proxied OpenCode page so client-side routing mounts under iframe mode without breaking normal proxy access -- removes the root cause of the blank render
- [x] `web/src/routes/_app/_auth/ai-agent.tsx` -- request the proxied page in explicit embedded mode and keep the standalone entry aligned with the fixed behavior -- makes frontend and backend use the same contract
- [x] `backend/domain/routes/ai_agent_test.go` -- cover the embedded bootstrap rewrite behavior and preserve existing non-embedded output expectations -- guards against regressions in the proxy rewrite path

**Acceptance Criteria:**
- Given an authenticated operator opens `/ai-agent`, when the iframe loads OpenCode through the AppOS proxy, then visible OpenCode UI renders instead of a blank gray panel.
- Given the backend proxies normal non-embedded ai-agent traffic, when the request is not marked as embedded mode, then the response does not get the iframe-only bootstrap mutation.
- Given the ai-agent slice is changed, when verification runs, then `make build` succeeds and a targeted backend test covering the rewrite logic passes.

## Spec Change Log

## Review Triage Log

### 2026-07-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 2, low 1)
- defer: 0
- reject: 2
- addressed_findings:
  - `[medium]` `[patch]` preserved the embedded-mode contract across redirect locations by rewriting `Location` headers to carry the proxy prefix and `embedded=1`.
  - `[medium]` `[patch]` reduced iframe reload regression risk by restoring the proxied ai-agent URL on unload while keeping the SPA mounted on a root-like client route during runtime.
  - `[low]` `[patch]` corrected the spec verification command and aligned the user-facing new-tab action with the embedded-compatible proxy URL.

### 2026-07-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` quoted the injected bootstrap CSP hash so browsers accept it as a valid `script-src` source and execute the embedded ai-agent bootstrap on the real site.

## Design Notes

Browser proof isolated the failure to OpenCode client routing under the `/api/ai/agent` prefix. Manually changing the iframe history path to `/` caused OpenCode to render immediately, which is strong evidence that embedded mode needs a bootstrap path shim before the SPA mounts.

The fix should keep that shim scoped to embedded requests only. The standalone proxy path should remain unchanged so AppOS does not silently rewrite visible top-level URLs for direct access.

## Verification

**Commands:**
- `cd backend && go test ./domain/routes -run 'TestRewriteAIAgentResponseBody|TestInjectAIAgentEmbeddedBootstrap|TestRewriteAIAgentLocation|TestAppendEmbeddedQuery'` -- expected: ai-agent rewrite tests pass
- `make build` -- expected: backend binary and web bundle build successfully

**Manual checks (if no CLI):**
- Open the authenticated `/ai-agent` page and confirm the OpenCode UI is visible instead of a blank iframe.

## Auto Run Result

Summary: Fixed the `/ai-agent` blank-page regression by introducing an embedded-mode contract between the AppOS wrapper page and the proxied OpenCode HTML bootstrap, so the OpenCode SPA mounts on a root-like client route while still loading through the AppOS proxy.

Files changed:
- `backend/domain/routes/ai_agent.go` -- added embedded-mode detection, HTML bootstrap injection, redirect query preservation, and reload-safe proxy URL restoration logic.
- `backend/domain/routes/ai_agent_test.go` -- added focused tests for embedded bootstrap insertion, non-HTML/non-embedded behavior, and redirect query preservation.
- `web/src/routes/_app/_auth/ai-agent.tsx` -- switched iframe requests to explicit embedded mode and aligned the new-tab entry with the embedded-compatible proxy URL.
- `specs/implementation-artifacts/epic-31-context.md` -- cached Epic 31 context for the workflow run.
- `specs/implementation-artifacts/spec-31-3-ai-agent-blank-page.md` -- recorded the implementation plan, review triage, and verification notes.

Review findings breakdown: patched 3 findings during the final pass; deferred 0; rejected 2 low-confidence edge-case suggestions (XHTML content-type support and speculative CSP relaxation) because they were not evidenced by the actual failing page.

Verification performed:
- `cd backend && go test ./domain/routes -run 'TestRewriteAIAgentResponseBody|TestInjectAIAgentEmbeddedBootstrap|TestRewriteAIAgentLocation|TestAppendEmbeddedQuery'` -- passed.
- `make build` -- passed twice after implementation and review-driven fixes.
- `cd backend && go test ./domain/routes -run 'TestRewriteAIAgentResponseBody|TestInjectAIAgentEmbeddedBootstrap|TestRewriteAIAgentLocation|TestAppendEmbeddedQuery|TestRelaxAIAgentEmbeddedCSP|TestAppendCSPDirectiveValue'` -- passed after the CSP hash compatibility fix.
- `make build` and `make run` -- passed after the CSP hash compatibility fix and hot reloaded the live container.
- Browser diagnosis on `http://cdl.dev.websoft9.cn:9091/ai-agent` before the fix confirmed the root cause: upstream HTML/JS/CSS loaded, but the OpenCode SPA stayed blank until the frame history path was manually rewritten from `/api/ai/agent...` to `/`.
- Final browser validation on `http://cdl.dev.websoft9.cn:9091/ai-agent` passed after deployment: the iframe rendered OpenCode UI content (`No projects open`, `Open project`, `Getting started`) instead of an empty shell.

Residual risks:
- The final revision field remains at the pre-run HEAD because repository policy in this session forbids auto-committing changes even though the BMAD workflow normally commits during review finalization.