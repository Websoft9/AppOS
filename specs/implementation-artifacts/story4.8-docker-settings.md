# Story 4.8: Docker Settings

Status: proposed

## Story

As an operator,
I want Docker settings to cover only a small set of platform-level defaults,
so that image pulls are easier to stabilize without turning Settings into a Docker daemon control panel.

## Product Decision

Docker-related settings should stay narrow.

Use this rule:

- Settings own global Docker behavior defaults that operators can understand.
- Connectors own reusable registry credentials.
- Broader outbound network policy owns proxy behavior.

For the current phase, Docker settings should contain only:

- `Docker Mirrors`
- `Image Pull Network Policy`

Do not expand Docker settings into a generic Docker engine or registry administration surface.

## Scope

In scope:

- keep `docker-mirror` as the Docker source-routing setting
- add one new setting entry: `image-pull-network-policy`
- define clear product boundaries between mirrors, pull behavior, and proxy behavior
- keep the Settings IA simple for SMB and non-DevOps operators

Out of scope:

- global `default registry` selection
- registry credential management in Settings
- Docker-specific proxy toggles
- raw daemon tuning such as storage driver, concurrent downloads, or arbitrary `daemon.json`
- redesigning connector management

## Problem To Solve

`Docker Mirrors` and network/proxy concepts are easy to confuse if both are described as ways to make pulls work better.

This story intentionally separates them:

- `Docker Mirrors` answers: where images are pulled from
- `Image Pull Network Policy` answers: how pull retries and timeout behavior work
- proxy answers: how outbound traffic exits the platform, which is not Docker-owned product language

The goal is not to expose every Docker pull knob.
The goal is to let operators fix the most common image-pull reliability problems with minimal concepts.

## Settings Contract

### 1. Docker Mirrors

`Docker Mirrors` remains a Docker settings entry.

Product meaning:

- configure preferred mirror endpoints for faster, more reliable, or policy-compliant image pulls

UI guidance:

- title: `Docker Mirrors`
- description: `Configure preferred mirror endpoints for faster or compliant image pulls.`

### 2. Image Pull Network Policy

Add one new Docker settings entry:

- entry id: `image-pull-network-policy`

Product meaning:

- define timeout and retry behavior for image pull operations
- improve pull resilience without exposing low-level daemon internals

Recommended field set:

- `pullTimeoutSeconds`
- `maxRetries`
- `retryDelaySeconds`

Field intent:

- `pullTimeoutSeconds`: maximum time allowed for one pull attempt before it is treated as failed
- `maxRetries`: how many retry attempts AppOS should make after a failed pull attempt
- `retryDelaySeconds`: fixed delay between retry attempts for the MVP

UI guidance:

- title: `Image Pull Network Policy`
- description: `Control timeout and retry behavior when pulling container images.`

## Product Boundary Rules

### Registry credentials

Private registry credentials are still meaningful in the product, but they are not first-class Docker settings.

They belong to reusable resource/connectors management.

If `docker-registries` remains visible in Settings during transition, it should be reference-only, not a full editable settings card.

### Default registry

Do not add a global `default registry` setting in this story.

Reason:

- it is ambiguous for mixed public/private image sources
- it suggests pull-source routing semantics that the product does not actually want to promise
- it creates confusion with mirrors and connectors

If a future product need appears, the narrower concept should be a default credential prefill, not a global default image source.

### Proxy

Do not add `allow pull via proxy` under Docker settings.

Reason:

- users can confuse it with mirrors
- proxy is a broader platform outbound-network concern, not a Docker-only concern

If proxy is productized, it should live under broader network or system settings and be shared by multiple outbound capabilities.

## Acceptance Criteria

1. Docker settings remain intentionally small and contain only `Docker Mirrors` plus `Image Pull Network Policy` as first-class Docker behavior entries.
2. `Image Pull Network Policy` is limited to timeout and retry semantics and does not include proxy toggles or registry-source selection.
3. `Docker Mirrors` and `Image Pull Network Policy` have clearly different product language so users can distinguish source routing from pull reliability behavior.
4. `docker-registries` is not expanded into a full editable Docker settings surface.
5. No global `default registry` setting is introduced.

## Implementation Notes

- Epic 13 still owns the shared Settings platform and `/api/settings` transport.
- Epic 4 owns the business meaning of Docker settings fields and runtime behavior.
- Keep the frontend IA minimal: one Docker settings group, no advanced mode in this story.
- Prefer fixed retry delay for the MVP over exponential backoff configuration.

## Non-Goals

- no Docker daemon expert panel
- no engine-level performance tuning matrix
- no registry connector CRUD inside Settings
- no attempt to merge mirror, proxy, and registry concepts into one Docker networking card
