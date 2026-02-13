# Epic 3: Authentication & Authorization

## Overview

**Objective**: Build complete authentication system - backend API layer (PocketBase wrapper) and frontend auth UI/state management

**Business Value**: Secure user authentication foundation for all websoft9 features, unified auth experience across CLI/API/Dashboard

**Priority**: P0 (Foundation for Epic 5, 6, and all protected features)

**Status**: Not Started

## Scope

Implement full-stack authentication system:

### Backend (Go + PocketBase)
- PocketBase client library (auth operations wrapper)
- REST API endpoints for auth operations
- JWT middleware and token validation
- Role-based access control (admin/user)
- Rate limiting and security measures

### Frontend (React)
- Auth UI pages (login, register, password reset)
- Auth state management (Context + hooks)
- Protected route guards
- Session management (token refresh, auto-logout)
- Integration with Dashboard framework (Epic 7)

## Success Criteria

- Users can register and login via Dashboard
- JWT tokens properly issued and validated
- Protected routes redirect to login when unauthenticated
- Token refresh works transparently (no UI disruption)
- CLI and API clients can authenticate using same backend
- Security: PocketBase credentials never exposed to frontend
- Auth flow completes in < 1 second (P95)

## Stories

### Backend Stories
- [ ] 3.1: PocketBase Client Library
  - Create `internal/pocketbase/client.go` (HTTP client wrapper)
  - Create `internal/pocketbase/auth.go` (auth operations)
  - Type definitions (AuthRequest, AuthResponse, User)
  - Error handling and logging
  
- [ ] 3.2: Auth API Endpoints
  - `POST /api/auth/login` - User login
  - `POST /api/auth/register` - User registration
  - `POST /api/auth/logout` - User logout
  - `POST /api/auth/refresh` - Token refresh
  - `GET /api/auth/me` - Get current user
  - Request validation and sanitization
  
- [ ] 3.3: JWT Middleware & Security
  - JWT token validation middleware
  - Token extraction from headers/cookies
  - Role-based authorization guards
  - Rate limiting (prevent brute force)
  - CORS configuration

### Frontend Stories
- [ ] 3.4: Auth API Client
  - Create `src/lib/api/auth.ts` (API client)
  - TanStack Query hooks (`useLogin`, `useLogout`, `useRegister`)
  - Error handling and type safety
  
- [ ] 3.5: Auth State Management
  - Create `src/contexts/AuthContext.tsx`
  - `useAuth()` hook (access user, login, logout)
  - `useUser()` hook (current user data)
  - Persist auth state (localStorage/sessionStorage)
  - Token refresh mechanism
  
- [ ] 3.6: Auth UI Pages
  - `/login` page (shadcn/ui form components)
  - `/register` page with validation
  - `/forgot-password` page
  - Responsive design (mobile-friendly)
  - Loading states and error messages
  - Redirect after login (return to original page)
  
- [ ] 3.7: Protected Routes & Guards
  - `<RequireAuth>` component wrapper
  - Route guards in TanStack Router
  - Redirect to login when unauthenticated
  - Handle token expiration gracefully
  - "Remember me" functionality

## Dependencies

- Prerequisites:
  - Epic 1 (Infrastructure) - Go backend, Docker setup
  - Epic 7 (Dashboard Foundation) - React framework, TanStack Router, shadcn/ui
  - PocketBase running and accessible
- Downstream:
  - Epic 5 (Store Module) - needs authenticated users
  - Epic 6 (Services Module) - needs authenticated users
  - Epic 8 (Backup) - needs authenticated users

## Technical Notes

### Backend Architecture

```go
// Project structure
backend/
  internal/
    pocketbase/
      client.go      // PocketBase HTTP client
      auth.go        // Auth operations (Login, Register, etc)
      types.go       // Request/Response types
    server/
      auth_handler.go   // REST API handlers
      middleware.go     // JWT validation middleware
```

**PocketBase Integration:**
- Backend acts as BFF (Backend for Frontend)
- PocketBase admin API key stored in backend config (not frontend)
- Backend validates user credentials against PocketBase
- Returns JWT token issued by backend (not PocketBase token directly)

