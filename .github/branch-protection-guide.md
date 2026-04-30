# Branch Protection And CI Roles

This repository uses three CI layers with different responsibilities:

- `PR Gate`: the pre-merge blocking gate for `main`
- `Main Post-Merge`: post-merge validation for merge-result health and advisory supply-chain checks
- `Release`: tag-based release preparation and draft release creation

Related workflows:

- `.github/workflows/pr-gate.yml`
- `.github/workflows/main-post-merge.yml`
- `.github/workflows/release.yml`
- `.github/workflows/publish-images.yml`

## What Should Block Merge

Only the PR gate should be configured as the required branch-protection check for `main`.

Recommended required check target:

- workflow: `PR Gate`
- job: `Quality Gate`

Why:

- It is the main admission gate for code entering `main`.
- It runs lint, tests, security fast checks, and e2e smoke.
- It avoids using post-merge or release-only checks as pre-merge blockers.

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

- set `PR Gate / Quality Gate` as a required status check
- require at least one human approval
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