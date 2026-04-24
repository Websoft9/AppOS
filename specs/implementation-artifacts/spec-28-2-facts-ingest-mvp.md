---
title: '28.2 Facts Ingest MVP'
type: 'feature'
created: '2026-04-24'
status: 'ready-for-dev'
context:
  - 'specs/implementation-artifacts/story28.2-agent-ingestion.md'
  - 'specs/implementation-artifacts/epic28-monitoring.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 28.2 defines low-frequency server facts ingest, but the MVP chain is incomplete: the server record has no canonical facts fields, `/api/monitor/ingest/facts` does not exist, and the monitor agent cannot post facts snapshots.

**Approach:** Add a server-scoped facts snapshot path that accepts authenticated monitor-agent uploads, enforces the MVP canonical allowlist, replaces the previous server facts snapshot, and records the observation time without introducing raw-ingest collections or collector-native payload passthrough.

## Boundaries & Constraints

**Always:** facts remain server-scoped in MVP; payload ownership must match the monitor token owner; accepted facts must use AppOS-owned canonical keys only; writes replace the previous snapshot instead of merging partial payloads; heartbeat and existing monitor ingest behavior must remain unchanged.

**Ask First:** changing the MVP allowlist beyond `os`, `kernel`, `architecture`, `cpu.cores`, and `memory.total_bytes`; introducing facts history storage; blocking heartbeat delivery when facts collection fails.

**Never:** persist raw Netdata facts or plugin metadata; introduce a dedicated facts history collection; expand facts ingest to app/resource targets in this slice; couple facts writes to monitor status projection.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | Valid bearer token, `serverId` matches token owner, one `server` facts item with allowlisted keys | Server record stores full `facts_json` snapshot and `facts_observed_at`; endpoint returns `202` with accepted count | N/A |
| OWNERSHIP_MISMATCH | Valid token for server A, payload `serverId` or `targetId` points to server B | Request is rejected and no server facts are changed | Return `403` for envelope ownership mismatch or `400` for invalid item target |
| ALLOWLIST_VIOLATION | Facts payload contains unknown top-level group or collector-native metadata | Request is rejected and no facts are persisted | Return `400` with invalid facts payload message |
| REPLACE_SNAPSHOT | Same server posts a second valid facts snapshot missing keys from the first snapshot | Stored `facts_json` becomes the second snapshot only | N/A |

</frozen-after-approval>

## Code Map

- `backend/infra/migrations/1740050000_create_servers_collection.go` -- current server schema baseline; new facts fields must layer onto `servers`
- `backend/domain/routes/monitor.go` -- monitor ingest route registration and HTTP validation patterns
- `backend/domain/routes/monitor_test.go` -- existing ingest test harness and monitor route assertions
- `backend/domain/monitor/signals/agent/token.go` -- reusable monitor token validation for server ownership
- `backend/domain/monitor/signals/agent/heartbeat.go` -- ingest helper style for authenticated agent payloads
- `backend/cmd/appos-monitor-agent/main.go` -- monitor agent payload structs, run cycle, and POST helpers

## Tasks & Acceptance

**Execution:**
- [ ] `backend/infra/migrations/*.go` -- add `servers.facts_json` and `servers.facts_observed_at` -- creates the canonical persistence target required by Story 28.2
- [ ] `backend/domain/routes/monitor_test.go` -- add facts ingest coverage for happy path, ownership mismatch, allowlist rejection, batch limit, and replace semantics -- locks the contract before implementation
- [ ] `backend/domain/monitor/signals/agent/facts.go` -- implement server-scoped facts validation and persistence helper -- keeps route logic thin and reuses monitor agent patterns
- [ ] `backend/domain/routes/monitor.go` -- register and implement `POST /api/monitor/ingest/facts` -- exposes the backend ingest contract
- [ ] `backend/cmd/appos-monitor-agent/main.go` -- add facts payload structs, collection, and `/facts` post path -- closes the MVP agent-to-backend loop

**Acceptance Criteria:**
- Given a valid monitor agent token for a server, when the agent posts one allowlisted facts snapshot for that server, then AppOS persists the snapshot to the canonical server record and records the snapshot observation time.
- Given a facts request whose `serverId` does not match the token owner, when the request is submitted, then AppOS rejects it and leaves the server record unchanged.
- Given a facts item whose `targetType` is not `server` or whose `targetId` does not equal the authenticated server, when the request is submitted, then AppOS rejects it as invalid input.
- Given a facts payload containing non-allowlisted top-level groups or collector-native metadata, when the request is submitted, then AppOS rejects it instead of persisting opaque fields.
- Given a server with an existing facts snapshot, when a new valid facts snapshot is ingested, then the stored facts snapshot is replaced rather than merged.

## Spec Change Log

## Verification

**Commands:**
- `cd /data/dev/appos/backend && go test ./domain/routes ./domain/monitor/signals/agent ./infra/migrations` -- expected: facts ingest tests and migration compilation pass
- `cd /data/dev/appos/backend && go test ./cmd/appos-monitor-agent` -- expected: agent facts payload path compiles and tests pass if present