# Story 14.4: IaC Browser UI

**Epic**: Epic 14 - IaC File Management  
**Priority**: P1  
**Status**: Done

---

## User Story

As an admin, I want a web-based code editor to browse and edit any text file under `/appos/data/`, so that I can make IaC changes without SSH access.

## Acceptance Criteria

- [x] Install `@monaco-editor/react` — add to `dashboard/package.json`
- [x] New route `/files` added via TanStack Router file-based routing; supports `?path=` search param for deep-linking
- [x] Sidebar file tree showing `apps/`, `workflows/`, `templates/` and their contents (calls Story 14.1 List API)
- [x] Clicking a file opens Monaco Editor with auto-detected language mode (YAML / JSON / TOML / Shell / Markdown / plaintext fallback)
- [x] Save button calls Story 14.2 PUT API; shows success/error feedback
- [x] Unsaved-changes warning on tab switch or close
- [x] Superuser only — redirect non-superusers via `_superuser` layout guard; no deploy trigger button

## Dependencies

- Story 14.1 (List API)
- Story 14.2 (PUT API)
