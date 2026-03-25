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

1. `/api/apps/*`
2. `/api/operations/*`
3. `/api/exposures/*`
4. `/api/releases/*`
5. `/api/pipelines/*`

These route groups define the main lifecycle API of the backend. `apps` is the long-lived management projection, `operations` is the execution-facing business action layer, `releases` and `exposures` are lifecycle business objects, and `pipelines` is the execution inspection surface.

### 3. `apps` API

Purpose: provide Installed App inventory, app detail projection, lifecycle state visibility, and action entry points.

#### 3.1 Query routes

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/apps` | list all apps | canonical Installed view |
| `GET` | `/api/apps/{id}` | get one app detail | includes release, exposure, and current pipeline summary |
| `GET` | `/api/apps/{id}/summary` | lightweight status summary | optional optimization for cards and polling |
| `GET` | `/api/apps/{id}/health` | get normalized runtime and health view | projected, not raw worker state |
| `GET` | `/api/apps/{id}/operations` | list operations belonging to one app | may proxy to `app_operations` query |
| `GET` | `/api/apps/{id}/timeline` | app-level lifecycle timeline | app-scoped, can aggregate multiple operations |
| `GET` | `/api/apps/{id}/audit` | app-scoped audit records | critical lifecycle actions only |

#### 3.2 Configuration routes

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/apps/{id}/config` | read effective config / compose baseline | UI editing and inspection |
| `POST` | `/api/apps/{id}/config/validate` | validate candidate config | does not apply changes |
| `PUT` | `/api/apps/{id}/config` | save draft config | optional if drafts are supported |
| `POST` | `/api/apps/{id}/config/apply` | apply config by creating a `reconfigure` operation | canonical behavior route |
| `POST` | `/api/apps/{id}/config/rollback` | rollback config baseline | typically creates a `rollback` or `reconfigure` operation |

#### 3.3 Lifecycle action routes

These routes are management-surface entry points. They should create or trigger `app_operations`, not execute container actions inline.

| Method | Path | Creates operation type |
| --- | --- | --- |
| `POST` | `/api/apps/{id}/start` | `start` |
| `POST` | `/api/apps/{id}/stop` | `stop` |
| `POST` | `/api/apps/{id}/restart` | `redeploy` or `maintain` depending on policy |
| `POST` | `/api/apps/{id}/upgrade` | `upgrade` |
| `POST` | `/api/apps/{id}/redeploy` | `redeploy` |
| `POST` | `/api/apps/{id}/reconfigure` | `reconfigure` |
| `POST` | `/api/apps/{id}/maintain` | `maintain` |
| `POST` | `/api/apps/{id}/recover` | `recover` |
| `POST` | `/api/apps/{id}/rollback` | `rollback` |
| `POST` | `/api/apps/{id}/publish` | `publish` |
| `POST` | `/api/apps/{id}/unpublish` | `unpublish` |
| `POST` | `/api/apps/{id}/backup` | `backup` |
| `POST` | `/api/apps/{id}/restore` | `recover` or future `restore` |
| `DELETE` | `/api/apps/{id}` | `uninstall` |

### 4. `operations` API

Purpose: expose the execution-facing business action layer.

This is the central async execution API. All major lifecycle actions ultimately become `app_operations` records.

#### 4.1 Generic operation routes

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/operations` | create a normalized lifecycle operation | generic entry for advanced or internal callers |
| `GET` | `/api/operations` | list operation history | filter by app, server, type, phase, status |
| `GET` | `/api/operations/{id}` | get operation detail | includes summary of pipeline execution |
| `GET` | `/api/operations/{id}/status` | lightweight status polling | for dashboards and progress polling |
| `GET` | `/api/operations/{id}/timeline` | get operation timeline | canonical timeline API |
| `GET` | `/api/operations/{id}/logs` | get operation logs | aggregated or proxied log view |
| `GET` | `/api/operations/{id}/stream` | realtime status/log stream | websocket or SSE depending on implementation |
| `POST` | `/api/operations/{id}/cancel` | request cancellation | async, best effort |
| `POST` | `/api/operations/{id}/retry` | recreate or resume operation | policy-controlled |
| `POST` | `/api/operations/{id}/retry-from-node` | retry from a specific node | optional advanced behavior |
| `POST` | `/api/operations/{id}/ack-manual-intervention` | resume after manual step | for `manual_intervention_required` outcomes |
| `DELETE` | `/api/operations/{id}` | delete terminal operation record | admin / low-priority cleanup path |

#### 4.2 Operation adapter routes

Purpose: convert different install/change inputs into one normalized operation contract.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/operations/install/manual-compose` | install from manual compose input |
| `POST` | `/api/operations/install/git-compose` | install from git compose source |
| `POST` | `/api/operations/install/store-app` | install from App Store / template source |
| `POST` | `/api/operations/install/docker-run` | normalize docker run input into compose-compatible spec |
| `POST` | `/api/operations/install/source-package` | normalize source package/build input into operation spec |

