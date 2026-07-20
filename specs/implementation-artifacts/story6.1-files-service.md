# Story 6.1: Files Service Foundation

**Epic**: Epic 6 - Infra Modules
**Status**: in-progress | **Priority**: P1 | **Depends on**: Epic 1 DevOps

---

## User Story

As the AppOS backend platform,
I want a shared files service foundation,
so that IaC, Space, and future Assets features can build on one common file capability boundary instead of each re-implementing filesystem safety and copy semantics.

## Objective

Establish the first foundation of a shared files service under `backend/infra/fileutil`, centered on safe path resolution and reusable copy helpers, so multiple product modules can converge on one common filesystem substrate.

This story is intentionally the single long-lived story for the shared files service. It should expand by phase instead of spawning a separate follow-on story for each layer.

## Positioning

This story is not defining a complete end-user file product.

It defines the first reusable service foundation beneath file-oriented domains:

- Epic 14 `IaC File Management`
- Epic 9 `Space` and future user-file flows
- future `Assets` or media-oriented modules

In the current first pass, the shared service boundary is intentionally narrow and is realized through `backend/infra/fileutil`.

## Delivery Phases

### Phase 1: Infra primitives

Status: done

Deliver the filesystem-safe primitives that all higher-level consumers can reuse:

- `ResolveSafePath()`
- `CopyFile()`
- `CopyDir()`
- focused unit coverage

### Phase 2: Shared files-service contract

Status: planned

Expand the story from raw helper functions into a recognizable shared service contract for file-oriented modules.

Target outcomes:

- one common vocabulary for roots / namespaces
- one common operation family for file-capability consumers
- one common metadata and error-semantics baseline
- one clear separation between infra file capability and product-specific policy

### Phase 3: Consumer convergence

Status: planned

Adopt the shared files-service contract from product modules incrementally.

Initial convergence targets:

- IaC file management
- Space-related filesystem-backed flows when applicable
- Assets or media staging/storage flows when introduced

## Scope

- provide safe relative-path resolution against a trusted base directory with allowed-root enforcement
- provide reusable `CopyFile()` and `CopyDir()` helpers
- keep the package free of HTTP and product-domain dependencies
- support multiple callers such as file-management routes and runtime workspace preparation
- establish the reusable filesystem substrate that higher-level file products can extend later
- define the long-lived shared-service direction inside this same story rather than splitting planning across multiple micro-stories

## Non-Goals

- user-facing file browser UX
- per-product permission policy
- file version history
- watcher, indexing, preview, or search behavior
- direct route or request/response contracts as part of the infra package API
- a complete cross-product metadata or storage abstraction in this first pass

## Current Implementation Anchor

- `backend/infra/fileutil/fileutil.go`
- `backend/infra/fileutil/fileutil_test.go`
- `backend/domain/routes/iac.go`
- `backend/domain/lifecycle/runtime/node_executor.go`

## Service Foundation Contract

### Exported API

```go
var ErrForbiddenPath error

func ResolveSafePath(base, rel string, allowedRoots []string) (string, error)
func CopyFile(src, dst string) error
func CopyDir(src, dst string) error
```

### Contract Rules

- `ResolveSafePath()` accepts slash-separated relative paths only
- the first path segment must be in `allowedRoots`
- absolute paths, empty paths, traversal escapes, and symlink escapes are rejected with `ErrForbiddenPath`
- valid paths resolve to an absolute path under the trusted base
- `CopyFile()` and `CopyDir()` are shared filesystem primitives only; they do not own authorization, HTTP mapping, or business semantics

### Shared-Service Intent

The long-term shared files service should let multiple product modules converge on:

- one safe path-resolution model
- one shared understanding of trusted roots / namespaces
- one reusable copy / move / write substrate
- one place to harden filesystem escape handling

This story only delivers the first, lowest layer of that service.

## Shared Files-Service Contract Direction

The following contract is the intended next layer of this same story.

### Namespaces / Roots

