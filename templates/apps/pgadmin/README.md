# pgAdmin Template Sample

This folder is a minimal sample for Epic 32 template contract work.

It is not yet a production runtime template.

Purpose:

- demonstrate the `manifest / inputs / render / source` contract from Story 32.1
- demonstrate how the official pgAdmin (dpage/pgadmin4) Docker image can be represented after Story 32.2 adaptation
- provide a concrete web database-admin sample for later Story 32.3 ingress and Story 32.4 validation work

Current constraints:

- values are illustrative and not fully wired into AppOS runtime code yet
- version tags are illustrative; consult upstream for currently published tags
- secret handling is represented at contract level through `secret_ref` and `${secret:...}` placeholders
- pgAdmin is a stateless web client for external PostgreSQL servers; it has no built-in database, so `hasBuiltinDatabase` is `false`
- the upstream Websoft9 reference includes a throwaway PostgreSQL container for testing only; it is intentionally omitted from this normalized template

Validation baseline:

- `templates/tests/pgadmin.expected.json`
- `templates/tests/pgadmin-upstream-review.md`
