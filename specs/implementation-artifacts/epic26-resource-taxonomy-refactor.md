# Epic 26: Resource Taxonomy Refactor

## Status
Superseded by [Epic 8](epic8-resources.md)

## Note

This draft has been merged into [Epic 8](epic8-resources.md) so that resource taxonomy, migration direction, and long-term ownership remain under one canonical resources epic.

The authoritative sections now live in Epic 8 Phase 2.

---

**Module**: Resources | **Status**: Proposed | **Priority**: P2 | **Depends on**: Epic 8, Epic 13, Epic 19, Epic 20, Epic 21

## Overview

Epic 26 defines the next-stage resource taxonomy for AppOS.

The goal is to move from a partially fragmented resource model toward four canonical resource families:

1. `Servers`
2. `Service Instances`
3. `Provider Accounts`
4. `Connectors`

This epic does not attempt to deliver full operational depth for every resource kind. Its first goal is to stabilize ownership, naming, references, and migration direction.

Companion ADR: [specs/adr/resource-taxonomy-instance-connector.md](specs/adr/resource-taxonomy-instance-connector.md)

## Problem Statement

The current model has three structural problems:

1. some long-lived external dependencies are stored under `settings`
2. `endpoints` is too narrow as a long-term home for all connection-oriented resources
3. there is no canonical home yet for service-like app dependencies such as RDS, object storage, model services, or managed registries

Without a taxonomy refactor, future work on LLM, S3, registry, DNS, SMTP, backup targets, and managed runtime dependencies will continue to drift into inconsistent resource families.

## Goals

Epic 26 is responsible for:

1. establishing `instances` as a canonical resource family for concrete app dependencies
2. evolving `endpoints` toward `connectors`
3. defining when a dependency belongs to `instance` versus `connector`
4. moving long-lived resource ownership out of `settings`
5. defining how settings, apps, deploy, and workflows reference the new resource families

## Non-Goals

Epic 26 is not responsible for:

1. delivering full health, backup, discovery, or lifecycle automation for all instance kinds
2. fully modeling every possible provider account integration in one release
3. rewriting all existing resource UIs in one iteration
4. provisioning cloud services directly

## Canonical Resource Families

| Family | Product label | Typical examples |
| --- | --- | --- |
| `server` | `Servers` | server nodes, SSH targets, host compute environments |
| `instance` | `Service Instances` | RDS, MySQL, Redis, Kafka, MinIO, object storage, model services |
| `provider_account` | `Provider Accounts` | AWS account, GitHub installation, Cloudflare account |
| `connector` | `Connectors` | OpenAI, SMTP, DNS, Webhook, MCP, registry login |

## Scope Split

### Track A: Taxonomy and naming

1. define route, collection, and frontend naming for `instances`, `provider accounts`, and `connectors`
2. update resource hub taxonomy and future navigation labels
3. document classification rules for ambiguous technology families such as `llm`, `s3`, and `registry`

### Track B: LLM extraction from settings

1. remove LLM provider ownership from `settings`
2. expose dedicated LLM resource routes during the transition period
3. decide whether the first durable landing zone for LLM is `connectors` or a temporary subdomain pending connector refactor

### Track C: Instance foundation

1. introduce minimal `instances` backend domain and CRUD surface
2. support registration-only instance objects with stable identity semantics
3. enable apps and deploy workflows to reference an instance as a dependency

### Track D: Connector evolution

1. evolve current `endpoints` model toward `connectors`
2. introduce template-aware connector modeling where needed
3. preserve lightweight connection-testing semantics

### Track E: Settings as reference layer

1. convert settings entries that currently own business resources into reference settings where appropriate
2. keep policy and default selection in `settings`
3. stop using `settings` as canonical persistence for long-lived resource objects

## Initial Classification Rules

| Object | Canonical family |
| --- | --- |
| third-party RDS | `instance` |
| self-hosted MySQL or Redis | `instance` |
| object storage used as long-lived app dependency | `instance` |
| self-hosted model service | `instance` |
| OpenAI or Anthropic access | `connector` |
| SMTP delivery target | `connector` |
| DNS automation target | `connector` |
| webhook target | `connector` |
| cloud or source-control account | `provider_account` |

## Migration Principles

1. users should see stable product labels before deep backend refactors become visible
2. existing resources must migrate incrementally instead of through one destructive rewrite
3. each migrated object family must end with one canonical owner only
4. backward-compatible transition routes are acceptable during the migration window
5. settings should reference resources, not own them

## Proposed Delivery Stories

### Story 26.1: Resource Taxonomy Contract

Define canonical route names, resource family language, and classification rules for `instance`, `connector`, and `provider_account`.

### Story 26.2: LLM Ownership Extraction

Finish extraction of LLM provider ownership from `settings` and place it under a dedicated resource surface compatible with future connector migration.

### Story 26.3: Instance Backend Foundation

Introduce `instances` collection, domain model, CRUD API, and minimal validation for registration-only instance objects.

### Story 26.4: Resource Hub and Navigation Refactor

Update dashboard resource navigation to expose `Service Instances`, `Connectors`, and `Provider Accounts` using the canonical product labels.

### Story 26.5: Connector Refactor from Endpoints

Refactor `endpoints` into `connectors`, preserving existing generic target use cases while tightening connector semantics.

### Story 26.6: Settings Reference Migration

Replace settings-owned business resources with resource references where appropriate.

## Data and Route Direction

The target direction is:

| Family | Expected backend path |
| --- | --- |
| `server` | `/api/servers` |
| `instance` | `/api/instances` |
| `provider_account` | `/api/provider-accounts` |
| `connector` | `/api/connectors` |

This epic does not require all target routes to exist immediately, but all stories must align with this target naming.

## Risks

1. ambiguous technologies such as `llm`, `s3`, and `registry` may regress into inconsistent classification if stories skip the ADR rules
2. frontend taxonomy changes may outpace backend ownership migration and create temporary duplication
3. existing `endpoint` semantics may resist a clean connector split if legacy clients depend on the old shape too long

## Acceptance Conditions

Epic 26 is considered successful when:

1. the canonical four-family taxonomy is documented and applied consistently in new work
2. LLM provider ownership is no longer canonical in `settings`
3. `instances` exists as a first-class resource family, even if initially registration-only
4. the migration path from `endpoints` to `connectors` is defined and actively used by new features
5. settings entries that still reference business resources do so by resource identity rather than owning the full object payload