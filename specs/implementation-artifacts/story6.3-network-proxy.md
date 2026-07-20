# Story 6.3: Unified Network Proxy Runtime

**Epic**: Epic 6 - Infra Modules  
**Status**: planned  
**Priority**: P1  
**Depends on**: Epic 1 DevOps, Epic 13 Settings, Story 8.5 Connector Foundation

## Goal

Define one shared backend proxy runtime so AppOS external egress can honor Settings > Proxy without each feature implementing proxy behavior independently.

## Fixed Decisions

- proxy is a platform egress policy, not a per-feature implementation detail
- one settings source drives all proxy-aware runtime behavior
- proxy policy requires both code declaration and settings enrollment
- undeclared policy keys are invalid; declared but unenrolled policy keys are denied at runtime
- public outbound HTTP(S) traffic should use the configured proxy by default
- control-plane connections such as SSH, SFTP, Docker local socket, and similar host-management paths are not forced through proxy in the first slice
- remote shell subprocess traffic is a separate egress surface from the SSH control channel and must be modeled independently
- when remote shell proxy is enabled, shell and child-process outbound traffic should inherit AppOS egress identity through a reverse tunnel instead of exposing remote server source IPs to upstream allowlists
- remote shell proxy policy must be resolved from Settings `proxy/policies` using `remote_shell.global` plus per-server overrides in `proxy/servers`; no second shell-specific toggle should exist outside that model
- reverse tunnel is the single proxy-bearing transport for remote shell once the effective remote shell mode is enabled; do not maintain parallel shell proxy mechanisms
- AppOS-side reverse-tunnel dialing must reuse the platform's effective egress policy, including external proxy, self proxy, or direct mode, rather than using a hard-coded direct `net.Dial`
- `NO_PROXY` and local/private bypass remain part of the central policy

## Current Implementation Target

- network source supports only `none`, `external`, and `self`
- policy mode supports only `disabled` and `always`
- `fallback` is removed everywhere
- settings wording is `policies`, not `consumers` or `registry`
- first policy domains are `http.*`, `download.*`, `git.*`, `remote_shell.global`, `remote_runtime.global`, and bypass-only `control_plane.*`
- `external` means AppOS uses configured proxy connectors for proxy-capable egress
- `self` means AppOS uses self-managed egress for remote shell transport, while control-plane SSH/SFTP remains direct

## Scope

Create one reusable runtime under `backend/infra` or another infra-owned package that provides:

- normalized proxy settings resolution from `proxy/network`
- proxy environment generation for subprocess and Docker-style execution
- proxy-aware `http.Client` / `http.Transport` construction for outbound HTTP(S)
- proxy-aware dialer construction where raw outbound dialing should follow egress policy
- one small traffic classification model such as `public_egress`, `control_plane`, and `local_or_private`
- one policy registry model with stable policy keys
- one settings enrollment model for declared policy keys only
- one adapter model such as `http_client`, `env`, and `dialer`
- one mode model: `disabled` and `always`
- one remote-shell reverse-tunnel transport model that keeps SSH control direct while routing shell subprocess egress through AppOS when remote shell proxy policy is enabled
- one effective-mode resolver for remote shell that combines `remote_shell.global`, per-server overrides, and current platform proxy capability

## Non-Goals

- transparent interception of all container traffic with iptables, TPROXY, or sidecar networking
- forcing SSH or SFTP server-management traffic through proxy in the first slice
- redefining product-specific route behavior beyond moving them onto the shared runtime
- introducing a second user-facing shell proxy switch outside Settings `proxy/servers`
- leaking remote server source-network identity when remote shell proxy policy has been explicitly enabled

## First Consumers

- AI Provider reachability and model fetch
- git module and deploy-time git actions
- feed fetch and favicon fetch
- space fetch-file actions
- asset and deployment external downloads
- external services outbound HTTP actions where applicable
- runtime instance HTTP-based checks where applicable
- platform account outbound HTTP actions where applicable
- software inventory HTTP probes
- Docker and worker command environments that already consume proxy env
- remote server shell and shell-spawned subprocess execution

## Consumer Model

Each proxy consumer must be declared in code with a stable key.

Suggested key shapes:

- module-level: `feeds.global`, `git.global`
- action-level: `deploy.git_fetch`, `space.fetch_file`

Rules:

