# Story 3.1: PocketBase Client Library

**Epic**: Epic 3 - Authentication & Authorization  
**Priority**: P0  
**Status**: ✅ Done  
**Completed**: 2026-02-12  
**Dependencies**: Epic 1 (Infrastructure), PocketBase service running  
**Estimated Effort**: 4-6 hours

## User Story

As a backend developer, I want a reusable PocketBase HTTP client library, so that I can interact with PocketBase API (auth, collections, files) from Go code in a type-safe, testable way without duplicating HTTP logic.

## Context

AppOS Backend acts as a **Backend for Frontend (BFF)** pattern:
- Frontend never directly accesses PocketBase
- Backend wraps PocketBase API to add security, validation, and business logic
- PocketBase admin credentials stay server-side only

This story creates the foundational client library that all auth and data operations will use.

**Scope Boundary**: This story implements the PocketBase client library only. Auth middleware updates (validating tokens in HTTP middleware) belong to Story 3.3. Logout is handled client-side (token is stateless JWT); no server-side `DeleteAuth` method is needed.

## Acceptance Criteria

### Core Client (AC 1-5)
- [ ] 1. `internal/pocketbase/client.go` created with `Client` struct
- [ ] 2. Client supports configurable base URL and timeout
- [ ] 3. Client includes custom HTTP client with proper timeouts (default 10s)
- [ ] 4. Client supports admin token authentication header
- [ ] 5. Error handling converts PocketBase errors to Go errors

### Auth Operations (AC 6-10)
- [ ] 6. `internal/pocketbase/auth.go` implements `AuthWithPassword(email, password) (*AuthResponse, error)`
- [ ] 7. Implements `CreateUser(email, password) (*AuthResponse, error)` with auto-login
- [ ] 8. Implements `RefreshAuth(refreshToken) (*AuthResponse, error)`
- [ ] 9. All methods POST to correct PocketBase endpoints with proper JSON
- [ ] 10. Returns structured `AuthResponse` with token, user data, expiry

### Type Definitions (AC 11-13)
- [ ] 11. `internal/pocketbase/types.go` defines `User` struct with JSON tags
- [ ] 12. Defines `AuthResponse` struct (token, user as "record", expiresAt)
- [ ] 13. Defines request structs with correct JSON field names (e.g., "identity" not "email")

### Error Handling (AC 14-15)
- [ ] 14. `internal/pocketbase/errors.go` defines `PBError` implementing `error` interface
- [ ] 15. `parseError()` function converts HTTP error responses to `PBError`

### Configuration (AC 16-17)
- [ ] 16. Client uses existing `cfg.PocketBaseURL` from `internal/config/config.go`
- [ ] 17. Client uses existing `cfg.PocketBaseToken` for admin auth

### Testing & Docs (AC 18-20)
- [ ] 18. Unit tests cover happy path and error cases using `httptest`
- [ ] 19. 80%+ code coverage on all exported functions
- [ ] 20. GoDoc comments on all exported types and functions

## Tasks / Subtasks

### Task 1: Setup Package Structure (15 min)
- [ ] 1.1 Create `backend/internal/pocketbase/` directory
- [ ] 1.2 Create files: `client.go`, `types.go`, `auth.go`, `errors.go`, `client_test.go`
- [ ] 1.3 Add package documentation

### Task 2: Core Client Implementation (45 min)

**File**: `client.go`

**Requirements:**
- [ ] 2.1 Define `Config` struct (BaseURL, AdminToken, Timeout)
- [ ] 2.2 Define `Client` struct (unexported fields)
- [ ] 2.3 Implement `NewClient(cfg Config) *Client` constructor
  - Default timeout: 10 seconds if not specified
  - Create `http.Client` with timeout
- [ ] 2.4 Implement private `doRequest(req *http.Request) (*http.Response, error)`
  - Add admin token to Authorization header if configured
  - Execute request
  - Check status code >= 400 and call `parseError()`
  - Return response or error

**API Contract (must implement):**
```go
type Config struct {
    BaseURL    string        // e.g., "http://localhost:8090"
    AdminToken string        // Optional
    Timeout    time.Duration // Default: 10s
}

type Client struct { /* unexported */ }

func NewClient(cfg Config) *Client
```

