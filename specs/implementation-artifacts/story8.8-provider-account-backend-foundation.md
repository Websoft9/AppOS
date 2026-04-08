# Story 8.8: Provider Account Backend Foundation

**Epic**: Epic 8 - Resources
**Priority**: P1
**Status**: in-progress
**Depends on**: Story 8.1

## User Story

As a platform engineer,
I want a canonical provider-account backend foundation,
so that AppOS can register long-lived platform identity scopes as stable `Platform Accounts` instead of overloading connectors or legacy cloud-account records.

## Goal

Introduce a brand-new `provider_accounts` resource family with a registration-only backend domain, template-aware profiles, and authenticated CRUD APIs.

This story intentionally does not include legacy `cloud_accounts` migration compatibility. It establishes the clean-slate canonical model first.

## In Scope

- create a new `provider_accounts` collection and backend domain model
- define minimum provider-account identity semantics for registration-only objects
- add template-aware provider-account profiles similar to the connector and instance template approach
- expose authenticated list/get/template routes and superuser-only mutation routes
- keep optional secret binding available for future connector or instance references

## Out of Scope

- migrating legacy `cloud_accounts` records into `provider_accounts`
- app, deploy, or settings consumption of provider accounts
- full provider-specific automation or provisioning
- frontend resource pages and navigation changes

## Minimum Provider Account Semantics

A `provider_account` is a platform identity and authorization scope with stable identity.

It is not:

1. a concrete service dependency
2. a generic external capability connection
3. an inline app-only payload

## Minimum Canonical Field Set

| Field | Purpose |
| --- | --- |
| `name` | display name |
| `kind` | provider kind such as `aws`, `aliyun`, `azure`, `gcp`, `github`, `cloudflare` |
| `template_id` | built-in profile id under the chosen provider kind |
| `identifier` | non-sensitive account / project / installation / subscription identifier |
| `credential` | optional secret relation for auth material |
| `config` | non-sensitive template-specific configuration |
| `description` | human description |

## Template Metadata Rules

`provider_accounts` template metadata follows the same three-layer structure as other Epic 8 clean-slate domains:

1. `category` is the product-facing discovery group, such as `cloud`, `developer-platform`, or `edge`.
2. `kind` is the canonical provider-account identity and must follow the platform family, such as `aws`, `gcp`, or `github`.
3. `template_id` is a profile under one `kind`, such as `generic-aws-account` or `github-app-installation`.

## Acceptance Criteria

1. A new canonical `provider_accounts` backend domain exists under `domain/resource/accounts`.
2. A new `provider_accounts` collection exists with the minimum canonical field set for registration-only objects.
3. The API exposes `/api/provider-accounts` CRUD plus template discovery routes, aligned with Epic 8 Phase 2 target naming.
4. Template-aware validation exists so a `template_id` must belong to the selected provider-account `kind`.
5. Secret binding remains relation-based and optional; no inline plaintext credential ownership is introduced.
6. The implementation is clean-slate only and does not depend on legacy `cloud_accounts` migration compatibility.
7. Automated tests cover migration, persistence, and route behavior.

## Tasks / Subtasks

- [x] Task 1: Freeze the clean-slate provider-account contract
  - [x] 1.1 Define minimum registration-only provider-account semantics and boundaries
  - [x] 1.2 Define minimum canonical field set and route naming
  - [x] 1.3 Define template-aware profile strategy without legacy migration coupling

- [x] Task 2: Implement backend provider-account domain and storage
  - [x] 2.1 Add `domain/resource/accounts` model, service, repository contract, errors, and templates
  - [x] 2.2 Add PocketBase persistence repository and collection migration for `provider_accounts`
  - [x] 2.3 Enforce template/kind validation and optional secret-reference validation

- [x] Task 3: Expose API and verify behavior
  - [x] 3.1 Add `/api/provider-accounts` list/get/create/update/delete and template routes
  - [x] 3.2 Add route, persistence, and migration tests
  - [x] 3.3 Run targeted backend test suites to verify the story end-to-end

## Dev Agent Record

### File List

- backend/domain/resource/accounts/model.go
- backend/domain/resource/accounts/repository.go
- backend/domain/resource/accounts/errors.go
- backend/domain/resource/accounts/service.go
- backend/domain/resource/accounts/service_test.go
- backend/domain/resource/accounts/templates.go
- backend/domain/resource/accounts/templates/README.md
- backend/domain/resource/accounts/templates/aws/_template.json
- backend/domain/resource/accounts/templates/aws/generic-aws-account.json
- backend/domain/resource/accounts/templates/aliyun/_template.json
- backend/domain/resource/accounts/templates/aliyun/generic-aliyun-account.json
- backend/domain/resource/accounts/templates/azure/_template.json
- backend/domain/resource/accounts/templates/azure/generic-azure-subscription.json
- backend/domain/resource/accounts/templates/gcp/_template.json
- backend/domain/resource/accounts/templates/gcp/generic-gcp-project.json
- backend/domain/resource/accounts/templates/github/_template.json
- backend/domain/resource/accounts/templates/github/github-app-installation.json
- backend/domain/resource/accounts/templates/cloudflare/_template.json
- backend/domain/resource/accounts/templates/cloudflare/cloudflare-account.json
- backend/domain/routes/provider_accounts.go
- backend/domain/routes/resources_test.go
- backend/domain/routes/routes.go
- backend/infra/collections/names.go
- backend/infra/migrations/1764200000_provider_accounts.go
- backend/infra/migrations/migrations_test.go
- backend/infra/persistence/provider_account_repository.go
- backend/infra/persistence/provider_account_repository_test.go
- specs/implementation-artifacts/story8.8-provider-account-backend-foundation.md

### Completion Notes

- Added a clean-slate `provider_accounts` domain with registration-only semantics, template-aware profiles, and optional secret relation support.
- Added PocketBase `provider_accounts` collection migration plus repository mapping for canonical fields `name`, `kind`, `template_id`, `identifier`, `credential`, `config`, and `description`.
- Added authenticated `/api/provider-accounts` CRUD and `/api/provider-accounts/templates*` discovery routes, with superuser-only mutations and audit logging.
- Added unit, route, persistence, and migration coverage for template-kind validation, CRUD behavior, and collection shape.
- Verified targeted backend suites pass with: `go test ./domain/resource/accounts ./domain/routes ./infra/persistence ./infra/migrations -count=1`.

### Change Log

- 2026-04-08: Story created to drive clean-slate Epic 8 `Platform Accounts` backend foundation implementation.
- 2026-04-08: Implemented clean-slate provider-account backend foundation with template-driven profiles, PocketBase migration, `/api/provider-accounts` routes, and targeted tests.