- code declaration defines that a consumer is known to the platform
- settings enrollment decides whether that known consumer may use proxy at runtime
- undeclared consumer keys are rejected by settings and runtime
- declared but unenrolled consumer keys are denied at runtime

## Scope Levels

Support two levels:

- module-level consumer
- action-level consumer

Action-level policy may override module-level policy. If neither level is enrolled, proxy use is denied.

Rule:

- module-level consumers act as policy anchors and defaults
- action-level consumers are the concrete direct-use network surfaces
- new outbound implementations should bind to action-level consumers instead of using `*.global` as a catch-all execution key

## Adapter Model

First-pass adapters:

- `http_client` for outbound HTTP(S) code paths
- `env` for subprocess, Docker, git, and script-style execution
- `dialer` for explicit outbound dial paths that should follow egress policy

Adapter type is defined by code declaration, not freely chosen per settings entry.

## Modes

Two modes only, for all consumers:

- `disabled`: never use proxy for this consumer
- `always`: use proxy when AppOS has usable proxy capability; otherwise allow direct operation with a visible warning

Design rationale for removing `fallback` (`Try direct then proxy`):

- `try direct then proxy` pushes network misconfiguration into runtime retries instead of surfacing problems at configuration time
- for HTTP consumers it introduces unpredictable latency without solving the root cause
- for subprocess consumers (apt, git, curl, docker) it creates side-effects, partial state, and non-idempotent behavior
- for remote shell it would replay stateful commands on a second network path — unacceptable
- the correct approach: resolve proxy capability once, warn on unavailability, let operators fix the configuration

## Implementation Direction

- move proxy settings resolution out of route-local helpers into one infra runtime module
- require outbound HTTP features to obtain clients from the shared runtime instead of creating ad hoc `http.Client` instances
- require subprocess-oriented network features to obtain proxy env from the same runtime
- require proxy-capable features to resolve proxy behavior through declared consumer keys only
- review direct `net.Dial` call sites and classify them instead of blindly proxying all raw TCP
- keep SSH session establishment on the direct control-plane path while allowing remote shell egress to traverse a reverse tunnel anchored on the existing SSH session
- treat reverse tunnel as a transport layer and keep final outbound policy in a shared AppOS-side dialer so external proxy, self proxy, and direct egress remain centrally decided

## Remote Shell Execution Slice

Implement remote shell proxy behavior in the following order:

1. resolve the effective remote shell mode from Settings `proxy/servers` by applying per-server override first and `servers.global` second
2. resolve current AppOS proxy capability as one of: `external_proxy_available`, `self_proxy_available`, or `no_proxy_capability`
3. establish the SSH control channel directly using the existing bypass-only control-plane path
4. if effective mode is `disabled`, start shell without reverse-tunnel proxy transport
5. if effective mode is `always` and AppOS proxy capability exists, create the reverse-tunnel transport and inject the shell proxy environment through that tunnel
6. if effective mode is `always` and reverse-tunnel proxy transport cannot be established (proxy unavailable), allow direct shell startup but emit a visible terminal warning before the prompt
7. if effective mode is `always` and reverse tunnel was established but later fails mid-session, emit a visible terminal warning; do not tear down the shell session
8. when reverse tunnel is active, route shell-spawned subprocess egress through an AppOS-side dialer that applies the current effective outbound policy

Implementation notes:

- terminal startup and one-shot SSH command execution must use the same remote shell mode resolution path
- reverse tunnel should bind to the current SSH session lifecycle and be torn down before SSH session close
- remote shell env injection should be derived from the reverse-tunnel endpoint, not from raw external proxy coordinates leaked to the managed server
- AppOS-side dialer selection must remain centralized so future changes to external proxy or self proxy do not require shell-specific rewrites
- the visible terminal warning on proxy-unavailable `always` sessions should be emitted through the same PTY channel, not a separate notification system, so it is intrinsically visible within the terminal stream

## Proxy Unavailable Strategy (All Consumers)

When a consumer is set to `always` but AppOS has no usable proxy capability:

- do NOT block the operation — proxy is an egress enhancement, not an availability gate
- allow direct execution with a visible warning
- the warning surface depends on the adapter:
  - `http_client`: structured warning in response metadata or logs
  - `env`: warning emitted before subprocess start
  - `dialer`: warning logged before connection
  - `remote shell`: warning printed through the PTY channel before the shell prompt

