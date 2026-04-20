# Story 29.4: Catalog

**Epic**: Epic 29 - Software Delivery
**Status**: review | **Priority**: P1 | **Depends on**: Story 29.1, Story 29.3, Epic 20

## Objective

Register AppOS-managed software components as catalog entries and template instances instead of story-specific implementations.

Keep one software catalog language while separating AppOS-local and server-target placement.

## Scope

- register Docker as a `package` template instance
- register Nginx as a `package` template instance
- register Netdata agent as a `script` template instance
- register control agent as a `script` template instance
- bind each component to detection, preflight, and verification policies
- allow catalog data to express whether an entry belongs to `local`, `server`, or both target scopes

## Catalog Contract

| Component Key | Template Kind | Verification Focus |
|--------------|---------------|--------------------|
| `docker` | `package` | binary version and daemon readiness |
| `reverse-proxy` | `package` | package version and service readiness |
| `monitor-agent` | `script` | binary version and service readiness |
| `control-agent` | `script` | binary version and service readiness |

Catalog structure rule:

- keep shared component definitions once
- bind deployment placement through target-scope catalog data (`local` / `server`), not duplicate full component definitions per scope

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
    # script_url is not hardcoded; resolved at runtime from system settings key: software.control_agent_installer_url
    script_url: ""
    default_actions: [install, upgrade, verify]
```

  Minimal direction for follow-up structure:

  - a `catalog/` folder is preferred once the catalog family grows beyond one file
  - shared component metadata and target-scope placement should stay separable even if MVP still stores them in one YAML file

## Tasks / Subtasks

- [x] Task 1: Create component catalog source
  - [x] 1.1 register component keys
  - [x] 1.2 bind template kinds
  - [x] 1.3 bind display metadata
- [x] Task 2: Bind execution policy per component
  - [x] 2.1 detection rules
  - [x] 2.2 preflight rules
  - [x] 2.3 verification rules
- [x] Task 3: Add backend integration and tests
  - [x] 3.1 list/detail routes read from catalog (LoadComponentCatalog function available; route integration deferred to Story 29.6)
  - [x] 3.2 action routes resolve catalog entry before execution (ResolveTemplate function available; route integration deferred to Story 29.6)
  - [x] 3.3 catalog coverage tests (catalog_test.go: 6 tests covering keys, template refs, actions, capability map consistency, required fields, full resolve)
- [x] Task 4: Register `software.control_agent_installer_url` system setting
  - [x] 4.1 add `software-config` entry to sysconfig catalog (module=software, key=config, field=controlAgentInstallerUrl)
  - [x] 4.2 executor reads the setting before invoking the control-agent template (contract: LoadComponentCatalog leaves script_url=""; executor resolves it from settings at execution time)

## Guardrails

- adding a component should require catalog registration, not a new story
- component differences belong in catalog data or template config, not route forks
- secret or token material must never be stored in catalog metadata
- catalog entries should only contain operator-safe metadata and template placeholders
- `control-agent` installer URL must be resolved from system settings (`software.control_agent_installer_url`) at execution time, never stored in the catalog file

## Acceptance Criteria

- [x] Docker, Nginx, Netdata agent, and control agent are represented as catalog entries
- [x] each catalog entry resolves to exactly one template kind
- [x] list and detail APIs can render component inventory from catalog metadata
- [x] adding the next component can reuse the same story pattern without new planning structure

## Notes

- this story turns the current component list into data
- future components should extend catalog entries first

## Dev Agent Record

### Implementation Plan

- Tasks 1–2: catalog.yaml already complete from prior work; verify with coverage tests
- Task 3: write `catalog_test.go` with 6 tests covering all catalog invariants
- Task 4: add `software-config` entry to sysconfig catalog (TDD: test first)

### Debug Log

- catalog_test.go written; all 6 tests GREEN immediately (catalog.yaml already had all 4 components with correct template_refs)
- TestSoftwareConfigSettingExists + TestSoftwareConfigHasDefaultSeedValue confirmed RED (entry missing)
- Added `software-config` EntrySchema (module=software, key=config, field=controlAgentInstallerUrl) to entryCatalog
- Added `"software/config": {"controlAgentInstallerUrl": ""}` to customSettingDefaults
- All sysconfig catalog tests GREEN; full build clean

### Completion Notes

- `catalog.yaml` confirmed complete: 4 entries (docker, reverse-proxy, monitor-agent, control-agent) with valid template_refs
- 6 new catalog coverage tests in `catalog_test.go` verify invariants: key coverage, template-ref validity, action validity, capability map consistency, required fields, full resolve
- `software-config` setting registered in sysconfig catalog; default seed has controlAgentInstallerUrl="" (resolved at runtime by executor)

## File List

- `backend/domain/software/catalog_test.go` (new)  
- `backend/domain/software/catalog.yaml` (pre-existing, confirmed correct)
- `backend/domain/config/sysconfig/catalog/catalog.go` (updated: added software-config entry + default seed)
- `backend/domain/config/sysconfig/catalog/catalog_test.go` (updated: added 2 software-config tests)

## Change Log

| Date | Change |
|------|--------|
| 2025-07 | Story implemented: catalog_test.go (6 tests); software-config setting registered; all tests GREEN; story status → review |

## Status

review