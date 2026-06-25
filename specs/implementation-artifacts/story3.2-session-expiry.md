# Story 3.2 Follow-up: Session Expiry & Runtime Re-Auth Recovery

**Epic**: Epic 3 - Authentication
**Priority**: P1
**Status**: proposed
**Depends on**: Story 3.2, Story 3.3, Story 3.4, Epic 7

## User Story

As an authenticated AppOS operator,
I want expired sessions to be handled consistently while I am already inside the product,
so that long-lived pages do not degrade into raw token errors, repeated failed polling, or confusing broken state.

## Problem Statement

Epic 3 already covers login, logout, startup auth refresh, and route-entry protection.

The remaining gap is runtime expiry during an already-mounted authenticated session:

1. a user lands on a protected page successfully
2. time passes without interaction or the token otherwise expires
3. a later `pb.send(...)`, `pb.collection(...)`, or direct authenticated `fetch(...)` request returns expired-auth / 401
4. the current page-level error handling can surface raw PocketBase messaging such as `The request requires valid record authorization token.`

This behavior is technically understandable but product-wise wrong for AppOS.

## Objective

Centralize runtime expired-session handling so AppOS:

1. converts expired-auth responses into one consistent re-auth flow
2. preserves the current target location through the existing login redirect mechanism
3. avoids repeated request-error spam on polling surfaces
4. keeps PocketBase implementation details out of end-user messaging

## Acceptance Criteria

- [ ] AC1: When an authenticated runtime request fails because the auth token is expired or invalid, the frontend treats it as a global auth-expiry event rather than a page-local business error.
- [ ] AC2: The user is redirected through the existing `/login?redirect=...` flow so that successful sign-in returns them to the page they were using.
- [ ] AC3: The user-facing message is product-language guidance such as `Session expired. Please sign in again.` and does not expose raw PocketBase token wording.
- [ ] AC4: The expiry flow is de-duplicated so multiple concurrent 401 responses do not trigger repeated redirects, repeated logout clears, or multiple stacked alerts.
- [ ] AC5: Both PocketBase SDK request paths and direct authenticated `fetch` paths participate in the same session-expiry policy.
- [ ] AC6: Protected pages that poll in the background stop degrading into repeated visible request failures after expiry.
- [ ] AC7: The story does not introduce a second auth model, a modal-first re-auth workflow, or backend session state beyond PocketBase's stateless auth model.

## Non-Goals

- [ ] silent refresh redesign beyond the existing `authRefresh()` startup verification model
- [ ] OAuth, MFA, SSO, or step-up authentication
- [ ] a full offline-draft recovery framework for every form in the product
- [ ] replacing the existing login redirect helper with a new return-navigation pattern

## Current Baseline

Current auth behavior is split across several layers:

1. `web/src/contexts/AuthContext.tsx`
   startup `authRefresh()` and reactive authStore syncing
2. `web/src/routes/_app/_auth.tsx`
   route-entry guard based on `pb.authStore.isValid`
3. `web/src/routes/_app/login.tsx` and `web/src/routes/_app/-login-redirect.ts`
   existing post-login redirect plumbing
4. many feature surfaces that call:
   - `pb.send(...)`
   - `pb.collection(...).get/create/update/delete(...)`
   - direct `fetch(... Authorization: pb.authStore.token)`

Because runtime request failures are not centralized today, the UX can become inconsistent by feature area.

## Proposed Product Behavior

### Default behavior

When runtime auth expires:

1. recognize the failure as expired auth
2. clear local auth state once
3. capture the current location as `redirect`
4. send the user to `/login?redirect=...`
5. show product-language explanation instead of raw backend wording

### Why this is the preferred AppOS pattern

This matches the product's current architecture better than a modal re-auth flow because:

1. login is already page-based, not modal-based
2. redirect-after-login already exists and is safe
3. many pages issue background polling, where staying in place after expiry would only create more failures
4. AppOS should favor a clear, deterministic recovery path over clever but partial local handling

### Editing-state nuance

This story should not block on global draft preservation.

However, implementation should avoid making future recovery harder:

