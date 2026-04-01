# Story 17.4e-B: Source Candidate Convergence

Status: in-progress

## Story

As a lifecycle platform team,
I want all install entry paths to be treated as candidate-input variants into one shared resolver contract,
so that Manual Compose, Git Compose, Store-prefill, and Installed-prefill stop behaving like separate execution worlds.

## Acceptance Criteria

1. Current install entry paths must be explainable as candidate-input variants that feed one shared lifecycle install-ingress model.
2. Manual Compose and Git Compose must map into the same candidate-input family without redefining execution behavior.
3. Store-prefill and Installed-prefill must be treated as candidate generators or preloaded candidate state, not as separate install execution modes.
4. Source attribution, adapter attribution, and source-specific fetch metadata must be preserved explicitly in normalized install metadata.
5. Future install entry types such as Docker Command or Source Package must have a clear extension point in the candidate-input model without bypassing the shared resolver.
6. This story must not introduce source-specific worker semantics or parallel operation families.

## Delivered Now

- [x] A shared create page already exists for current install paths.
- [x] Manual Compose and Git Compose already land on the shared lifecycle operation model.
- [x] Store-prefill already feeds the shared create page instead of creating a separate Store execution path.
- [x] The remaining work is convergence of candidate-input modeling, not basic route coexistence.
- [x] Current frontend entry modes and prefill modes have now been traced to their actual install ingress shapes.
- [x] Current backend install paths are now clearly separated into transport concerns, candidate-input concerns, and shared install resolution concerns.
- [x] Backend install-ingress now carries explicit `candidate_kind` metadata for Manual Compose and Git Compose.
- [x] Manual create/check requests now emit candidate metadata from the create page instead of keeping prefill origin only in controller state.
- [x] Store-prefill and Installed-prefill can now survive as explicit candidate context in normalized install metadata.
- [x] Normalized install metadata now carries structured `origin_context` and source-specific `candidate_payload` in addition to compatibility keys.

## Still Deferred

- [ ] Formal candidate-input types and validation rules across all current install entry paths.
- [ ] Clear treatment of placeholder entry modes such as Docker Command and Source Package.
- [ ] Unified resolution preview that reflects candidate-input origin and normalized output.

## Dev Notes

- This is the source-variant convergence slice for `17.4e`.
- The user may start from different surfaces, but lifecycle semantics must begin at one shared ingress contract.
- Source-specific UI sections are allowed; source-specific execution semantics are not.
- If the product adds a new install source later, this story should provide the extension rule.

## Current Candidate Mapping

The current product already exposes multiple install entry variants. They should now be treated as candidate-input variants rather than independent execution modes.

| UI Entry / Prefill Mode | Current UI Evidence | Candidate Kind | Current Backend Path | Convergence Judgment |
| --- | --- | --- | --- | --- |
| `compose` | create page manual compose mode | `manual-compose` | `/api/actions/install/manual-compose` | canonical candidate |
| `git-compose` | create page git compose mode | `git-compose` | `/api/actions/install/git-compose` | canonical candidate |
| `store-prefill` | manual mode with Store-loaded compose | `store-prefill` | currently still lands on manual compose install path | candidate generator, not execution mode |
| `installed-prefill` | manual mode with installed compose preloaded | `installed-prefill` | currently still lands on manual compose install path | candidate generator, not execution mode |
| `docker-command` | guided placeholder in create page | `docker-command` | no dedicated backend install path yet | placeholder candidate kind only |
| `install-script` | guided placeholder in create page | `install-script` | no dedicated backend install path yet | placeholder candidate kind only |

## Target Candidate Model

The candidate model should sit above `InstallResolutionRequest`.

Proposed minimum shape:

1. `candidate_kind`
2. `source`
3. `adapter`
4. `origin_context`
5. `prefill_context`
6. `candidate_payload`

### Candidate model rules

