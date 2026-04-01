# App Lifecycle Source Build Boundary

## Status
Proposed

## Context

AppOS already defines `Application Lifecycle` as the only core domain, with `Lifecycle Execution`, `Runtime Infrastructure`, and `Integrations & Connectors` as supporting domains.

The next deployment path under discussion is source-based deployment:

1. accept a source reference or uploaded source package
2. prepare build context
3. build an OCI image through Buildpacks or an equivalent builder
4. publish the artifact to a registry when required
5. deploy the resulting release through the lifecycle execution flow

Without an explicit boundary decision, this flow is easy to model incorrectly in one of four ways:

1. treating Buildpacks as a new business domain
2. treating image build as part of `AppInstance` state
3. treating source build only as a runtime infrastructure concern
4. letting raw source-build form payloads leak directly into workers and pipeline nodes

Existing ADRs already define two relevant constraints:

1. install input resolution belongs to the lifecycle ingress boundary, not to `AppInstance`
2. workers and pipeline runners consume only normalized lifecycle operation data

This ADR defines where source build belongs in the current AppOS DDD model while keeping the existing PRD domain split stable.

## Decisions

### 1. No new business domain is introduced

Source-based deployment and Buildpacks-based image creation do not justify a new top-level domain or subdomain.

They must be expressed through the existing domain structure.

`Buildpacks` is treated as an execution mechanism and strategy choice, not as a business domain.

### 2. Business ownership stays in Application Lifecycle

The business meaning of source build belongs to `Application Lifecycle`, specifically the release path of an application.

The operator intent is not "run Buildpacks". The operator intent is:

1. install an app from source
2. produce a deployable release from source
3. activate or update an application with that release

Therefore source build is modeled as part of lifecycle release progression, not as an infrastructure-only action.

### 3. Release semantics belong to ReleaseSnapshot, not AppInstance

The result of a successful source build must be represented as release baseline data.

Typical release-facing facts include:

1. source revision or source package identity
2. builder strategy used
3. produced image reference or artifact reference
4. resolved runtime baseline derived from that artifact

These facts belong to `ReleaseSnapshot` or equivalent release-owned metadata.

They must not be stored as raw `AppInstance` state or as unresolved form payloads.

### 4. Execution ownership stays in Lifecycle Execution

The actual build, publish, and deploy steps are executed inside `Lifecycle Execution`, primarily through `Pipeline Execution`.

For source-based deployment, the selected pipeline may include stages such as:

1. `resolve_source`
2. `prepare_workspace`
3. `build_artifact`
4. `publish_artifact`
5. `render_runtime_config`
6. `activate_release`
7. `verify_runtime_health`

These are pipeline stages or nodes, not new business aggregates.

`PipelineRun` owns the in-flight execution state.

`OperationJob` owns the business action state and terminal outcome.

### 5. Source and registry connections remain in Integrations & Connectors

External repository access belongs to `Integrations & Connectors / Source Integrations`.

External registry access belongs to `Integrations & Connectors / Artifact & Registry Integrations`.

Those connectors provide credentials, endpoints, and binding metadata.

They do not own release semantics, operation progression, or app lifecycle state.

### 6. Workspace and build context remain supporting infrastructure

Temporary build workspace, uploaded source materialization, generated files, and runtime build context belong to supporting execution or infrastructure concerns.

Depending on the implementation detail:

1. persisted configuration assets may live under `Runtime Infrastructure`
2. ephemeral execution context may live only inside `Lifecycle Execution`

In either case, workspace ownership must not be confused with release ownership.

### 7. Source build must cross the queue boundary as normalized lifecycle intent

Raw source-deploy UI payloads must not be interpreted directly by workers.

Before queueing, backend lifecycle ingress must normalize source-build inputs into operation-facing data such as:

1. source kind and source reference
2. uploaded package references or hydrated workspace references
3. builder strategy
4. target registry or artifact publication mode
5. secret-backed credential references
6. deploy-time runtime inputs required after build

Workers and pipeline nodes consume only this normalized contract.

### 8. Buildpacks is one builder strategy, not the model center

The lifecycle model should be builder-neutral.

`Buildpacks` may be the first supported strategy, but the domain language should remain stable if AppOS later adds other builders.

Preferred language in domain-facing design is:

1. source build
2. builder strategy
3. build artifact
4. artifact publication

`Buildpacks` should appear as an implementation strategy value, not as the main domain noun.

## Consequences

This keeps the existing PRD domain hierarchy stable.

No new domain is needed for source-based deployment.

The practical ownership split is:

1. `Application Lifecycle` owns source-to-release business meaning
2. `Lifecycle Execution` owns build/publish/deploy execution flow
3. `Integrations & Connectors` owns external source and registry connectivity
4. `Runtime Infrastructure` may host supporting workspace or configuration assets but does not own release semantics

This also implies the following implementation rules:

1. `Deploy` remains a task-oriented product entry, not a new domain
2. `AppInstance` remains a projection of active lifecycle state, not a build state store
3. `ReleaseSnapshot` should become the durable owner of verified source-build output metadata
4. pipeline definitions may add source-build stages without changing domain boundaries
5. future builder choices can be added without reworking the domain model