1. do not hardcode page-local raw error UI around auth expiry
2. keep the redirect target intact so pages can later restore drafts if needed
3. note high-value future candidates such as deployment forms, profile edits, or large config editors

## Implementation Direction

### 1. Global auth-expiry classifier

Introduce one frontend utility that answers:

1. is this error an expired-auth / unauthorized condition
2. if yes, should the app begin the forced re-auth flow now

This classifier should understand:

1. PocketBase `ClientResponseError` 401-style responses
2. direct `fetch` responses with `status === 401`
3. equivalent invalid-auth error payloads where status mapping is inconsistent

### 2. Single runtime session-expiry handler

Centralize the side effects in one place:

1. clear `pb.authStore`
2. suppress duplicate concurrent handling
3. preserve current path/search/hash as `redirect`
4. navigate to `/login`
5. surface one product-language message only

The project should not require each page to rediscover how to handle auth expiry.

### 3. Request-entry integration

Apply the same handler to all authenticated request modes used in AppOS:

1. PocketBase SDK send helpers
2. PocketBase collection CRUD helpers
3. direct authenticated `fetch` helpers

The first slice does not need to refactor every file into one abstraction immediately, but it must establish a clear migration path and wire the highest-volume authenticated request flows first.

### 4. Product-language UX

Normalize end-user wording to something like:

- `Session expired. Please sign in again.`

Do not surface:

- `The request requires valid record authorization token.`
- raw SDK response dumps
- stack traces or auth implementation jargon

### 5. Polling and repeated-request behavior

Pages with periodic polling should not repeatedly re-render the same expired-session message.

Once forced re-auth begins:

1. subsequent 401s should be ignored or short-circuited by the same in-progress auth-expiry state
2. the app should not produce multiple redirects or a cascade of banners

## Tasks / Subtasks

- [ ] Task 1: Document and implement one auth-expiry utility layer
  - [ ] 1.1 Add an error classifier for expired-auth conditions
  - [ ] 1.2 Add a single forced re-auth handler with duplicate suppression
- [ ] Task 2: Integrate PocketBase SDK request paths
  - [ ] 2.1 Cover `pb.send(...)`
  - [ ] 2.2 Cover common `pb.collection(...)` CRUD flows or wrap them through a shared helper path
- [ ] Task 3: Integrate direct authenticated fetch paths
  - [ ] 3.1 Identify `fetch` calls that attach `Authorization: pb.authStore.token`
  - [ ] 3.2 Route their 401 behavior through the same forced re-auth policy
- [ ] Task 4: User-facing behavior
  - [ ] 4.1 Reuse existing login redirect plumbing
  - [ ] 4.2 Replace raw expired-token messaging with product-language guidance
- [ ] Task 5: Verification
  - [ ] 5.1 Add tests for route-preserving redirect behavior
  - [ ] 5.2 Add tests ensuring duplicate concurrent 401s trigger only one re-auth flow
  - [ ] 5.3 Add tests for at least one `pb.send(...)` flow and one direct `fetch(...)` flow

## Dev Notes

- Keep the solution frontend-only unless implementation proves a backend response normalization gap that cannot be handled safely on the client.
- Prefer using the already-established `/login?redirect=...` contract instead of inventing a second session-recovery state machine.
- This story should improve operator experience without weakening auth guarantees.
- Route-entry auth checks remain useful, but they are not sufficient for long-lived authenticated screens.
- Because this repo has both SDK and raw `fetch` auth traffic, success requires policy consistency rather than only touching `AuthContext`.

## Minimal Test Checklist

- [ ] Expired auth during a protected page request redirects to login with a preserved redirect target.
- [ ] The user does not see raw PocketBase expired-token wording.
- [ ] Multiple simultaneous 401s produce one forced re-auth flow.
- [ ] At least one polling page no longer surfaces repeated expired-session request errors.
- [ ] Direct authenticated `fetch` usage participates in the same recovery policy.

## References

- [Source: specs/implementation-artifacts/epic3-auth.md]
- [Source: web/src/contexts/AuthContext.tsx]
- [Source: web/src/routes/_app/_auth.tsx]
- [Source: web/src/routes/_app/login.tsx]
- [Source: web/src/routes/_app/-login-redirect.ts]