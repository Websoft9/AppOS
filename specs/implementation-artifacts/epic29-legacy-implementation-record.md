# Epic 29 Legacy Implementation Record

**Epic**: Epic 29 - Software Delivery
**Status**: Archived after canonical story consolidation

## Purpose

This document preserves implementation history from the superseded split Story 29.1-29.7 set after Epic 29 was reorganized into five canonical story documents.

The canonical planning surface is now:

- `story29.1-software-contract-and-catalog.md`
- `story29.2-software-lifecycle-execution.md`
- `story29.3-server-software-operational-surface.md`
- `story29.4-supported-software-discovery-surface.md`
- `story29.5-local-software-inventory-surface.md`

This archive keeps the old implementation notes, file lists, and test evidence so the superseded split story files can be removed without losing delivery history.

## Canonical Mapping

| Canonical Story | Superseded Source Stories | Notes |
|---|---|---|
| Story 29.1 Software Contract and Catalog | `story29.1-model.md`, `story29.2-boundary.md`, `story29.3-template.md`, `story29.4-catalog.md` | contract, boundary, template, and catalog foundations |
| Story 29.2 Software Lifecycle Execution | `story29.5-target-readiness.md`, `story29.7-worker.md` | readiness, async worker flow, operation persistence |
| Story 29.3 Server Software Operational Surface | `story29.6-surface.md` | server detail software tab and action surface |
| Story 29.4 Supported Software Discovery Surface | `story29.4a-lightweight-server-software-catalog-surface.md` | read-only supported-software discovery intent |
| Story 29.5 Local Software Inventory Surface | part of `story29.6-surface.md` implementation record | old surface implementation also introduced local inventory pages later split into a dedicated canonical story |

## Story 29.1 Contract and Catalog Legacy Record

### From `story29.1-model.md`

Implementation summary:

- renamed `Operation` to `SoftwareDeliveryOperation` in `backend/domain/software/model.go`
- added `backend/domain/software/interfaces.go` with `CapabilityStatus`, `CapabilityQuerier`, and `CapabilityCommander`
- added `backend/domain/software/events.go` with four domain event constants
- added `backend/domain/software/model_test.go` with 15 tests covering constants, JSON fields, values, and interface compilation
- follow-up implementation note: concrete capability query/command behavior now lives behind `backend/domain/software/service`

Files recorded by the legacy story:

- `backend/domain/software/model.go`
- `backend/domain/software/interfaces.go`
- `backend/domain/software/events.go`
- `backend/domain/software/model_test.go`
- `backend/domain/software/service/service.go`

Evidence recorded by the legacy story:

- 15 tests passed
- full backend build clean

### From `story29.2-boundary.md`

Implementation summary:

- added `backend/domain/serverbase/boundary.go` with typed `Subdomain` constants, `MaterialSubdomainMap`, and `CapabilityComponentMap`
- added `backend/domain/serverbase/boundary_test.go`
- confirmed audit constants in `backend/domain/serverbase/model.go` already matched the `server.software.*` naming after remediation
- preserved Monitor handoff commentary and audit migration note in package godoc

Files recorded by the legacy story:

- `backend/domain/serverbase/boundary.go`
- `backend/domain/serverbase/boundary_test.go`
- `backend/domain/serverbase/model.go`

Evidence recorded by the legacy story:

- 20 serverbase tests green
- `go build ./...` clean

### From `story29.3-template.md`

Implementation summary:

- added `backend/domain/serverbase/template.go` with typed structs, embed declarations, `LoadTemplateRegistry`, `LoadComponentCatalog`, and `ResolveTemplate`
- added `backend/domain/serverbase/template_test.go`
- updated `backend/domain/serverbase/templates.yaml` to add `repair` to both `package-systemd` and `script-systemd`
- updated `backend/domain/serverbase/interfaces.go` with `TemplateResolver` and `ComponentExecutor`
- preserved placeholder-resolution rule: placeholders resolve from catalog metadata only, not arbitrary user input

Files recorded by the legacy story:

- `backend/domain/serverbase/template.go`
- `backend/domain/serverbase/template_test.go`
- `backend/domain/serverbase/templates.yaml`
- `backend/domain/serverbase/interfaces.go`

Evidence recorded by the legacy story:

- 30 serverbase tests green
- full build clean

### From `story29.4-catalog.md`

Implementation summary:

- added `backend/domain/software/catalog_test.go` with six catalog invariant tests
- confirmed `backend/domain/software/catalog.yaml` already contained the managed component set with valid template references
- updated `backend/domain/config/sysconfig/catalog/catalog.go` to register `software-config` and seed `controlAgentInstallerUrl`
- updated `backend/domain/config/sysconfig/catalog/catalog_test.go` with two software-config tests

