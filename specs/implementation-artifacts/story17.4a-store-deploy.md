# Story 17.4a: Store Direct Deploy

Status: in-progress

## Story

As an operator using App Store,
I want Store applications to open Deploy Center with the right deployment inputs already prepared,
so that template-backed installs feel like one flow instead of two disconnected screens.

## Acceptance Criteria

1. Store application detail surfaces must provide a real deploy action that enters Deploy Center rather than acting as a placeholder link.
2. Deploy Center must accept Store-driven prefill state, including app identity and source type.
3. Library-backed applications must preload their base `docker-compose.yml` from the library path.
4. Template-backed custom applications must preload their base `docker-compose.yml` from the template path.
5. The resulting deploy flow must still submit through the shared manual compose pipeline rather than creating a Store-only execution path.
6. Prefill failures must produce clear operator-visible feedback.

## Tasks / Subtasks

- [ ] Add Store-to-Deploy entry handoff (AC: 1,2)
  - [ ] Wire deploy action from Store detail surfaces
  - [ ] Define route search or equivalent typed prefill contract
- [ ] Implement template prefill (AC: 3,4)
  - [ ] Load library-backed compose templates
  - [ ] Load custom template-backed compose files
- [ ] Keep execution path shared (AC: 5)
  - [ ] Prefill manual deploy dialog rather than creating a second submit path
- [ ] Handle failure states (AC: 6)
  - [ ] Surface missing-template and load-failure feedback in Deploy Center

## Dev Notes

- This story owns Store entry UX and template prefill only.
- It must not redefine deploy execution semantics or lifecycle rules.
- Base compose is required; future `.env` and metadata overlays can extend this story later without changing its core handoff contract.

### References

- [Source: specs/implementation-artifacts/epic17-deploy.md#App Template Contract (Minimal)]
- [Source: specs/implementation-artifacts/epic17-deploy.md#Story 17.4 Trigger Adapters (MVP Scope)]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List


### File List
