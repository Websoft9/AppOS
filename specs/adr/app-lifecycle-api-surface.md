# Application Lifecycle API Surface

## Status
Proposed

## Context
AppOS has adopted a clean-slate MVP lifecycle model built around these canonical objects:

1. `app_instances`
2. `app_operations`
3. `app_releases`
4. `app_exposures`
5. `pipeline_runs`
6. `pipeline_node_runs`

The backend is no longer designed around one deploy-era record shape. The API surface must reflect the same separation of concerns as the lifecycle domain model:

1. `AppInstance` is the long-lived management projection
2. `OperationJob` is the execution-facing business action
3. `ReleaseSnapshot` is the release baseline and rollback reference
4. `Exposure` is the publication and entry-point object
5. `PipelineRun` and `PipelineNodeRun` are execution infrastructure details

This ADR defines the complete lifecycle API surface needed to understand the backend model. It includes:

1. canonical custom lifecycle APIs
2. PocketBase native collection APIs that exist for the lifecycle collections
3. the role of each API group
4. which endpoints are intended for business behavior vs inspection/debugging

Companion documents:

1. `specs/adr/app-lifecycle-domain-model.md`
2. `specs/adr/app-lifecycle-field-definitions.md`
3. `specs/adr/app-lifecycle-pocketbase-collections.md`

## Decisions

### 1. API layering

The lifecycle backend exposes three layers of API:

1. **Canonical lifecycle business APIs**: custom routes used by frontend and product workflows
2. **Execution primitive APIs**: lower-level Docker, proxy, server, and IaC routes used by lifecycle workers
3. **PocketBase native collection APIs**: generic record CRUD and query routes, mainly for admin tooling, debugging, and low-level inspection

The canonical product-facing logic must live in the custom lifecycle routes, not in raw PocketBase collection writes.

### 2. Canonical route groups

The canonical lifecycle route groups are:

1. `/api/app-instances/*`
2. `/api/app-operations/*`
3. `/api/app-exposures/*`
4. `/api/app-releases/*`

These four route groups define the main business API of the lifecycle backend.

### 3. `app-instances` API

Purpose: provide Installed App inventory, app detail projection, lifecycle state visibility, and action entry points.

#### 3.1 Query routes

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/app-instances` | list all app instances | canonical Installed view |
| `GET` | `/api/app-instances/{id}` | get one app instance detail | includes release and exposure summary |
| `GET` | `/api/app-instances/{id}/summary` | lightweight status summary | optional optimization for cards and polling |
| `GET` | `/api/app-instances/{id}/health` | get normalized runtime and health view | projected, not raw worker state |
| `GET` | `/api/app-instances/{id}/operations` | list operations belonging to one app | may proxy to `app_operations` query |
| `GET` | `/api/app-instances/{id}/timeline` | app-level lifecycle timeline | app-scoped, can aggregate multiple operations |
| `GET` | `/api/app-instances/{id}/audit` | app-scoped audit records | critical lifecycle actions only |

#### 3.2 Configuration routes

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/app-instances/{id}/config` | read effective config / compose baseline | UI editing and inspection |
| `POST` | `/api/app-instances/{id}/config/validate` | validate candidate config | does not apply changes |
| `PUT` | `/api/app-instances/{id}/config` | save draft config | optional if drafts are supported |
| `POST` | `/api/app-instances/{id}/config/apply` | apply config by creating a `reconfigure` operation | canonical behavior route |
| `POST` | `/api/app-instances/{id}/config/rollback` | rollback config baseline | typically creates a `rollback` or `reconfigure` operation |

#### 3.3 Lifecycle action routes

These routes are management-surface entry points. They should create or trigger `app_operations`, not execute container actions inline.

| Method | Path | Creates operation type |
| --- | --- | --- |
| `POST` | `/api/app-instances/{id}/start` | `start` |
| `POST` | `/api/app-instances/{id}/stop` | `stop` |
| `POST` | `/api/app-instances/{id}/restart` | `redeploy` or `maintain` depending on policy |
| `POST` | `/api/app-instances/{id}/upgrade` | `upgrade` |
| `POST` | `/api/app-instances/{id}/redeploy` | `redeploy` |
| `POST` | `/api/app-instances/{id}/reconfigure` | `reconfigure` |
| `POST` | `/api/app-instances/{id}/maintain` | `maintain` |
| `POST` | `/api/app-instances/{id}/recover` | `recover` |
| `POST` | `/api/app-instances/{id}/rollback` | `rollback` |
| `POST` | `/api/app-instances/{id}/publish` | `publish` |
| `POST` | `/api/app-instances/{id}/unpublish` | `unpublish` |
| `POST` | `/api/app-instances/{id}/backup` | `backup` |
| `POST` | `/api/app-instances/{id}/restore` | `recover` or future `restore` |
| `DELETE` | `/api/app-instances/{id}` | `uninstall` |

### 4. `app-operations` API

Purpose: expose the execution-facing business action layer.

This is the central async execution API. All major lifecycle actions ultimately become `app_operations` records.

