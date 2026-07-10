---
title: 'ClickHouse AppOS Application Template'
type: 'feature'
created: '2026-07-10'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/templates/AUTHORING.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** AppOS lacks a normalized `templates/apps/clickhouse/` template, so ClickHouse cannot be offered as a deployable application through the template contract.

**Approach:** Author a complete ClickHouse template contribution following `templates/AUTHORING.md`, modeled on the single-service pattern (ClickHouse is itself the database, no separate DB sidecar), sourced from the official ClickHouse Docker docs with the Websoft9 docker-library as secondary reference.

## Boundaries & Constraints

**Always:** Follow `templates/AUTHORING.md` invariants; `contractVersion` `"0.1"` in all contract files; directory name = `manifest.key` = `manifest.name` = `clickhouse`; exactly one `primary` serviceRole; secrets only via `secret_backed` inputs + `${secret:...}`; no secret literals in `env/defaults.env`; official docs take priority over Websoft9 reference.

**Block If:** The validator cannot be made green without contradicting the AUTHORING invariants.

**Never:** Add a separate database service (ClickHouse has a built-in store); introduce runtime/instance-declaration concerns; edit unrelated templates.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Validate single template | `validate_templates.py clickhouse` | prints `OK  clickhouse` | non-zero exit + FAIL line on contract mismatch |
| Validate full suite | `validate_templates.py` | all templates print `OK`, exit 0 | no regressions from new template |

</intent-contract>

## Code Map

- `templates/AUTHORING.md` -- authoring rules (authoritative)
- `templates/apps/metabase/` -- closest structural reference (app + secret handling)
- `templates/apps/wordpress/` -- reference for `admin_path` app-specific input
- `templates/tests/validate_templates.py` -- validator that must pass

## Tasks & Acceptance

**Execution:**
- [ ] `templates/apps/clickhouse/manifest.json` -- identity, capabilities (single-service, `hasBuiltinDatabase: true`), versions, serviceRoles with one primary
- [ ] `templates/apps/clickhouse/inputs.schema.json` -- baseline fields (app_id, version, http_port, site_url, db_password) adapted; ClickHouse HTTP port 8123
- [ ] `templates/apps/clickhouse/render.json` -- W9_* + CLICKHOUSE_* env mapping, compose_values (primaryService only), exposures for HTTP
- [ ] `templates/apps/clickhouse/compose/base.yml` -- single clickhouse service with volumes, ulimits, cap_add, healthcheck, external network
- [ ] `templates/apps/clickhouse/env/defaults.env` -- illustrative non-secret defaults
- [ ] `templates/apps/clickhouse/source.json` -- provenance to official docs
- [ ] `templates/apps/clickhouse/README.md` -- scope + constraints note
- [ ] `templates/upstream/clickhouse/source.json` -- upstream identity
- [ ] `templates/upstream/clickhouse/README.md` -- upstream reference note
- [ ] `templates/adapters/clickhouse.json` -- adaptation decisions
- [ ] `templates/tests/clickhouse.expected.json` -- regression baseline
- [ ] `templates/tests/examples/clickhouse.values.json` -- sample override values
- [ ] `templates/tests/clickhouse-upstream-review.md` -- upstream review checklist

**Acceptance Criteria:**
- Given the new template, when `python3 templates/tests/validate_templates.py clickhouse` runs, then it prints `OK  clickhouse`.
- Given the new template, when `python3 templates/tests/validate_templates.py` runs, then all templates pass with exit 0.

## Design Notes

ClickHouse is a single-service application: the server both serves the HTTP interface (8123) and stores data. There is NO separate database service, so `compose_values` has `primaryService: clickhouse` and no `databaseService`. `hasBuiltinDatabase: true`. The `db_password` secret maps to `CLICKHOUSE_PASSWORD` (initial default-user password on first start), reused by the login user. Official docs recommend `--ulimit nofile=262144:262144` and optional `cap_add: SYS_NICE`; both preserved from upstream. Persist `/var/lib/clickhouse` and `/var/log/clickhouse-server`.

## Verification

**Commands:**
- `python3 templates/tests/validate_templates.py clickhouse` -- expected: `OK  clickhouse`
- `python3 templates/tests/validate_templates.py` -- expected: exit 0, no FAIL lines
