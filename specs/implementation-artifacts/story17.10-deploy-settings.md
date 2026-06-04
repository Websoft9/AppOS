# Story 17.10: Deploy Settings and Runtime Policy Extraction

Status: proposed

## Story

As a platform operator,
I want platform-owned deploy guardrails and runtime policies to be configurable in workspace settings,
so that install checks and execution behavior can adapt to different host environments without code changes.

## Scope

- Expand deploy settings beyond a single preflight disk threshold into a small platform-owned policy surface.
- Keep install-request data, template metadata, and per-app declarations outside workspace settings.
- Move hardcoded deploy policy defaults into persisted settings where they represent platform guardrails rather than per-request business input.
- Keep worker and preflight semantics explicit and stable after extraction.
- Land the configuration through the shared Epic 13 Settings Module onboarding path.

## Acceptance Criteria

1. Workspace settings API supports deploy-owned settings groups for platform policy, not just per-request install input.
2. `deploy/preflight.minFreeDiskBytes` remains persisted via existing settings storage with default `536870912` bytes (0.5 GiB), and the story may add adjacent preflight probe timeout or resource-policy fields only when they are platform-owned and shared across install entry paths.
3. Deploy execution runtime policies that are currently hardcoded but platform-owned are modeled under a deploy runtime settings group, including compose execution timeout, health-check timeout, image-pull timeout, and runtime-pull idle heartbeat cadence.
4. Git Compose default branch and default compose path may be modeled as deploy settings only when treated as platform defaults, while request payloads may still override them explicitly.
5. Request-scoped install data remains out of workspace settings, including `project_name`, `server_id`, `env`, `runtime_inputs`, `source_build`, exposure payloads, and app-specific resource declarations such as `app_required_disk_bytes`.
6. Preflight disk check continues to report `min_free_bytes`, `available_bytes` when probe succeeds, and `required_app_bytes` in response payload.
7. Preflight hard-block semantics remain explicit and unchanged unless a follow-up story intentionally expands resource blocking beyond disk:
   - available disk below `minFreeDiskBytes`
   - app estimated disk requirement greater than available disk
8. Non-blocking probe failures, such as unavailable probe capability or parse failure, remain warnings and do not hard-block install creation by themselves.
9. Create endpoints continue to perform server-side preflight before operation creation and reject when the resulting preflight decision is blocking.

## Configuration Design

### Deploy-Owned Settings Groups

- Module: `deploy`
- Keys:
  - `preflight`
  - `runtime`
  - optional `git-defaults`

### Example Payloads

`deploy/preflight`

```json
{
  "minFreeDiskBytes": 536870912
}
```

`deploy/runtime`

```json
{
  "imagePullTimeoutSeconds": 180,
  "composeUpTimeoutSeconds": 600,
  "healthCheckTimeoutSeconds": 120,
  "runtimePullIdleHeartbeatSeconds": 20
}
```

`deploy/git-defaults`

```json
{
  "defaultRef": "main",
  "defaultComposePath": "docker-compose.yml"
}
```

### Validation Rules

- `minFreeDiskBytes` must be an integer.
- Minimum value: `0`.
- Maximum value: `1099511627776` (1 TiB).
- Runtime timeout and interval fields must be positive integers expressed in seconds.
- `defaultRef` and `defaultComposePath` must be non-empty strings when configured.
- Invalid values return `422` with field-level errors.

## Runtime Decision Matrix

- `status=conflict, ok=false`:
  - `available_bytes < min_free_bytes`
  - `required_app_bytes > 0 && required_app_bytes > available_bytes`
- `status=ok, ok=true`:
  - probe succeeds and no conflict condition is met
- `status=warning|unavailable, ok=true`:
  - probe capability unavailable, unexpected output, or parse failure

## Settings Boundary

### Should Be Settings

- platform-wide preflight thresholds and probe timing
- platform-wide deploy execution timeouts and heartbeat cadence
- platform-wide Git Compose defaults

### Must Not Be Settings

- request-scoped install payload such as project name, target server, env, exposure, runtime inputs, and source-build request body
- app/template-owned resource declarations such as estimated required disk
- internal filesystem root changes such as deployment workspace base path unless a separate system-level configuration story owns migration and compatibility

## API Notes

### Request Metadata Inputs

- Top-level `app_required_disk_gib` may be supplied by UI for check/create calls.
- Backend normalizes estimate to `metadata.app_required_disk_bytes` and uses it in disk preflight evaluation.
- Request payloads may continue to supply explicit Git Compose ref and compose path; settings only provide fallback defaults.

### Response Notes

- Disk check message must include reason and compared values for conflicts.
- Warning paths should remain explicit about why data is unavailable or incomplete.

## Out Of Scope

- Dynamic per-app profile catalogs for disk estimate defaults.
- Historical disk trend prediction.
- Automatic threshold tuning.
- Redesigning install request schemas to move request-scoped inputs into settings.
- Converting deployment workspace root path into a normal workspace setting in this story.

## File Touchpoints

- `backend/domain/config/sysconfig/schema/schema.go`
- `backend/domain/routes/settings_handlers.go`
- `backend/domain/routes/deploy.go`
- `backend/domain/lifecycle/service/install_preflight.go`
- `backend/domain/lifecycle/runtime/installprobe/install_preflight_probe.go`
- `backend/domain/worker/deployment_image_pull.go`
- `backend/domain/worker/worker.go`
- `backend/domain/lifecycle/runtime/node_executor.go`
- `specs/implementation-artifacts/story17.10-settings.md`