#### 4.1 Generic operation routes

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/app-operations` | create a normalized lifecycle operation | generic entry for advanced or internal callers |
| `GET` | `/api/app-operations` | list operation history | filter by app, server, type, phase, status |
| `GET` | `/api/app-operations/{id}` | get operation detail | includes summary of pipeline execution |
| `GET` | `/api/app-operations/{id}/status` | lightweight status polling | for dashboards and progress polling |
| `GET` | `/api/app-operations/{id}/timeline` | get operation timeline | canonical timeline API |
| `GET` | `/api/app-operations/{id}/logs` | get operation logs | aggregated or proxied log view |
| `GET` | `/api/app-operations/{id}/stream` | realtime status/log stream | websocket or SSE depending on implementation |
| `POST` | `/api/app-operations/{id}/cancel` | request cancellation | async, best effort |
| `POST` | `/api/app-operations/{id}/retry` | recreate or resume operation | policy-controlled |
| `POST` | `/api/app-operations/{id}/retry-from-node` | retry from a specific node | optional advanced behavior |
| `POST` | `/api/app-operations/{id}/ack-manual-intervention` | resume after manual step | for `manual_intervention_required` outcomes |
| `DELETE` | `/api/app-operations/{id}` | delete terminal operation record | admin / low-priority cleanup path |

#### 4.2 Operation adapter routes

Purpose: convert different install/change inputs into one normalized operation contract.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/app-operations/install/manual-compose` | install from manual compose input |
| `POST` | `/api/app-operations/install/git-compose` | install from git compose source |
| `POST` | `/api/app-operations/install/store-app` | install from App Store / template source |
| `POST` | `/api/app-operations/install/docker-run` | normalize docker run input into compose-compatible spec |
| `POST` | `/api/app-operations/install/source-package` | normalize source package/build input into operation spec |

These adapter routes are convenience and normalization APIs. They must still create `app_operations` and enter the shared execution core.

### 5. `app-exposures` API

Purpose: manage publication, domain binding, path binding, certificates, and publication health independently from runtime install state.

#### 5.1 Exposure CRUD and query routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/app-exposures` | list all exposures |
| `POST` | `/api/app-exposures` | create a new exposure definition |
| `GET` | `/api/app-exposures/{id}` | get exposure detail |
| `PATCH` | `/api/app-exposures/{id}` | update exposure configuration |
| `DELETE` | `/api/app-exposures/{id}` | delete exposure |
| `GET` | `/api/app-exposures/{id}/health` | get external publication health |
| `GET` | `/api/app-exposures/{id}/history` | get exposure-related history |

#### 5.2 Exposure behavior routes

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/app-exposures/{id}/verify` | re-run publication verification |
| `POST` | `/api/app-exposures/{id}/set-primary` | switch primary entry point |
| `POST` | `/api/app-exposures/{id}/publish` | create `publish` operation |
| `POST` | `/api/app-exposures/{id}/unpublish` | create `unpublish` operation |

#### 5.3 App-scoped exposure routes

These are convenience routes commonly used by app detail pages.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/app-instances/{id}/exposures` | list exposures for one app |
| `POST` | `/api/app-instances/{id}/exposures` | create exposure for one app |
| `GET` | `/api/app-instances/{id}/exposures/{exposureId}` | get one app exposure |
| `PATCH` | `/api/app-instances/{id}/exposures/{exposureId}` | update one app exposure |
| `DELETE` | `/api/app-instances/{id}/exposures/{exposureId}` | delete one app exposure |

### 6. `app-releases` API

Purpose: expose release baselines, activation targets, and rollback references.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/app-releases` | list releases globally |
| `GET` | `/api/app-releases/{id}` | get release detail |
| `GET` | `/api/app-instances/{id}/releases` | list releases for one app |
| `GET` | `/api/app-instances/{id}/releases/current` | get current active release |
| `GET` | `/api/app-instances/{id}/releases/last-known-good` | get rollback baseline |
| `POST` | `/api/app-instances/{id}/releases/{releaseId}/activate` | activate one release |
| `POST` | `/api/app-instances/{id}/releases/{releaseId}/promote` | promote candidate to active |
| `POST` | `/api/app-instances/{id}/releases/{releaseId}/mark-last-known-good` | mark release as rollback-safe |
| `GET` | `/api/app-releases/{id}/diff/{otherReleaseId}` | compare two releases |

### 7. Timeline and audit APIs

Timeline and audit are not separate domain objects, but they are separate product-facing surfaces.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/app-operations/{id}/timeline` | canonical execution timeline |
| `GET` | `/api/app-operations/{id}/timeline/nodes` | node-level execution detail |
| `GET` | `/api/app-operations/{id}/timeline/summary` | lightweight timeline summary |
| `GET` | `/api/app-operations/{id}/audit` | audit linked to one operation |
| `GET` | `/api/app-instances/{id}/history` | app-scoped history view |
| `GET` | `/api/app-instances/{id}/audit` | app-scoped audit view |

