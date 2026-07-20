# Story 26.2: Extensions UI

**Epic**: Epic 26 - Extensions
**Status**: Proposed | **Priority**: P2 | **Depends on**: Story 26.1

## Objective

Deliver the first operator-facing `Extensions` page with a two-tab layout that separates `Platform Extensions` from `Server Extensions`.

## Scope

- add one top-level `Extensions` page under the `Platform` menu group
- use two tabs only: `Platform` and `Server`
- keep the first-pass page card-based rather than table-based
- make `Platform` the default active tab
- keep the page focused on orientation and browsing, not deep operations

## Layout Contract

### Page shell

- page title: `Extensions`
- short subtitle explaining that AppOS manages extensions across the platform runtime and managed servers
- tab bar directly under the header

### Tabs

#### `Platform` tab

Purpose:

- show platform-managed extensions that AppOS itself includes

Presentation:

- card grid
- each card shows at least name and short role description
- cards may show lightweight status such as `Present`, `Degraded`, or `Unavailable` when that status is truthful

Entry behavior:

- card click opens the platform-extension directory or detail surface

#### `Server` tab

Purpose:

- show server-target extension capabilities AppOS can project onto managed servers

Presentation:

- card grid
- each card shows at least name and short role description
- cards may show lightweight support labels such as `Supported` when the page is rendering discovery-oriented data rather than live server state

Entry behavior:

- card click opens the server-extension catalog or the next appropriate server-oriented surface

## Interaction Rules

- tabs switch target context, not cosmetic filtering of one mixed list
- the page must not render one shared mixed card set containing both `Platform Extensions` and `Server Extensions`
- do not add a third `All` tab in the first pass
- do not add left-side faceted filtering in the first pass
- keep actions lightweight; do not turn this page into a lifecycle operations console

## UI Guardrails

- no marketplace framing
- no generic plugin-upload CTA
- no mixed `Platform` and `Server` rows/cards in one section
- no deep operational tables on the top-level page
- no duplicate target selector outside the tab bar

## Acceptance Criteria

1. The `Extensions` page is reachable as a standalone page under the `Platform` menu group.
2. The page uses exactly two tabs: `Platform` and `Server`.
3. The default active tab is `Platform`.
4. Both tabs use card-based presentation in the first pass.
5. `Platform` and `Server` content remain clearly separated by tabs rather than mixed into one shared list.
6. The page stays browsing-oriented and does not become the primary lifecycle operations surface.

## Notes

- `Platform` appears before `Server` because the page belongs to the `Platform` menu context and targets advanced operators.
- Detailed inventory, catalog, or operation behavior belongs to downstream pages, not to the top-level `Extensions` page.