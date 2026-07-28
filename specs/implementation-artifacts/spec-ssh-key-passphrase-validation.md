---
title: 'SSH Key Passphrase Validation'
type: 'feature'
created: '2026-07-28'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '4ad4a646b1f731a43a394bb7dee5a4e4fd75f608'
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** AppOS currently accepts any text as an `ssh_key` secret payload and only fails later when a server, terminal, SFTP, or Docker-over-SSH flow tries to use it. The runtime also models an optional `passphrase` field in the secret template but does not actually carry or use it during SSH authentication.

**Approach:** Enforce SSH-key-specific payload validation in the shared `secrets` module, then propagate optional `passphrase` data through the shared server and SSH execution config chain so encrypted SSH private keys work everywhere that already consumes `ssh_key` secrets.

## Boundaries & Constraints

**Always:** Keep validation in `backend/domain/secrets`; reject public keys, PPK content, and malformed SSH private keys at create/update time; support both unencrypted and encrypted SSH private keys; keep `passphrase` optional and low-emphasis in the UI; preserve existing password and unencrypted-key behavior; verify via focused tests plus build and gate commands.

**Block If:** A discovered SSH consumer bypasses both `servers.AccessConfig` and the current terminal/docker config chain in a way that requires a separate product decision for passphrase handling.

**Never:** Move SSH-key validation into server-specific routes; introduce a new secret template or schema migration; store decrypted key material outside the existing secret payload flow; broaden this change into TLS private key validation redesign.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH_UNENCRYPTED | `ssh_key` payload contains a valid unencrypted OpenSSH/PEM private key and empty `passphrase` | Secret create/update succeeds; SSH auth continues to work exactly as before | No error expected |
| HAPPY_PATH_ENCRYPTED | `ssh_key` payload contains a valid encrypted private key and matching `passphrase` | Secret create/update succeeds; terminal, SFTP, server ops, workflow, monitor, and Docker-over-SSH consumers can authenticate with the decrypted signer | No error expected |
| MISSING_PASSPHRASE | `ssh_key` payload contains an encrypted private key and empty `passphrase` | Secret create/update is rejected before persistence | Return a clear validation error that the encrypted private key requires a passphrase |
| WRONG_TYPE_CONTENT | `ssh_key` payload contains a public key, PPK file text, or malformed text | Secret create/update is rejected before persistence | Return a clear validation error naming the unsupported content kind or invalid private-key format |

</intent-contract>

## Code Map

- `backend/domain/secrets/templates.go` -- shared payload validation entry point for both secret create and payload update flows.
- `backend/domain/secrets/hooks.go` -- secret create hook that already validates payloads before encryption.
- `backend/domain/routes/secrets.go` -- payload update route that reuses `ValidatePayload`.
- `backend/domain/resource/servers/config.go` -- shared server access config shape that feeds SSH consumers.
- `backend/domain/resource/servers/managed.go` -- resolves secret payload fields into server access config.
- `backend/domain/terminal/config.go` -- common SSH connector config used by terminal, SFTP, server ops, monitor, workflow, and software execution.
- `backend/domain/terminal/connector_ssh.go` -- canonical terminal-side SSH auth-method builder.
- `backend/infra/docker/ssh.go` -- Docker-over-SSH auth path that currently duplicates private-key parsing.
- `backend/infra/remoteshell/env.go` -- maps server access config into terminal connector config.
- `backend/domain/routes/secrets_test.go` -- route-level validation regression coverage for secret payload updates.
- `backend/domain/secrets/hooks_test.go` -- hook-level secret create validation coverage.
- `backend/domain/terminal/terminal_test.go` -- SSH auth helper tests for invalid keys and passphrase handling.
- `backend/infra/docker/ssh_test.go` -- Docker SSH config/auth helper regression coverage.
- `web/src/components/secrets/SecretForm.tsx` -- upload/paste UX surface for SSH key content hints.
- `web/src/locales/en/secrets.json` -- English UI copy for SSH key hints and validation affordances.
- `web/src/locales/zh/secrets.json` -- Chinese UI copy for SSH key hints and validation affordances.

## Tasks & Acceptance

**Execution:**
- [x] `backend/domain/secrets/templates.go` and a new SSH-key helper file -- add `ssh_key`-specific payload validation that distinguishes encrypted private keys, malformed keys, public keys, and PPK content -- ensures bad secret material is rejected at the shared module boundary.
- [x] `backend/domain/resource/servers/config.go`, `backend/domain/resource/servers/managed.go`, `backend/domain/terminal/config.go`, `backend/domain/terminal/connector_ssh.go`, `backend/infra/docker/ssh.go`, and `backend/infra/remoteshell/env.go` -- carry optional `passphrase` through shared server and SSH config structs and use it during signer creation -- makes encrypted SSH-key secrets usable across all existing SSH consumers.
- [x] `backend/domain/secrets/hooks_test.go`, `backend/domain/routes/secrets_test.go`, `backend/domain/terminal/terminal_test.go`, and `backend/infra/docker/ssh_test.go` -- cover encrypted-key success, missing-passphrase failure, invalid-content failure, and runtime signer creation -- prevents regression across validation and execution paths.
- [x] `web/src/components/secrets/SecretForm.tsx`, `web/src/locales/en/secrets.json`, and `web/src/locales/zh/secrets.json` -- add lightweight SSH-key upload hints without making passphrase a prominent primary-path concept -- supports user guidance while keeping the backend authoritative.

**Acceptance Criteria:**
- Given a user creates or updates an `ssh_key` secret with a public key, PPK content, or malformed key text, when the shared secret validation runs, then the request is rejected before persistence with a content-specific validation error.
- Given a user creates or updates an `ssh_key` secret with an encrypted private key and no `passphrase`, when validation runs, then the request is rejected with a clear missing-passphrase error.
- Given a user creates or updates an `ssh_key` secret with an encrypted private key and the correct `passphrase`, when a server-backed SSH consumer uses that secret, then signer creation succeeds without changing password or unencrypted-key behavior.
- Given the SSH key upload form is used, when content resembles a public key or PPK file, then the UI shows lightweight guidance while leaving final enforcement to the backend.

## Spec Change Log

## Review Triage Log

## Design Notes

The smallest coherent shape is to keep one parsing rule for validation and one parsing rule for runtime signer creation, rather than inventing server-specific branches. Validation should remain template-aware (`ssh_key` only) while runtime signer creation should stay transport-aware (terminal and Docker SSH).

## Verification

**Commands:**
- `make test backend TARGET=./domain/secrets/...` -- expected: SSH-key payload validation tests pass.
- `make test backend TARGET=./domain/routes RUN=TestSecrets` -- expected: secret route validation regressions pass.
- `make test backend TARGET=./domain/terminal RUN=TestAuthMethodFromConfig` -- expected: SSH signer creation covers passphrase and invalid-key branches.
- `make test backend TARGET=./infra/docker RUN=Test` -- expected: Docker SSH auth config tests pass.
- `make test web` -- expected: frontend secret-form changes do not break Vitest suites.
- `make build` -- expected: backend binary and web dist build successfully.
- `make gate merge` -- expected: full merge gate passes without tracked-file drift.
