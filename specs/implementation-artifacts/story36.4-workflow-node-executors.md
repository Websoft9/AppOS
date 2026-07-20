# Story 36.4: Workflow Node Executors

**Epic**: Epic 36 - Workflow
**Status**: Proposed | **Priority**: P1 | **Depends on**: Story 36.1, Story 36.2, Story 36.3, Epic 19, Epic 20, Epic 30, Epic 31

## Objective

Implement the built-in executor registry and the first supported node types for Workflow.

## Scope

- define one internal executor interface and registry
- implement built-in executors for MVP node types
- define output contracts and minimum validation for each executor
- define server-target behavior for `shell` and `docker`
- define opencode integration contract for `agent`

## Node Set

MVP executors:

- `shell`
- `http`
- `llm`
- `agent`
- `docker`
- `smtp`
- `condition`
- `manual_gate`
- `subworkflow`

## Executor Rules

### Shell

- executes on the selected AppOS server target
- uses existing server connection and remote execution infrastructure where possible
- output contract should include at minimum:
  - `stdout`
  - `stderr`
  - `exit_code`

### Docker

- executes on the selected AppOS server target with Docker capability
- container image and command come from node config
- output contract should include at minimum:
  - `stdout`
  - `stderr`
  - `exit_code`

### HTTP

- supports method, URL, headers, and body
- serves as the webhook notification executor in MVP
- output contract should include at minimum:
  - `status_code`
  - `response_body`

### SMTP

- serves as the email notification executor in MVP
- supports subject, recipients, and body
- uses AppOS platform mail settings only in MVP

### LLM

- uses existing AI provider resolution and model streaming/factory layers
- MVP is single-shot inference only
- result is persisted as structured text or JSON output

### Agent

- invokes opencode as an executor inside a bounded workspace
- workflow engine remains authoritative; opencode is not the scheduler
- node config defines prompt, workspace preparation inputs, and expected output path/contract
- first integration may use CLI invocation through `os/exec`
- workspace should live under an AppOS-managed runtime path for workflow runs

### Condition

- evaluates one expression against resolved params, outputs, and static values
- chooses one next path according to node contract
- expression language should stay minimal and explicit in MVP
- MVP approver model for `manual_gate` is superuser-only

### Manual Gate

- transitions node into `manual_gate`
- workflow resumes only after explicit approve or reject action
- timeout behavior may map to rejection in MVP if needed

### Subworkflow

- invokes another workflow synchronously in MVP
- child result returns to parent as node output

## Acceptance Criteria

1. Workflow defines one internal executor interface and registry for built-in node types.
2. `shell` and `docker` are server-targeted executors in MVP.
3. `http` covers webhook notifications and `smtp` covers email notifications.
4. `llm` reuses existing AI provider and prompt/asset infrastructure.
5. `agent` invokes opencode as a bounded executor and returns persisted outputs.
6. `manual_gate` and `condition` have execution-authoritative node behaviors, not UI-only semantics.
7. `subworkflow` executes synchronously in MVP.

## Out of Scope

- external plugin marketplace
- generalized third-party executor SDK
- alternative agent runtimes beyond opencode in MVP
- async child workflow orchestration
