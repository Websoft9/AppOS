# Epic 38: Sandbox Runtime

**Module**: Sandbox Runtime | **Status**: Proposed | **Priority**: P2 | **Depends on**: Epic 15, 19, 20, 31

## Overview

AppOS Sandbox Runtime is the controlled local execution environment for user-installed CLI tools.

Its primary goal is to let operators run AI agent CLIs, cloud CLIs, and SaaS CLIs inside AppOS without polluting or destabilizing the AppOS runtime itself.

## Definition

`Sandbox Runtime` is a general CLI runtime, not a terminal feature.

It owns:

- isolated runtime home and working directories for CLI tools
- local CLI installation boundary inside AppOS
- sandbox lifecycle and runtime metadata
- command execution inside a selected sandbox

It does not own:

- remote server access or SSH transport
- terminal session UX
- AI orchestration logic
- connector definitions, secrets ownership, or asset definitions

## Boundary

Use Sandbox Runtime when AppOS needs a local, controlled execution environment for CLI-based tooling.

Do not use Sandbox Runtime as a replacement for Terminal, Servers, or full container orchestration.

Terminal may attach to a sandbox, but sandbox and terminal remain separate concepts:

- `sandbox` = execution environment
- `terminal` = interactive access path

## Direction

Phase 1 should stay minimal:

- treat sandbox as a reusable local CLI runtime
- support AI agent CLI as the first consumer, but not the only one
- prefer container-internal isolation that does not require host changes or privileged container mode