These adapter routes are convenience and normalization APIs. They must still create `app_operations` and enter the shared execution core.

### 4.3 `pipelines` API

Purpose: inspect execution infrastructure state for debugging, progress detail, and node-level visibility.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/pipelines` | list pipeline runs |
| `GET` | `/api/pipelines/{id}` | get pipeline run detail including nodes |

### 5. `exposures` API

Purpose: manage publication, domain binding, path binding, certificates, and publication health independently from runtime install state.

#### 5.1 Exposure CRUD and query routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/exposures` | list all exposures |
| `POST` | `/api/exposures` | create a new exposure definition |
| `GET` | `/api/exposures/{id}` | get exposure detail |
| `PATCH` | `/api/exposures/{id}` | update exposure configuration |
| `DELETE` | `/api/exposures/{id}` | delete exposure |
| `GET` | `/api/exposures/{id}/health` | get external publication health |
| `GET` | `/api/exposures/{id}/history` | get exposure-related history |

#### 5.2 Exposure behavior routes

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/exposures/{id}/verify` | re-run publication verification |
| `POST` | `/api/exposures/{id}/set-primary` | switch primary entry point |
| `POST` | `/api/exposures/{id}/publish` | create `publish` operation |
| `POST` | `/api/exposures/{id}/unpublish` | create `unpublish` operation |

#### 5.3 App-scoped exposure routes

These are convenience routes commonly used by app detail pages.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/apps/{id}/exposures` | list exposures for one app |
| `POST` | `/api/apps/{id}/exposures` | create exposure for one app |
| `GET` | `/api/apps/{id}/exposures/{exposureId}` | get one app exposure |
| `PATCH` | `/api/apps/{id}/exposures/{exposureId}` | update one app exposure |
| `DELETE` | `/api/apps/{id}/exposures/{exposureId}` | delete one app exposure |

### 6. `releases` API

Purpose: expose release baselines, activation targets, and rollback references.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/releases` | list releases globally |
| `GET` | `/api/releases/{id}` | get release detail |
| `GET` | `/api/apps/{id}/releases` | list releases for one app |
| `GET` | `/api/apps/{id}/releases/current` | get current active release |
| `GET` | `/api/apps/{id}/releases/last-known-good` | get rollback baseline |
| `POST` | `/api/apps/{id}/releases/{releaseId}/activate` | activate one release |
| `POST` | `/api/apps/{id}/releases/{releaseId}/promote` | promote candidate to active |
| `POST` | `/api/apps/{id}/releases/{releaseId}/mark-last-known-good` | mark release as rollback-safe |
| `GET` | `/api/releases/{id}/diff/{otherReleaseId}` | compare two releases |

### 7. Timeline and audit APIs

Timeline and audit are not separate domain objects, but they are separate product-facing surfaces.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/operations/{id}/timeline` | canonical execution timeline |
| `GET` | `/api/operations/{id}/timeline/nodes` | node-level execution detail |
| `GET` | `/api/operations/{id}/timeline/summary` | lightweight timeline summary |
| `GET` | `/api/operations/{id}/audit` | audit linked to one operation |
| `GET` | `/api/apps/{id}/history` | app-scoped history view |
| `GET` | `/api/apps/{id}/audit` | app-scoped audit view |

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

1. `POST /api/operations/install/manual-compose`
2. `POST /api/operations/install/git-compose`
3. `GET /api/operations`
4. `GET /api/operations/{id}`
5. `GET /api/operations/{id}/timeline`
6. `GET /api/operations/{id}/logs`
7. `GET /api/apps`
8. `GET /api/apps/{id}`
9. `POST /api/apps/{id}/upgrade`
10. `POST /api/apps/{id}/redeploy`
11. `POST /api/apps/{id}/rollback`
12. `DELETE /api/apps/{id}`

This subset is sufficient to understand and validate the core backend lifecycle flow:

1. create an app
2. create an operation
3. inspect operation execution
4. observe app projection
5. perform change and retirement actions

### 12. Explicit non-business routes

The following route groups remain important to lifecycle, but they are not the primary business-action surface:

1. `/api/pipelines/*` for execution inspection
2. `/api/ext/docker/*` for runtime primitives
3. `/api/ext/proxy/*` for publication primitives
4. `/api/ext/iac/*` for baseline/config file primitives
5. `/api/servers/*` for remote execution and system primitives

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
2. implement the remaining `/api/releases` and `/api/exposures` route groups
3. define auth and role policy per route group before public release