Different product modules may own different trusted roots, but they should converge on one shared model:

- each consumer declares its base path explicitly
- each consumer declares allowed top-level roots or namespaces explicitly
- the shared service enforces path safety; the consumer owns which roots are permitted

Baseline namespace model for this story:

- `base_path`: the trusted absolute filesystem anchor owned by the consumer
- `namespace`: the first path segment beneath the trusted base and the only root-level token the shared service allowlists
- `relative_path`: the remaining slash-separated path beneath the namespace
- `resource_key`: the consumer-facing logical identifier that maps to `namespace/relative_path` when exposed in APIs or product DTOs

Phase-2 contract rules:

- all consumer-supplied paths are normalized into `namespace + relative_path`; raw absolute paths are never accepted across the shared boundary
- the namespace must be declared before resolution time; consumers do not infer namespaces from arbitrary user input
- one request or operation targets exactly one trusted base path; cross-base copy or move is a higher-level orchestration concern, not an infra primitive concern
- consumers may map one product concept to one or more namespaces, but the shared service still validates only explicit allowlisted namespaces

Illustrative consumer shapes:

- IaC: managed infra roots under `/appos/data`
- Space: user or workspace-scoped roots when filesystem-backed storage is needed
- Assets: upload or generated-asset staging roots when filesystem-backed storage is needed

### Operation Family

The long-term shared service should support a common operation vocabulary that higher-level modules can map into their own APIs:

- list
- read
- write or overwrite
- move or rename
- copy
- delete
- upload
- download

This story's current implementation only delivers the path-safety and copy primitives beneath that vocabulary.

Phase-2 operation baseline for future convergence:

| Operation | Shared-service responsibility | Consumer responsibility |
| --- | --- | --- |
| `resolve` | validate namespace and relative path against trusted base | choose base path and allowed namespaces |
| `list` | enumerate entries beneath a validated target path | apply product visibility rules and pagination policy |
| `read` | open or stream a validated file target | authorize caller and shape response |
| `write` | persist bytes to a validated file target | decide overwrite policy, content validation, and side effects |
| `copy` | copy validated source to validated destination | decide whether source and destination namespaces are allowed |
| `move` | relocate validated source to validated destination | decide rename semantics and conflict policy |
| `delete` | remove a validated file or directory target | enforce retention, audit, and destructive-operation policy |

Phase-1 delivery in this story covers only `resolve` plus copy primitives. The remaining operations are contract targets for later expansion inside the same story.

### Metadata Baseline

When higher-level modules expose file or directory metadata, they should converge where practical on a common shape such as:

- `name`
- `type`
- `size`
- `modified_at`
- consumer-owned path or key fields

This story does not yet standardize a runtime DTO, but it establishes the intent that modules should not invent incompatible metadata models without reason.

Phase-2 metadata baseline for shared review:

| Field | Meaning | Owner |
| --- | --- | --- |
| `name` | leaf display name | shared baseline |
| `kind` | `file` or `directory` | shared baseline |
| `size` | byte size for files; optional or omitted for directories when expensive | shared baseline |
| `modified_at` | last modification timestamp in RFC3339-compatible representation | shared baseline |
| `path` | consumer-facing relative identifier under the declared namespace | consumer-mapped but shape should stay stable |
| `namespace` | declared top-level root token | shared baseline when surfaced |
| `content_type` | MIME-like hint when relevant | optional consumer extension |
| `extra` | product-specific metadata bag | consumer extension |

Guardrail:

- consumers may extend metadata, but should not rename or reinterpret the shared baseline fields without explicit reason and review

### Error Semantics

The shared service direction should converge on a stable error baseline:

- forbidden path or namespace
- not found
- already exists or conflict
- unsupported content or operation
- invalid input

Infra helpers may keep using Go errors internally, but consumer layers should avoid re-inventing incompatible semantics for the same underlying filesystem cases.

Phase-2 error mapping baseline:

