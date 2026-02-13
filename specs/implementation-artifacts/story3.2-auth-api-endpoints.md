# Story 3.2: Auth API Endpoints

**Epic**: Epic 3 - Authentication & Authorization  
**Priority**: P0  
**Status**: Ready for Dev  
**Dependencies**: Story 3.1 (PocketBase Client Library) ✅  
**Estimated Effort**: 3-4 hours

## User Story

As a frontend/CLI client, I want REST API endpoints for login, registration, token refresh, logout, and current user retrieval, so that I can authenticate and manage sessions without directly accessing PocketBase.

## Context

The PocketBase client library (Story 3.1) provides `AuthWithPassword`, `CreateUser`, and `RefreshAuth`. This story wraps those into HTTP handlers under `/api/auth/*`, following the existing closure-based dependency injection pattern (`handlers.DeployApp(s.asynqClient)`).

**Key Design Decisions:**
- Auth routes (`login`, `register`) are **public** — outside auth middleware
- Protected routes (`refresh`, `me`) require a valid token in `Authorization: Bearer <token>` header
- Logout is **stateless** (PocketBase JWT) — endpoint returns 204, client discards token
- Handlers receive `*pocketbase.Client` via closure injection

## Acceptance Criteria

- [ ] 1. `POST /api/auth/login` authenticates user and returns `{token, user}`
- [ ] 2. `POST /api/auth/register` creates user, auto-logins, returns `{token, user}`
- [ ] 3. `POST /api/auth/refresh` refreshes token (requires valid Bearer token)
- [ ] 4. `POST /api/auth/logout` returns 204 (stateless, no server action)
- [ ] 5. `GET /api/auth/me` returns current user from PocketBase (requires valid Bearer token)
- [ ] 6. Proper error responses: 400 (bad request), 401 (invalid credentials), 409 (email exists), 500 (server error)
- [ ] 7. Request validation: email format, password min length (8 chars)
- [ ] 8. JSON response envelope: `{"token": "...", "user": {...}}` on success, `{"error": "..."}` on failure
- [ ] 9. Routes registered in `server.go` outside the `/v1` auth-protected group
- [ ] 10. Unit tests with `httptest` for all endpoints, 80%+ coverage

## Tasks

### Task 1: Auth Handler File (90 min)

**File**: `backend/internal/server/handlers/auth.go`

**Implement these handler constructors (closure pattern):**

```go
func Login(pb *pocketbase.Client) http.HandlerFunc
func Register(pb *pocketbase.Client) http.HandlerFunc
func RefreshToken(pb *pocketbase.Client) http.HandlerFunc
func Logout() http.HandlerFunc
func Me(pb *pocketbase.Client) http.HandlerFunc
```

**Request/Response Types (define in same file):**

```go
type LoginRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type RegisterRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type AuthSuccessResponse struct {
    Token string          `json:"token"`
    User  pocketbase.User `json:"user"`
}

type ErrorResponse struct {
    Error string `json:"error"`
}
```

**Login Handler Logic:**
1. Decode JSON body → `LoginRequest`
2. Validate email non-empty, password non-empty
3. Call `pb.AuthWithPassword(email, password)`
4. On PBError → map to HTTP status (400/401)
5. Return `AuthSuccessResponse{Token: resp.Token, User: resp.User}`

**Register Handler Logic:**
1. Decode JSON body → `RegisterRequest`
2. Validate email format (`strings.Contains(email, "@")`), password >= 8 chars
3. Call `pb.CreateUser(email, password)`
4. On PBError → map to HTTP status (400 validation / 409 duplicate)
5. Return `AuthSuccessResponse`

**Refresh Handler Logic:**
1. Extract Bearer token from `Authorization` header
2. Call `pb.RefreshAuth(token)`
3. On error → 401
4. Return `AuthSuccessResponse`

**Me Handler Logic:**
1. Extract Bearer token from `Authorization` header
2. Call `pb.RefreshAuth(token)` (PocketBase returns user data with refresh)
3. Return `{"user": {...}}` (token optional in response)

**Logout Handler:**
1. Return 204 No Content (stateless JWT — client discards token)

**Helper functions:**
```go
func writeJSON(w http.ResponseWriter, status int, v interface{})
func writeError(w http.ResponseWriter, status int, msg string)
func extractBearerToken(r *http.Request) (string, error)
```

### Task 2: Route Registration (15 min)

**File**: `backend/internal/server/server.go`

Add auth routes **before** the `/v1` auth-protected group:

