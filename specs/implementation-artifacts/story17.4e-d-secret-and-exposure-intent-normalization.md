# Story 17.4e-D: Secret and Exposure Intent Normalization

Status: proposed

## Story

As a lifecycle platform team,
I want sensitive install input and publication-related install intent to become explicit normalized lifecycle data,
so that secret values and exposure semantics are not hidden inside route-local form payloads or worker-only runtime data.

## Acceptance Criteria

1. Secret-like install inputs must be classified and normalized at the backend install-ingress boundary.
2. Raw secret values must not become durable worker-facing payloads when secret-backed references are required or available.
3. Existing secret-ref validation must expand into a broader install-input classification rule rather than remaining only an env-string special case.
4. Exposure and publication-related install inputs must be preserved as explicit normalized lifecycle intent with validation rules.
5. Normalized install output must clearly distinguish resolved runtime env, secret references, and exposure intent.
6. This story must not implement publication execution itself; it only preserves install-time intent and semantics.

## Delivered Now

- [x] Secret refs are already recognized and validated in env normalization.
- [x] Exposure intent already has a normalized lifecycle shape with validation rules.
- [x] The current foundation proves the right direction, but coverage is still narrower than the real install-input problem.

## Still Deferred

- [ ] Broader classification of secret-like install inputs beyond env string refs.
- [ ] Stronger install-time policy for how secret-backed refs are created, reused, or rejected.
- [ ] Clear operator-visible summary of normalized secret and exposure intent in the create flow.

## Dev Notes

- This is the boundary-hardening slice for `17.4e`.
- Do not let secret semantics remain a UI convenience rule.
- Do not let exposure intent disappear into generic metadata blobs that later teams cannot reason about.
- The purpose is semantic preservation at ingress, not execution expansion.

### Suggested Implementation Focus

1. Define classification rules for secret-like candidate inputs.
2. Decide which raw values may be accepted transiently and which must resolve to durable secret refs.
3. Keep exposure intent explicit and versionable in normalized operation data.
4. Add tests covering both valid and rejected secret/exposure inputs.

### References

- [Source: specs/implementation-artifacts/story17.4e-install-input-resolution.md]
- [Source: specs/adr/app-lifecycle-install-resolution.md]
- [Source: backend/domain/lifecycle/service/install_resolution.go]
- [Source: backend/domain/secrets/config.go]
- [Source: specs/implementation-artifacts/story23.4-certificate-consumption.md]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List

- Story created to keep secret and publication-related install semantics from being lost during broader input convergence.
- The slice is intentionally about normalization and policy, not gateway execution.


### File List
