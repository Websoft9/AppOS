# Lifecycle Execution Engine Core Stack

## Status
Superseded

## Context

This ADR was an earlier deploy-era design note for Epic 17. AppOS has since reframed Epic 17 as the Lifecycle Execution Core rather than a generic deploy epic, and the worker/runtime contract has been updated accordingly.

The authoritative execution-engine decisions now live in `specs/adr/app-lifecycle-pipeline-execution-engine.md`.

## Superseded By

- `specs/adr/app-lifecycle-domain-model.md`
- `specs/adr/app-lifecycle-field-definitions.md`
- `specs/adr/app-lifecycle-pocketbase-collections.md`
- `specs/adr/app-lifecycle-api-surface.md`
- `specs/adr/app-lifecycle-pipeline-execution-engine.md`

## Retained Takeaways

1. Prefer a rigid lifecycle pipeline over a heavyweight workflow platform.
2. Keep strict per-`server_id` serialization for conflicting operations.
3. Use timeout and orphan-recovery guardrails for long-running execution.
4. Treat first install failure as cleanup-plus-failure, not rollback.

## Notes

- This file should no longer be used as the source of truth for queueing, worker runtime, or execution state semantics.
- In particular, any older guidance here that conflicts with the current Asynq-based lifecycle worker should be considered obsolete.
