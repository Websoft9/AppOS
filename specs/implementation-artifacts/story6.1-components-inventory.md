# Story 6.1: Components Inventory

Status: proposed

## Story

As a system administrator,
I want to see a simple inventory of installed AppOS components,
so that I can quickly confirm which core parts are present and whether they are still usable.

## Acceptance Criteria

1. Backend provides a component inventory endpoint for AppOS system components. Each record must include at minimum: `name`, `version`, `available`, and `last_detected_at`.
2. Inventory includes the initial baseline derived from AppOS build/runtime composition, including at least: `appos`, dashboard static bundle, reverse proxy, process manager, cache/data service, container tooling, infrastructure tooling, Node runtime, package manager, Store Library artifact, and base OS.
3. `available` indicates whether the component is usable and not in a broken state. It is sufficient for MVP to represent this as a boolean or equivalent healthy/broken status.
4. Component inventory is backed by one human-maintained YAML metadata registry that defines the supported component list and how each component is inspected.
5. Frontend `Installed Components` tab renders read-only text cards (name + version + time) in a high-density responsive grid (up to five columns on wide desktop), without category grouping, source filters, summary statistics, or search.
6. Frontend shows explicit loading, empty, error, and partial-detection states. Partial-detection means some components render successfully while others are shown as unavailable or version-unknown.
7. UI renders well for mobile and desktop admin workflows and uses Dashboard design system components.
8. API and UI remain read-only in this story; no version editing, install, or uninstall operations are introduced.

## Tasks / Subtasks

- [ ] Define installed component inventory contract (AC: 1,2,3,4)
  - [ ] Define component DTO for `name`, `version`, `available`, and `last_detected_at`
  - [ ] Translate Dockerfile-derived baseline into normalized seed detection rules
  - [ ] Define missing-version and unavailable-component behavior
- [ ] Define YAML metadata registry (AC: 4)
  - [ ] Define registry file location and loading lifecycle
  - [ ] Define required fields per component entry
  - [ ] Define safe defaults for logs and operations
- [ ] Implement backend aggregation endpoint for installed components (AC: 1,2,3,4,6)
  - [ ] Add component aggregation service under `backend/domain/`
  - [ ] Add PB route for `GET /api/components` or equivalent final route contract
  - [ ] Map YAML registry entries to detection results and simple availability status
- [ ] Implement frontend Installed Components tab (AC: 5,6,7,8)
  - [ ] Add simple read-only text cards/grid without search or category/filter controls
  - [ ] Add loading, empty, error, and partial-detection UI states
  - [ ] Add responsive layout treatment for narrow screens
- [ ] Validation (AC: 1-8)
  - [ ] Backend tests for response shape and availability evaluation
  - [ ] Frontend typecheck/tests for simple list rendering and partial-detection states

## Dev Notes

- Start with the build/runtime baseline already documented in Epic 6 rather than trying to solve full SBOM coverage in the first iteration.
- Keep the output admin-friendly and minimal; do not expose `SBOM`, `package URL`, provenance details, or scanner jargon in primary UI copy.
- This story intentionally focuses on installed/static visibility. Running state and service operations belong to Story 6.2.

### Suggested API Shape

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/components` | List normalized installed components |

### API Contract

#### `GET /api/components`

Purpose: return the simplified installed component inventory used by the `Installed Components` tab.

Response `200 OK`:

```json
[
  {
    "id": "appos",
    "name": "AppOS",
    "version": "0.9.0",
    "available": true,
    "last_detected_at": "2026-03-18T10:24:00Z"
  },
  {
    "id": "nginx",
    "name": "Nginx",
    "version": "1.26.2",
    "available": true,
    "last_detected_at": "2026-03-18T10:24:00Z"
  },
  {
    "id": "pi-agent",
    "name": "Pi Agent",
    "version": "unknown",
    "available": false,
    "last_detected_at": "2026-03-18T10:24:00Z"
  }
]
```

Field rules:

| Field | Type | Required | Notes |
|------|------|----------|-------|
| `id` | string | yes | Stable component key from metadata registry |
| `name` | string | yes | User-facing display name |
| `version` | string | yes | Detected version or `unknown` |
| `available` | boolean | yes | Whether the component is currently usable |
| `last_detected_at` | string | yes | RFC3339 timestamp for last successful probe attempt |

Error behavior:

1. `401 Unauthorized` when auth is missing or invalid.
2. `500 Internal Server Error` when registry loading fails or component aggregation fails completely.
3. Partial detection still returns `200 OK`; unavailable components remain in the list with `available: false` or `version: "unknown"`.

### Metadata Registry Rules

Preferred format: YAML.

The registry should be the single source of truth for supported components and should be maintained as a human-readable file, for example `backend/config/components.yaml` or an equivalent backend-owned path.

Minimum fields per component entry:

| Field | Purpose |
|------|---------|
| `id` | Stable internal key |
| `name` | User-facing name |
| `enabled` | Whether this component should appear in the inventory |
| `criticality` | Risk level such as `core`, `important`, `optional` |
| `version_probe` | Backend-only definition of how version is detected |
| `availability_probe` | Backend-only definition of how usability is checked |
| `log_access` | Backend-only definition of how logs are retrieved |
| `operations` | Allowed actions such as restart/start/stop |
| `notes` | Short maintainer guidance |

Registry rules:

1. Commands and probe definitions are backend-owned and must never be executed by the frontend.
2. `operations.start`, `operations.stop`, and `operations.restart` default to `false` and must be explicitly enabled.
3. Core components should remain observable by default; dangerous actions are not assumed to exist.
4. Version and availability probes are required for every enabled component unless explicitly documented as unsupported.
5. Log access may be optional, but the registry should still declare the intended log source when available.

Suggested registry path: `backend/config/components.yaml`.

### Initial Baseline Targets

- AppOS backend binary
- Dashboard static bundle
- Nginx
- Supervisor
- Redis
- Terraform CLI
- Docker CLI
- Docker Compose CLI plugin
- Node.js
- npm
- Pi Coding Agent
- Store Library plugin
- Alpine base image

## References

- [Source: specs/implementation-artifacts/epic6-components.md#Stories]
- [Source: specs/implementation-artifacts/epic6-components.md#Initial Component Inventory Baseline]
- [Source: build/Dockerfile]
- [Source: build/Dockerfile.local]