| Semantic error | Typical trigger | Infra / service expectation |
| --- | --- | --- |
| `forbidden_path` | namespace not allowlisted, traversal escape, symlink escape, absolute path input | map from `ErrForbiddenPath` or equivalent safety rejection |
| `invalid_input` | empty path, malformed path token, invalid operation arguments | reject before mutating filesystem |
| `not_found` | target path missing for read, move, delete, or copy source | preserve as a non-safety failure |
| `conflict` | destination exists when product policy forbids overwrite or rename collision occurs | consumer may set policy, service reports collision |
| `unsupported_operation` | operation not enabled for that consumer or storage mode | fail explicitly instead of silently degrading |
| `io_failure` | OS-level read, write, sync, permission, or device failure not covered above | preserve as infrastructure failure for higher-level mapping |

Guardrail:

- route and domain layers may translate these semantics into HTTP status codes or UI messages, but they should not collapse safety violations, input errors, and generic I/O failures into one undifferentiated failure type

### Consumer Boundary

The shared files service should own:

- path safety
- root enforcement
- reusable file and directory primitives
- common capability vocabulary

The consuming module should own:

- authorization
- product policy
- user-facing route shape
- product-specific metadata enrichment
- lifecycle side effects after file operations

Consumer convergence baseline for this story:

| Consumer | Near-term adoption expectation | Explicit non-goal in this phase |
| --- | --- | --- |
| IaC | continue using shared safe path resolution and copy primitives for whitelisted file-management and workspace-preparation flows; become the first reference consumer for namespace semantics | do not force IaC-specific API shapes into the shared service |
| Space | adopt the namespace and metadata baseline when filesystem-backed storage flows need local path safety or server-side file orchestration | do not assume all Space storage backends are local filesystem-backed |
| Assets | adopt the same namespace and error model for staging, generated outputs, and media preparation when a filesystem-backed asset pipeline appears | do not invent the asset product contract yet |

Phase-3 convergence rule:

- each consumer should converge by adaptation at its boundary, not by embedding product rules into `backend/infra/fileutil`
- any new shared capability added beneath this story should be justified by at least two consumers or by one consumer plus a clearly reusable next consumer
- the shared service remains a backend capability boundary, not a user-facing product module

## Adoption Checklist

Any consumer adopting the shared files-service contract under this story should satisfy the following baseline checklist.

### Consumer Readiness

- declare one trusted `base_path` owned by the consumer
- declare one explicit namespace allowlist rather than accepting arbitrary top-level path tokens
- define whether the consumer is filesystem-backed for the target flow before binding to local path semantics
- identify which shared operations are actually needed instead of exposing the whole operation family by default

### Contract Mapping

- map product-facing identifiers to `namespace + relative_path`
- preserve the shared metadata baseline when file metadata is surfaced
- map infra or service failures into the agreed error-semantics baseline before route or UI translation
- keep authorization and product policy outside the infra helper boundary

### Implementation Guardrails

- do not pass raw absolute paths from route, worker, or domain inputs into the shared boundary
- do not duplicate traversal or symlink-escape logic in product modules when the shared helper already owns it
- do not widen shared capability for one product if the change hardcodes product-specific policy into infra
- add focused tests at the consumer boundary for namespace policy, error translation, and destructive-operation policy

### Done Check For A Converged Consumer

A consumer should be considered converged under this story when:

- it reuses the shared path-safety model instead of maintaining a competing filesystem-safety implementation
- its route or domain layer translates errors consistently with the shared baseline
- its product-specific metadata extends, rather than replaces, the shared metadata baseline
- its product policy stays outside `backend/infra/fileutil`

## Recommended Sequencing

The remaining work in this story should be executed in the following order.

### Sequence 1: IaC as reference consumer

- formalize IaC namespace naming against the phase-2 contract already recorded here
- verify current file-management and workspace-preparation flows against the error-semantics baseline
- capture any missing shared primitive only if the gap is clearly reusable outside IaC

Outcome:
IaC becomes the first fully aligned reference consumer for the shared files-service contract.

