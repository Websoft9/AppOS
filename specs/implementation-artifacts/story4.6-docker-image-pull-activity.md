# Story 4.6: Docker Image Pull Activity

Status: complete

## Story

As an operator,
I want to see current and recent image pull operations for one server,
so that image pulls are observable after submit instead of only through a single in-flight dialog.

## Acceptance Criteria

1. Keep the existing submit contract: `POST /api/servers/{serverId}/docker/images/pull` still returns `operation_id`.
2. Keep the existing detail contract: `GET /api/servers/{serverId}/docker/image-pull-operations/{operationId}` still returns one operation's current state and output.
3. Add one list contract: `GET /api/servers/{serverId}/docker/image-pull-operations`.
4. The list contract supports one minimal query: `status=in_progress|completed|failed|all`, default `in_progress`.
5. The list response reuses the same summary fields already exposed by the detail contract: `id`, `image_name`, `phase`, `terminal_status`, `failure_reason`, `created`, `updated`.
6. Add one single-record cleanup contract: `DELETE /api/servers/{serverId}/docker/image-pull-operations/{operationId}`.
7. Add one server-scoped history cleanup contract: `DELETE /api/servers/{serverId}/docker/image-pull-operations`.
8. Add one queued-cancel contract: `POST /api/servers/{serverId}/docker/image-pull-operations/{operationId}/cancel`.
9. The Images tab can use the list contract for both current pulls and recent pull history without rebuilding history state in the client.

## Current Baseline

- Already implemented:
  - `POST /api/servers/{serverId}/docker/images/pull`
  - `GET /api/servers/{serverId}/docker/image-pull-operations/{operationId}`
  - persistent `docker_image_pull_operations` records
  - in-flight deduplication for the same normalized image reference on the same server
- Added in this story:
  - `GET /api/servers/{serverId}/docker/image-pull-operations`
  - `DELETE /api/servers/{serverId}/docker/image-pull-operations/{operationId}`
  - `DELETE /api/servers/{serverId}/docker/image-pull-operations`
  - `POST /api/servers/{serverId}/docker/image-pull-operations/{operationId}/cancel`
  - one lightweight Images-tab activity surface for current and recent pull operations

## Minimal Contract

### Backend

Add:

`GET /api/servers/{serverId}/docker/image-pull-operations?status=in_progress|completed|failed|all&limit=20`

`DELETE /api/servers/{serverId}/docker/image-pull-operations/{operationId}`

`DELETE /api/servers/{serverId}/docker/image-pull-operations`

`POST /api/servers/{serverId}/docker/image-pull-operations/{operationId}/cancel`

Behavior:

- `in_progress`: `terminal_status = none`
- `completed`: `terminal_status = success`
- `failed`: `terminal_status = failed`
- `all`: no terminal filter
- newest first by `updated`
- default `limit = 20`, cap at `50`
- single-record delete applies only to terminal records
- clear-history deletes only terminal records for the target server
- cancel applies only to queued (`phase=accepted`) pull operations

Minimal response:

```json
{
  "items": [
    {
      "id": "op_xxx",
      "image_name": "nginx:latest",
      "phase": "executing",
      "terminal_status": "none",
      "failure_reason": "",
      "created": "2026-05-18 10:00:00.000Z",
      "updated": "2026-05-18 10:00:12.000Z"
    }
  ]
}
```

### Frontend

In `Server Detail > Docker > Images`:

- keep the existing pull dialog behavior for submit + single-operation polling
- show current pull activity and recent pull history from the shared activity surface
- show `Pulling` from `status=in_progress`
- show `Recents` from `status=all&limit=10`
- allow delete-one, clear-history, and queued-cancel actions from the activity surface
- clicking one item opens its detail view inside the same activity dialog

## Non-Goals

- no resumable pull orchestration
- no fleet-wide pull history
- no separate activity center outside the Images tab
- no richer progress model than current `phase` + `output`

## Dev Notes

- This story is intentionally a query-surface follow-up, not a rework of the current async pull execution model.
- Prefer one list endpoint over separate `history` and `running` endpoints.
- Reuse `dockerImagePullOperationResponse(...)` field names where possible to keep frontend adaptation small.
- Queued cancel is intentionally narrow: executing pulls are still not interruptible.