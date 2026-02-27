# Story 16.1: Tunnel Infrastructure

**Epic**: Epic 16 – SSH Tunnel: Local Server Management
**Status**: done | **Priority**: P1 | **Depends on**: Epic 15

---

## User Story

As the appos platform, I provide a reverse SSH tunnel entry point so that local servers behind NAT can connect into appos without requiring a public IP or any agent software.

---

## Implementation

### New files

```
backend/internal/tunnel/
  server.go       # SSH server: listens :2222, accepts reverse port-forward requests
  portpool.go     # persistent port allocation pool
  token.go        # token generation (base32, 32 bytes entropy)
  session.go      # in-memory session registry
```

> `internal/tunnel/` is pure infrastructure — no PocketBase imports. All PocketBase
> integration (token validation, status updates) is injected via interfaces by the
> caller (`routes/tunnel.go`, delivered in Story 16.2).

---

### Interfaces injected by caller

```go
// tunnel/server.go

// TokenValidator resolves a raw token string to a server ID.
// Returns ("", false) if the token is unknown or revoked.
type TokenValidator interface {
    Validate(token string) (serverID string, ok bool)
}

// SessionHooks receives lifecycle events so the business layer can
// write PocketBase and audit records without coupling this package to PB.
type SessionHooks interface {
    OnConnect(serverID string, services []Service, conflicts []ConflictResolution)
    OnDisconnect(serverID string)
}

// Service describes one forwarded port pair.
type Service struct {
    Name       string // "ssh" | "http" | ...
    LocalPort  int    // port on the local server
    TunnelPort int    // port bound on appos 127.0.0.1
}
```

---

### server.go — SSH server

**Auth strategy**: `NoClientAuth = true` with **TCP-level rate limiting**. The OpenSSH
client tries "none" auth first; the server advertises only "none", so the client never
prompts for a password. Immediately after `ssh.NewServerConn` succeeds, the username is
validated via `TokenValidator`. If invalid, the connection is closed before any channel
is processed.

Rate limiting mitigates scanner abuse on the open `none`-auth handshake:
- **Connection rate**: `golang.org/x/time/rate` limiter on the TCP accept loop (default 10 conn/s)
- **Concurrent pending**: semaphore limiting unauthenticated handshakes in flight (default 50)
- Validated sessions bypass rate limits — no impact on reconnecting legitimate tunnels

```go
// Pseudo-code outline
func (s *Server) handleConn(tcpConn net.Conn) {
    sshConn, chans, reqs, _ := ssh.NewServerConn(tcpConn, s.sshConfig)

    serverID, ok := s.validator.Validate(sshConn.User())
    if !ok {
        sshConn.Close()
        return
    }

    services, conflicts := s.pool.AcquireOrReuse(serverID)  // ← portpool
    s.sessions.Register(serverID, &Session{
        ServerID: serverID,
        Conn: sshConn,
        Services: services,
        ConnectedAt: time.Now().UTC(),
    })
    s.hooks.OnConnect(serverID, services, conflicts)
    defer func() {
        s.sessions.Unregister(serverID)
        s.hooks.OnDisconnect(serverID)
    }()

    go ssh.DiscardRequests(reqs)
    s.handleChannels(chans, services)             // ← port-forward only
}
```

**Port forwarding**: the server handles `tcpip-forward` global requests only. It does
**not** open a PTY, exec a command, or forward arbitrary direct-tcpip channels — the
tunnel SSH session is forward-only, not a shell.

```go
// handleGlobalRequests: accept "tcpip-forward" requests
// For each -R 0:localhost:N, OpenSSH sends:
//   tcpip-forward { bind_addr, bind_port=0 }
// Server responds with the assigned tunnel port from portpool.
// OpenSSH then forwards local N → that tunnel port.
```

**Host key**: generated once at appos startup, persisted to `pb_data/tunnel_host_key`
(RSA-4096 or Ed25519). Regenerated only if missing.

**Heartbeat**: the SSH keep-alive is handled at the transport level
(`ServerConfig.ClientVersion` + SSH connection keepalive). Session enters `offline` state
if no data / keepalive within 60 s.

---

### portpool.go — persistent port allocation