This strategy replaces the removed `fallback` mode. The key principle:

- **configuration problems should be visible, not silently retried**

## Hard Bypass List

The following paths are bypass-by-default in the first slice and must not silently opt into proxy:

- SSH and SFTP server-management traffic
- Docker local unix-socket traffic
- local loopback and explicit local/private bypass targets
- host-management and similar control-plane reachability probes unless explicitly reclassified later

## Remote Shell Policy Notes

- `servers.global` is the workspace-wide policy anchor for remote shell and shell-spawned subprocess egress
- per-server overrides in Settings `proxy/servers` take precedence over `servers.global`
- the SSH control channel remains a bypass-only control-plane consumer even when remote shell subprocess traffic is proxied
- reverse-tunnel transport exists to let remote shell inherit AppOS network reachability and allowlisted egress identity without requiring upstream systems to whitelist every managed server
- if AppOS uses an external proxy, reverse-tunnel egress must still present AppOS-side network identity rather than asking upstream systems to understand managed-server origins
- if AppOS uses self proxy, reverse-tunnel egress should reuse that same AppOS-side capability instead of introducing a separate shell-specific proxy stack
- terminal startup and one-shot SSH command execution should converge on the same effective remote shell proxy decision and the same reverse-tunnel transport rules

## Remote Shell Mode Simplification

- remote shell supports only two user-facing modes: `Disabled` and `Always`
- `Disabled`: never proxy; shell subprocess egress uses the managed server's own network
- `Always`: always proxy when AppOS has usable proxy capability
- when `Always` is selected but AppOS proxy capability is currently unavailable:
  - do NOT block shell startup
  - allow direct shell startup with a visible warning or notice to the terminal user
  - "visible" means a prominent terminal banner, distinct color, or shell MOTD-style prefix — not merely a log line buried in server logs
- the UX intent: proxy is an enhancement, not a single point of failure; blocking remote shell because proxy is down creates an operational denial-of-service
- the security intent: the warning must be unavoidable so the user cannot accidentally operate under direct egress while believing they are protected by proxy

## Remote Shell UX Semantics

- the remote shell proxy UI must not describe any mode as `Try direct then proxy`
- the `Always` mode label in Remote Shell Proxy should be paired with help text that explains: proxy unavailable → direct shell with visible warning
- if the settings UI reuses shared mode labels, remote shell must be explicitly carved out with dedicated consumer-specific copy
- when `Always` is selected and proxy is unavailable, the terminal UI must surface a visible warning before the shell prompt appears
- the warning should make it clear that the current shell session is running without proxy protection, but must not prevent the user from proceeding

## Implementation Artifacts / Proposed Types

Proposed backend types and interfaces for the first implementation slice:

```go
type ProxyCapability string

const (
	ProxyCapabilityNone     ProxyCapability = "none"
	ProxyCapabilityExternal ProxyCapability = "external_proxy_available"
	ProxyCapabilitySelf     ProxyCapability = "self_proxy_available"
)

type RemoteShellProxyDecision struct {
	ServerID              string
	Mode                  proxyinfra.Mode
	Capability            ProxyCapability
	UseReverseTunnel      bool
	ProxyUnavailable      bool
	Warning               string
	Reason                string
}

type ReverseTunnelEndpoint struct {
	BindHost              string
	BindPort              int
	ProxyURL              string
	Env                   map[string]string
}

type EffectiveDialerMode string

const (
	EffectiveDialerDirect   EffectiveDialerMode = "direct"
	EffectiveDialerExternal EffectiveDialerMode = "external_proxy"
	EffectiveDialerSelf     EffectiveDialerMode = "self_proxy"
)

type EffectiveDialerPlan struct {
	ConsumerKey           string
	Mode                  proxyinfra.Mode
	Capability            ProxyCapability
	DialerMode            EffectiveDialerMode
	ProxyEnv              map[string]string
	NoProxy               []string
}
```

Proposed backend entry points:

```go
func ResolveProxyCapability(app core.App) (ProxyCapability, error)
func ResolveRemoteShellProxyDecision(app core.App, serverID string) (RemoteShellProxyDecision, error)
func BuildEffectiveDialerPlan(app core.App, consumerKey string) (EffectiveDialerPlan, error)
func BuildRemoteShellProxyEnv(endpoint ReverseTunnelEndpoint) map[string]string
func StartReverseTunnelProxy(ctx context.Context, client *ssh.Client, plan EffectiveDialerPlan) (*ReverseTunnelEndpoint, io.Closer, error)
```

