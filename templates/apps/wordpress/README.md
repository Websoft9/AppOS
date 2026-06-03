# WordPress Template Sample

This folder is a minimal sample for Epic 32 template contract work.

It is not yet a production runtime template.

Purpose:

- demonstrate the `manifest / inputs / render / source` contract from Story 32.1
- demonstrate how an upstream WordPress Compose project can be represented after Story 32.2 adaptation
- provide a concrete sample for later Story 32.3 ingress and Story 32.4 validation work

Current constraints:

- values are illustrative and not fully wired into AppOS runtime code yet
- secret handling is represented at contract level through `secret_ref` and `${secret:...}` placeholders
- auxiliary source files such as `src/init.sh` and `src/php_exra.ini` are intentionally not copied yet

Validation baseline:

- `templates/tests/wordpress.expected.json`
- `templates/tests/wordpress-upstream-review.md`