Files recorded by the legacy story:

- `backend/domain/software/catalog_test.go`
- `backend/domain/software/catalog.yaml`
- `backend/domain/config/sysconfig/catalog/catalog.go`
- `backend/domain/config/sysconfig/catalog/catalog_test.go`

Evidence recorded by the legacy story:

- six new catalog coverage tests green
- sysconfig catalog tests green
- full build clean

## Story 29.2 Lifecycle Execution Legacy Record

### From `story29.5-target-readiness.md`

Implementation summary:

- added `backend/domain/software/readiness.go` with `ReadinessIssueCode`, `TargetInfo`, and `EvaluateReadiness`
- added `backend/domain/software/readiness_test.go`
- preserved readiness behavior notes: case-insensitive OS matching, empty supported-OS means allow any OS, and one issue per failing dimension
- noted that AppOS-local software later exposed a parallel read-only inventory surface under `/api/software/local`

Files recorded by the legacy story:

- `backend/domain/software/readiness.go`
- `backend/domain/software/readiness_test.go`

Evidence recorded by the legacy story:

- nine readiness tests green
- 45 software-domain tests green overall at that point
- full build clean

### From `story29.7-worker.md`

Implementation summary:

- added `backend/domain/worker/software_delivery.go` with task types, payloads, enqueue helpers, phase guards, executor factory hook, and worker flow helpers
- added `backend/domain/worker/software_delivery_test.go`
- added migration `backend/infra/migrations/1764800000_software_operations.go`
- updated `backend/infra/collections/names.go` with `SoftwareOperations`
- added `backend/domain/routes/software.go` and updated `backend/domain/routes/routes.go` to register software routes
- updated `backend/domain/worker/worker.go` with four new mux handler registrations
- preserved important implementation note: `softwareExecutorFactory` returns `nil` by default, so missing executors fail gracefully with `component executor not yet implemented`
- preserved guard note: duplicate in-flight detection used `terminal_status = 'none'`
- preserved audit note: terminal audit records use `server.software.{action}` action names

Files recorded by the legacy story:

- `backend/domain/worker/software_delivery.go`
- `backend/domain/worker/software_delivery_test.go`
- `backend/domain/worker/worker.go`
- `backend/infra/migrations/1764800000_software_operations.go`
- `backend/infra/collections/names.go`
- `backend/domain/routes/software.go`
- `backend/domain/routes/routes.go`

Evidence recorded by the legacy story:

- phase-forward tests, task creation tests, and payload round-trip tests green
- full build clean

## Story 29.3 Server Surface Legacy Record

### From `story29.6-surface.md`

Implementation summary:

- added `web/src/lib/software-api.ts` with API helpers for operations, components, capabilities, detail, and async action invocation
- added `web/src/lib/software-api.test.ts` with 11 frontend tests
- added `web/src/components/servers/ServerSoftwarePanel.tsx` for the server detail Software tab
- modified `web/src/routes/_app/_auth/resources/servers.tsx` to add the `software` tab wiring
- added `backend/domain/routes/software.go` as the backend route family used by the surface

Files recorded by the legacy story:

- `web/src/lib/software-api.ts`
- `web/src/lib/software-api.test.ts`
- `web/src/components/servers/ServerSoftwarePanel.tsx`
- `web/src/routes/_app/_auth/resources/servers.tsx`
- `backend/domain/routes/software.go`

Evidence recorded by the legacy story:

- frontend 11/11 pass for `software-api.test.ts`
- backend `go build ./...` clean

## Story 29.4 Supported Software Discovery Legacy Record

### From `story29.4a-lightweight-server-software-catalog-surface.md`

Legacy product intent preserved:

- supported-software discovery must remain available before any server is connected
- the page must stay read-only and clearly represent `supported by AppOS`, not installed state
- the entry belongs under `Resources` as a lightweight software-oriented family, not under `Settings` and not inside a generic package center
- server lifecycle actions remain in the server-scoped Software tab rather than in discovery surfaces

This intent is now carried by canonical Story 29.4.

## Story 29.5 Local Inventory Legacy Record

### From `story29.6-surface.md` split outcome

The legacy Story 29.6 implementation record also introduced local inventory artifacts that now belong to canonical Story 29.5:

- `web/src/components/software/LocalSoftwareInventoryPage.tsx`
- `web/src/routes/_app/_auth/resources/local-software.tsx`

Legacy evidence recorded there:

- local AppOS inventory was intentionally separated from the server-scoped Software tab
- backend route family and frontend types were shared with the broader software surface implementation

## Deletion Note

The superseded split story files were removed after this archive was added and after planning references were retargeted to the canonical five-story set.