# ClickHouse Template Sample

This folder is a minimal sample for Epic 32 template contract work.

It is not yet a production runtime template.

Purpose:

- demonstrate the `manifest / inputs / render / source` contract from Story 32.1
- demonstrate how the official ClickHouse Docker deployment can be represented after Story 32.2 adaptation
- provide a concrete single-service database sample for later Story 32.3 ingress and Story 32.4 validation work

Current constraints:

- values are illustrative and not fully wired into AppOS runtime code yet
- version tags are illustrative; consult upstream for currently published tags
- secret handling is represented at contract level through `secret_ref` and `${secret:...}` placeholders
- ClickHouse is a single-service application (the server is also the datastore), so there is no separate database service; `hasBuiltinDatabase` is `true`
- the sample keeps the upstream shape narrow: community edition exposing the HTTP interface (8123)

Validation baseline:

- `templates/tests/clickhouse.expected.json`
- `templates/tests/clickhouse-upstream-review.md`
