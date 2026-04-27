# Story 29.4: Supported Software Discovery Surface

**Epic**: Epic 29 - Software Delivery
**Status**: done | **Priority**: P1 | **Depends on**: Story 29.1

## Objective

Expose one lightweight read-only surface that shows what server-target software AppOS can manage before any server is connected.

## Reorganization Note

This story absorbs and generalizes Story 29.4a Supported Software Surface under the reorganized epic split.

## Scope

- keep one read-only supported-software catalog API for server-target entries
- keep one lightweight `Supported Software` page under `Resources`
- show support scope, lifecycle support, and template-backed delivery metadata without implying installed state
- make the page useful for onboarding, evaluation, demos, and contract testing before any server exists
- keep discovery separate from server-scoped operations

## Navigation Contract

- place the entry under `Resources`
- keep it under a dedicated software-oriented section such as `Software Delivery`
- keep the card lightweight and read-only
- do not place it under `Settings`
- do not bury it inside the server detail experience

## UI Contract

Show only read-only support information:

- label
- component key
- mapped capability
- supported lifecycle actions
- template kind or delivery strategy family
- short description or note

Do not show:

- installed state
- per-server readiness
- operation history
- server picker
- action buttons that mutate a target

## API Contract

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/software/server-catalog` | list supported server-target software |
| GET | `/api/software/server-catalog/{componentKey}` | read one supported server-target entry |

Rules:

- the API must remain read-only
- supported actions shown here come from catalog metadata, not live server state
- the page should point users to Server Detail `Software` for actual lifecycle execution

## Technical Context

Current implementation anchor points:

- `backend/domain/software/service/supported_catalog.go`
- `backend/domain/routes/software.go`
- `web/src/lib/software-api.ts`
- `web/src/components/software/SupportedSoftwarePage.tsx`
- `web/src/components/resources/ResourceHub.tsx`

This surface already exists in first-pass form, so this story should be treated as the reorganized contract for maintaining and extending it rather than inventing a second discovery page.

## Tasks / Subtasks

- [x] Task 1: Align supported-software DTOs with the canonical catalog contract
	- [x] 1.1 expose supported lifecycle actions consistently
	- [x] 1.2 keep capability and template metadata readable for operators
	- [x] 1.3 ensure descriptions remain short and avoid App Store ambiguity
- [x] Task 2: Keep the Resource Hub integration lightweight
	- [x] 2.1 preserve a dedicated software-oriented section
	- [x] 2.2 keep `Supported Software` read-only with no `Add Resource` CTA
	- [x] 2.3 keep card copy explicit that this is support scope, not installation state
- [x] Task 3: Validate the separation from operational UI
	- [x] 3.1 point users toward Server Detail for actions
	- [x] 3.2 avoid leaking readiness, inventory, or operation history into this page
	- [x] 3.3 keep frontend tests independent from connected-server state

## Guardrails

- no mutate actions on this page
- no server inventory mixed into discovery rows
- no App Store, marketplace, or package-center positioning
- no local AppOS inventory mixed into this page

## Acceptance Criteria

- operators can inspect supported server-target software without connecting a server first
- the page is explicitly read-only and clearly distinct from installed inventory
- supported actions shown on the page reflect catalog policy rather than a live server state guess
- the Resource Hub entry remains lightweight and does not behave like a resource-creation flow
- the page points operators toward the server-scoped operational surface for real lifecycle actions

## Notes

- use `Supported Software` as the product label rather than `Software Catalog`
- the value of this story is clarity and testability, not UI depth