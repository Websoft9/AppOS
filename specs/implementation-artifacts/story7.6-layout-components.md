# Story 7.6: Layout Components

## Overview

**Epic**: Epic 7 - Dashboard Foundation  
**Story**: 7.6 - Layout Components  
**Status**: Done  
**Priority**: P0 (Foundation for all feature modules)

## Objective

Build 5-zone layout structure for the dashboard. All zones are reusable layout components, supporting responsive and Dark/Light mode.

## 5-Zone Layout Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         HEADER                              │
│  [Logo]  [Breadcrumbs/Title]        [Theme][Lang][UserMenu] │
├─────────┬───────────────────────────────────────────────────┤
│         │                                                   │
│ SIDEBAR │              CONTENT AREA                         │
│         │                                                   │
│ [Nav]   │            ┌─────────────────────┐               │
│ [Menu]  │            │   Page Content      │               │
│ [Items] │            │   (<Outlet />)      │               │
│         │            └─────────────────────┘               │
│         │                                                   │
│         ├───────────────────────────────────────────────────┤
│         │                    BOTTOM                         │
│[Toggle] │  [Status]    [Notifications]    [Docs][API][Help] │
└─────────┴───────────────────────────────────────────────────┘
```

Bottom 与 Content Area 同宽，Sidebar 保持垂直连续性。

## Zone Requirements

### 1. AppShell

Main container, orchestrates all zones using CSS Grid layout.

- Grid Areas: `header header / sidebar content / sidebar bottom`
- Provide LayoutContext to children (sidebar state, responsive breakpoints)
- min-height: 100vh

### 2. Header

**Full width, fixed height**: 64px (desktop) / 56px (mobile)

| Position | Content |
|----------|---------|
| Left | Logo (link to home) |
| Center-Left | Page title or breadcrumbs (route-based) |
| Right | Theme toggle, language switcher, user menu slot |

- User menu is a **slot** — Epic 3 (Auth) provides actual component

### 3. Sidebar

**Left side**: 240px expanded / 64px collapsed / hidden on mobile

- Two navigation groups with collapsible headers:
  - **Workspace** (top): Dashboard, App Store
  - **Admin** (bottom): Services
- Each group header shows label + chevron; click to collapse/expand children
- Group collapse state persisted to `localStorage` (`sidebar-groups` key)
- When sidebar is collapsed (icon-only mode), group headers are hidden
- Active route highlighted
- Sidebar collapse toggle button at bottom
- Mobile: overlay drawer (Sheet component)
- Sidebar collapsed state persisted to `localStorage`

### 4. Content Area

**Center zone**, between Sidebar and Bottom

- Renders page content via `<Outlet />`
- Independent scroll container
- Optional page header (title + action buttons)

### 5. Bottom

**Below Content Area**, same width as Content Area

| Position | Content |
|----------|---------|
| Left | System status, connection state |
| Center | Notification/alert summary with badge count |
| Right | Quick action links (help, docs, api) |

- Height: 40px default, expandable to show notification list
- Collapse when clicking outside

## Responsive Behavior

| Breakpoint | Sidebar | Bottom | Header |
|------------|---------|--------|--------|
| Desktop ≥1024px | Visible, collapsible | Full info | Full controls |
| Tablet 768-1023px | Drawer overlay | Condensed | Hamburger menu |
| Mobile <768px | Full-screen drawer | Icons only | Minimal |

### Desktop (≥1024px)

```
+------------------------------------------------------------------+
|                        HEADER (64px)                             |
| [Logo]           [Breadcrumbs]              [🌙] [EN] [👤 User] |
+----------+-------------------------------------------------------+
|          |                                                       |
| SIDEBAR  |              CONTENT AREA                             |
| (240px)  |                                                       |
| [📊] Dash|        (Page Content)                                 |
| [🏪] Stor|                                                       |
|----------|                                                       |
| ADMIN    |                                                       |
| [⚙️] Serv|                                                       |
|          +-------------------------------------------------------+
|          |              BOTTOM (40px)                             |
| [◀ Hide] | [✓ Connected]  [🔔 2 Alerts]    [📚 Docs] [🔌 API] [❓ Help]  |
+----------+-------------------------------------------------------+
```

### Tablet / Mobile

```
+--------------------------------------------+
|           HEADER (56px)                    |
| [☰] [Logo]                [🌙] [👤]       |
+--------------------------------------------+
|            CONTENT AREA                    |
|          (Page Content)                    |
+--------------------------------------------+
|           BOTTOM (40px)                    |
| [✓ OK]   [🔔 2]           [🔌] [❓]     |
+--------------------------------------------+

Sidebar: Drawer overlay (tablet) / full-screen (mobile)
```

## Technical Decisions

- **Layout method**: CSS Grid with named areas, sidebar spans content + bottom rows
- **State management**: LayoutContext (sidebar collapsed/open, bottom expanded, responsive flags)
- **Sidebar persistence**: `localStorage` key `sidebar-collapsed`
- **Component library**: shadcn/ui Sheet (drawer), Button, Avatar, DropdownMenu
- **Icons**: lucide-react

## File Structure

```
src/components/layout/
├── index.ts              # Re-exports
├── AppShell.tsx
├── Header.tsx
├── Sidebar.tsx
├── ContentArea.tsx
├── Bottom.tsx
├── Logo.tsx
├── Breadcrumbs.tsx
├── NavItem.tsx
├── UserMenu.tsx          # Slot, Epic 3 provides actual impl
├── SidebarToggle.tsx
└── MobileDrawer.tsx
```

## Acceptance Criteria

- [x] AppShell renders 5-zone layout (Header, Sidebar, Content, Bottom)
- [x] Header: logo, breadcrumbs, theme toggle, language switcher, user menu slot
- [x] Sidebar: nav items with icons, collapse/expand, active route highlight
- [x] Sidebar: mobile drawer mode with open/close animation
- [x] ContentArea: renders `<Outlet />`, independent scroll
- [x] Bottom: status, notifications (expandable), quick actions (docs, api, help)
- [x] Bottom width aligned with Content Area
- [x] Responsive at 3 breakpoints (desktop/tablet/mobile)
- [x] Dark/Light mode styling for all zones
- [x] Keyboard navigation (Tab, Escape to close drawers)
- [x] ARIA labels on interactive elements
- [x] Sidebar collapsed state persists across page reloads
- [x] No layout shift on initial load

## Implementation Notes

- Login page includes `<ModeToggle />` in top-right corner for standalone theme switching
- `tw-animate-css` provides animation utilities (`animate-in`, `fade-in`, `zoom-in`, `slide-in`) for dialog/sheet/dropdown transitions

## Integration Notes

- **Epic 3 (Auth)**: provides UserMenu component for Header slot
- **Epic 5/6**: register navigation items for Sidebar
- **Story 7.7**: Bottom notifications integrate with Toast system
- **Story 7.3**: provides design tokens and shadcn/ui primitives
- **Story 7.5**: provides LayoutContext patterns
