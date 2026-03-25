# Story 17.4a: Store Compose Prefill

Status: review

## Story

As an operator using App Store,
I want Store applications to open the shared install flow with the right compose input already prepared,
so that Store-backed installs enter Epic 17 without creating a second execution path.

## Acceptance Criteria

1. Store application detail surfaces must provide a real action into the shared install flow rather than a placeholder link.
2. The install flow must accept Store-driven prefill state, including app identity and source type.
3. Library-backed applications must preload their base `docker-compose.yml` from the library path.
4. Template-backed custom applications must preload their base `docker-compose.yml` from the template path.
5. The resulting install flow must still submit through the shared manual compose pipeline rather than creating a Store-only execution path.
6. Prefill failures must produce clear operator-visible feedback.

## Delivered Now

- [x] Store detail surfaces can navigate directly into the shared install flow.
- [x] Route search state carries Store prefill identity and source information.
- [x] Library-backed applications preload compose from the library path.
- [x] Template-backed custom applications preload compose from the template path.
- [x] Submission still goes through the same manual-compose operation creation path as other installs.
- [x] Missing-template and prefill-load failures surface operator-visible feedback.

## Still Deferred

- [ ] Richer Store metadata overlays beyond base compose prefill.
- [ ] Store-driven parameter collection that normalizes into the same operation contract without reintroducing Store-specific execution logic.

## Dev Notes

- This story owns Store entry UX and compose prefill only.
- It must not redefine execution semantics or lifecycle rules.
- Base compose is required; future `.env` and metadata overlays can extend this story later without changing its core handoff contract.

### References

- [Source: specs/implementation-artifacts/epic17-app-execution.md#App Template Contract (Minimal)]
- [Source: specs/implementation-artifacts/epic17-app-execution.md#Story 17.4 Input Adapters (MVP Scope)]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List

- Store detail entry now hands off to the shared lifecycle install flow.
- Both library and template compose sources are prefilled on the client before creating the operation.
- This story is intentionally thin: it feeds Epic 17, it does not own execution.


### File List
