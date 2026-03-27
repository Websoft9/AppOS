# App Lifecycle Install Preflight

## Status
Proposed

## Context

Install resolution defines how backend normalizes install inputs before operation creation.

The create-deployment UX now also needs a non-submitting `Check` capability so operators can inspect likely problems before creating an action.

These checks may include:

1. compose syntax and required structure
2. duplicate application name
3. secret reference validation
4. environment-dependent conflicts such as occupied or reserved ports when detectable

This is related to install resolution, but it is not the same concern.

## Decisions

### 1. Separate preflight from resolution

Install resolution remains the backend step that produces normalized install data for operation creation.

Install preflight is a separate backend capability that evaluates whether an install request is likely to succeed before action creation.

### 2. `Check` must not create actions

Preflight endpoints may reuse resolution logic, but they must not create `app_operations`, queue workers, or mutate lifecycle state.

### 3. Preflight result shape

Preflight returns operator-facing results grouped as checks.

Minimum checks are:

1. compose validity
2. application name availability
3. resource-conflict checks when the target environment can answer them

### 4. Blocking vs warning

Preflight may return both blocking failures and non-blocking warnings.

Examples:

1. invalid compose: blocking
2. duplicate application name: blocking
3. target environment cannot provide port occupancy data: warning

### 5. Backend remains final authority

Preflight improves operator feedback, but create-operation endpoints remain the final authority.

Successful preflight does not guarantee successful execution.

## Consequences

This keeps the original install-resolution boundary intact while adding a clear place for non-submitting validation semantics.

Frontend can expose `Check` as an optional operator tool without implying that workers consume raw form payloads.

Environment-dependent validation can evolve independently from the normalized install contract.