### Sequence 2: Space boundary definition

- identify which Space flows are truly filesystem-backed on the server side
- define Space namespace ownership and resource-key mapping before adding local filesystem operations
- adopt shared metadata and error semantics only for the flows that actually bind to local filesystem behavior

Outcome:
Space reuses the shared contract where local filesystem orchestration is real, without forcing all Space storage modes into the same implementation path.

### Sequence 3: Assets staging model

- define whether Assets needs upload staging, generated output staging, or both
- adopt the same namespace and safety model for staging paths
- keep asset-type validation, transformation rules, and lifecycle orchestration outside the infra layer

Outcome:
Assets can reuse the same backend file-capability boundary without turning the shared service into an asset-specific module.

### Sequence 4: Shared capability expansion

- only after at least one reference consumer is fully aligned and a second consumer has a concrete need, evaluate whether `list`, `read`, `write`, `move`, or `delete` should be added beneath this story
- each new capability must document its shared responsibility, consumer responsibility, and error mapping before implementation

Outcome:
The shared files service grows by reusable capability, not by speculative abstraction.

## Acceptance Criteria

- [x] `backend/infra/fileutil` exists as a reusable package under the infra layer
- [x] `ResolveSafePath(base, rel, allowedRoots)` rejects empty input, leading slash, non-whitelisted roots, `..` traversal, and symlink escape outside the trusted base
- [x] `ResolveSafePath()` returns an absolute target path for valid relative paths under the trusted base
- [x] `CopyFile(src, dst)` creates parent directories as needed and overwrites destination content safely
- [x] `CopyDir(src, dst)` recursively copies a directory tree using the shared file helper path
- [x] the package has no HTTP dependencies and can be consumed by both route and non-route code
- [x] unit tests cover happy paths, forbidden roots, traversal, leading slash, empty input, symlink escape, file copy, and directory copy
- [x] at least two distinct backend consumers reuse the package from outside `backend/infra`
- [x] the story is explicitly framed as shared file-service foundation for multiple product modules rather than an IaC-only helper
- [x] this story defines a phase-2 shared-service contract covering namespace model, operation family, metadata baseline, and error semantics
- [x] this story defines a phase-3 convergence direction for IaC, Space, and future Assets consumers without splitting into a separate story

## Tasks / Subtasks

- [x] Task 1: Establish the shared infra package boundary
  - [x] create `backend/infra/fileutil`
  - [x] keep the package free of HTTP and PocketBase dependencies
  - [x] expose a small reusable contract instead of route-specific helpers
- [x] Task 2: Implement safe path resolution
  - [x] reject empty input and leading slash
  - [x] enforce first-segment root allowlist
  - [x] reject `..` traversal outside the trusted base
  - [x] reject symlink escape by resolving the deepest existing ancestor
- [x] Task 3: Implement shared copy helpers
  - [x] provide `CopyFile()` with parent-directory creation
  - [x] provide `CopyDir()` recursive tree copy via the shared file-copy helper
- [x] Task 4: Reuse from multiple backend consumers
  - [x] wire the package into IaC file routes
  - [x] wire the package into lifecycle runtime workspace hydration
- [x] Task 5: Validate the foundation with focused tests
  - [x] safe path happy paths and forbidden roots
  - [x] traversal and leading-slash rejection
  - [x] symlink escape rejection
  - [x] file copy and directory copy behavior
- [x] Task 6: Define the shared files-service contract in this story
  - [x] define namespace / root model for multiple consumers
  - [x] define common operation vocabulary
  - [x] define shared metadata baseline
  - [x] define shared error-semantics baseline
- [x] Task 7: Define convergence plan for product consumers in this story
  - [x] state how IaC should consume the shared contract
  - [x] state how Space should consume the shared contract when filesystem-backed flows are introduced or expanded
  - [x] state how Assets should consume the shared contract when introduced
