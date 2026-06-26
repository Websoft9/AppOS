# Story 6.5: Fetch-Store Download Runtime

**Epic**: Epic 6 - Infra Modules
**Status**: planned | **Priority**: P1 | **Depends on**: Story 6.4 Egress Domain Consolidation

---

## Goal

Define the first dedicated runtime for large-file `fetch_store` workloads so AppOS can download remote files to local storage with resumability, integrity checks, progress reporting, and failure recovery, without polluting `infra/egress` root package or `infra/filesvc` with mixed responsibilities.

## Fixed Boundary

- `backend/infra/egress` remains the parent outbound-network governance domain
- large-file fetch-to-local execution lives in `backend/infra/egress/fetchstore`
- `backend/infra/filesvc` remains the local file persistence substrate only
- do not reintroduce `infra/downloader` as a parallel top-level package
- do not move remote URL, HTTP Range, mirror, or retry orchestration into `infra/filesvc`

## Why This Boundary

`fetch_store` is a specific egress workload, not a new peer domain beside `egress`.

At the same time, resumable download execution includes concerns that are broader than transport policy:

- Range probing
- partial state files
- chunk scheduling
- checksum verification
- final atomic promotion
- mirror/fallback sequencing
- operator-visible progress

Those concerns belong in a dedicated execution subpackage under the `egress` parent domain.

## Proposed Package Layout

```text
backend/infra/egress/
  fetch.go                 # existing safe public fetch client construction
  direct.go                # existing direct/no-proxy client construction
  runtime.go               # existing registry/runtime views
  fetchstore/
    downloader.go          # coordinator entry point
    request.go             # request/options model
    state.go               # resumable state/meta model
    checksum.go            # streaming hash verification
    mirrors.go             # fallback source iteration
    progress.go            # callback/event contract
```

Supporting local-path helpers may be reused from `backend/infra/filesvc` or `backend/infra/fileutil`, but fetchstore owns the remote-transfer state machine.

## Core API Shape

First-slice backend surface:

```go
type Request struct {
	ConsumerKey        string
	URL                string
	DestinationPath    string
	Overwrite          bool
	ExpectedSHA256     string
	Timeout            time.Duration
	Resume             bool
	Mirrors            []string
	Progress           func(Progress)
}

type Progress struct {
	Phase            string
	BytesCompleted   int64
	BytesTotal       int64
	ChunkIndex       int
	ChunkCount       int
	SourceURL        string
}

type Result struct {
	Path             string
	BytesWritten     int64
	SHA256           string
	Resumed          bool
	SourceURL        string
}

func Download(ctx context.Context, app core.App, service *filesvc.LocalService, req Request) (Result, error)
```

Rules:

- the caller provides `ConsumerKey`; fetchstore does not invent policy identities
- network client creation must go through `egress.NewFetchHTTPClient(...)`
- `DestinationPath` is relative to the provided `filesvc.LocalService`; fetchstore must enforce that service boundary before bytes are written
- the final file must only appear at the destination after integrity and write completion succeed

## State File Model

For resumable first-slice behavior, Phase 1 should keep one temp payload and one metadata file adjacent to the final destination so atomic rename stays reliable.

Suggested shape:

- payload: `target.filename.part`
- metadata: `target.filename.part.json`

Suggested metadata fields:

```json
{
  "version": 1,
  "source_url": "https://example.com/file.tar.gz",
  "source_etag": "abc123",
  "source_last_modified": "Wed, 26 Jun 2026 12:00:00 GMT",
  "bytes_completed": 10485760,
  "bytes_total": 52428800,
  "expected_sha256": "...",
  "chunk_size": 0,
  "updated_at": "2026-06-26T12:00:00Z"
}
```

First slice can keep `chunk_size = 0` for single-stream resume. A later parallel-chunk phase can expand the state schema instead of replacing it.

Phase-1 note:

- do not move temp payloads to a separate directory if that would weaken same-filesystem atomic promotion guarantees

## Delivery Phases

### Phase 1: Resumable single-stream downloader

Deliver:

- safe fetch client integration through `infra/egress`
- single-stream download to temp file
- resume from existing partial file when the origin supports Range
- optional SHA256 verification
- progress callback
- atomic rename to final destination on success
- temp-file cleanup rules on hard failure

### Phase 2: Mirror/fallback sources

Deliver:

- ordered source list: primary URL then mirrors
- retry/backoff between transient failures
- preservation of partial state only when the next source is byte-compatible

### Phase 3: Parallel chunk download

Deliver:

- HEAD capability probe
- chunk planning for Range-capable origins
- bounded concurrency
- chunk merge or direct sparse writes
- final full-file checksum verification

## Non-Goals For Phase 1

- torrent-like peer distribution
- generic cache proxy for all outbound HTTP
- browser-side segmented download orchestration
- multi-writer distributed coordination across multiple AppOS nodes
- changing `egress` policy registry semantics

## Acceptance Criteria For Phase 1

- one new `backend/infra/egress/fetchstore` package exists as the canonical `fetch_store` execution engine
- all remote file-to-local persistence logic in this story uses `egress` for outbound policy and `filesvc` or `fileutil` only for local persistence helpers
- interrupted downloads can resume when the source supports Range and local partial state matches the source identity
- completed downloads can optionally verify SHA256 without re-reading the file from disk
- the destination file is promoted atomically only after transfer completion and verification success
- callers can receive progress updates without loading the full file into memory

## Phase-1 Hashing Note

Because Go standard-library hash state is not trivially serializable, resumed downloads may re-hash the existing partial file once before appending new bytes. The key contract is that fetchstore does not need to re-read the completed final file after successful promotion.

## Go Package Guidance

There are third-party Go packages that can help with resumable or parallel HTTP downloads, but AppOS should not adopt one by default unless it clearly fits the exact boundary above.

Reasons:

- AppOS must combine proxy-aware client construction, SSRF-safe fetch policy, destination-path safety, auditability, and future workload-aware controls
- many generic downloader libraries assume they own the HTTP client lifecycle and policy stack
- most libraries are optimized for simple URL-to-file downloading, not for AppOS-specific egress governance and local persistence rules

Use an external package only if it is thin, actively maintained, and easy to adapt as an internal engine beneath the `fetchstore` contract. Otherwise, Phase 1 is small enough to implement cleanly in-house on top of the standard library.