```go
type PortPool struct {
    mu       sync.Mutex
    start    int
    end      int
    // serverID → []assigned ports
    byServer map[string][]int
    // port → serverID (reverse index)
    byPort   map[int]string
}

// LoadExisting is called at startup with all tunnel_services records from DB.
// Pre-reserves assigned ports so they are never given to another server.
func (p *PortPool) LoadExisting(records []PortRecord) { ... }

// AcquireOrReuse returns existing ports for a known server, or allocates
// new ones from the free range for a first-time server.
// On conflict (persisted port already occupied by the OS):
//   - allocates a replacement port
//   - returns ConflictResolution{OldPort, NewPort} in addition to services
//   - caller (routes/tunnel.go) updates DB and writes audit entry
func (p *PortPool) AcquireOrReuse(serverID string) ([]Service, []ConflictResolution) { ... }

// Release frees all ports assigned to a server.
// Called when a servers record is deleted.
func (p *PortPool) Release(serverID string) { ... }
```

Port range is read from system settings at startup (default 40000–49999).
With 2 ports per server (SSH + HTTP), the default range supports ~5,000 concurrent
tunnel servers.

---

### token.go — token generation

```go
// Generate returns a URL-safe base32 token of 32 bytes entropy (52 chars).
// Alphabet: A–Z 2–7 (RFC 4648), no padding — safe for SSH usernames and URLs.
func Generate() string {
    b := make([]byte, 32)
    io.ReadFull(rand.Reader, b)
    return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b)
}
```

Validation is NOT in this package — it is the caller's responsibility (routes/tunnel.go
looks up the token in PocketBase `secrets` where `type = tunnel_token`).

---

### session.go — in-memory session registry

```go
type Session struct {
    ServerID    string
    Conn        *ssh.ServerConn
    Services    []Service
    ConnectedAt time.Time
}

type Registry struct {
    mu       sync.RWMutex
    sessions map[string]*Session  // serverID → session
}

// Register kicks any existing session for serverID (last-writer-wins),
// then stores the new session.
func (r *Registry) Register(serverID string, sess *Session)
// UnregisterConn removes the session only if the stored Conn matches the provided
// pointer — prevents a kicked session's defer from removing the new session.
func (r *Registry) UnregisterConn(serverID string, conn *ssh.ServerConn)
func (r *Registry) Get(serverID string) (*Session, bool)
func (r *Registry) Disconnect(serverID string)  // closes active SSH conn
func (r *Registry) All() []*Session
```

Used by Story 16.2 routes to answer `/servers/:id/status` without hitting PocketBase.

---

### Server startup sequence

Called from `routes/tunnel.go` (Story 16.2) during PocketBase `OnAfterBootstrap`:

```
1. Read port range from settings
2. Query all servers where connect_type = tunnel, load tunnel_services → portpool.LoadExisting()
3. Load or generate host key from pb_data/tunnel_host_key
4. Start tunnel.Server{validator, pool, sessions, hooks} on :2222
```

---

### What this story does NOT include

- PocketBase reads/writes (injected via interfaces, implemented in Story 16.2)
- Token generation API route (Story 16.2)
- Setup command generation (Story 16.2)
- Frontend wizard (Story 16.2)
- `servers` schema migration (Story 16.2)

---

## Acceptance Criteria

- [x] `tunnel.Server` binds `:2222` on appos startup
- [x] OpenSSH client connects with `{TOKEN}@appos:2222` and no password prompt (`none` auth accepted)
- [x] TCP accept loop enforces connection-rate limiter and concurrent-handshake semaphore
- [x] Invalid token → connection closed before any channel processing
- [x] `-R 0:localhost:22` → server assigns a port from the configured range and returns it in the `tcpip-forward` reply
- [x] `-R 0:localhost:80` → same, separate port assigned
- [x] Two connections with the same valid token get the same ports (`AcquireOrReuse`)
- [x] Host key persists across process restarts (`pb_data/tunnel_host_key`)
- [x] `portpool.LoadExisting()` correctly pre-reserves all previously assigned ports on startup
- [x] When a persisted port is already occupied by the OS: new port allocated, `ConflictResolution` returned, old port never reused
- [x] `portpool.Release()` frees ports; freed ports can be reassigned to a new server
- [x] `token.Generate()` output contains only `[A-Z2-7]` chars (base32 no-padding, SSH/URL safe)
- [x] `Registry.Register/Unregister/Get` are safe for concurrent use
- [x] No PocketBase import anywhere in `internal/tunnel/`

---

## Dev Agent Record