- [x] Task 8: Define adoption checklist and implementation sequencing in this story
  - [x] define consumer-readiness checklist
  - [x] define contract-mapping checklist
  - [x] define recommended convergence sequence for IaC, Space, and Assets

## Implementation Summary

- `ResolveSafePath()` enforces root whitelisting on the first path segment before resolving the target path.
- the helper walks up to an existing ancestor and evaluates symlinks so non-existing descendant paths still inherit a safe anchor.
- `CopyFile()` ensures destination parent directories exist and syncs the final file.
- `CopyDir()` recursively walks the source tree and reuses `CopyFile()` for leaf copies.

## Implementation Notes

- `ErrForbiddenPath` gives callers one stable infrastructure-level failure for forbidden path resolution.
- `ResolveSafePath()` returns the unresolved final absolute target path after validating that the resolved existing anchor remains within `base`.
- this design allows safe validation of not-yet-created descendants while still blocking symlink escape attacks.
- route layers remain responsible for translating infra errors into product-facing API responses.
- higher-level modules may differ in root policy, permission model, and metadata shape, but should prefer reusing this substrate instead of rebuilding path safety.

## Phase-2 and Phase-3 Completion Note

This story now records the intended shared contract baseline and the first consumer-convergence direction in the same document. Future work under this story should refine implementation against this contract instead of opening another planning story for the same shared files-service boundary.

Because implementation expansion remains intentionally open inside this same story, the story status stays `in-progress` until at least one reference consumer and one additional consumer complete convergence against the contract recorded here.

## Current Consumers

- `backend/domain/routes/iac.go`
  - uses `ResolveSafePath()` for `/api/ext/iac` and library-copy path validation
  - uses `CopyDir()` for library-to-apps copy behavior
- `backend/domain/lifecycle/runtime/node_executor.go`
  - uses `ResolveSafePath()` and `CopyDir()` for source workspace hydration into runtime project directories

## Future Consumer Direction

- IaC continues to consume this layer for safe filesystem operations under managed roots
- Space should consume the same foundation for user-file or workspace-style storage boundaries when filesystem-backed behavior is needed
- Assets should consume the same foundation for safe local staging, copy, or storage-handling primitives instead of introducing a parallel path-safety implementation

## Next Recommended Work In This Story

Because this story is intentionally long-lived, follow-up work should be recorded here instead of opening a new story for each layer.

Recommended order:

1. define the shared contract for namespaces, operations, metadata, and errors
2. review current IaC routes against that contract and identify drift
3. define the expected Space consumption boundary
4. define the expected Assets consumption boundary
5. converge implementations incrementally without breaking current consumers

## Verification

Primary test file:

- `backend/infra/fileutil/fileutil_test.go`

Covered behaviors:

- allowed roots and valid relative paths
- forbidden roots such as `pb`, `redis`, and arbitrary external paths
- traversal attempts including `apps/../../etc/passwd`
- leading-slash and empty input rejection
- symlink escape rejection
- `CopyFile()` destination creation and content preservation
- `CopyDir()` recursive tree copy

## Boundary Notes

- this story complements but does not replace Epic 14 `IaC File Management`; Epic 14 owns the product-facing file routes and UI
- this story is also intentionally broader than Epic 14: it defines a reusable shared substrate that other file-oriented modules should consume later
- future file-related features should prefer extending this shared foundation rather than re-implementing path-safety logic in domain packages
- permission rules, metadata models, and HTTP contracts remain owned by the consuming module, not by `backend/infra/fileutil`

## Guardrails

- no PocketBase dependency in `backend/infra/fileutil`
- no HTTP request or response structs in the package
- no product-specific permission decisions embedded in helper logic
- no hidden root defaults; allowed roots must come from the caller
- no silent traversal fallback; forbidden paths must fail explicitly

## File List

- `backend/infra/fileutil/fileutil.go`
- `backend/infra/fileutil/fileutil_test.go`
- `backend/domain/routes/iac.go`
- `backend/domain/lifecycle/runtime/node_executor.go`
