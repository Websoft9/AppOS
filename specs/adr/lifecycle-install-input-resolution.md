# Lifecycle Install Input Resolution

## Status
Proposed

## Context

Different install entry points may collect different user inputs before an install operation is created.

Examples include:

1. Store or template install dialogs
2. Git-based install inputs
3. manual compose install inputs
4. future guided install flows

These inputs must not flow directly into workers or pipeline execution as raw UI payloads. Epic 17 requires one normalized lifecycle execution contract before queueing.

## Decisions

### 1. Responsibility boundary

Install input collection and install execution are separate concerns.

1. frontend collects candidate inputs
2. backend resolves and normalizes them
3. shared lifecycle execution consumes only normalized operation data

### 2. Resolver role

The backend must own install input resolution.

The resolver is responsible for:

1. validating user inputs
2. applying defaults and template rules
3. selecting optional addons or overlays
4. producing rendered runtime inputs such as compose and env data
5. classifying sensitive inputs and converting them to secret-backed references when required

### 3. Normalized output

Install resolution must produce one normalized install payload before operation creation.

Minimum outputs are:

1. rendered compose baseline
2. resolved env data or equivalent runtime configuration payload
3. source and adapter attribution
4. normalized operation spec metadata required by the shared lifecycle execution core

### 4. Exposure and publication inputs

Inputs such as public domain names must not be treated only as raw install form fields.

If an input affects external publication semantics, it should be stored as lifecycle publication intent or exposure-related metadata, not hidden inside worker-only runtime data.

### 5. Secret handling

Sensitive install inputs such as passwords, tokens, or external database credentials must be handled by backend logic.

They must not rely on frontend-only rendering rules or direct worker payload injection.

### 6. Execution boundary

Workers, pipeline runners, and node executors must consume only normalized lifecycle operation data.

They must not interpret raw install dialog payloads.

## Consequences

This keeps install dialogs flexible without leaking UI-specific payloads into the shared lifecycle execution engine.