# Egress Safe HTTP Retrieval API

## Status
Proposed

## Context
AppOS already has a generic outbound HTTP client planning API in `backend/infra/egress`:

1. `NewHTTPClientPlan` for proxy-aware local HTTP clients
2. `BuildEnvPlan` for subprocess proxy environment injection
3. `NewDialerPlan` for raw outbound dialers

This is sufficient for generic API communication such as AI provider traffic, but it does not yet unify the public external retrieval workloads currently implemented through `safefetch.NewClient()` and ad hoc `http.DefaultClient` usage.

The missing capability is a standard way to construct a local HTTP client that combines:

1. `egress` proxy policy resolution
2. SSRF-safe URL and redirect handling
3. transport reuse and one-way migration away from scattered client construction

This ADR defines the next minimal API to add under the `egress` domain.

## Decisions

### 1. Keep `NewHTTPClientPlan` as the generic HTTP API

`NewHTTPClientPlan` remains the generic egress-aware HTTP client planner.

It continues to serve request-response workflows that are not primarily public external retrieval, including:

1. AI provider API traffic
2. future generic HTTP consumers where SSRF-style public fetch restrictions are not appropriate
3. internal callers that already control their endpoint surface by other means

### 2. Add a second API for public external retrieval

AppOS should add a second HTTP client planning API under `backend/infra/egress`:

1. `NewFetchHTTPClientPlan`
2. and a convenience wrapper `NewFetchHTTPClient`

The naming uses `fetch` rather than `download` because the shared concern is public external retrieval, not only asset storage.

### 3. `NewFetchHTTPClientPlan` combines three concerns

The new API should produce a client plan that combines:

1. existing `egress` proxy policy selection based on consumer key
2. SSRF-safe target enforcement for public HTTP(S) retrieval
3. a standard client/transport construction path reusable by multiple domains

At minimum, the SSRF-safe behavior must include:

1. only `http` and `https` URLs are accepted
2. loopback, private, unspecified, and link-local targets are rejected
3. redirect validation applies the same target rules
4. DNS resolution and connect-time IP checks enforce the same public-target rule

### 4. The first API shape should stay small

The first API should stay close to the current `NewHTTPClientPlan` shape.

Recommended initial signatures:

```go
func NewFetchHTTPClientPlan(app core.App, consumerKey string, timeout time.Duration, skipTLSVerify bool) (HTTPClientPlan, error)

func NewFetchHTTPClient(app core.App, consumerKey string, timeout time.Duration, skipTLSVerify bool) (http.Client, error)
```

The returned type can remain `HTTPClientPlan` in the first phase so the decision and warning contract stays consistent with the existing generic HTTP API.

### 5. URL validation helpers may be exposed separately only if needed

The first phase does not require a new public validator type unless migration work proves it necessary.

If callers need preflight validation before request construction, AppOS may later expose a narrowly named helper such as:

1. `ValidateFetchURL`

Until then, the primary contract is the client plan itself.

### 6. Scope the first migration to public external retrieval only

The first consumers of `NewFetchHTTPClientPlan` should be limited to public external retrieval paths, including:

1. feeds parsing
2. bookmark analysis
3. favicon retrieval
4. remote skill and archive retrieval
5. remote compose retrieval
6. remote file import into space

The first migration should not automatically include:

1. local service readiness checks
2. internal control-plane HTTP requests
3. local or private network health probes
4. remote shell fetched execution

### 7. `safefetch` becomes an implementation source, not a parallel public architecture center

The existing `backend/infra/safefetch` logic should be treated as the source of SSRF-safe transport behavior for the first implementation phase.

The architecture direction is:

1. reuse or absorb its validation and dial safeguards
2. stop adding new direct domain-layer dependencies on `safefetch`
3. converge consumer call sites toward `egress`

This avoids maintaining two separate parent concepts for outbound HTTP behavior.

## Consequences

### Positive

1. AppOS keeps one parent domain for outbound network governance
2. public external retrieval gains a single migration target
3. current `download.general` and `http.general` consumers become usable in real code paths
4. SSRF protection and proxy policy can converge instead of forcing consumers to choose one or the other

### Trade-offs

1. the `egress` package takes on another HTTP-oriented capability and needs careful internal structure
2. internal/local HTTP callers still need explicit decisions instead of being swept into one generic fetch client
3. some `safefetch` internals may need refactoring before they can cleanly coexist with proxy-aware transport planning

### Follow-up

1. implement `NewFetchHTTPClientPlan` inside `backend/infra/egress`
2. migrate `fetch-for-store` and `fetch-for-parse` consumers in the first slice
3. decide whether `ValidateFetchURL` needs to become a public helper
4. revisit consumer-key granularity only after the first slice is complete
