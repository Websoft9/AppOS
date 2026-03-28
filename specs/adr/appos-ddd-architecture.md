# AppOS DDD Architecture

## Status
Draft

## Intent
This document defines a minimal DDD view of AppOS for current product and backend evolution.

AppOS should be understood as a **single-server application lifecycle platform**, not only a Docker operation console and not only a server operations tool.

## 1. Subdomain Classification

| Domain | Type | Purpose | Core objects |
| --- | --- | --- | --- |
| Application Lifecycle | Core | Manage one app from install to run, change, recover, stop, retire | `AppInstance`, `OperationJob`, `ReleaseSnapshot`, `Exposure` |
| Lifecycle Execution | Supporting | Execute lifecycle operations through pipeline, worker, projection | `PipelineRun`, `PipelineNodeRun` |
| App Catalog | Supporting | Provide install sources, templates, custom apps, favorites, notes | `CatalogApp`, `CustomApp`, `UserAppNote` |
| Server Management | Supporting | Manage target server access and remote operation capability | `Server`, `TunnelSession`, `TerminalSession` |
| Runtime Infrastructure | Supporting | Provide Docker, proxy, certificate, backup, IaC primitives | `RuntimeProject`, `ProxyBinding`, `Certificate`, `BackupSnapshot` |
| Platform Configuration | Generic | Manage settings, secrets, auth, audit, system policies | `Setting`, `Secret`, `AuditEvent`, `User` |

### Interpretation

- `Application Lifecycle` is the only core domain.
- `Lifecycle Execution` is not product-facing by itself; it exists to realize lifecycle behavior.
- `App Catalog` is a separate source domain, not the lifecycle domain itself.
- `Server Management` and `Runtime Infrastructure` are supporting domains used by lifecycle operations.

## 2. Bounded Context Map

```mermaid
flowchart LR
    Catalog[App Catalog]\n+    Lifecycle[Application Lifecycle]\n+    Execution[Lifecycle Execution]\n+    Server[Server Management]\n+    Runtime[Runtime Infrastructure]\n+    Platform[Platform Configuration]

    Catalog -->|install source / template| Lifecycle
    Lifecycle -->|creates operation| Execution
    Execution -->|uses server access| Server
    Execution -->|uses runtime primitives| Runtime
    Lifecycle -->|reads policies / writes audit| Platform
    Server -->|connectivity for| Runtime
```

### Context boundaries

| Bounded Context | Owns | Does not own |
| --- | --- | --- |
| Application Lifecycle | app state, operation intent, release baseline, exposure state | docker command details, ssh session details |
| Lifecycle Execution | pipeline progression, node execution state, worker coordination | long-lived app business meaning |
| App Catalog | app metadata, install templates, user favorites, user custom apps | installed app lifecycle state |
| Server Management | remote connection, shell, file, terminal, host capability | release state, publication state |
| Runtime Infrastructure | compose apply, proxy binding, certificate, backup primitives | product-facing lifecycle decisions |
| Platform Configuration | auth, settings, secrets, audit | app-specific lifecycle orchestration |

### Integration rules

1. `Application Lifecycle` is the orchestration owner for app business behavior.
2. `Lifecycle Execution` executes, but does not define, product meaning.
3. `App Catalog` may propose install intent, but cannot mutate installed app state directly.
4. `Runtime Infrastructure` exposes primitives; it should not become the product API surface.
5. `Server Management` is a capability provider to lifecycle execution, not the lifecycle root.

## 3. Aggregate Design

## 3.1 Application Lifecycle Context

| Aggregate | Root | Boundary | Invariants |
| --- | --- | --- | --- |
| App Instance | `AppInstance` | One installed app in management scope | only one canonical lifecycle state; points to current release and primary exposure |
| Operation | `OperationJob` | One requested lifecycle action | one operation has one type, one terminal result, optional one pipeline run |
| Release | `ReleaseSnapshot` | One immutable release/config baseline | release snapshot is append-only after creation except activation markers |
| Exposure | `Exposure` | One external publication definition | publication state is independent from app runtime state |

Boundary rules:

1. `AppInstance` owns long-lived lifecycle state.
2. `OperationJob` owns execution intent and result, not app lifecycle state.
3. `ReleaseSnapshot` owns rollback-safe baseline information.
4. `Exposure` owns publication state and endpoint configuration.

## 3.2 Lifecycle Execution Context

| Aggregate | Root | Boundary | Invariants |
| --- | --- | --- | --- |
| Pipeline Run | `PipelineRun` | One execution graph for one operation | belongs to exactly one `OperationJob` |
| Pipeline Node Run | `PipelineNodeRun` | One observable execution step | belongs to exactly one `PipelineRun`; smallest retryable unit |

Boundary rules:

1. `PipelineRun` is internal execution state, not product lifecycle state.
2. Node runs may update projections, but they do not redefine domain ownership.

## 3.3 App Catalog Context

| Aggregate | Root | Boundary | Invariants |
| --- | --- | --- | --- |
| Catalog App | `CatalogApp` | One installable catalog item | metadata and template remain source-of-truth for discovery |
| Custom App | `CustomApp` | One user-authored install template | ownership and visibility must be explicit |
| User App Note | `UserAppNote` | One user's annotation on one app | unique per user and app |

## 3.4 Server Management Context

| Aggregate | Root | Boundary | Invariants |
| --- | --- | --- | --- |
| Server | `Server` | One managed execution target | connection identity and capability belong together |
| Tunnel Session | `TunnelSession` | One tunnel lifecycle | bound to one server target |
| Terminal Session | `TerminalSession` | One interactive shell session | ephemeral; not a lifecycle aggregate |

## 3.5 Runtime Infrastructure Context

| Aggregate | Root | Boundary | Invariants |
| --- | --- | --- | --- |
| Runtime Project | `RuntimeProject` | One compose/runtime workspace | maps runtime files and running services for one app workload |
| Proxy Binding | `ProxyBinding` | One route/domain publication binding | route target and exposure target must be consistent |
| Backup Snapshot | `BackupSnapshot` | One recovery artifact | immutable once created |

## Domain Boundary Summary

1. App lifecycle decisions start in `Application Lifecycle`.
2. Execution state lives in `Lifecycle Execution`.
3. Infrastructure mutation happens through `Runtime Infrastructure`.
4. Remote capability comes from `Server Management`.
5. Install source and reusable templates belong to `App Catalog`.
6. Cross-cutting policy, auth, and audit belong to `Platform Configuration`.

## Current Design Choice

For the current stage of AppOS, the system should optimize for this path:

`Catalog or manual input -> Lifecycle intent -> Operation -> Pipeline execution -> Runtime mutation -> Lifecycle projection`

This keeps the business center on `AppInstance`, not on Docker commands and not on raw server sessions.