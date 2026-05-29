# Epic 31: AI Runtime

**Module**: AI Runtime | **Status**: Proposed | **Priority**: P1 | **Depends on**: Epic 12, 15, 30

## Overview

AppOS AI Runtime is the controlled execution foundation for operational AI agents.

It provides the runtime boundary for agents to diagnose, plan, request approval, act through controlled tools, verify the result, and summarize the outcome.

The goal is to provide the runtime boundary that lets AI agents operate inside AppOS with clear permissions, observable execution, and operator control.

## Definition

AppOS AI Runtime is the domain that runs AI-controlled operational workflows.

It owns the runtime capabilities that make AI execution controllable: model access, orchestration, tool execution, terminal execution, workspace access, task state, event streaming, approvals, and audit trace.

It does not own:

- app deployment templates or app lifecycle semantics
- raw terminal product UX outside agent execution
- reusable asset definitions such as scripts or skills
- software installation and upgrade ownership
- monitoring evidence collection and health judgment

## Boundary

Use AI Runtime when the product needs an AI-controlled operational workflow.

Do not use AI Runtime as a general chat module, unrestricted shell runner, generic workflow engine, or catch-all automation domain.

AI Runtime should consume existing AppOS domains through explicit tools and contracts. It should not bypass domain ownership by directly mutating deployment, monitoring, software, terminal, or asset internals.

## Core Capabilities

AI Runtime provides:

- model access
- agent orchestration
- tool execution
- terminal execution
- workspace and file access
- task state and event streaming
- audit and trace records
- approval gates

## Direction

AI Runtime should stay small and boundary-focused. It coordinates agent execution and delegates domain-specific actions to existing AppOS domains through explicit tools.
