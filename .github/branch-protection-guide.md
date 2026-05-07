# Branch Protection And CI Roles

This repository uses three primary CI/CD layers with different responsibilities:

- `PR Gate`: the pre-merge blocking gate for `main`
- `Main Post-Merge`: post-merge validation for merge-result health and advisory supply-chain checks
- `Release`: tag-based release preparation and draft release creation

There is also one source-security workflow managed alongside the CI layers:

- `CodeQL`: source code security scanning for PRs to `main` and pushes to `main`

There is also one optional developer workflow:

- `Dev Fast CI`: lightweight self-checks for non-`main` development branches

Related workflows:

- `.github/workflows/pr-gate.yml`
- `.github/workflows/_quality-gate.yml`
- `.github/workflows/main-post-merge.yml`
- `.github/workflows/codeql.yml`
- `.github/workflows/dev-fast-ci.yml`
- `.github/workflows/release.yml`
- `.github/workflows/publish-images.yml`

## What Should Block Merge

Only the PR gate should be configured as the required branch-protection check set for `main`.

Recommended required check targets:

- `PR Gate / Quality Gate / Lint (pull_request)`
- `PR Gate / Quality Gate / Test Backend (pull_request)`
- `PR Gate / Quality Gate / Test Frontend (pull_request)`
- `PR Gate / Quality Gate / Security Scan (pull_request)`
- `PR Gate / Quality Gate / E2E Smoke (pull_request)`

Optional later additions after the first successful CodeQL PR runs:

- the real reported CodeQL PR job checks, such as the Go and JavaScript TypeScript analysis jobs

Why:

- `PR Gate` is the main admission gate for code entering `main`
- it runs lint, tests, security fast checks, and e2e smoke
- it avoids using post-merge or release-only checks as pre-merge blockers
- GitHub branch protection must reference the real job-level checks reported by workflows, not abstract wrapper names like `PR Gate` or `Quality Gate`

Do not set these as required checks unless matching workflows are actually reporting them:

- `PR Gate`
- `Quality Gate`
- `Code scanning results`

## Developer Branch Fast CI

`Dev Fast CI` is intended for personal development branches and excludes `main`.

It is useful for early feedback, but it is not a merge-governance layer and should not replace the PR gate.

Recommended use:

- run lightweight lint, backend/frontend tests, and fast security checks on `push -> non-main branches`
- do not treat `Dev Fast CI` as a required check for `main`
- do not use it as a substitute for PR review or branch protection

## What Should Not Block Merge

`Main Post-Merge` should validate the merged result, but it should not be the primary merge gate.

In the current design:

- `Build Production Image` is a blocking post-merge health signal for `main`
- `Advisory Image Security` is informative and should not redefine main-branch health on its own

If `Main Post-Merge` fails:

- treat `Quality Gate` or image-build failures as urgent main-health issues
- treat advisory scan failures as triage items unless policy says otherwise

## Recommended GitHub Settings For `main`

Enable:

- Require a pull request before merging
- Require status checks to pass before merging
- Require branches to be up to date before merging
- Require conversation resolution before merging
- Restrict direct pushes to `main`
- Allow auto-merge only after required checks and approvals pass

Recommended manual settings outside the repository:

- set the five PR job checks listed above as required status checks
- after the first successful CodeQL runs, optionally add the real reported CodeQL PR check names if you want source security scanning to block merges
- require at least one human approval when the repository has more than one active maintainer
- add CODEOWNERS later for sensitive areas such as workflows, release logic, and runtime bootstrapping

## How To Treat AI In Branch Protection

AI review may help summarize and pre-screen PRs, but branch protection should still rely on:

- required CI checks
- human approvals
- repository permissions

Do not treat AI comments or AI merge suggestions as equivalent to a required approval.

## Release Layer

Release workflows are not part of the merge gate.

- `Release` validates tags, generates release artifacts, and creates a draft release
- `Publish Images` runs only after a release is published

This separation avoids using release-specific work as a daily development bottleneck.

## Current Code Scanning State

There is a dedicated repository-managed CodeQL workflow in `.github/workflows/codeql.yml`.

What exists right now:

- `CodeQL` runs for `pull_request -> main`
- `CodeQL` runs for `push -> main`
- `Main Post-Merge` runs an advisory Trivy image scan
- the Trivy SARIF report is uploaded to GitHub Security using `github/codeql-action/upload-sarif@v3`
- the Trivy SARIF upload happens after pushes to `main`, not as a PR gate

What this means operationally:

- PRs to `main` now produce dedicated CodeQL checks and code scanning results
- pushes to `main` continue to refresh the default-branch code scanning baseline
- branch protection should use the real CodeQL job check names after they appear, not the generic label `Code scanning results`
- Trivy image scanning remains a post-merge image-security signal, not a source-code scanning gate

Recommended interpretation:

- CodeQL is the source-code security layer
- Trivy image scanning is the post-merge image-security layer
- these are complementary and should not be treated as the same check type