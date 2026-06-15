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
- proxy consumption requires both code declaration and settings enrollment
- undeclared consumers are invalid; declared but unenrolled consumers are denied at runtime
- public outbound HTTP(S) traffic should use the configured proxy by default
- control-plane connections such as SSH, SFTP, Docker local socket, and similar host-management paths are not forced through proxy in the first slice
- remote shell subprocess traffic is a separate egress surface from the SSH control channel and must be modeled independently
- when remote shell proxy is enabled, shell and child-process outbound traffic should inherit AppOS egress identity through a reverse tunnel instead of exposing remote server source IPs to upstream allowlists
- remote shell proxy policy must be resolved from Settings `proxy/servers` using `servers.global` plus per-server overrides; no second shell-specific toggle should exist outside that model
- reverse tunnel is the single proxy-bearing transport for remote shell once the effective remote shell mode is enabled; do not maintain parallel shell proxy mechanisms
- AppOS-side reverse-tunnel dialing must reuse the platform's effective egress policy, including external proxy, self proxy, or direct mode, rather than using a hard-coded direct `net.Dial`
- `NO_PROXY` and local/private bypass remain part of the central policy

## Scope

Create one reusable runtime under `backend/infra` or another infra-owned package that provides:

- normalized proxy settings resolution from `proxy/network`
- proxy environment generation for subprocess and Docker-style execution
- proxy-aware `http.Client` / `http.Transport` construction for outbound HTTP(S)
- proxy-aware dialer construction where raw outbound dialing should follow egress policy
- one small traffic classification model such as `public_egress`, `control_plane`, and `local_or_private`
- one consumer registry model with stable consumer keys
- one settings enrollment model for declared consumers only
- one adapter model such as `http_client`, `env`, and `dialer`
- one mode model: `disabled`, `always`, and `fallback`
- one remote-shell reverse-tunnel transport model that keeps SSH control direct while routing shell subprocess egress through AppOS when remote shell proxy policy is enabled
- one effective-mode resolver for remote shell that combines `servers.global`, per-server overrides, and current platform proxy capability

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

- `disabled`: never use proxy for this consumer
- `always`: always use proxy for this consumer
- `fallback`: try direct first, then retry through proxy on network failure

Guardrail:

- `fallback` is allowed only for declared consumers that are safe to retry, typically idempotent read-style actions

## Implementation Direction

- move proxy settings resolution out of route-local helpers into one infra runtime module
- require outbound HTTP features to obtain clients from the shared runtime instead of creating ad hoc `http.Client` instances
- require subprocess-oriented network features to obtain proxy env from the same runtime
- require proxy-capable features to resolve proxy behavior through declared consumer keys only
- review direct `net.Dial` call sites and classify them instead of blindly proxying all raw TCP
- keep SSH session establishment on the direct control-plane path while allowing remote shell egress to traverse a reverse tunnel anchored on the existing SSH session
- treat reverse tunnel as a transport layer and keep final outbound policy in a shared AppOS-side dialer so external proxy, self proxy, and direct egress remain centrally decided
- interpret remote shell `fallback` as: use reverse tunnel when proxy capability exists, otherwise allow direct shell execution; interpret remote shell `always` as fail closed when no usable proxy capability exists

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

## Acceptance Criteria

- [ ] one shared proxy runtime is defined as the only source for proxy settings resolution
- [ ] the design distinguishes public egress from control-plane and local/private traffic
- [ ] the design defines code declaration versus settings enrollment for proxy consumers
- [ ] the design defines module-level and action-level consumers
- [ ] the design defines first-pass adapters and the rule that adapter type comes from code declaration
- [ ] the design defines `disabled`, `always`, and `fallback` modes
- [ ] the design states that undeclared or unenrolled consumers are denied
- [ ] HTTP-based outbound features are expected to consume shared proxy-aware clients
- [ ] subprocess and Docker-style outbound features are expected to consume shared proxy env
- [ ] the document explicitly rejects transparent full-container proxy interception for the first slice
- [ ] the document explicitly states that proxy behavior should become global by shared runtime adoption, not by per-feature proxy logic
- [ ] the design states that remote shell subprocess traffic is distinct from the SSH control channel and is governed by Settings `proxy/servers`
- [ ] the design states that remote shell proxy uses reverse tunnel as the single proxy-bearing transport when its effective mode is enabled
- [ ] the design states that remote shell reverse-tunnel egress must reuse AppOS effective outbound policy, including external proxy, self proxy, or direct mode
- [ ] the design defines fail-open versus fail-closed semantics for remote shell `fallback` and `always`

## Guardrails

- do not keep route-level or feature-level proxy parsing once the shared runtime exists
- do not allow ad hoc proxy use without a declared consumer key
- do not allow settings to invent new consumer keys that code has not declared
- do not proxy local sockets or clearly local control paths by default
- do not mix product policy with the infra proxy runtime
- do not let remote shell proxy decisions bypass `servers.global` and per-server override resolution
- do not implement reverse-tunnel shell egress with a hard-coded direct dialer that ignores AppOS effective proxy capability