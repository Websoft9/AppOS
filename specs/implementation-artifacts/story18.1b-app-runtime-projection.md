# Story 18.1b: App Runtime Projection

Status: proposed

## Story

As an operator,
I want `AppInstance` detail and list surfaces to read stable app-scoped runtime, source, and desired-state context without depending primarily on `last_operation`,
so that the management projection remains coherent even when the latest execution record is absent, stale, or unrelated to the current management question.

## Acceptance Criteria

1. The backend `AppInstance` response exposes app-scoped runtime/source context through a stable read model rather than primarily reconstructing it from `last_operation`.
2. `last_operation` remains a linked lifecycle projection and is not the main anchor for core management context such as project directory or source lineage.
3. The new or revised app-scoped read behavior preserves the Epic 18 boundary: it can summarize runtime-supporting context but does not absorb execution internals into `AppInstance` state.
4. Installed-side list and detail pages continue to render required app context without depending on implicit execution-history reconstruction.
5. The story does not redesign runtime observability, container diagnostics, or Epic 17 operation detail semantics.
6. The backend management projection exposes `desired_state` clearly enough that Installed-side views can distinguish intent from current lifecycle state.
7. `desired_state` is not treated as a duplicate of execution status or pipeline phase.

## Delivered Now

- [x] The boundary problem is documented in the Epic 17/18 App Instance assessment.
- [x] `AppInstance` is already the management-facing object for Installed-side views.
- [x] `desired_state` already exists in the lifecycle model and projection structure.
- [ ] App-scoped runtime/source context is fully stabilized away from `last_operation`-first reconstruction.
- [ ] Backend and frontend management surfaces fully expose and interpret `desired_state`.

## Still Deferred

- [ ] Richer runtime diagnostics and observability redesign.
- [ ] Deeper source-resolution normalization beyond the fields needed for Installed-side management.
- [ ] Full runtime query-model redesign across all app-related surfaces.
- [ ] More advanced intent-policy modeling beyond `desired_state` versus current lifecycle state.

## Current Baseline (2026-04-01)

Current backend response shaping in `backend/domain/routes/apps.go` still resolves parts of app runtime/config context by traversing `app_instances.last_operation` into `app_operations`.

This works as an interim bridge, but it is weaker than the intended domain boundary because:

1. `last_operation` is execution linkage, not durable app-scoped management context.
2. Stable operator-facing context should not disappear just because the latest operation record is missing or no longer the right source for reconstruction.
3. The current behavior makes `AppInstance` detail more execution-coupled than the DDD framing intends.

## Dev Notes

- This is a read-model hardening story, not a new execution-contract story.
- The goal is not to move runtime ownership into `AppInstance`; the goal is to make the management projection self-sufficient enough for Installed-side surfaces.
- Prefer app-scoped fields or app-scoped projection derivation over execution-history backtracking when the information is needed for stable management UX.
- This story absorbs the earlier `desired_state` projection cleanup into the same response-hardening slice.

## Implementation Breakdown

### 1. Backend projection contract review

- Review `appInstanceResponse` and `resolveAppRuntimeContext` in `backend/domain/routes/apps.go`.
- Separate fields that are truly app-scoped management context from fields that are only opportunistic execution residue.
- Decide which fields must be available even when `last_operation` is empty.

### 2. Stable app-scoped context source

- Introduce or formalize a stable source for app-scoped runtime/source context.
- Keep `last_operation` as a related summary field, not the primary reconstruction path.
- Preserve convenience summaries if needed, but do not make them structurally depend on the latest operation record.

### 3. Response and UI compatibility

- Keep `/api/apps` consumers working in Installed-side list/detail surfaces.
- Update frontend assumptions only where the contract becomes clearer or stricter.
- Avoid adding fields that would reclassify runtime-only details as aggregate state.

### 4. Tests

- Add or update route tests to cover app responses when `last_operation` is empty, stale, or unrelated to the currently rendered context.
- Verify that required app-scoped fields still resolve correctly.

## Technical Direction

The implementation direction for this story is now part of this story itself.

Key decisions:

1. the stable runtime anchor should be projected onto `app_instances`
2. `last_operation` should remain linkage, not the primary read source
3. `/api/apps` should stay backward-compatible while response shaping is hardened
4. `desired_state` should be exposed in the same response cleanup slice where practical

### Stable projection fields

The management projection should be able to return these fields without traversing `last_operation` first:

1. `project_dir`
2. `compose_project_name`
3. app-scoped source lineage summary for management use
4. `desired_state`

Recommended storage naming keeps API compatibility while clarifying projection meaning internally.

### Response hardening rule

Refactor route behavior from operation-first reconstruction into projection-first shaping:

1. read stable projection fields from `app_instances`
2. fall back to `last_operation` only when projected fields are absent
3. return partial context when possible instead of treating missing `last_operation` as the defining failure

### Write-path rule

Stable runtime-context fields should be refreshed when lifecycle operations establish or change the app runtime anchor, especially install, upgrade, redeploy, and later config apply/rollback after convergence.

### Frontend rule

Keep the first slice minimal:

1. continue consuming `project_dir` and `source` as before
2. add `desired_state` to Installed-side types and views where it improves operator reasoning
3. avoid turning this story into a runtime-observability redesign

## Minimal Acceptance Test Checklist

- [ ] `/api/apps/{id}` still returns stable app-scoped runtime/source context when `last_operation` is unset.
- [ ] `/api/apps/{id}` does not require `last_operation` to expose operator-facing context that should belong to the app management projection.
- [ ] `last_operation` remains present as lifecycle linkage where available.
- [ ] Installed-side UI still renders app summary without regression.
- [ ] `/api/apps` list and detail payloads expose `desired_state` where expected.
- [ ] Installed-side TypeScript types include `desired_state`.
- [ ] UI does not confuse `desired_state` with current execution phase.

## References

- [Source: specs/implementation-artifacts/epic17-18-app-instance-subdomain-assessment.md]
- [Source: specs/implementation-artifacts/story18.1a-app-detail-boundary.md]
- [Source: specs/adr/app-lifecycle-domain-model.md]