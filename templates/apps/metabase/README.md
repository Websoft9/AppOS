# Metabase Template Sample

This folder is a minimal sample for Epic 32 template contract work.

It is not yet a production runtime template.

Purpose:

- demonstrate the `manifest / inputs / render / source` contract from Story 32.1
- demonstrate how the official Metabase Docker Compose deployment can be represented after Story 32.2 adaptation
- provide a concrete analytics/BI sample for later Story 32.3 ingress and Story 32.4 validation work

Current constraints:

- values are illustrative and not fully wired into AppOS runtime code yet
- version tags are illustrative; consult upstream for currently published tags
- secret handling is represented at contract level through `secret_ref` and `${secret:...}` placeholders
- the sample keeps the upstream shape narrow: OSS edition with a PostgreSQL application database

Validation baseline:

- `templates/tests/metabase.expected.json`
- `templates/tests/metabase-upstream-review.md`