### Task 3: Type Definitions (30 min)

**File**: `types.go`

**Critical**: JSON tags must match PocketBase API exactly!

**Required types to define:**
```go
type User struct {
    ID       string    `json:"id"`
    Email    string    `json:"email"`
    Username string    `json:"username,omitempty"`
    Name     string    `json:"name,omitempty"`
    Avatar   string    `json:"avatar,omitempty"`
    Created  time.Time `json:"created"`
    Updated  time.Time `json:"updated"`
}

type AuthResponse struct {
    Token   string    `json:"token"`
    User    User      `json:"record"` // ⚠️ PocketBase uses "record" not "user"
    Expires time.Time `json:"-"`
}

type AuthRequest struct {
    Email    string `json:"identity"` // ⚠️ PocketBase uses "identity" not "email"
    Password string `json:"password"`
}

type CreateUserRequest struct {
    Email           string `json:"email"`
    Password        string `json:"password"`
    PasswordConfirm string `json:"passwordConfirm"`
}
```

### Task 4: Auth Operations Implementation (90 min)

**File**: `auth.go`

**Implement these methods:**

**4.1 AuthWithPassword**
- [ ] POST to `/api/collections/users/auth-with-password`
- [ ] Marshal `AuthRequest{Email: email, Password: password}` to JSON
- [ ] Set `Content-Type: application/json` header
- [ ] Call `doRequest()` and decode response to `AuthResponse`
- [ ] Wrap errors with context (`fmt.Errorf`)

**4.2 CreateUser**
- [ ] POST to `/api/collections/users/records`
- [ ] Marshal `CreateUserRequest` (set PasswordConfirm = Password)
- [ ] Decode user response
- [ ] **Auto-login**: Call `AuthWithPassword()` with same credentials
- [ ] Return `AuthResponse` from login

**4.3 RefreshAuth**
- [ ] POST to `/api/collections/users/auth-refresh`
- [ ] Set `Authorization: <refreshToken>` header
- [ ] Decode response to `AuthResponse`

**Public API Contract:**
```go
func (c *Client) AuthWithPassword(email, password string) (*AuthResponse, error)
func (c *Client) CreateUser(email, password string) (*AuthResponse, error)
func (c *Client) RefreshAuth(refreshToken string) (*AuthResponse, error)
```

**Implementation Guidelines:**
- Use `bytes.NewReader()` for request body
- Always `defer resp.Body.Close()`
- Use `json.NewDecoder(resp.Body).Decode()`
- Wrap all errors: `fmt.Errorf("operation: %w", err)`
- In `doRequest()`: when returning error from `parseError()`, close the response body inside `doRequest` itself (caller should not need to handle body on error path)

### Task 5: Error Handling (30 min)

**File**: `errors.go`

**Requirements:**
- [ ] 5.1 Define `PBError` struct with fields: Code, Message, Data
- [ ] 5.2 Implement `Error() string` method (satisfies `error` interface)
- [ ] 5.3 Implement `parseError(resp *http.Response) error`:
  - Try to decode JSON error from response body
  - If decode fails, return generic `fmt.Errorf("HTTP %d: %s", ...)`
  - Set Code from `resp.StatusCode`
  - Return `*PBError`

**Type Contract:**
```go
type PBError struct {
    Code    int               `json:"code"`
    Message string            `json:"message"`
    Data    map[string]string `json:"data,omitempty"`
}

func (e *PBError) Error() string
func parseError(resp *http.Response) error
```

### Task 6: Configuration Integration (30 min)

> **Note**: `internal/config/config.go` already has `PocketBaseURL` and `PocketBaseToken` fields loaded from env vars. No config changes needed.

**6.1 Initialize PocketBase Client in `server.go`:**
- In `server.New()`, create PocketBase client using existing config fields
- Pass field names exactly: `cfg.PocketBaseURL` → `Config.BaseURL`, `cfg.PocketBaseToken` → `Config.AdminToken`
- Store client in `Server` struct as a field

**6.2 Verify `.env.example`:**
- Ensure `POCKETBASE_URL` and `POCKETBASE_TOKEN` entries exist (they should already)

### Task 7: Unit Tests (60 min)

**File**: `client_test.go`

**Test Coverage Requirements:**

