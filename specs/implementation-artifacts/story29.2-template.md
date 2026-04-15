# Story 29.2: Template

**Epic**: Epic 29 - Server Base
**Status**: Proposed | **Priority**: P1 | **Depends on**: Story 29.1, Epic 20

## Objective

Define the shared component template contract so all server base components execute through one model.

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

### Kind Rules

- `package`: distro-aware package install and service verification
- `script`: controlled online installer plus explicit verification

## Minimal Schema

Suggested source shape: one template registry file plus one component catalog file.

Suggested paths:

- `backend/domain/serverbase/templates.yaml`
- `backend/domain/serverbase/catalog.yaml`

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

- [ ] Task 1: Define template schema
  - [ ] 1.1 shared fields
  - [ ] 1.2 `package` fields
  - [ ] 1.3 `script` fields
- [ ] Task 2: Define executor contract
  - [ ] 2.1 detect flow
  - [ ] 2.2 preflight flow
  - [ ] 2.3 install / upgrade / verify flow
- [ ] Task 3: Define backend integration points
  - [ ] 3.1 route to template resolution
  - [ ] 3.2 template result to response mapping
  - [ ] 3.3 template result to audit mapping
- [ ] Task 4: Add backend tests
  - [ ] 4.1 template validation tests
  - [ ] 4.2 executor contract tests

## Guardrails

- route shape stays component-agnostic
- no component-specific handler contract drift
- template schema must not allow arbitrary shell input from UI
- template placeholders are resolved from catalog metadata, not user input

## Acceptance Criteria

- [ ] all component actions resolve through one shared template contract
- [ ] `package` and `script` template kinds are both supported
- [ ] detect, preflight, install, upgrade, verify share one executor shape
- [ ] audit output can be derived from template execution without per-component route forks

## Notes

- this story defines the reusable mechanism
- it does not yet register specific components