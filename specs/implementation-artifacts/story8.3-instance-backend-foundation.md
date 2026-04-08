# Story 8.3: Instance Backend Foundation

**Epic**: Epic 8 - Resources
**Priority**: P1
**Status**: in-progress
**Depends on**: Story 8.1

## User Story

As a platform engineer,
I want a canonical service-instance backend foundation,
so that AppOS can register long-lived runtime dependencies as stable `Service Instances` instead of overloading connectors or settings.

## Goal

Introduce a brand-new `instances` resource family with a registration-only backend domain, template-aware profiles, and authenticated CRUD APIs.

This story intentionally does not consider legacy migration compatibility. It establishes the clean-slate canonical model first.

## In Scope

- create a new `instances` collection and backend domain model
- define minimum instance identity semantics for registration-only objects
- add template-aware instance profiles similar to the connector template approach
- expose authenticated list/get/template routes and superuser-only mutation routes
- keep optional secret binding available for future app/deploy dependency references

## Out of Scope

- migrating legacy database, endpoint, or settings-owned records into `instances`
- app or deploy workflow consumption of instances
- health checks, discovery, backup, provisioning, or lifecycle automation
- frontend resource pages and navigation changes

## Minimum Instance Semantics

An `instance` is a concrete service dependency with stable identity.

It is not:

1. a generic external capability access configuration
2. a provider account or tenant boundary
3. an inline app-only payload

## Minimum Canonical Field Set

| Field | Purpose |
| --- | --- |
| `name` | display name |
| `kind` | instance kind such as `mysql`, `postgres`, `redis`, `kafka`, `s3`, `registry`, `ollama` |
| `template_id` | built-in profile id under the chosen kind |
| `endpoint` | optional primary service address or base URL |
| `credential` | optional secret relation for future auth/bootstrap use |
| `config` | non-sensitive template-specific configuration |
| `description` | human description |

## Template Metadata Rules

`instances` template metadata is intentionally split into three layers:

1. `category` is the product-facing directory group used for navigation and discovery, such as `database`, `storage`, `ai`, or `artifact`.
2. `kind` is the canonical resource identity and must follow the product/service line, such as `mysql`, `postgres`, `redis`, `s3`, `registry`, or `ollama`.
3. `template_id` is a profile under one `kind`, such as `generic-postgres`, `aws-rds-postgres`, `minio`, or `generic-ollama`.

Naming rules:

1. `category` must never replace `kind` as the identity axis.
2. `template_id` must stay inside one `kind` family and must not fall back to category-level profiles such as `custom_database` or `custom_storage`.
3. Generic profiles are allowed only at the product-kind layer, for example `generic-mysql` or `generic-postgres`.
4. Template directory names must equal `kind` names.
5. Template directory names must stay aligned with product-family `kind` names such as `mysql`, `s3`, or `ollama`.

## Acceptance Criteria

1. A new canonical `instances` backend domain exists under `domain/resource/instances`.
2. A new `instances` collection exists with the minimum canonical field set for registration-only objects.
3. The API exposes `/api/instances` CRUD plus template discovery routes, aligned with Epic 8 Phase 2 target naming.
4. Template-aware validation exists so a `template_id` must belong to the selected instance `kind`.
5. Secret binding remains relation-based and optional; no inline plaintext credential ownership is introduced.
6. The implementation is clean-slate only and does not depend on legacy resource migration compatibility.
7. Automated tests cover migration, persistence, and route behavior.

## Tasks / Subtasks

- [x] Task 1: Freeze the clean-slate instance contract
  - [x] 1.1 Define minimum registration-only instance semantics and boundaries
  - [x] 1.2 Define minimum canonical field set and route naming
  - [x] 1.3 Define template-aware profile strategy without legacy migration coupling

- [x] Task 2: Implement backend instance domain and storage
  - [x] 2.1 Add `domain/resource/instances` model, service, repository contract, errors, and templates
  - [x] 2.2 Add PocketBase persistence repository and collection migration for `instances`
  - [x] 2.3 Enforce template/kind validation and optional secret-reference validation

- [x] Task 3: Expose API and verify behavior
  - [x] 3.1 Add `/api/instances` list/get/create/update/delete and template routes
  - [x] 3.2 Add route, persistence, and migration tests
  - [x] 3.3 Run targeted backend test suites to verify the story end-to-end