### Implementation Plan
- `token.go`: `Generate()` using `crypto/rand` + base32 no-padding (RFC 4648 A–Z 2–7). 32-byte entropy → 52 chars. No validation logic (caller's concern).
- `session.go`: `Session` struct + `Registry` with `sync.RWMutex`. `Register`, `Unregister`, `Get`, `All` all goroutine-safe.
- `portpool.go`: `PortPool` with `LoadExisting` (startup pre-reserve), `AcquireOrReuse` (reconnect reuse + OS conflict fallback), `Release`. Port-free check uses `net.Listen("tcp", "127.0.0.1:N")` probe. Default service specs (ssh/22, http/80) baked in.
- `server.go`: `TokenValidator` + `SessionHooks` interfaces (zero PocketBase coupling). `Server.ListenAndServe` with `rate.Limiter` (10 conn/s) + buffered-channel semaphore (50 pending). Ed25519 host key generated on first start, stored at `DataDir/tunnel_host_key` (mode 0600). `handleGlobalRequests` maps sequential `tcpip-forward` requests to services. `runListener` + `forwardConn` proxy TCP connections via `forwarded-tcpip` SSH channels.

### Completion Notes
- All 14 ACs verified via 27 unit tests (all PASS, 0 failures).
- No PocketBase import confirmed via `go list -f '{{.Imports}}'`.
- Full backend regression suite clean (all existing packages pass).
- `encodeEd25519PEM` uses `ssh.MarshalPrivateKey` for OpenSSH-format PEM (compatible with `ssh.ParseRawPrivateKey`).
- Port conflict detection probes OS with transient `net.Listen` to avoid TOCTOU races.

### Senior Developer Review #2 (AI)
**Outcome:** Approved | **Date:** 2026-02-27

#### Issues Found and Fixed
- [x] [High] Keepalive closed connection on `ok=false`: OpenSSH always replies REQUEST_FAILURE to `keepalive@openssh.com` — liveness check changed to `err != nil` only
- [x] [High] Duplicate-token race: `Register` now kicks old session (last-writer-wins); `handleConn` uses `UnregisterConn` (pointer match) instead of `Unregister` to prevent race; `OnDisconnect` checks registry before marking offline
- [x] [Med] `runListener` bind failure on kick: added retry with backoff (5 attempts, 25×n ms) to allow kicked session's listeners to release port
- [x] [Low] `Unregister` became dead code after `UnregisterConn` introduced — removed
- [x] [Low] `svc := svc` loop capture unnecessary in Go 1.22+ — removed
- [x] [Low] `forwardConn` silently discarded channel-open error — added log

### Senior Developer Review (AI) #1
**Outcome:** Changes Requested | **Date:** 2026-02-27 | **Resolved:** 5/5

#### Action Items
- [x] [High] H1: Absolute 60s deadline drops live tunnels — replaced with 15s handshake deadline + keepalive goroutine (`server.go`)
- [x] [High] H2: `forwardConn` goroutines not tracked in WaitGroup — `runListener` now uses local `proxyWg` (`server.go`)
- [x] [Med] M1: `keepaliveInterval` constant declared but unused — now used by keepalive goroutine (`server.go`)
- [x] [Med] M2: Nil `Validator`/`Hooks`/`Pool`/`Sessions` caused panic — `init()` returns explicit errors for all nil deps (`server.go`)
- [x] [Med] M3: Redundant `pem.Decode` result stored in unused `block` variable — inlined to single-statement check (`server.go`)

---

## File List

- `backend/internal/tunnel/token.go` (new)
- `backend/internal/tunnel/session.go` (new)
- `backend/internal/tunnel/portpool.go` (new)
- `backend/internal/tunnel/server.go` (new)
- `backend/internal/tunnel/token_test.go` (new)
- `backend/internal/tunnel/session_test.go` (new)
- `backend/internal/tunnel/portpool_test.go` (new)
- `backend/internal/tunnel/server_test.go` (new)
- `specs/implementation-artifacts/story16.1-tunnel-infrastructure.md` (updated)
- `specs/implementation-artifacts/sprint-status.yaml` (updated)

---

## Change Log

- 2026-02-27: Story 16.1 implemented — `internal/tunnel` package created with SSH server (:2222), port pool, token generator, and session registry. 21 unit tests added. Status → review.
- 2026-02-27: Code review #2 — keepalive fix (ok→err), kick-old-connection (last-writer-wins + UnregisterConn + OnDisconnect race guard), bind retry in runListener, dead code + minor cleanup. Status remains done.
