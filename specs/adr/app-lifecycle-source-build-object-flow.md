# App Lifecycle Source Build Object Flow

## Status
Proposed

## Context

`app-lifecycle-source-build-boundary.md` defines the domain placement for source-based deployment and Buildpacks-based image creation.

The next decision needed is more operational:

1. which normalized object crosses the ingress boundary
2. how that object is persisted into `OperationJob`
3. how execution expands into `PipelineRun`
4. when release data becomes durable in `ReleaseSnapshot`
5. when `AppInstance` should change

AppOS already has the following constraints:

1. raw install or deploy form payloads must not flow into workers
2. `OperationJob` owns business action state
3. `PipelineRun` owns execution graph state
4. `ReleaseSnapshot` owns release baseline data
5. `AppInstance` is the long-lived lifecycle projection

This ADR defines a minimal engineering object flow for source-based deployment without changing those ownership rules.

## Decisions

### 1. Introduce one normalized ingress object: `SourceBuildIntent`

Source-based deployment should cross the lifecycle ingress boundary as one normalized intent object.

Recommended logical shape:

| Field | Purpose |
| --- | --- |
| `source_kind` | `git`, `uploaded-package`, or future source kinds |
| `source_ref` | repository URL, commit ref, branch, or uploaded package reference |
| `source_revision` | commit SHA or immutable package digest when known |
| `workspace_ref` | hydrated workspace or uploaded source reference |
| `builder_strategy` | `buildpacks` for the first implementation, extensible later |
| `builder_inputs` | builder-specific non-secret options after normalization |
| `registry_target_ref` | target registry or publication mode |
| `credential_refs` | secret-backed references for source or registry access |
| `deploy_inputs` | post-build runtime inputs needed for release activation |
| `release_metadata` | version label, source attribution, or operator notes |

`SourceBuildIntent` is a normalization product.

It is not itself a persisted aggregate root.

### 2. `SourceBuildIntent` is embedded into `OperationJob.spec_json`

The accepted business action remains an `OperationJob` of type `install`, `upgrade`, or `redeploy` depending on the user path.

For source-based deployment, `OperationJob.spec_json` should carry a normalized contract shaped approximately as:

```json
{
  "mode": "source-build",
  "source_build": {
    "source_kind": "uploaded-package",
    "source_ref": "workspace://apps/my-app/src",
    "source_revision": null,
    "workspace_ref": "workspace://operations/op-123/source",
    "builder_strategy": "buildpacks",
    "builder_inputs": {
      "builder_image": "paketobuildpacks/builder-jammy-base"
    },
    "registry_target_ref": "registry://default/my-app",
    "credential_refs": {
      "registry": "secretref://registry/default"
    },
    "deploy_inputs": {
      "runtime_inputs": {}
    },
    "release_metadata": {
      "version_label": "main-20260401"
    }
  }
}
```

`OperationJob` remains the queue boundary and the business action record.

`spec_json` remains the canonical execution contract.

### 3. Source-based deployment expands into one pipeline family instance

`OperationJob` should map into an existing pipeline family rather than introducing a source-build-only family.

Recommended mapping:

1. first install from source -> `ProvisionPipeline`
2. change from source on an existing app -> `ChangePipeline`

The selected `PipelineRun` may contain nodes such as:

1. `resolve_source`
2. `hydrate_workspace`
3. `prepare_build_context`
4. `build_artifact`
5. `publish_artifact`
6. `create_candidate_release`
7. `render_runtime_config`
8. `activate_release`
9. `verify_runtime_health`
10. `finalize_release_projection`

The important rule is that build-specific nodes remain execution nodes.

They do not become new business roots.

### 4. Candidate release is created before activation, not after app projection

When source build reaches a verified artifact boundary, the system should create or update a candidate `ReleaseSnapshot` before runtime activation.

Recommended release-owned fields for source build:

| Release field | Meaning |
| --- | --- |
| `source_type` | `git` or `file` or equivalent normalized kind |
| `source_ref` | source location or immutable uploaded package reference |
| `artifact_digest` | digest of the produced image or artifact |
| `version_label` | operator-facing version label |
| `rendered_compose` | resulting deployable baseline |
| `resolved_env_json` | effective runtime configuration after normalization |
| `notes` | source build attribution or release note |

This snapshot starts as `candidate`.

It becomes `active` only after activation and verification succeed.

### 5. `AppInstance` changes only from projected outcome

`AppInstance` must not reflect transient build stages such as:

1. `building`
2. `pushing`
3. `publishing_artifact`

During source-based deployment:

1. `OperationJob.phase` shows in-flight execution state
2. `PipelineRun` and `PipelineNodeRun` show internal node progress
3. `ReleaseSnapshot` records candidate or active baseline data
4. `AppInstance` changes only through existing lifecycle projection rules such as `installing`, `updating`, `running_healthy`, `running_degraded`, or `attention_required`

### 6. Failure handling follows release-safe cut points

Source-based deployment must distinguish three failure zones:

1. before artifact creation
2. after artifact creation but before activation
3. after activation attempt

Recommended handling:

1. before artifact creation failure -> fail operation, no candidate release activation
2. after artifact creation but before activation -> keep candidate release as non-active historical evidence or clean it according to policy
3. after activation failure -> compensate using previous `last_known_good` release when policy allows

This keeps build failure semantics separate from activation failure semantics.

### 7. Workspace ownership is split between execution and infrastructure concerns

For source-based deployment, two workspace concepts may exist:

1. source materialization workspace
2. runtime deployment workspace

The engineering rule is:

1. temporary execution workspace belongs to execution flow and may be ephemeral
2. persisted IaC or uploaded source assets may remain under `Runtime Infrastructure`
3. `ReleaseSnapshot` stores the verified baseline, not the entire temporary workspace

This avoids conflating workspace hydration with release ownership.

### 8. Minimal projection chain

The recommended minimal object flow is:

`Deploy Ingress -> SourceBuildIntent -> OperationJob -> PipelineRun -> candidate ReleaseSnapshot -> active ReleaseSnapshot -> AppInstance projection`

Expanded narrative:

1. deploy ingress accepts source-oriented user intent
2. backend normalizes it into `SourceBuildIntent`
3. accepted action is persisted as `OperationJob`
4. execution engine instantiates a `PipelineRun`
5. build nodes produce an artifact and candidate release baseline
6. activation nodes switch runtime to the candidate baseline
7. verification marks the release active or triggers compensation
8. projection updates `AppInstance` and operation summary fields

## Consequences

This gives AppOS one concrete engineering chain for source-based deployment without changing the current DDD structure.

The main implementation consequences are:

1. source deploy ingress should normalize into an explicit source-build payload section inside `spec_json`
2. worker code should execute source build only through pipeline nodes, not through ad hoc route-specific logic
3. release creation should happen at an explicit candidate boundary
4. app state should continue to be projected from operation outcomes instead of mirroring build internals
5. workspace hydration and uploaded package handling can evolve independently from release semantics

This ADR also provides a stable handoff for future implementation work around:

1. uploaded source package hydration
2. Git source checkout
3. Buildpacks node execution
4. registry publication
5. release activation and rollback policy