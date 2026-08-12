---
title: 'Fix terminal files list missing vertical scrollbar'
type: 'bugfix'
created: '2026-08-12'
status: 'done'
route: 'one-shot'
---

## Intent

**Problem:** On the terminal's files list page (`FileManagerPanel`), when a directory contains many files/folders, the list display area has no vertical scrollbar and rows are clipped by the parent container, so the full listing cannot be seen.

**Approach:** Constrain the `ScrollArea` flex child with `min-h-0` so it shrinks to the available panel height and its internal viewport scrolls, and clip overflow at the panel root.

## Suggested Review Order

- `web/src/components/connect/FileManagerPanel.tsx:837` — panel root now `overflow-hidden`; confirms the flex-column root clips, matching `TerminalPanel`/`DockerPanel`.
- `web/src/components/connect/FileManagerPanel.tsx:1146` — `ScrollArea` gains `flex-1 min-h-0`; the core fix letting the Radix viewport scroll.
- `web/src/components/connect/FileManagerPanel.test.tsx` — new regression test asserts the scroll container is height-constrained.
- `web/src/components/connect/TerminalPanel.tsx:521` — sibling pattern reference (`flex-1 min-h-0`).

## Code Map

- `web/src/components/connect/FileManagerPanel.tsx` -- files list panel; root + list scroll container edited.
- `web/src/components/connect/FileManagerPanel.test.tsx` -- existing Vitest suite; regression test added.
- `web/src/components/connect/TerminalPanel.tsx` -- sibling panel with correct `flex-1 min-h-0` pattern.

## Tasks & Acceptance

**Execution:**
- [x] `web/src/components/connect/FileManagerPanel.tsx:837` -- add `overflow-hidden` to panel root -- clip spill at the panel boundary, matching sibling panels.
- [x] `web/src/components/connect/FileManagerPanel.tsx:1146` -- add `min-h-0` to `ScrollArea` -- allow the flex child to shrink below content height so its viewport scrolls vertically.
- [x] `web/src/components/connect/FileManagerPanel.test.tsx` -- add regression test asserting the scroll container classes -- guard against re-introduction.

**Acceptance Criteria:**
- Given a directory with many files, when the files list renders, then the list area shows a vertical scrollbar and all rows are reachable by scrolling.
- Given the panel renders, when inspected in the DOM, then the `ScrollArea` element carries both `flex-1` and `min-h-0`, and its parent root carries `overflow-hidden`.

## Verification

**Commands:**
- `npx vitest run src/components/connect/FileManagerPanel.test.tsx` -- expected: all 11 tests pass (including new regression test).
- `npx eslint src/components/connect/FileManagerPanel.tsx src/components/connect/FileManagerPanel.test.tsx` -- expected: no output.
- `npx tsc --noEmit` -- expected: no errors.
- `npx prettier --check src/components/connect/FileManagerPanel.tsx src/components/connect/FileManagerPanel.test.tsx` -- expected: all files formatted.

**Manual checks (if no CLI):**
- In the terminal files view of a directory with many entries, confirm the list scrolls vertically and the full listing is reachable.
