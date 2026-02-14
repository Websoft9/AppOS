# Epic 3: Authentication (Frontend)

## Overview

Frontend auth implementation using PocketBase JS SDK. Backend auth (JWT, token management, password reset) is built into PocketBase — zero custom Go code needed.

PB auth is fully **stateless**: no sessions, tokens not stored server-side. "Logout" = discard token locally (`pb.authStore.clear()`).

**Status**: Done | **Priority**: P0 | **Depends on**: Epic 1, Epic 7

## Key Decisions

- **Dual-collection auth**: `_superusers` (admin) + `users` (regular). Login tries `_superusers` first, falls back to `users`
- **Setup page**: Fresh container first visit → `/setup` to create admin. 3s countdown then auto-login
- **INIT_MODE**: `setup` (default, create admin via Web UI) / `auto` (entrypoint auto-creates)
- **Auto-login pattern**: Setup and Register show success screen + 3s countdown → auto `authWithPassword`
- **Logout UX**: AlertDialog confirmation → success feedback → redirect to login
- **Root route**: `index.tsx` checks `/api/appos/setup/status`, `needsSetup` → `/setup`, else → `/login`

## Stories

### 3.1: PocketBase Client Setup ✅
- `src/lib/pb.ts` — singleton `new PocketBase('/')`

### 3.2: Auth Context & Hooks ✅
- `src/contexts/AuthContext.tsx` — `useAuth()` hook
- On mount: `authRefresh()` verifies token (selects collection by `collectionName`)
- Dual-collection login: `_superusers` → `users` fallback
- Distinguishes network errors from auth failures

### 3.3: Login Page ✅
- Form submit → `login()` (dual-collection)
- Checks `needsSetup` → redirects to `/setup`
- Already logged in → redirects to dashboard
- Error + loading state

### 3.4: Protected Routes ✅
- `_auth.tsx` `beforeLoad` guard: `pb.authStore.isValid` check
- Header shows user email + role badge (Superuser / User)
- Logout: controlled AlertDialog confirm → 800ms success feedback → clear authStore + redirect

### 3.5: Setup Page ✅
- `/setup` — Create admin on fresh container first visit
- Backend `GET /api/appos/setup/status` + `POST /api/appos/setup/init`
- `checkNeedsSetup`: excludes PB installer superuser (`__pbinstaller@example.com`)
- 3s countdown after success → auto-login to `_superusers`

### 3.6: Register Page ✅
- `/register` — Create `users` collection account
- Success screen + 3s countdown → auto-login

### 3.7: Password Reset ✅
- `/forgot-password` — Send reset email (supports `_superusers` + `users`)
- `/reset-password` — Token validation + new password

## Technical Design

### PB Client

```typescript
// src/lib/pb.ts
import PocketBase from 'pocketbase';
export const pb = new PocketBase('/');
```

### Auth Context

```typescript
// src/contexts/AuthContext.tsx

// On mount — verify token with server (not just local expiry)
try {
  await pb.collection('users').authRefresh();  // → new token + latest record
} catch {
  pb.authStore.clear();  // token invalid or expired server-side
}

// Login
await pb.collection('users').authWithPassword(email, password);
// → authStore auto-updates: token + record persisted to localStorage

// Logout (no server endpoint — PB is stateless)
pb.authStore.clear();

// Reactive — SDK fires on any authStore change
pb.authStore.onChange((token, record) => setUser(record));

// Access
pb.authStore.isValid   // local JWT exp check
pb.authStore.token     // JWT string
pb.authStore.record    // auth record data (not .user)
```

### Route Guard

```typescript
// src/routes/_app/_auth.tsx
beforeLoad: async ({ location }) => {
  if (!pb.authStore.isValid) {
    throw redirect({ to: '/login', search: { redirect: location.href } });
  }
}
```

## Key PB Auth Behaviors

- **No logout endpoint** — stateless, just discard token client-side
- **`authStore.isValid`** — local JWT exp check only, no network call
- **`authRefresh()`** — server-side verification, returns new token + latest user data. Use on page reload
- **`authStore.record`** — the authenticated record (not `.user`)
- **`authStore.onChange`** — callback fires on every authStore change (login, logout, refresh)
- **Token auto-attached** — SDK attaches `Authorization` header to all subsequent requests automatically

## Definition of Done

- [x] Login flow works end-to-end (email + password, dual-collection)
- [x] Protected routes redirect to login when unauthenticated
- [x] Auth persists across page refresh (verified via `authRefresh`)
- [x] Logout clears session and redirects to login (with confirmation dialog)
- [x] Error states shown for invalid credentials
- [x] Setup page for first-time admin creation
- [x] Register page for user creation
- [x] Forgot-password + reset-password flow
- [x] User email + role badge in header

## Out of Scope (v1)

OAuth, OTP, MFA, RBAC UI
