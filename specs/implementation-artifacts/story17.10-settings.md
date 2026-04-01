# Story 17.10: Deploy Preflight Settings Extraction

Status: proposed

## Story

As a platform operator,
I want deploy preflight guardrails to be configurable in workspace settings,
so that disk-capacity blocking behavior can match different host sizes and app profiles without code changes.

## Scope

- Add a workspace settings module for deploy preflight guardrails.
- Extract hardcoded minimum free-disk threshold into persisted settings.
- Keep preflight blocking semantics explicit and stable.
- Document metadata contract for app-level estimated disk requirement.
- Land the configuration through the shared Epic 13 Settings Module onboarding path.

## Acceptance Criteria

1. Workspace settings API supports module `deploy` with key `preflight`.
2. `deploy/preflight.minFreeDiskBytes` is persisted via existing settings storage and has a default of `536870912` bytes (0.5 GiB).
3. Preflight disk check reports `min_free_bytes`, `available_bytes` (when probe succeeds), and `required_app_bytes` in response payload.
4. Preflight hard-block for disk checks is limited to:
   - available disk below `minFreeDiskBytes`.
   - app estimated disk requirement greater than available disk.
5. Non-blocking disk probe failures (for example unavailable probe capability or parse failures) remain warnings and do not hard-block create by themselves.
6. Create endpoints perform server-side preflight before operation creation and reject when preflight result is blocking.
7. Create/check payload supports optional app estimate via `app_required_disk_gib` (or metadata equivalent), converted to bytes server-side.

## Configuration Design

### Module and Key

- Module: `deploy`
- Key: `preflight`
- Payload:

```json
{
  "minFreeDiskBytes": 536870912
}
```

### Validation Rules

- `minFreeDiskBytes` must be an integer.
- Minimum value: `0`.
- Maximum value: `1099511627776` (1 TiB).
- Invalid values return `422` with field-level errors.

## Runtime Decision Matrix

- `status=conflict, ok=false`:
  - `available_bytes < min_free_bytes`
  - `required_app_bytes > 0 && required_app_bytes > available_bytes`
- `status=ok, ok=true`:
  - probe succeeds and no conflict condition is met
- `status=warning|unavailable, ok=true`:
  - probe capability unavailable, unexpected output, or parse failure

## API Notes

### Request Metadata Inputs

- Top-level `app_required_disk_gib` may be supplied by UI for check/create calls.
- Backend normalizes estimate to `metadata.app_required_disk_bytes` and uses it in disk preflight evaluation.

### Response Notes

- Disk check message must include reason and compared values for conflicts.
- Warning paths should remain explicit about why data is unavailable or incomplete.

## Out Of Scope

- Dynamic per-app profile catalogs for disk estimate defaults.
- Historical disk trend prediction.
- Automatic threshold tuning.

## File Touchpoints

- `backend/domain/routes/settings.go`
- `backend/domain/routes/deploy.go`
- `dashboard/src/pages/deploy/actions/useActionsController.ts`
- `dashboard/src/pages/deploy/CreateDeploymentPage.tsx`
- `specs/implementation-artifacts/story17.10-settings.md`
