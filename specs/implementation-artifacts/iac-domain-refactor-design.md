# IaC Domain Refactor Design

**Scope**: Epic 14 `IaC File Management`

**Status**: proposed

## Goal

Refactor the current IaC implementation from a route-centric structure into a clearer domain-centered design under `backend/domain/iac`, while preserving the current MVP behavior and continuing to use `backend/infra/filesvc` as the filesystem capability boundary.

This is a structural refactor, not a product-scope expansion.

## Why Now

The current IaC backend implementation already has a stable filesystem substrate in `backend/infra/filesvc`, but `backend/domain/routes/iac.go` still mixes multiple concerns:

- HTTP request and response mapping
- IaC workspace policy
- upload and content-read constraints
- library import rules
- route-local DTO definitions
- filesvc wiring and error translation

That shape is still workable for MVP, but it is no longer the right long-term home for IaC behavior. The route file is already acting as a transport adapter plus application service plus policy holder.

## Feasibility Decision

This refactor is feasible now because:

1. `filesvc` already owns the reusable local filesystem behavior.
2. IaC is a policy-oriented domain with a clear bounded context.
3. The current route implementation already exposes the seams needed for extraction.

This refactor should be executed incrementally. It should not be attempted as a single all-at-once rewrite.

## Domain Framing

`IaC` should be treated as a workspace-policy domain, not as a generic file domain.

IaC owns:

- workspace root policy under `/appos/data`
- library import policy under `/appos/library`
- path and cross-root movement rules specific to IaC
- upload policy for IaC-managed files
- text-read policy for editor-facing access
- operator-facing use cases for list/read/create/update/delete/move/upload/download/import

IaC does not own:

- generic filesystem safety
- generic local file read/write/copy/move primitives
- HTTP router registration details
- transport-level response encoding

Those concerns already belong to `backend/infra/filesvc` and route adapters.

## Target Package Layout

Create a new package:

- `backend/domain/iac/`

Recommended initial file split:

- `backend/domain/iac/doc.go`
  - package boundary and intent
- `backend/domain/iac/policy.go`
  - roots, archive constant, text-read rules, cross-root move rule, helper policy functions
- `backend/domain/iac/config.go`
  - quota and upload-limit loading from settings
- `backend/domain/iac/errors.go`
  - IaC domain and application-level errors exposed to route adapters
- `backend/domain/iac/contracts.go`
  - smallest interfaces for workspace access and library access
- `backend/domain/iac/service.go`
  - application service orchestrating IaC use cases
- `backend/domain/iac/dto.go`
  - request-independent response models returned by the service layer

The existing route file remains:

- `backend/domain/routes/iac.go`

But after refactor it should act only as the HTTP adapter.

## Target Responsibility Split

### 1. `backend/infra/filesvc`

Keep as infrastructure capability only.

Responsibilities:

- path safety
- root enforcement
- file and directory operations
- local streaming writes
- cross-base copy capability

Non-responsibilities:

- IaC upload policy
- IaC text-read policy
- IaC route DTOs
- IaC settings semantics

### 2. `backend/domain/iac`

Use as the IaC domain plus application-service package.

Responsibilities:

- define the IaC workspace and library boundaries
- define allowed IaC roots
- define which reads are editor-oriented text reads
- define upload constraints and archive rule interpretation
- define whether cross-root moves are allowed
- define library import behavior
- expose use cases in service form

Non-responsibilities:

- raw filesystem implementation
- direct HTTP request binding
- direct PocketBase router manipulation

### 3. `backend/domain/routes/iac.go`

Reduce to transport adapter only.

Responsibilities:

- bind request body and query values
- invoke IaC service use cases
- map service errors to HTTP status codes
- stream downloads via HTTP response

## Interface Direction

Do not let `backend/domain/iac` depend directly on the concrete `*filesvc.LocalService` type.

Instead define the minimum ports in `backend/domain/iac/contracts.go`.

Suggested direction:

```go
type WorkspacePort interface {
	List(path string) ([]filesvc.Entry, error)
	ReadFile(path string) ([]byte, filesvc.Entry, error)
	WriteFile(path string, data []byte, overwrite bool) (filesvc.Entry, error)
	WriteReader(path string, reader io.Reader, overwrite bool, maxBytes int64) (filesvc.Entry, error)
	Mkdir(path string) (filesvc.Entry, error)
	Delete(path string, recursive bool) error
	Move(fromPath, toPath string, overwrite bool) (filesvc.Entry, error)
	Stat(path string) (filesvc.Entry, error)
	Resolve(path string) (string, error)
}

type LibraryPort interface {
	List(path string) ([]filesvc.Entry, error)
	ReadFile(path string) ([]byte, filesvc.Entry, error)
	Stat(path string) (filesvc.Entry, error)
}

type CrossCopyPort interface {
	CopyLibraryToWorkspace(fromPath, toPath string, overwrite bool) (filesvc.Entry, error)
}
```