## Dev Agent Record

### File List

- backend/domain/resource/instances/model.go
- backend/domain/resource/instances/repository.go
- backend/domain/resource/instances/errors.go
- backend/domain/resource/instances/service.go
- backend/domain/resource/instances/service_test.go
- backend/domain/resource/instances/templates.go
- backend/domain/resource/instances/templates/README.md
- backend/domain/resource/instances/templates/kafka/_template.json
- backend/domain/resource/instances/templates/kafka/generic-kafka.json
- backend/domain/resource/instances/templates/kafka/redpanda.json
- backend/domain/resource/instances/templates/ollama/_template.json
- backend/domain/resource/instances/templates/ollama/generic-ollama.json
- backend/domain/resource/instances/templates/ollama/ollama.json
- backend/domain/resource/instances/templates/mysql/_template.json
- backend/domain/resource/instances/templates/mysql/aurora-mysql.json
- backend/domain/resource/instances/templates/mysql/generic-mysql.json
- backend/domain/resource/instances/templates/s3/_template.json
- backend/domain/resource/instances/templates/s3/generic-s3.json
- backend/domain/resource/instances/templates/s3/minio.json
- backend/domain/resource/instances/templates/postgres/_template.json
- backend/domain/resource/instances/templates/postgres/aws-rds-postgres.json
- backend/domain/resource/instances/templates/postgres/generic-postgres.json
- backend/domain/resource/instances/templates/redis/_template.json
- backend/domain/resource/instances/templates/redis/generic-redis.json
- backend/domain/resource/instances/templates/registry/_template.json
- backend/domain/resource/instances/templates/registry/harbor.json
- backend/domain/resource/instances/templates/registry/generic-registry-instance.json
- backend/domain/routes/instances.go
- backend/domain/routes/resources_test.go
- backend/domain/routes/routes.go
- backend/infra/migrations/1764100000_instances.go
- backend/infra/migrations/migrations_test.go
- backend/infra/persistence/instance_repository.go
- backend/infra/persistence/instance_repository_test.go
- specs/implementation-artifacts/story8.3-instance-backend-foundation.md

### Completion Notes

- Added a clean-slate `instances` domain with registration-only semantics, template-aware profiles, and optional secret relation support.
- Added PocketBase `instances` collection migration plus repository mapping for canonical fields `name`, `kind`, `template_id`, `endpoint`, `credential`, `config`, and `description`.
- Added authenticated `/api/instances` CRUD and `/api/instances/templates*` discovery routes, with superuser-only mutations and audit logging.
- Added unit, route, persistence, and migration coverage for template defaults, template-kind mismatch validation, CRUD behavior, and collection shape.
- Clarified template metadata layering: `category` is the product directory layer, `kind` is canonical identity, and `template_id` is a kind-local profile; category-level custom profiles such as `custom_database` are explicitly excluded.
- Renamed abstract capability-style kinds to product-family kinds by replacing `object_storage` with `s3` and `model_service` with `ollama` across templates, code, and tests.
- Added minimal template README plus product-level instance profiles for AWS RDS PostgreSQL, Aurora MySQL, MinIO, Harbor, Ollama, and Redpanda.
- Tightened the DDD boundary by moving allowed-kind checks, credential-reference validation entry points, and explicit name uniqueness enforcement into the `instances` service layer instead of leaving them implicit in routes or PocketBase schema alone.
- Verified targeted backend suites pass with: `go test ./domain/resource/instances ./domain/routes ./infra/persistence ./infra/migrations -count=1`.

### Change Log

- 2026-04-07: Story created to drive clean-slate Epic 8 `Service Instances` backend foundation implementation.
- 2026-04-07: Implemented clean-slate Epic 8 service-instance backend foundation with template-driven profiles, PocketBase migration, `/api/instances` routes, and passing targeted backend tests.
- 2026-04-07: Restored template metadata name to `category`, kept category/kind/template_id layering, and added initial product-level instance profiles plus a minimal template README.
- 2026-04-07: Renamed abstract capability-style instance kinds to product-family kinds, simplifying template directories to `s3` and `ollama`.
- 2026-04-07: Moved core instance invariants into the service layer by making allowed kinds explicit, adding service-level credential-reference validation hooks, and surfacing duplicate names as an explicit conflict rule.