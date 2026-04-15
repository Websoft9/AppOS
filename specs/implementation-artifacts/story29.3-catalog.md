# Story 29.3: Catalog

**Epic**: Epic 29 - Server Base
**Status**: Proposed | **Priority**: P1 | **Depends on**: Story 29.1, Story 29.2, Epic 20, Epic 28

## Objective

Register AppOS-managed server base components as template instances instead of story-specific implementations.

## Scope

- register Docker as a `package` template instance
- register Nginx as a `package` template instance
- register Netdata agent as a `script` template instance
- register control agent as a `script` template instance
- bind each component to detection, preflight, and verification policies

## Catalog Contract

| Component Key | Template Kind | Verification Focus |
|--------------|---------------|--------------------|
| `docker` | `package` | binary version and daemon readiness |
| `reverse-proxy` | `package` | package version and service readiness |
| `monitor-agent` | `script` | binary version and service readiness |
| `control-agent` | `script` | binary version and service readiness |

## Minimal Catalog Table

| Component Key | Label | Template Ref | Binary | Service | Package / Script Ref | Default Actions |
|--------------|-------|--------------|--------|---------|----------------------|-----------------|
| `docker` | Docker | `package-systemd` | `docker` | `docker.service` | `docker.io` or distro equivalent | `install`, `upgrade`, `verify` |
| `reverse-proxy` | Nginx | `package-systemd` | `nginx` | `nginx.service` | `nginx` | `install`, `upgrade`, `verify` |
| `monitor-agent` | Netdata Agent | `script-systemd` | `netdata` | `netdata.service` | `https://get.netdata.cloud/kickstart.sh` | `install`, `upgrade`, `verify` |
| `control-agent` | AppOS Control Agent | `script-systemd` | `appos-control-agent` | `appos-control-agent.service` | AppOS installer URL | `install`, `upgrade`, `verify` |

## Catalog Example

```yaml
components:
  - component_key: docker
    label: Docker
    template_ref: package-systemd
    binary: docker
    service_name: docker.service
    package_name: docker.io
    default_actions: [install, upgrade, verify]

  - component_key: reverse-proxy
    label: Nginx
    template_ref: package-systemd
    binary: nginx
    service_name: nginx.service
    package_name: nginx
    default_actions: [install, upgrade, verify]

  - component_key: monitor-agent
    label: Netdata Agent
    template_ref: script-systemd
    binary: netdata
    service_name: netdata.service
    script_url: https://get.netdata.cloud/kickstart.sh
    default_actions: [install, upgrade, verify]

  - component_key: control-agent
    label: AppOS Control Agent
    template_ref: script-systemd
    binary: appos-control-agent
    service_name: appos-control-agent.service
    script_url: https://example.invalid/appos-control-agent/install.sh
    default_actions: [install, upgrade, verify]
```

## Tasks / Subtasks

- [ ] Task 1: Create component catalog source
  - [ ] 1.1 register component keys
  - [ ] 1.2 bind template kinds
  - [ ] 1.3 bind display metadata
- [ ] Task 2: Bind execution policy per component
  - [ ] 2.1 detection rules
  - [ ] 2.2 preflight rules
  - [ ] 2.3 verification rules
- [ ] Task 3: Add backend integration and tests
  - [ ] 3.1 list/detail routes read from catalog
  - [ ] 3.2 action routes resolve catalog entry before execution
  - [ ] 3.3 catalog coverage tests

## Guardrails

- adding a component should require catalog registration, not a new story
- component differences belong in catalog data or template config, not route forks
- secret or token material must never be stored in catalog metadata
- catalog entries should only contain operator-safe metadata and template placeholders

## Acceptance Criteria

- [ ] Docker, Nginx, Netdata agent, and control agent are represented as catalog entries
- [ ] each catalog entry resolves to exactly one template kind
- [ ] list and detail APIs can render component inventory from catalog metadata
- [ ] adding the next component can reuse the same story pattern without new planning structure

## Notes

- this story turns the current component list into data
- future components should extend catalog entries first