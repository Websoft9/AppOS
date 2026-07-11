# phpMyAdmin Template Sample

This folder is a minimal sample for Epic 32 template contract work.

It is not yet a production runtime template.

Purpose:

- demonstrate the `manifest / inputs / render / source` contract from Story 32.1
- demonstrate how the official phpMyAdmin Docker image can be represented after Story 32.2 adaptation
- provide a concrete web database-admin sample for later Story 32.3 ingress and Story 32.4 validation work

Current constraints:

- values are illustrative and not fully wired into AppOS runtime code yet
- version tags are illustrative; consult upstream for currently published tags
- phpMyAdmin is a stateless web client for external MySQL/MariaDB servers; it has no built-in database, so `hasBuiltinDatabase` is `false`
- login credentials are entered by the end user against the target database at runtime, so there is no contract-level secret input; `PMA_ARBITRARY=1` allows connecting to any server
- the upstream Websoft9 reference includes a throwaway MariaDB container for testing only; it is intentionally omitted from this normalized template

Validation baseline:

- `templates/tests/phpmyadmin.expected.json`
- `templates/tests/phpmyadmin-upstream-review.md`
