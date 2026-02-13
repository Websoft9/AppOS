# Epic 7: Dashboard Foundation

## Overview

**Objective**: Build reusable frontend framework infrastructure - project setup, design system, routing, state management, and layout components (NO business logic)

**Business Value**: Provides consistent, production-ready foundation for all feature modules (Store, Services, Auth), eliminating setup duplication and ensuring UI/UX consistency

**Priority**: P0 (Foundation for Epic 3, 5, 6)

**Status**: Not Started

## Scope

Implement frontend infrastructure only (framework, not features):
- Vite + React 18 + TypeScript SPA foundation
- **TanStack Router** framework and file-based routing structure
- **shadcn/ui + Tailwind CSS** design system with **Dark/Light mode** support
- **react-i18next** internationalization infrastructure
- State Management setup:
  - **TanStack Query** configuration (server state framework)
  - **React Context** utilities (client state patterns)
- **Layout components** (AppShell, Header, Sidebar, Content Area)
- **Common UI components** (ErrorBoundary, Toaster, Loading states)
- cockpit.js integration for system operations
- Build pipeline and optimization

**Out of Scope**: Authentication logic, business features (Store/Services), data models

## Success Criteria

- Dashboard framework loads in < 2 seconds (initial empty state)
- Layout components render properly (Header, Sidebar with placeholder menu)
- Theme switching (Dark/Light) works
- Language switching infrastructure ready (en/zh placeholders)
- TanStack Router navigates between placeholder pages
- cockpit.js API accessible and functional
- Build pipeline produces optimized static assets
- Epic 3/5/6 can start development immediately using framework

## Stories

- [ ] 7.1: Project Setup & Build Pipeline
  - Vite + React 18 + TypeScript configuration
  - ESLint + Prettier setup
  - Environment variables (.env structure)
  - Development and production builds
  - Hot module replacement (HMR)
  
- [ ] 7.2: TanStack Router Setup
  - Install and configure TanStack Router
  - File-based routing structure (`src/routes/`)
  - Route tree generation
  - Route loader/action patterns
  - Navigation utilities
  
- [ ] 7.3: Design System Foundation
  - Install shadcn/ui + Tailwind CSS 4
  - Theme system (CSS variables)
  - Dark/Light mode implementation
  - Color palette and typography
  - Common component primitives (Button, Input, Card, etc.)
  
- [ ] 7.4: i18n Infrastructure
  - Install react-i18next
  - Language detection and switching
  - Translation file structure (`locales/en.json`, `locales/zh.json`)
  - `useTranslation()` hook setup
  - Language switcher component
  
- [ ] 7.5: State Management Setup
  - TanStack Query configuration (QueryClient, QueryClientProvider)
  - React Context utilities and patterns
  - Devtools setup (React Query Devtools)
  - API client base setup (axios/fetch wrapper)
  
- [ ] 7.6: Layout Components
  - `<AppShell>` main layout container
  - `<Header>` with logo, theme toggle, language switcher, user menu slot
  - `<Sidebar>` with collapsible navigation (menu items from config)
  - `<ContentArea>` with breadcrumbs and page header
  - Responsive behavior (mobile drawer, desktop sidebar)
  
- [ ] 7.7: Common UI Components
  - `<ErrorBoundary>` for error handling
  - `<Toaster>` notification system (sonner or shadcn toast)
  - `<LoadingSpinner>` and loading states
  - `<Suspense>` boundaries for code splitting
  - Empty states, error pages (404, 500)
  

- [ ] 7.8: Responsive Design & Accessibility
  - Mobile-first responsive layout (1024px+ tablet, 768px+ mobile)
  - Touch-friendly interactions
  - Keyboard navigation support
  - ARIA labels and semantic HTML
  - Focus management

## Dependencies

- Prerequisites: 
  - Epic 1 (Infrastructure) - Docker, build tools, development environment
  - Cockpit installed and cockpit-ws running
- Downstream: 
  - **Epic 3 (Auth)** - builds on Epic 7 framework, adds auth UI and state
  - **Epic 5 (Store Module)** - uses Epic 7 layout, routing, and components
  - **Epic 6 (Services Module)** - uses Epic 7 layout, routing, and components

## Technical Notes

### Core Stack
- **Build Tool**: Vite 5+
- **Framework**: React 18 + TypeScript 5+
- **Routing**: TanStack Router (file-based routing)
- **UI Library**: shadcn/ui + Tailwind CSS + CSS variables for theming
- **Theme**: Dark/Light mode with system preference detection
- **i18n**: react-i18next + i18next-browser-languagedetector

### State Management Strategy
- **Server State**: TanStack Query (formerly React Query)
  - All BaaS API calls
  - Data fetching, caching, synchrosetup
  - QueryClient configuration
  - Query and mutation patterns
  - Cache management strategies
  - Devtools integration
- **Client State**: React Context patterns
  - Theme context (dark/light mode)
  - Locale context (language selection)
  - UI state context (sidebar collapsed, etc)
  - Context composition patterns

### Project Structure
```
dashboard/
  src/
    components/       # Shared UI components (Button, Card, etc.)
    contexts/         # React Context providers (Theme, Locale)
    hooks/            # Custom React hooks
    layouts/          # Layout components (AppShell, Header, Sidebar)
    lib/              # Utilities (api client, cockpit wrapper, etc.)
    routes/           # TanStack Router file-based routes
      _app/           # Main app layout route
        _auth/        # Protected routes (Epic 3 will populate)
        index.tsx     # Dashboard home (placeholder)
      login.tsx       # Login page (Epic 3 will implement)
    locales/          # i18n translation files
      en.json
      zh.json
    index.css         # Global styles
    main.tsx          # App entry point
```

### Integration Points for Feature Epics

**For Epic 3 (Auth):**
- Use `<Header>` user menu slot for auth UI
- Add routes under `routes/login.tsx`, `routes/register.tsx`
- Create AuthContext in `contexts/AuthContext.tsx`
- Add route guards using TanStack Router

**For Epic 5 (Store) & Epic 6 (Services):**
- Add routes under `routes/_app/_auth/store/` and `routes/_app/_auth/services/`
- Use layout components (`<AppShell>`, `<Header>`, `<Sidebar>`)
- Use shadcn/ui components and design tokens
- Use i18n for translations
- Use TanStack Query for data fetching

### Build and Deployment
- **Build Output**: Static files in `dashboard/dist/`
- **Served at**: `/dashboard` via reverse proxy
- **Environment**: Vite env vars for API endpoints
- **Optimization**: Code splitting, tree shaking, minification