# Egress as Parent Domain and Fetch as Workload Semantics

## Status
Proposed

## Context
AppOS already has a meaningful outbound-network runtime under `backend/infra/egress`. It currently owns:

1. consumer registry and policy anchors
2. proxy settings and capability resolution
3. HTTP client planning
4. subprocess environment planning
5. raw dialer planning
6. capability and warning contracts

At the same time, AppOS has multiple external content retrieval paths that do not share one consistent vocabulary or one consistent client stack. The current discussion surfaced three related but distinct concerns:

1. whether a new top-level package such as `infra/outbound_http` should exist
2. whether `egress` is too narrow or too broad as a domain name
3. how to classify external retrieval scenarios such as feed fetch, remote file import, AI API calls, health probes, and fetched script execution

The important distinction is that network direction and workload semantics are not the same thing.

1. `egress` describes how AppOS traffic leaves the system
2. `fetch` describes a common workload where AppOS retrieves external content
3. `download` is only one narrower subset of `fetch`
4. fetched script execution is not a normal download workflow

This ADR defines the vocabulary and package boundaries so later implementation work can converge without introducing overlapping infra domains.

## Decisions

### 1. `egress` remains the parent infrastructure domain

`backend/infra/egress` remains the canonical parent domain for outbound network governance in AppOS.

It is intentionally broader than HTTP and may continue to grow to cover additional outbound surfaces, including:

1. HTTP(S) clients
2. subprocess proxy environment injection
3. raw TCP dialers
4. tunnel-related outbound policy decisions
5. future outbound adapters that are not strictly HTTP

The term is aligned with standard platform and cloud operations language, where egress means outbound traffic in general rather than only file or page retrieval.

### 2. AppOS does not introduce a separate top-level `infra/outbound_http` package

AppOS will not add a new top-level infrastructure domain named `outbound_http`.

Reasons:

1. it overlaps heavily with responsibilities already implemented in `infra/egress`
2. it incorrectly narrows the top-level concept to HTTP even though AppOS egress policy already applies to more than HTTP
3. it would create an ambiguous split for future consumers choosing between `egress` and `outbound_http`

If AppOS needs stronger HTTP retrieval helpers, they should be added inside the `egress` domain or in a narrowly scoped child concept that depends on `egress`, rather than as a parallel parent domain.

### 3. `fetch` is the preferred semantic term for external content retrieval

When AppOS discusses the workload of retrieving content from external locations, the preferred semantic term is `fetch`.

This term is broader and more accurate than `download` because it covers workflows where content is:

1. stored locally
2. parsed and discarded
3. inspected for metadata
4. executed remotely after retrieval

`download` should remain a narrower term used only when the retrieved artifact is intentionally treated as a managed file or asset.

### 4. External retrieval workloads are classified by semantics, not by top-level package names

AppOS will use the following semantic classification for external retrieval workloads:

1. `fetch-for-store`: retrieve content to save as a file or managed asset
2. `fetch-for-parse`: retrieve content to parse into structured information
3. `fetch-for-api`: standard request-response API communication
4. `fetch-for-probe`: lightweight retrieval for availability or health checks
5. `fetch-for-execute`: retrieve content whose main purpose is execution

These are workload semantics and policy categories. They do not require one package per category.

They may later inform:

1. default timeout classes
2. SSRF guard requirements
3. response size limits
4. redirect policies
5. audit expectations
6. default proxy behavior for specific consumers

### 5. Fetched script execution is not treated as a normal download workflow

When AppOS uses `curl`, `wget`, or equivalent mechanisms to retrieve a remote script and execute it immediately, the workflow is classified as `fetch-for-execute`, not as a standard download.

This distinction exists because the system goal is not asset acquisition but remote execution of externally sourced content.

That class of workflow should be governed primarily by execution and trust rules, not by file-download semantics.

### 6. HTTP retrieval hardening should evolve under `egress`

If AppOS unifies SSRF protection, proxy policy, timeout handling, redirect handling, and client reuse for local HTTP retrieval, that work should evolve under the `egress` domain.

Examples of acceptable evolution directions include:

1. expanding `egress` APIs for safe HTTP client construction
2. introducing clearly named HTTP retrieval helpers within the `egress` domain
3. adding workload metadata to egress consumer definitions

The architecture should avoid duplicating proxy, HTTP client, or dialer logic across multiple top-level infra domains.

## Consequences

### Positive

1. AppOS keeps one clear parent domain for outbound traffic governance
2. package naming stays aligned with standard platform terminology
3. the system gains a cleaner vocabulary for discussing external retrieval workflows
4. future HTTP hardening can reuse the existing `egress` runtime instead of creating a second infrastructure center

### Trade-offs

1. `egress` remains a broad term and requires discipline to prevent it from becoming a grab bag
2. some teams may initially find `fetch` less concrete than `download`
3. implementation work still needs careful API design to combine proxy logic and SSRF-safe retrieval without leaking abstraction details

### Follow-up

1. document current external retrieval consumers and map them to the semantic categories in this ADR
2. define whether workload metadata should become part of `egress.Definition`
3. design the next incremental API for safe HTTP retrieval inside `backend/infra/egress`
4. migrate current local HTTP retrieval paths toward the unified egress-based model