**API Design:**
```
POST /api/auth/login
  Request:  { email: string, password: string }
  Response: { token: string, user: User, expiresAt: string }

POST /api/auth/register
  Request:  { email: string, password: string, passwordConfirm: string }
  Response: { token: string, user: User }

POST /api/auth/refresh
  Request:  { refreshToken: string }
  Response: { token: string, expiresAt: string }

GET /api/auth/me
  Headers:  Authorization: Bearer <token>
  Response: { user: User }
```

### Frontend Architecture

```typescript
// Project structure
dashboard/src/
  contexts/
    AuthContext.tsx      // Auth state provider
  lib/
    api/
      auth.ts           // Auth API client
      client.ts         // Base API client (with auth interceptor)
  routes/
    _app/
      _auth/            // Protected routes (require auth)
        index.tsx
        store/
        services/
    login.tsx           // Public login page
    register.tsx        // Public register page
```

**Auth Flow:**
1. User submits login form
2. `useLogin()` mutation calls `POST /api/auth/login`
3. Backend validates credentials with PocketBase
4. Backend returns JWT token + user data
5. Frontend stores token in AuthContext + localStorage
6. AuthContext provides `user` and `isAuthenticated` to app
7. Protected routes check `isAuthenticated`, redirect if false

**Token Refresh Strategy:**
- Use access token (short-lived, 15 min) + refresh token (long-lived, 7 days)
- Axios/Fetch interceptor auto-refreshes on 401 Unauthorized
- If refresh fails, logout and redirect to login

**State Management:**
```typescript
// AuthContext API
const {
  user,              // Current user or null
  isAuthenticated,   // Boolean
  isLoading,         // Boolean (checking stored token)
  login,             // (email, password) => Promise<void>
  logout,            // () => void
  register,          // (email, password) => Promise<void>
} = useAuth();
```

### Security Considerations

1. **Token Storage:**
   - Access token: Memory (React state) or localStorage
   - Refresh token: httpOnly cookie (if using cookies) or secure localStorage
   - Never store sensitive tokens in plain text

2. **HTTPS Only:**
   - All auth requests must use HTTPS in production
   - Secure cookie flag enabled

3. **CSRF Protection:**
   - Use SameSite cookies
   - CSRF token for state-changing operations

4. **Rate Limiting:**
   - Limit login attempts (5 per minute per IP)
   - Exponential backoff on failures

5. **Password Policy:**
   - Minimum 8 characters
   - Require mix of letters, numbers, symbols (configurable)

### Integration with Epic 7 (Dashboard)

**Layout Integration:**
```typescript
// Epic 7's Header component will use Epic 3's auth state
import { useAuth } from '@/contexts/AuthContext';

function Header() {
  const { user, logout } = useAuth();
  
  return (
    <header>
      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Avatar>{user.email[0]}</Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={logout}>
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  );
}
```

**Router Integration:**
```typescript
// Epic 7's router setup, Epic 3's guards
import { RequireAuth } from '@/components/RequireAuth';

// In route definitions
{
  path: '/_app',
  component: () => (
    <RequireAuth>
      <AppLayout />
    </RequireAuth>
  ),
  children: [
    { path: '/store', component: StoreModule },
    { path: '/services', component: ServicesModule },
  ],
}
```

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| PocketBase service down | Health check endpoint, fallback to maintenance mode, clear error messages |
| Token expiration during user action | Auto-refresh before expiration, retry failed request after refresh |
| Brute force attacks | Rate limiting, account lockout after N failed attempts, CAPTCHA |
| XSS token theft | Use httpOnly cookies for refresh tokens, sanitize all inputs, CSP headers |
| Session fixation | Regenerate session ID after login, expire old tokens |

## Definition of Done

- [ ] All story acceptance criteria met
- [ ] Backend API endpoints tested (unit + integration tests)
- [ ] Frontend auth flows work (login, logout, register, refresh)
- [ ] Protected routes redirect properly
- [ ] Token refresh happens transparently
- [ ] Security review passed (no token leakage, proper validation)
- [ ] Works with CLI authentication (same backend API)
- [ ] Performance: Login completes in < 1s (P95)
- [ ] Documentation: API docs, frontend integration guide
- [ ] Code reviewed and approved

## Future Enhancements (Out of Scope for v1)

- Social login (OAuth: GitHub, Google)
- Two-factor authentication (2FA/MFA)
- Advanced RBAC (custom roles, permissions)
- Audit logs (login history, security events)
- Password complexity rules (configurable)
- Account email verification
- Magic link login (passwordless)