The exact names may change, but the design rule should remain:

- domain depends on the smallest useful capability contract
- routes do not own business or policy logic
- concrete `filesvc` wiring stays outside the core service logic

## Service Shape

The initial `backend/domain/iac/service.go` should expose use cases, not route handlers.

Suggested shape:

```go
type Service struct {
	workspace WorkspacePort
	library   LibraryPort
	crossCopy CrossCopyPort
	settings  SettingsPort
}

func (s *Service) List(path string) ([]Entry, error)
func (s *Service) ReadText(path string) (FileContent, error)
func (s *Service) CreateFile(path, content string) error
func (s *Service) CreateDir(path string) error
func (s *Service) UpdateFile(path, content string) error
func (s *Service) Delete(path string, recursive bool) error
func (s *Service) Move(fromPath, toPath string) error
func (s *Service) Upload(dirPath, filename string, reader io.Reader, sizeHint int64) (string, error)
func (s *Service) Download(path string) (ResolvedFile, error)
func (s *Service) ListLibrary(path string) ([]Entry, error)
func (s *Service) ReadLibraryText(path string) (FileContent, error)
func (s *Service) ImportLibraryApp(sourceKey, destKey string) error
```

The service should return domain-oriented DTOs and errors. The route layer remains responsible for HTTP serialization.

## Extractable Logic From Current `routes/iac.go`

The following logic should move out of the route file into `backend/domain/iac`:

- `filesAllowedRoots`, `libraryAllowedRoots`, and archive rule ownership
- `loadIacFileLimits()` semantics and quota interpretation
- text MIME allow rule in `isTextMIME()`
- `rootOf()` usage as a cross-root move policy
- upload size-limit interpretation
- upload extension blacklist interpretation
- library import rules and destination shaping
- mapping from `filesvc.Entry` to IaC-facing entry DTOs

The following logic should remain in routes:

- `BindBody()` and query parsing
- `e.JSON(...)`, `ServeFile(...)`, and response headers
- transport-specific status code mapping

## Target Error Strategy

The refactor should stop mapping `filesvc` errors directly inside every handler.

Instead:

1. `filesvc` continues to expose infrastructure-oriented errors.
2. `backend/domain/iac` translates them into IaC service errors such as:
   - invalid path
   - path not found
   - file required
   - directory required
   - destination exists
   - cross-root move forbidden
   - binary content not supported
   - upload limit exceeded
   - upload extension forbidden
3. `routes/iac.go` maps those IaC service errors to HTTP.

This will make IaC routes thinner and prevent route code from understanding `filesvc` internals directly.

## Recommended Refactor Sequence

### Phase 1: Domain skeleton

- create `backend/domain/iac`
- move constants and pure policy helpers first
- create service skeleton and smallest DTOs

Expected outcome:

- route file still works, but policy no longer lives only in routes

### Phase 2: Read-side extraction

- move list, read-text, library list, and library read into the IaC service
- keep route handlers as thin transport adapters

Expected outcome:

- read-side behavior becomes the first verified domain service path

### Phase 3: Write-side extraction

- move create, update, delete, move, upload, and import-library orchestration into the IaC service
- centralize upload policy and cross-root policy there

Expected outcome:

- all business orchestration leaves `routes/iac.go`

### Phase 4: Wiring cleanup

- replace direct `*filesvc.LocalService` assumptions with explicit IaC ports
- keep concrete `filesvc` construction in route wiring or a nearby bootstrap helper

Expected outcome:

- `backend/domain/iac` depends on stable capability contracts rather than concrete infra types

## Risks

1. Over-refactoring too early

Risk:
moving DTO and HTTP concerns too aggressively may slow the work without improving clarity.

Mitigation:
move policy and use-case orchestration first; keep transport DTOs simple during the first extraction.

2. Leaking `filesvc` types into the domain surface forever

Risk:
the first extraction may accidentally freeze a concrete infra dependency into the IaC service API.

Mitigation:
use a staged approach but keep the end-state explicit: IaC should depend on ports, not on `*filesvc.LocalService`.

3. Mixing settings loading with route concerns again

Risk:
settings-backed limits may stay route-owned.

Mitigation:
move settings interpretation into `backend/domain/iac/config.go` early in Phase 1.

## Decision

Proceed with an incremental DDD-oriented refactor of IaC into `backend/domain/iac`.

Do not rewrite the module in one pass.

Do not treat this as a product-scope story.

Treat it as a structural refactor that:

- keeps `filesvc` as infrastructure capability
- moves IaC policy and orchestration into the domain layer
- leaves HTTP concerns in route adapters