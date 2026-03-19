# Story 6.4: Detection Pipeline

Status: proposed

## Story

As a platform maintainer,
I want a component detection pipeline with clear provenance and extensibility rules,
so that the Components workspace can evolve from simple inventory into future health, upgrade, and risk insights without breaking its core data model.

## Acceptance Criteria

1. Backend defines a component aggregation layer that merges multiple detection sources into one normalized component model.
2. Detection sources are explicitly classified, at minimum: build metadata, runtime command detection, service discovery, and application metadata.
3. The model can represent components that have no running service and services that should not be treated as first-class installed components.
4. Aggregation logic records provenance per component record and defines conflict-resolution rules when multiple sources provide version data.
5. Detection is driven by one backend-owned YAML metadata registry that defines supported components, probes, log access, and optional operations.
6. The design leaves a stable extension point for future health, vulnerability, upgrade, or compliance fields without requiring a breaking schema rewrite.
7. Story produces a documented detection contract even if only a subset of detectors is implemented in the first pass.

## Tasks / Subtasks

- [ ] Define normalized component aggregation contract (AC: 1,2,3,4,5,6,7)
  - [ ] Define detector interface and aggregation output shape
  - [ ] Define precedence rules for version conflicts and missing data
  - [ ] Define provenance storage fields and extension points
- [ ] Define metadata registry loading rules (AC: 5,7)
  - [ ] Define YAML schema and validation rules
  - [ ] Define registry boot-time loading and invalid-config failure behavior
  - [ ] Define safe defaults for operations and log access
- [ ] Implement first-pass detectors (AC: 1,2,4,5,7)
  - [ ] Build metadata detector from image/build configuration
  - [ ] Runtime command detector for version probing where needed
  - [ ] Service discovery detector for runtime-linked components where useful
- [ ] Document future extensibility rules (AC: 3,5,6,7)
  - [ ] Define how future security/health metadata attaches to current component IDs
  - [ ] Define boundaries between installed component records and runtime service records
- [ ] Validation (AC: 1-7)
  - [ ] Unit tests for aggregation precedence, registry validation, and provenance output
  - [ ] Story-level documentation review against Epic 6 scope

## Dev Notes

- This story is architectural groundwork, not a user-visible surface by itself.
- The long-term direction is standards-friendly and supply-chain-aware, but the immediate UI should still consume an admin-friendly normalized model.
- Avoid binding the model too tightly to a single scanner vendor or a single command-line probing strategy.

### Suggested Internal Model

| Field | Purpose |
|------|---------|
| `id` | Stable component identity |
| `name` | User-facing label |
| `version` | Best-known resolved version |
| `available` | Usability / non-broken state |
| `last_detected_at` | Freshness marker |

### Metadata Registry Rules

Preferred format: YAML.

The registry should be backend-owned and treated as master data for supported components. It should define what exists, how it is inspected, and whether any dangerous action is even eligible for later exposure.

Minimum entry shape:

| Field | Purpose |
|------|---------|
| `id` | Stable internal key |
| `name` | Display label |
| `enabled` | Include/exclude component from registry |
| `criticality` | `core`, `important`, or `optional` |
| `version_probe` | Backend-only version detection definition |
| `availability_probe` | Backend-only usability check definition |
| `log_access` | Backend-only log retrieval definition |
| `operations.start` | Default `false` |
| `operations.stop` | Default `false` |
| `operations.restart` | Default `false` |
| `notes` | Maintainer notes |

Registry rules:

1. The frontend never executes registry commands or interprets shell snippets directly.
2. Core components are observe-first by default; dangerous operations must be explicitly enabled and justified.
3. Invalid registry entries should fail backend validation rather than silently degrading into unsafe behavior.
4. The registry should be extensible enough to add future health or risk metadata without replacing component IDs.

### Example `components.yaml`

```yaml
version: 1

components:
  - id: appos
    name: AppOS
    enabled: true
    criticality: core
    version_probe:
      type: command
      command:
        - /usr/local/bin/appos
        - version
    availability_probe:
      type: http
      url: http://127.0.0.1/api/health
      expect_status: 200
    log_access:
      type: supervisor
      service: appos
      default_stream: stdout
    operations:
      start: false
      stop: false
      restart: false
    notes: Primary backend and API service.

  - id: nginx
    name: Nginx
    enabled: true
    criticality: core
    version_probe:
      type: command
      command:
        - nginx
        - -v
    availability_probe:
      type: command
      command:
        - nginx
        - -t
    log_access:
      type: file
      stdout_path: /var/log/nginx/access.log
      stderr_path: /var/log/nginx/error.log
    operations:
      start: false
      stop: false
      restart: false
    notes: Reverse proxy and static file server.

  - id: redis
    name: Redis
    enabled: true
    criticality: important
    version_probe:
      type: command
      command:
        - redis-server
        - --version
    availability_probe:
      type: command
      command:
        - redis-cli
        - ping
      expect_output: PONG
    log_access:
      type: supervisor
      service: redis
      default_stream: stdout
    operations:
      start: false
      stop: false
      restart: false
    notes: Internal cache/runtime dependency.

services:
  - name: appos
    component_id: appos
    enabled: true
    log_access:
      type: supervisor
      service: appos
      default_stream: stdout
    operations:
      start: false
      stop: false
      restart: false

  - name: nginx
    component_id: nginx
    enabled: true
    log_access:
      type: file
      stdout_path: /var/log/nginx/access.log
      stderr_path: /var/log/nginx/error.log
    operations:
      start: false
      stop: false
      restart: false
```

Example interpretation rules:

1. `components[]` defines the installed inventory rendered by `GET /api/components`.
2. `services[]` defines the runtime service surfaces rendered by `GET /api/components/services`.
3. `component_id` links a runtime service to its parent installed component when such mapping exists.
4. `operations.*` remain `false` by default and should only be enabled after an explicit safety review.
5. Probe definitions are backend-owned execution metadata, not frontend configuration.

## References

- [Source: specs/implementation-artifacts/epic6-components.md#Stories]
- [Source: specs/implementation-artifacts/epic6-components.md#Key Technical Decisions]
- [Source: build/Dockerfile]
- [Source: build/Dockerfile.local]