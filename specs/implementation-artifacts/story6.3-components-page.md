# Story 6.3: Components Page

Status: proposed

## Story

As a system administrator,
I want one `System / Components` page with separate tabs for installed components and active services,
so that I can find both static system composition and runtime service state from a single entry point.

## Acceptance Criteria

1. Sidebar under `System` exposes a single `Components` entry for this domain.
2. The page route is `/components`.
3. Page contains exactly two primary tabs: `Installed Components` and `Active Services`.
4. `Installed Components` tab uses a simple list layout and does not include category grouping, search, or summary statistics.
5. Installed component rows focus on minimal fields: component name, version, and availability state.
6. Terminology in breadcrumbs, page title, helper text, and tabs uses `Components` and `Services` consistently; no `SBOM` or security-scanner terminology appears on the primary surface.
7. Existing `Services` functionality remains reachable from the new page and no separate sidebar entry is required after migration.
8. Layout is responsive and preserves usability on both desktop and mobile.

## Tasks / Subtasks

- [ ] Define page information architecture (AC: 1,2,3,4,5,6)
  - [ ] Finalize sidebar placement under `System`
  - [ ] Define breadcrumb/title/helper copy
  - [ ] Define minimal installed-components row layout and availability badge semantics
- [ ] Implement route and page shell (AC: 1,2,3,4,5,7,8)
  - [ ] Add `/components` route in TanStack Router structure
  - [ ] Add page header and simple tab layout
  - [ ] Add tab container with Installed Components and Active Services tabs
- [ ] Migrate navigation from legacy Services entry (AC: 1,6,7)
  - [ ] Remove or deprecate standalone sidebar `Services` item when Components page is ready
  - [ ] Preserve deep-link or redirect behavior as needed
- [ ] Validation (AC: 1-8)
  - [ ] Route/navigation tests or manual verification checklist
  - [ ] Responsive layout verification for mobile and desktop

## Dev Notes

- This story is the information-architecture layer that binds Story 6.1 and Story 6.2 together.
- Keep it as a composition story. It should not absorb the backend detection details from Story 6.4.
- If implementation sequencing requires it, the page shell can land first with mock/placeholder states while Story 6.1 and 6.2 complete.

### Page Layout Definition

```text
System
└── Components (/components)
  ├── Header
    ├── Tab: Installed Components
    └── Tab: Active Services
```

### ASCII Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ System / Components                                          [ Refresh ]    │
├──────────────────────────────────────────────────────────────────────────────┤
│ Components                                                                  │
│ Review installed platform components and active internal services in one     │
│ workspace.                                                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ [ Installed Components ] [ Active Services ]                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ Name                          Version                Available              │
│──────────────────────────────────────────────────────────────────────────────│
│ AppOS                         0.9.0                  Yes                    │
│ Nginx                         1.26.2                 Yes                    │
│ Redis                         7.2.5                  Yes                    │
│ Terraform CLI                 1.14.0                 Yes                    │
│ Pi Agent                      detected               No                     │
└──────────────────────────────────────────────────────────────────────────────┘

Active Services tab:

┌──────────────────────────────────────────────────────────────────────────────┐
│ System / Components                                          [ Refresh ]    │
├──────────────────────────────────────────────────────────────────────────────┤
│ [ Installed Components ] [ Active Services ]                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ Search [____________________]  State [All v]  Auto Refresh [5s v]           │
├──────────────────────────────────────────────────────────────────────────────┤
│ Service         State        PID      Uptime      CPU      Memory  Actions   │
│──────────────────────────────────────────────────────────────────────────────│
│ appos           Running      122      3d 2h       1.2%     92 MB   [...]     │
│ nginx           Running      58       3d 2h       0.3%     18 MB   [...]     │
│ redis           Running      76       3d 2h       0.7%     24 MB   [...]     │
│ worker          Stopped      -        -           -        -       [...]     │
└──────────────────────────────────────────────────────────────────────────────┘

Mobile sketch:

┌──────────────────────────────┐
│ Components      [ Refresh ]  │
├──────────────────────────────┤
│ [ Installed ][ Services ]    │
├──────────────────────────────┤
│ AppOS                        │
│ 0.9.0                        │
│ Available                    │
├──────────────────────────────┤
│ Nginx                        │
│ 1.26.2                       │
│ Available                    │
└──────────────────────────────┘
```

The page should keep one consistent shell while switching only the tab-specific controls and list body.

## References

- [Source: specs/implementation-artifacts/epic6-components.md#Scope]
- [Source: specs/implementation-artifacts/epic6-components.md#Key Technical Decisions]
- [Source: dashboard/src/components/layout/Sidebar.tsx]
