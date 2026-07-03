# Resource Reachability & Availability Status Model

## Status
Accepted

## Context

AppOS resource list pages need to show live status (reachability and/or availability) for resource types: service instances, connectors, AI providers, and servers. The current implementation has three divergent patterns:

| Resource | Background Sweep | Live On-Demand Endpoint | Persistence |
|---|---|---|---|
| Service Instances | ✅ monitor `reachability_sweep` | ✅ `POST /api/instances/reachability` | `monitor_latest_status` |
| Connectors | ❌ | ✅ `GET /api/connectors/reachability` | none (live only) |
| AI Providers | ❌ | ✅ `GET /api/ai-providers/reachability` + `GET /api/ai-providers/availability` | `config.availability` on AI provider record |

This inconsistency causes:
1. **No cache for connectors/AI providers**: first page load shows no status until live probe completes.
2. **Status stored in config**: AI provider availability lives in `config.availability`, mixing user configuration with system-observed state.
3. **No unified status overview**: `monitor_latest_status` covers only instances and servers.
4. **Different "last checked" semantics**: each page computes `checked_at` from different sources.

## Decision

### 1. Two-tier status model: Reachability vs Availability

**Reachability** — narrow, cheap, universal:
- Definition: can AppOS establish a TCP connection to the resource's endpoint?
- Cost: single `net.DialTimeout` (3s timeout), no credentials needed.
- Lifecycle: both **live on-demand** (user clicks refresh) and **background cron sweep** (monitor domain).
- Persistence: always written to `monitor_latest_status`.

**Availability** — broad, expensive, resource-specific:
- Definition: can AppOS actually use the resource for its intended purpose? For AI providers this means credential validation + model fetch.
- Cost: credential resolution, remote API calls, potential rate limits.
- Lifecycle: **live on-demand only** (user clicks refresh or config changes). No background sweep.
- Persistence: recent results written to `monitor_latest_status` for UI caching, but no cron-driven refresh.

### 2. Single persistence surface: `monitor_latest_status`

All resource status results (reachability and availability, for all resource types) are projected into the existing `monitor_latest_status` collection. This replaces the ad-hoc `config.availability` / `config.reachability` storage on AI provider records.

New `target_type` values are added:
- `ai_provider` — for AI provider reachability and availability status
- `connector` — for connector reachability status

The unique index `(target_type, target_id)` prevents collisions across resource types.

### 3. Business API performs checks, monitor persists results

The business-domain API routes (e.g. `GET /api/ai-providers/availability`) remain the **check executors**. After probing, they project results into `monitor_latest_status` via the shared status projection layer. The monitor domain does not duplicate the probe logic — it provides only:
- The persistence surface (`monitor_latest_status` collection)
- The background cron sweep for **reachability** (TCP dial, shared probe library)
- The projection helpers for writing check results

### 4. Frontend: cache-first, live-overlay

Every resource list page follows the same data flow:

```
Page load
  → Fetch list API (returns resource records)
  → Fetch monitor_latest_status (filtered by target_type) → instant status display
  → Fire live on-demand check (reachability or availability) → overlay results
  → Live results also persisted server-side for next page load
```

The `checked_at` timestamp always reflects the check that produced the currently displayed status. When a live overlay replaces a cached value, the timestamp updates to the live check time.

## Consequences

- **Positive**: Unified status surface enables future monitor overview dashboards, status-based filtering, and alerting across all resource types.
- **Positive**: Cache-first rendering gives instant status on page load for all resources, not just instances.
- **Positive**: `config.availability` / `config.reachability` can eventually be deprecated from AI provider records.
- **Negative**: `monitor_latest_status` collection grows with additional target types. Mitigated by the existing unique index — one record per target.
- **Negative**: Migration adds two `target_type` enum values. Existing data is unaffected.