**7.1 TestAuthWithPassword**
- [ ] Success case: Mock server returns valid JSON, verify token and user
- [ ] Error case: Mock returns 400, verify `PBError` type
- [ ] Verify correct endpoint path and request method

**7.2 TestCreateUser**
- [ ] Success case: Verify user creation + auto-login
- [ ] Error case: Duplicate email returns error

**7.3 TestRefreshAuth**
- [ ] Success case: Returns new token
- [ ] Invalid token case: Returns error

**7.4 TestErrorHandling**
- [ ] Verify `*PBError` type assertion works
- [ ] Verify fallback when JSON decode fails

**Test Pattern:**
```go
func TestAuthWithPassword_Success(t *testing.T) {
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // Assert request (method, path, headers)
        // Write mock JSON response
    }))
    defer server.Close()
    
    client := pocketbase.NewClient(pocketbase.Config{BaseURL: server.URL})
    resp, err := client.AuthWithPassword("test@example.com", "password123")
    
    // Assert no error, verify response fields
}
```

**Coverage Target**: 80%+

### Task 8: Documentation (20 min)

- [ ] 8.1 Add package-level GoDoc with usage example
- [ ] 8.2 Document all exported types with purpose
- [ ] 8.3 Document all exported functions with parameters and return values
- [ ] 8.4 Document security considerations (admin token handling)

**Example Package Doc:**
```go
// Package pocketbase provides a Go HTTP client for PocketBase API.
//
// This client is used by the AppOS backend to interact with PocketBase
// for authentication, user management, and data operations.
//
// Example:
//   client := pocketbase.NewClient(pocketbase.Config{
//       BaseURL: "http://localhost:8090",
//   })
//   auth, err := client.AuthWithPassword("user@example.com", "password")
```

## Technical Reference

### PocketBase API Endpoints

**Auth with Password:**
```http
POST /api/collections/users/auth-with-password
Content-Type: application/json

{"identity": "user@example.com", "password": "secret"}

→ {"token": "...", "record": {"id": "...", "email": "..."}}
```

**Create User:**
```http
POST /api/collections/users/records
Content-Type: application/json

{"email": "user@example.com", "password": "secret", "passwordConfirm": "secret"}

→ {"id": "...", "email": "...", "created": "..."}
```

**Refresh Token:**
```http
POST /api/collections/users/auth-refresh
Authorization: <refresh-token>

→ {"token": "...", "record": {...}}
```

### Security Considerations

1. **Admin Token**: Only used for server-side operations, never exposed to frontend
2. **HTTPS**: Always use HTTPS in production
3. **Token Storage**: Backend doesn't store tokens, only validates and forwards
4. **Timeout**: 10-second timeout prevents hanging requests

### Dependencies

- **Go Standard Library Only**: `net/http`, `encoding/json`, `fmt`, `time`
- **External**: PocketBase service running at configured URL
- **PocketBase Setup**: Users collection must exist

## Definition of Done

- [ ] All 20 acceptance criteria met and verified
- [ ] `go test ./internal/pocketbase/... -v` passes
- [ ] `go vet ./internal/pocketbase/...` passes with no warnings
- [ ] `go test ./internal/pocketbase/... -cover` shows 80%+ coverage
- [ ] GoDoc comments on all exported symbols
- [ ] Config integration complete (env vars, main.go)
- [ ] Manual test with running PocketBase succeeds
- [ ] Code reviewed and approved

## Verification Commands

```bash
# Run tests
cd backend
go test ./internal/pocketbase/... -v

# Check coverage
go test ./internal/pocketbase/... -cover

# Vet for issues
go vet ./internal/pocketbase/...

# Type check
go build ./...

# Manual integration test (requires PocketBase)
POCKETBASE_URL=http://localhost:8090 go run ./cmd/server/main.go
```

## Next Stories

- **Story 3.2**: Auth API Endpoints - HTTP handlers using this client
- **Story 3.3**: JWT Middleware & Security - Token validation

## Cross-References

- Epic: [epic3-auth.md](epic3-auth.md)
- Architecture: [../planning-artifacts/architecture.md](../planning-artifacts/architecture.md)
- PocketBase Docs: https://pocketbase.io/docs/api-authentication/