Proposed integration points:

- `backend/domain/proxy/runtime.go`: resolve proxy capability, effective dialer plan, and remote shell decision
- `backend/domain/terminal/connector_ssh.go`: create and tear down reverse-tunnel transport bound to SSH session lifetime
- `backend/domain/terminal/ssh_exec.go`: inject remote shell proxy env for one-shot commands using the same decision path as interactive shell startup
- `backend/domain/routes/server_access.go`: replace direct `ProxyEnvForRemoteShellServer` usage with the richer remote shell decision object

Implementation constraints:

- `ResolveRemoteShellProxyDecision` must be deterministic and side-effect free
- `StartReverseTunnelProxy` must not decide policy; it should only materialize the transport selected by the decision layer
- `BuildEffectiveDialerPlan` must be the single place where external proxy vs self proxy vs direct egress is chosen
- reverse-tunnel endpoint env must expose only loopback-facing shell variables such as `ALL_PROXY`, not raw upstream external-proxy coordinates
- `RemoteShellProxyDecision.ProxyUnavailable` indicates that proxy is configured but not currently reachable; the caller must use this to surface a visible terminal warning rather than failing the session or silently starting without proxy

## Acceptance Criteria

- [ ] one shared proxy runtime is defined as the only source for proxy settings resolution
- [ ] the design distinguishes public egress from control-plane and local/private traffic
- [ ] the design defines code declaration versus settings enrollment for proxy consumers
- [ ] the design defines module-level and action-level consumers
- [ ] the design defines first-pass adapters and the rule that adapter type comes from code declaration
- [ ] the design defines `disabled` and `always` as the only two modes for all proxy consumers
- [ ] the design states that undeclared or unenrolled consumers are denied
- [ ] HTTP-based outbound features are expected to consume shared proxy-aware clients
- [ ] subprocess and Docker-style outbound features are expected to consume shared proxy env
- [ ] the document explicitly rejects transparent full-container proxy interception for the first slice
- [ ] the document explicitly states that proxy behavior should become global by shared runtime adoption, not by per-feature proxy logic
- [ ] the design states that remote shell subprocess traffic is distinct from the SSH control channel and is governed by Settings `proxy/servers`
- [ ] the design states that remote shell proxy uses reverse tunnel as the single proxy-bearing transport when its effective mode is enabled
- [ ] the design states that remote shell reverse-tunnel egress must reuse AppOS effective outbound policy, including external proxy, self proxy, or direct mode
- [ ] the design defines that `always` with proxy unavailable allows direct operation with visible warning for all consumer adapters
- [ ] the design includes an ordered remote shell execution slice that developers can implement without introducing a second shell proxy mechanism
- [ ] the design explicitly rejects `Try direct then proxy` mode for all consumers; configuration problems must surface as warnings, not silent retries
- [ ] the design states that Remote Shell Proxy must not expose misleading `Try direct then proxy` semantics in settings UI copy
- [ ] the design proposes concrete backend decision/result types and integration points for reverse-tunnel implementation
- [ ] the design defines remote shell as a two-mode consumer: `disabled` and `always`
- [ ] the design defines that `always` with proxy unavailable allows direct shell startup with visible terminal warning
- [ ] the design states that visible terminal warning replaces removed fallback mode for remote shell consumers
- [ ] the design documents the rationale for removing `fallback` from the mode model

- do not keep route-level or feature-level proxy parsing once the shared runtime exists
- do not allow ad hoc proxy use without a declared consumer key
- do not allow settings to invent new consumer keys that code has not declared
- do not proxy local sockets or clearly local control paths by default
- do not mix product policy with the infra proxy runtime
- do not let remote shell proxy decisions bypass `servers.global` and per-server override resolution
- do not implement reverse-tunnel shell egress with a hard-coded direct dialer that ignores AppOS effective proxy capability
- do not implement `Try direct then proxy` semantics for any consumer
- do not reuse generic proxy labels in Remote Shell Proxy when those labels imply replay semantics that the runtime forbids
- do not silently downgrade any `always` consumer to direct egress without a visible warning
- do not block operations when proxy is unavailable; proxy is an egress enhancement, not a consumer availability gate