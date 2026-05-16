# Story 4.3 Supplement: Docker Tabs UI Contract

**Epic**: Epic 4 - Docker Operations Layer  
**Status**: Implemented  
**Parent**: Story 4.3 Docker Workspace Replan

---

## Purpose

This document records finalized UI conventions for all Docker sub-tabs inside the Docker workspace. It is the implementation reference for building and maintaining any Docker tab — existing or new.

Containers-specific decisions are called out explicitly. Everything else applies to all tabs.

---

## Scope

Covers:
- panel shell layout and outer chrome (`DockerPanel`)
- shared section header conventions
- Containers tab: table structure, columns, interaction patterns
- React patterns that apply across all tabs

Does not cover:
- Docker backend routes or API contracts (Epic 4 domain stories)
- monitor telemetry contracts (Story 28.6, 28.7)

---

This document records the finalized UI conventions for the `Containers` tab inside the Docker workspace. It serves as the implementation reference so the same conventions can be applied consistently when extending other Docker sub-tabs.

---

## Panel Shell (`DockerPanel`)

`DockerPanel` owns all outer chrome. Individual tab components are controlled — they render content only, no outer borders, headers, or toolbars of their own.

```
DockerPanel
  ├── Left nav  (tab switching, collapsible)
  └── Content panel  (rounded-xl border overflow-hidden)
        ├── Section header  (title + per-tab toolbar)
        └── <Tab component>  (controlled, no chrome)
```

**Rule: `overflow-hidden` on the content panel.** The content panel uses `rounded-xl border`. It must also carry `overflow-hidden` so that child backgrounds do not paint over the rounded corners, which would make the bottom corners appear flat/cut off.

**Rule: controlled tab components.** Any tab component that has toolbar state (filters, pagination, column visibility) must receive that state as props from `DockerPanel`. The tab itself does not own or render the toolbar.

---

## Section Header (all tabs)

Lives in `DockerPanel`, not in individual tab components.

Layout: `flex flex-col gap-2` with inner row `flex-wrap items-center justify-between`. Title left, toolbar right. Wraps naturally in narrow panels — no breakpoint-driven `flex-row` switch.

**Rule**: Do not use `xl:flex-row` or similar breakpoints to switch between stacked and side-by-side. `flex-wrap justify-between` is sufficient.

Tab description text is **not shown** in the section header. The tab name is self-explanatory.

---

## Left Nav (collapsible)

The collapse/expand toggle button uses `right-0` when collapsed and `right-3` when expanded.

**Rule**: At collapsed width (`w-14` = 56px), placing the toggle at `right-3` (12px from edge) causes it to overlap the centered tab icons. Use `right-0` when collapsed.

---

## Containers Table

### Column Order

| # | Column | Always visible |
|---|--------|----------------|
| 1 | Name | ✓ |
| 2 | Runtime | ✓ |
| 3 | Quick | ✓ |
| 4 | Lifecycle | optional |
| 5 | Ports | optional |
| 6+ | CPU / Mem / Net / Compose | optional |
| last | Actions | ✓ |

**Rule**: Quick column is fixed at position 3, immediately after Runtime. It must always be visible without horizontal scrolling.

### Name Column

- Content: container name (bold, `text-sm`) above image tag (`font-mono text-[11px] text-muted-foreground`)
- Left edge aligns with the section header title (`pl-4`, 16px from panel edge)
- Clicking the name row opens the inline detail expansion

**Rule**: Name column header and cell content share the same left offset (`pl-4`). Do not use negative margin tricks on the sort button to compensate for component padding — use a native `<button>` element with `px-0` instead.

### Runtime Column

Shows state badge + telemetry freshness badge together.

- Running: `emerald` badge
- Exited: muted badge
- Paused: `amber` badge
- No telemetry / Stale: ghost dashed badge alongside the state badge

### Quick Column (`w-[112px]`)

Three icon-only buttons: Logs (`FileText`), Monitor (`Activity`), Exec (`TerminalSquare`).

- Exec button is disabled when container state is not `running`
- All buttons use `onClick` with `event.stopPropagation()` + `event.preventDefault()`

### Actions Column (`w-[52px]`)

`DropdownMenu` trigger with `MoreVertical` icon.

**Critical rule**: All `DropdownMenuItem` handlers must use `onSelect` (not `onClick`) with `window.setTimeout(() => handler(), 0)` to defer state changes until after Radix menu cleanup. Using `onClick` on menu items causes React error #185 (maximum update depth exceeded) because synchronous state changes during menu close animation create a render loop.

```tsx
<DropdownMenuItem
  onSelect={event => {
    event.stopPropagation()
    window.setTimeout(() => setStatsContainer(c), 0)
  }}
>
```

---

## Derived Data — useMemo Rule

Filter chains (`filtered`, `stateFiltered`, `nameFiltered`) must be wrapped in `useMemo`. Plain `.filter()` calls in the render body produce new array references on every render, which causes downstream `useMemo` and `useEffect` hooks to run on every render, eventually triggering React error #185 via the `onSummaryChange` callback.

```tsx
const filtered = useMemo(
  () => containers.filter(c => c.Names?.toLowerCase().includes(query)),
  [containers, query]
)
```

---

## Sort Button

The `SortHead` component must use a native `<button>` element, not the shadcn `Button` component. The shadcn `size="sm"` prop injects `has-[>svg]:px-2.5` which overrides `px-0` when an SVG child is present, shifting the header text to the right and breaking alignment with cell content.

---

## Row Styling

- Running rows: subtle `bg-emerald-500/[0.015]` tint
- Expanded row: `bg-muted/35`
- Hover: `hover:bg-muted/30`
- State dot / inline badge in the Name cell: **not used** (state is shown in the Runtime column only)
