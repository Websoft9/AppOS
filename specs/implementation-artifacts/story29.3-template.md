# Story 29.3: Template

**Epic**: Epic 29 - Software Delivery
**Status**: review | **Priority**: P1 | **Depends on**: Story 29.1, Story 29.2, Epic 20

## Objective

Define the shared component template contract so all software delivery components execute through one model.

## Scope

- define `package` and `script` template kinds
- define shared detect, preflight, install, upgrade, verify steps
- define template-specific fields without changing route shape
- keep action execution and audit contract template-driven

## Template Contract

### Shared Fields

| Field | Notes |
|------|-------|
| `template_kind` | `package` or `script` |
| `display_name` | operator-facing name |
| `detect` | installed-state and version detection |
| `preflight` | OS, privilege, network checks |
| `install` | install step definition |
| `upgrade` | upgrade step definition |
| `verify` | post-action verification |
| `repair` | optional repair step (re-apply install then verify; defaults to install when absent) |

### Kind Rules

- `package`: distro-aware package install and service verification
- `script`: controlled online installer plus explicit verification

## Minimal Schema

Suggested source shape: one template registry file plus one component catalog file.

Suggested paths:

- `backend/domain/software/templates.yaml`
- `backend/domain/software/catalog.yaml`

### Template Example

```yaml
templates:
  package-systemd:
    template_kind: package
    detect:
      version_command: "{{binary}} --version"
      installed_hint:
        - "command -v {{binary}}"
    preflight:
      require_root: true
      supported_os:
        - ubuntu
        - debian
        - rocky
    install:
      strategy: package
      package_name: "{{package_name}}"
    upgrade:
      strategy: package
      package_name: "{{package_name}}"
    verify:
      strategy: systemd
      service_name: "{{service_name}}"
    repair:
      strategy: reinstall  # re-run install then verify

  script-systemd:
    template_kind: script
    detect:
      version_command: "{{binary}} --version"
      installed_hint:
        - "command -v {{binary}}"
    preflight:
      require_root: true
      require_network: true
      supported_os:
        - ubuntu
        - debian
        - rocky
    install:
      strategy: script
      script_url: "{{script_url}}"
      args: []
    upgrade:
      strategy: script
      script_url: "{{script_url}}"
      args:
        - --upgrade
    verify:
      strategy: systemd
      service_name: "{{service_name}}"
    repair:
      strategy: reinstall  # re-run install then verify
```

### Executor Result Example

```json
{
  "component_key": "monitor-agent",
  "template_kind": "script",
  "installed_state": "installed",
  "detected_version": "1.45.3",
  "packaged_version": "1.45.3",
  "verification_state": "healthy",
  "available_actions": ["upgrade", "verify"],
  "last_action": {
    "action": "install",
    "result": "success"
  }
}
```

## Tasks / Subtasks

- [x] Task 1: Define template schema
  - [x] 1.1 shared fields
  - [x] 1.2 `package` fields
  - [x] 1.3 `script` fields
- [x] Task 2: Define executor contract
  - [x] 2.1 detect flow
  - [x] 2.2 preflight flow
  - [x] 2.3 install / upgrade / verify flow
- [x] Task 3: Define backend integration points
  - [x] 3.1 route to template resolution (`TemplateResolver` interface in interfaces.go)
  - [x] 3.2 template result to response mapping (`SoftwareComponentDetail` in model.go)
  - [x] 3.3 template result to audit mapping (audit constants defined in model.go)
- [x] Task 4: Add backend tests
  - [x] 4.1 template validation tests (TestLoadTemplateRegistry, TestRepairStepPresent, TestPreflightOSSupportNonEmpty)
  - [x] 4.2 executor contract tests (TestTemplateResolverInterface, TestComponentExecutorInterface)

## Guardrails

- route shape stays component-agnostic
- no component-specific handler contract drift
- template schema must not allow arbitrary shell input from UI
- template placeholders are resolved from catalog metadata, not user input

## Acceptance Criteria

- [x] all component actions resolve through one shared template contract
- [x] `package` and `script` template kinds are both supported
- [x] detect, preflight, install, upgrade, verify, and repair share one executor shape
- [x] audit output can be derived from template execution without per-component route forks
- [x] repeated invocations of install or repair on an already-installed component are idempotent: they do not fail or corrupt the installed state

## Notes

- this story defines the reusable mechanism
- it does not yet register specific catalog entries

## Dev Agent Record

### Implementation Plan

- Task 1–2: Create `template.go` with typed Go structs for all YAML schema fields + embed declarations for templates.yaml and catalog.yaml
- Task 2–3: Add `TemplateResolver` and `ComponentExecutor` interfaces to `interfaces.go`
- Task 4: TDD — `template_test.go` written first (RED), then implementation (GREEN)

### Debug Log

- template_test.go written first; RED: 10+ undefined symbols.
- templates.yaml updated: added `repair` step (strategy: reinstall) to both package-systemd and script-systemd.
- template.go created with all structs, embed declarations, `LoadTemplateRegistry`, `LoadComponentCatalog`, and `ResolveTemplate`.
- `TemplateResolver` and `ComponentExecutor` interfaces added to interfaces.go.
- GREEN: all 30 serverbase tests pass. Full build clean.

### Completion Notes

- Template schema encoded as typed Go structs in `backend/domain/serverbase/template.go`.
- Both template kinds (package-systemd, script-systemd) embedded and loadable at runtime with `//go:embed`.
- `ResolveTemplate` substitutes all `{{placeholder}}` values from catalog metadata only — no user input path.
- `TemplateResolver` interface provides route-to-template indirection; `ComponentExecutor` provides the execution contract.
- 30 tests total pass (10 new template tests + 20 prior model/boundary tests). Full build is clean.

## File List

- `backend/domain/serverbase/template.go` (new)
- `backend/domain/serverbase/template_test.go` (new)
- `backend/domain/serverbase/templates.yaml` (updated: added repair step to both templates)
- `backend/domain/serverbase/interfaces.go` (updated: added TemplateResolver and ComponentExecutor)

## Change Log

| Date | Change |
|------|--------|
| 2025-07 | Story implemented: template.go + template_test.go created; interfaces updated; 30 tests GREEN; story status → review |

## Status

review