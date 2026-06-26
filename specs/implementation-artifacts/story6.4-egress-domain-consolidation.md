# Story 6.4: Egress Domain Consolidation

**Epic**: Epic 6 - Infra Modules
**Status**: done | **Priority**: P1 | **Depends on**: Epic 1 DevOps, Epic 13 Settings, Story 6.3 Network Proxy

---

## User Story

As the AppOS backend platform,
I want one canonical outbound-network infrastructure domain,
so that HTTP fetch, direct internal HTTP, proxy-aware API traffic, and related egress semantics do not fragment across multiple overlapping infra packages.

## Objective

Consolidate outbound-network ownership under `backend/infra/egress`, make `fetch` the preferred semantic term for external retrieval workloads, and remove obsolete parallel entry points such as `infra/safefetch` and `infra/downloader`.

This story turns the earlier architectural decisions into the actual canonical code and planning boundary.

## Fixed Decisions

- `egress` is the parent infrastructure domain for outbound-network governance in AppOS
- `fetch` is the semantic term for external retrieval workloads
- `download` is only the `fetch-for-store` subset, not the parent infra concept
- `outbound_http` is not introduced as a parallel top-level infra domain
- public external retrieval, general proxy-aware HTTP, and explicit direct internal HTTP are separate egress capabilities
- `infra/safefetch` and `infra/downloader` do not survive as independent long-term architecture centers
- workload metadata belongs in the egress consumer model so policy semantics are machine-readable as well as documented

## Scope

- keep `backend/infra/egress` as the only parent code domain for AppOS outbound-network policy and client construction
- provide one safe public-fetch client path for external retrieval workloads
- provide one direct/no-proxy client path for internal and probe-style traffic
- preserve the existing generic proxy-aware HTTP plan path for API traffic and similar consumers
- annotate egress consumers with workload metadata such as `api`, `fetch_store`, `fetch_parse`, `fetch_probe`, `fetch_execute`, `subprocess`, `tunnel`, and `control_plane`
- migrate AppOS-owned consumers onto egress-owned client construction instead of ad hoc or legacy helper construction
- delete obsolete legacy compatibility or empty shim packages once no runtime consumers remain

## Non-Goals

- redesigning product-facing proxy settings UX in this story
- introducing a second policy system beyond the existing egress consumer model
- rewriting unrelated caller business logic outside outbound-network client ownership
- exposing workload metadata to end users as a primary UX feature in the same story

## Canonical Egress Capability Model

### Parent Domain

`backend/infra/egress` owns:

- consumer registry and policy anchors
- proxy settings and capability resolution
- safe public-fetch HTTP client construction
- generic proxy-aware HTTP client construction
- direct/no-proxy HTTP client construction
- subprocess env planning
- raw dialer and tunnel-related egress planning
- workload metadata attached to consumer definitions

### Semantic Terms

- `egress`: how AppOS traffic leaves the system
- `fetch`: retrieving external content
- `download`: `fetch-for-store` only
- `fetch-for-execute`: retrieved content whose main purpose is execution rather than storage

### Workload Metadata

Each egress consumer definition must declare one workload value.

Current canonical values:

- `api`
- `fetch_store`
- `fetch_parse`
- `fetch_probe`
- `fetch_execute`
- `subprocess`
- `tunnel`
- `control_plane`

The workload field is descriptive and governance-oriented. It should inform policy meaning, testing focus, and future operator-facing grouping, but it does not require a separate package per workload type.

## Implementation Outcome

### Canonical code direction

- safe public external retrieval lives under `egress.NewFetchHTTPClientPlan` / `egress.NewFetchHTTPClient`
- explicit direct internal traffic lives under `egress.NewDirectHTTPClient`
- generic proxy-aware HTTP remains under `egress.NewHTTPClientPlan`
- egress consumer metadata is exposed through the runtime definition view so administrative surfaces can understand consumer semantics later

### Consolidated consumers

The following AppOS-owned HTTP consumer classes should converge on egress-owned client construction:

- feeds retrieval and favicon fetch
- space remote import
- assets remote text and archive fetch
- deploy remote compose fetch
- AI provider reachability and model fetch
- copilot/OpenRouter validation and provider client fallback
- internal probe-style callers such as local HTTP probe, Traefik readiness, and monitor write forwarding

### Removed parallel entry points

This story retires the following as standalone architecture concepts:

- `backend/infra/safefetch`
- `backend/infra/downloader`

If older documents or discussions refer to those packages, they should be read as historical implementation steps, not as the canonical long-term domain model.

## Acceptance Criteria

- `backend/infra/egress` is the only parent infra domain used for AppOS outbound-network client construction and policy resolution
- no AppOS runtime consumers directly depend on `infra/safefetch` or `infra/downloader`
- egress definitions include validated workload metadata
- workload metadata is present in the serialized egress definition view
- safe public fetch, generic proxy-aware HTTP, and direct internal HTTP each have explicit egress-owned entry points
- repository tests cover the main migration risk points around client fallback and consumer metadata
- repository build succeeds after consolidation

## References

- [specs/adr/egress-parent-domain-and-fetch-semantics.md](../adr/egress-parent-domain-and-fetch-semantics.md)
- [specs/adr/egress-safe-http-retrieval-api.md](../adr/egress-safe-http-retrieval-api.md)
- [specs/implementation-artifacts/epic6-infra.md](epic6-infra.md)