```go
// Auth routes (public - no auth middleware)
r.Route("/api/auth", func(r chi.Router) {
    r.Post("/login", handlers.Login(s.pbClient))
    r.Post("/register", handlers.Register(s.pbClient))
    r.Post("/logout", handlers.Logout())

    // These require a valid token but use their own extraction
    r.Post("/refresh", handlers.RefreshToken(s.pbClient))
    r.Get("/me", handlers.Me(s.pbClient))
})
```

### Task 3: Unit Tests (60 min)

**File**: `backend/internal/server/handlers/auth_test.go`

**Test each endpoint with `httptest`:**

| Test | Method | Expected |
|------|--------|----------|
| `TestLogin_Success` | POST valid creds | 200 + token + user |
| `TestLogin_InvalidCreds` | POST wrong password | 401 |
| `TestLogin_BadRequest` | POST empty body | 400 |
| `TestRegister_Success` | POST new user | 201 + token + user |
| `TestRegister_DuplicateEmail` | POST existing email | 409 |
| `TestRegister_WeakPassword` | POST short password | 400 |
| `TestRefresh_Success` | POST with valid token | 200 + new token |
| `TestRefresh_NoToken` | POST without header | 401 |
| `TestMe_Success` | GET with valid token | 200 + user |
| `TestLogout` | POST | 204 |

**Test Pattern:**
```go
func TestLogin_Success(t *testing.T) {
    mockPB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        json.NewEncoder(w).Encode(map[string]interface{}{
            "token":  "test-token",
            "record": map[string]string{"id": "123", "email": "test@example.com"},
        })
    }))
    defer mockPB.Close()

    pb := pocketbase.NewClient(pocketbase.Config{BaseURL: mockPB.URL})
    handler := handlers.Login(pb)

    body := `{"email":"test@example.com","password":"password123"}`
    req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(body))
    rec := httptest.NewRecorder()

    handler.ServeHTTP(rec, req)

    assert.Equal(t, http.StatusOK, rec.Code)
}
```

### Task 4: Error Mapping (included in Task 1)

Map PocketBase errors to appropriate HTTP status codes:

```go
func mapPBErrorToStatus(err error) int {
    var pbErr *pocketbase.PBError
    if errors.As(err, &pbErr) {
        switch pbErr.Code {
        case 400:
            return http.StatusBadRequest
        case 401, 403:
            return http.StatusUnauthorized
        case 404:
            return http.StatusNotFound
        default:
            return http.StatusInternalServerError
        }
    }
    return http.StatusInternalServerError
}
```

**Special case for Register**: PocketBase returns 400 for duplicate email — detect via `pbErr.Data` containing `"email"` key and return `409 Conflict`.

## Technical Reference

### API Endpoints

```
POST /api/auth/login
  Body: {"email": "user@test.com", "password": "secret123"}
  → 200: {"token": "...", "user": {"id": "...", "email": "..."}}
  → 401: {"error": "Invalid credentials"}

POST /api/auth/register
  Body: {"email": "user@test.com", "password": "secret123"}
  → 201: {"token": "...", "user": {"id": "...", "email": "..."}}
  → 400: {"error": "Password must be at least 8 characters"}
  → 409: {"error": "Email already registered"}

POST /api/auth/refresh
  Headers: Authorization: Bearer <token>
  → 200: {"token": "new-token", "user": {...}}
  → 401: {"error": "Invalid or expired token"}

POST /api/auth/logout
  → 204 (no body)

GET /api/auth/me
  Headers: Authorization: Bearer <token>
  → 200: {"user": {"id": "...", "email": "...", ...}}
  → 401: {"error": "Invalid or expired token"}
```

### Dependencies

- `internal/pocketbase` — Client library (Story 3.1)
- `github.com/go-chi/chi/v5` — Router
- `github.com/rs/zerolog` — Logging
- `errors` — For `errors.As` PBError type checking

## Definition of Done

- [ ] All 10 acceptance criteria met
- [ ] `go test ./internal/server/handlers/... -v` passes
- [ ] `go vet ./internal/server/handlers/...` clean
- [ ] 80%+ test coverage on `auth.go`
- [ ] GoDoc on all exported symbols
- [ ] Manual test with running PocketBase succeeds

## Verification Commands

```bash
cd backend
go test ./internal/server/handlers/... -v
go test ./internal/server/handlers/... -cover
go vet ./...
go build ./...
```

## Next Stories

- **Story 3.3**: JWT Middleware & Security — Token validation in auth middleware, rate limiting
- **Story 3.4**: Auth API Client (frontend) — TypeScript API client + TanStack Query hooks
