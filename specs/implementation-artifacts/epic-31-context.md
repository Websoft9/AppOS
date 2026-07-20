# Epic 31 Context: AI Runtime

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Establish the controlled execution foundation for operational AI agents. Enable AppOS to run AI-orchestrated workflows with observable execution, operator control, and explicit tool access to existing domains through clear contracts without exposing provider credentials or enabling unrestricted automation.

## Stories

- Story 31.1: Chat MVP

## Requirements & Constraints

AI Runtime owns model access, agent orchestration, tool execution, terminal execution, workspace access, task state, event streaming, approvals, and audit trace. It must not take over deployment ownership, generic terminal UX outside agent execution, software installation ownership, or monitoring judgment.

All AI runtime routes require authenticated AppOS access. Provider credentials stay server-side and must never be exposed to the browser. When no usable provider exists, the system should return an explicit setup-required error instead of failing silently.

The runtime should stay small and contract-driven. It should consume existing AppOS domains through explicit interfaces instead of bypassing domain ownership with direct mutations.

## Technical Decisions

Backend AI runtime behavior should live behind AppOS-owned services and routes rather than exposing provider SDK details directly from handlers. Session and message persistence use PocketBase-backed storage and AppOS custom routes.

Frontend AI surfaces are React + TanStack Router pages inside the authenticated shell. Requests must go through `pb.send`, and UI should surface loading, setup, and failure states explicitly instead of rendering an empty shell.

Terminal-capable AI experiences build on the same PTY-over-WebSocket approach already used elsewhere in AppOS, keeping process lifecycle tied to the client session.

## Cross-Story Dependencies

Epic 31 depends on AI provider configuration, secrets resolution, settings-driven provider selection, and the terminal foundation from Epic 15.