### 8. Execution primitive routes

These routes are not the main lifecycle API, but lifecycle workers and adapters rely on them.

They remain part of the backend, but should be treated as implementation primitives rather than the canonical lifecycle business surface.

| Route group | Role |
| --- | --- |
| `/api/ext/docker/*` | runtime compose and container operations |
| `/api/ext/proxy/*` | reverse proxy, domain, and certificate primitives |
| `/api/ext/iac/*` | file and IaC editing primitives |
| `/api/servers/*` | remote execution, file, and ops primitives |

### 9. PocketBase native collection APIs

PocketBase automatically provides native record APIs for each lifecycle collection.

For each of the following collections:

1. `app_instances`
2. `app_operations`
3. `app_releases`
4. `app_exposures`
5. `pipeline_runs`
6. `pipeline_node_runs`

the following native routes exist:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/collections/{collection}/records` | list records |
| `GET` | `/api/collections/{collection}/records/{id}` | get one record |
| `POST` | `/api/collections/{collection}/records` | create a record |
| `PATCH` | `/api/collections/{collection}/records/{id}` | update a record |
| `DELETE` | `/api/collections/{collection}/records/{id}` | delete a record |

Typical PocketBase query parameters still apply to the list/detail APIs:

1. `filter`
2. `sort`
3. `expand`
4. `fields`
5. `page`
6. `perPage`
7. `skipTotal`

#### 9.1 Intended use of native collection routes

PocketBase native routes are available, but their role is different by collection.

| Collection | Native reads | Native writes | Intended role |
| --- | --- | --- | --- |
| `app_instances` | useful | limited | admin/debug inspection; main UI should prefer custom projection API |
| `app_operations` | useful | restricted | debugging and admin inspection; business creation should prefer custom operation API |
| `app_releases` | useful | restricted | admin and rollback inspection |
| `app_exposures` | useful | restricted | inspection and internal tooling |
| `pipeline_runs` | useful | avoid | execution inspection only |
| `pipeline_node_runs` | useful | avoid | timeline inspection only |

Business behavior should not rely on raw native writes because those writes bypass:

1. normalization
2. scheduler rules
3. compensation policy
4. audit generation
5. projection updates

### 10. PocketBase-native lifecycle inspection examples

These are not the canonical product APIs, but they are useful for understanding the backend model.

| Purpose | Native PocketBase query |
| --- | --- |
| list apps by lifecycle state | `GET /api/collections/app_instances/records?filter=lifecycle_state='running_healthy'` |
| get one operation with linked app and pipeline | `GET /api/collections/app_operations/records/{id}?expand=app,pipeline_run` |
| list app operations | `GET /api/collections/app_operations/records?filter=app='{appId}'&sort=-created` |
| inspect timeline nodes | `GET /api/collections/pipeline_node_runs/records?filter=pipeline_run='{pipelineRunId}'&sort=created` |
| inspect exposures for an app | `GET /api/collections/app_exposures/records?filter=app='{appId}'` |
| inspect active or last-known-good releases | `GET /api/collections/app_releases/records?filter=app='{appId}' && (is_active=true || is_last_known_good=true)` |

### 11. MVP canonical subset

The full API surface is larger than the first MVP delivery. The minimum canonical subset for MVP should be:

1. `POST /api/app-operations/install/manual-compose`
2. `POST /api/app-operations/install/git-compose`
3. `GET /api/app-operations`
4. `GET /api/app-operations/{id}`
5. `GET /api/app-operations/{id}/timeline`
6. `GET /api/app-operations/{id}/logs`
7. `GET /api/app-instances`
8. `GET /api/app-instances/{id}`
9. `POST /api/app-instances/{id}/upgrade`
10. `POST /api/app-instances/{id}/redeploy`
11. `POST /api/app-instances/{id}/rollback`
12. `DELETE /api/app-instances/{id}`

This subset is sufficient to understand and validate the core backend lifecycle flow:

1. create an app
2. create an operation
3. inspect operation execution
4. observe app projection
5. perform change and retirement actions

### 12. Explicit non-canonical routes

Pre-refactor route groups such as the following are not part of the canonical lifecycle API surface:

1. `/api/apps/*`
2. `/api/deployments/*`

If such routes remain temporarily in code during refactor, they should be treated only as transitional or implementation aliases. They must not be treated as the final API model for lifecycle management.

## Consequences

### Positive

1. backend logic becomes understandable by API surface alone
2. the API mirrors the domain model instead of hiding it behind one deploy record
3. timeline, release, and exposure responsibilities remain explicit
4. PocketBase native routes remain available for debugging without becoming the business API

### Trade-offs

1. there are more route groups than in the deploy-era model
2. frontend cannot rely on one flat deployment list to understand the full lifecycle
3. a strict boundary is needed between business APIs and raw PocketBase native writes

### Follow-up

1. generate OpenAPI docs for the canonical route groups
2. align the current `/api/apps` and `/api/deployments` code with the canonical route names
3. define auth and role policy per route group before public release