1. `candidate_kind` describes how the user arrived at the install intent, not how workers execute it.
2. `source` and `adapter` remain lifecycle execution selectors and must still survive into normalized metadata.
3. `store-prefill` and `installed-prefill` are candidate generators that currently collapse into the manual-compose execution family.
4. Placeholder kinds such as `docker-command` and `install-script` may exist before execution support exists, but they must still fit the same candidate model.
5. No candidate kind may define a parallel worker or pipeline family on its own.

## Implementation Breakdown

### 1. Candidate model definition

- Define one explicit candidate-input model above the current compose-centric resolver.
- Keep it separate from `InstallResolutionRequest`, which stays the normalized execution-facing contract.

### 2. Frontend entry normalization

- Map create-page `entryMode` and `manualEntryMode` values into candidate kinds explicitly.
- Map `prefillMode=target|installed` into candidate context instead of treating them as hidden controller state.

### 3. Backend candidate ingestion

- Introduce one backend-owned candidate ingestion boundary that converts candidate input into `InstallResolutionRequest`.
- Preserve source attribution, adapter attribution, and candidate origin metadata through that conversion.

### 4. Prefill semantics

- Treat Store-prefill and Installed-prefill as sources of candidate payload enrichment, not execution branches.
- Keep prefilled compose/config provenance explicit in metadata.

### 5. Placeholder candidate kinds

- Define extension slots for `docker-command` and `install-script` even if they still resolve to guided placeholders.
- Prevent later implementation from inventing ad hoc ingress paths outside the candidate model.

## Minimal Acceptance Test Checklist

- [x] `compose` and `git-compose` are represented as explicit candidate kinds, not only as route names.
- [x] `store-prefill` and `installed-prefill` are represented as candidate generators or candidate context, not separate execution families.
- [x] Candidate-origin metadata survives into normalized install metadata.
- [x] Placeholder modes such as `docker-command` and `install-script` have explicit candidate-model slots.
- [ ] The create page can explain entry-path differences in candidate terms without redefining execution semantics.

### Suggested Implementation Focus

1. Define a candidate-input model that sits above the current compose-centric resolver.
2. Clarify how Store-prefill and Installed-prefill become candidate state rather than execution variants.
3. Normalize source-specific metadata shape consistently before install resolution.
4. Add tests proving source origin changes candidate input, not execution semantics.

## Function-Level Plan

1. Introduce candidate-kind definitions in the lifecycle install ingress layer.
2. Add one candidate-to-resolution conversion path for current `manual-compose` and `git-compose` inputs.
3. Record `store-prefill` and `installed-prefill` as candidate context rather than hidden controller-only mode.
4. Add a narrow frontend/backend mapping test or fixture proving the candidate-kind mapping.

### References

- [Source: specs/implementation-artifacts/story17.4a-store-deploy.md]
- [Source: specs/implementation-artifacts/story17.4b-git-compose.md]
- [Source: specs/implementation-artifacts/story17.4e-install-input-resolution.md]
- [Source: specs/implementation-artifacts/story17.6-create-deployment-page.md]
- [Source: specs/implementation-artifacts/iteration2-epic17-install-resolution-convergence-slice.md]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List

- Story created to formalize source-variant convergence under the shared install-ingress boundary.
- The slice is intentionally about candidate-input modeling, not about adding new execution families.
- Current frontend entry modes and backend install routes have been mapped into a first candidate-model draft so implementation can start from one vocabulary.
- Manual compose create/check now ships explicit candidate metadata, including prefill context for Store and Installed entry paths.
- Route parity tests now prove explicit prefill candidate context survives both check and create normalization.
- Docker Command and Source Package entry modes now submit explicit placeholder candidate kinds through the same manual install path.
- Manual and Git candidate metadata now normalize through one backend shape with `origin_context` and `candidate_payload` preserved through both check and create flows.


### File List

- `dashboard/src/pages/deploy/actions/action-types.ts`
- `dashboard/src/pages/deploy/actions/useActionsController.ts`
- `backend/domain/deploy/deploy.go`
- `backend/domain/lifecycle/service/install_resolution_test.go`
- `backend/domain/routes/deploy.go`
- `backend/domain/routes/deploy_test.go`
