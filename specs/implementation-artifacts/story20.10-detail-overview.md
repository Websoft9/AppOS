# Story 20.10: Server Detail Overview Tab

**Epic**: Epic 20 – Servers
**Status**: Draft | **Priority**: P1 | **Depends on**: Story 20.1, Story 20.6

---

## User Story

As a superuser, I can open a stable `Overview` tab for one server, so that I can quickly understand its identity, connection metadata, provider context, and collected host facts without mixing that summary with lifecycle diagnosis.

---

## Implementation

- **Frontend**: Server Detail `Overview` tab only
- **Backend**: No ownership change; Story 20.1 remains the source of truth for read-model fields

### Ownership Note

This story owns the frontend `Overview` tab contract only.

It includes:

- `Overview` information architecture
- read-only presentation of metadata, provider summary, and system facts
- the `Edit Connection` entry in `Overview`

It does not include:

- list/detail navigation or tab rail behavior in Story 20.6
- `Connection` lifecycle diagnosis in Story 20.6
- backend/read-model ownership in Story 20.1

### Overview Information Architecture

`Overview` is the default descriptive tab in Server Detail and should stay compact.

### 1. Server Metadata

Show the stable descriptive fields for one server record:

- ID
- name
- connection type
- access summary
- tunnel state when relevant
- host / port / user
- credential reference
- created by / created / updated
- description when present

The section header exposes one `Edit Connection` action that reuses the existing unified edit dialog.

### 2. Cloud Provider

Show a lightweight provider summary:

- provider name
- region

When provider data is unavailable, keep the section visible and show `Unavailable`.

### 3. System Information

Show collected host facts when available:

- operating system
- kernel
- architecture
- CPU cores
- memory
- facts observed timestamp

When facts are unavailable, show a simple empty state.

---

## Acceptance Criteria

- [ ] AC1: Server Detail exposes `Overview` as the default descriptive tab for a selected server.
- [ ] AC2: `Overview` shows stable server metadata without duplicating `Connection` diagnostics or next-step guidance.
- [ ] AC3: `Overview` exposes `Edit Connection` in the metadata header and reuses the existing server edit dialog flow.
- [ ] AC4: `Overview` includes a dedicated `Cloud Provider` section with `Provider` and `Region` rows.
- [ ] AC5: `Cloud Provider` remains visible with fallback values when provider data is unavailable.
- [ ] AC6: `Overview` includes a `System Information` section backed by collected host facts when present.
- [ ] AC7: `System Information` shows a clear empty state when no facts have been collected yet.