# Story 29.4a: Supported Software Surface

**Epic**: Epic 29 - Software Delivery
**Status**: Done | **Priority**: P1 | **Depends on**: Story 29.4

## Objective

Expose one minimal read-only `Supported Software` surface for `server` target software so operators can see what AppOS can manage before any server is connected.

## Scope

- add one read-only server software catalog API
- add one lightweight frontend `Supported Software` page
- show supported server-target software entries from catalog data only
- keep the page useful for discovery, onboarding, and testing before server connection
- place the entry under `Resources` as a lightweight family, not a server-like operational surface

## Why Separate Story

- supported-software discoverability should not depend on having a connected server
- frontend catalog behavior should stay testable without server inventory state
- server-scoped lifecycle actions should remain in the Server Detail Software surface

## Navigation Contract

- place the entry in `Resources`
- use a small `Software Delivery` section in the Resource Hub
- render `Supported Software` as one lightweight family card
- do not place the page under `Settings`
- do not bury the entry under an `Other` bucket

## UI Contract

The entry should be lightweight in both navigation and page scope.

Resource Hub expectations:

- same family-card visual language as other resource families
- read-only entry with `Open family`
- no `Add Resource` CTA

Page expectations:

- small and read-only
- positioned as `supported by AppOS`, not `installed anywhere`

Show only:

- label
- component key
- mapped capability
- supported actions
- delivery template kind
- short note or description

Do not show:

- installed state
- verification state
- preflight readiness
- operation history
- install, upgrade, verify, or repair buttons
- per-server state or server selector

## API Draft

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/software/server-catalog` | list read-only server-target catalog entries |
| GET | `/api/software/server-catalog/{componentKey}` | read one server-target catalog entry |

## Acceptance Criteria

- operators can inspect AppOS-managed server software without selecting a server
- the page is explicitly read-only and does not imply software is installed anywhere
- the surface clearly separates `supported by AppOS` from `installed on this server`
- the page links or points users to Server Detail `Software` for lifecycle actions
- the Resource Hub entry appears as a lightweight family card under a dedicated software-oriented section

## Notes

- this is not a second software management center
- this page exists to make catalog scope visible and independently testable
- lifecycle actions still belong to the server-scoped software surface
- product label should use `Supported Software`, not `Software Catalog`, to avoid App Store ambiguity