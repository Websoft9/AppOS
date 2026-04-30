# AI PR Workflow Policy

This document defines how AI should participate in PR creation, review, and merge decisions for this repository.

## Goals

- Speed up routine authoring and review work
- Improve consistency of change summaries and review coverage
- Keep merge authority and release authority under explicit repository controls

## Allowed AI Roles

### 1. PR Authoring Support

AI may help with:

- PR title and summary drafting
- change categorization
- release-note draft text
- test-plan drafting
- reviewer-facing risk summaries

Human expectation:

- The PR author remains responsible for accuracy.
- Generated text must be edited if it is vague, inflated, or inconsistent with the actual diff.

### 2. PR Review Support

AI may help with:

- first-pass diff review
- identifying likely regressions
- spotting missing tests
- flagging API, workflow, or release-surface changes
- summarizing CI results and risk areas

Human expectation:

- AI comments are advisory.
- CODEOWNER-equivalent human review is still required for risky or cross-cutting changes.

### 3. Merge Readiness Support

AI may help by summarizing whether a PR appears merge-ready based on repository rules.

AI may recommend merge only when all of the following are true:

- required PR checks are green
- requested human reviewers have approved
- there are no unresolved review threads
- no required follow-up item is hidden in comments

## Disallowed AI Roles

AI must not:

- bypass required CI or branch protection
- approve its own generated code without human review
- be treated as the sole reviewer for workflow, release, auth, security, migration, or destructive runtime changes
- directly merge to `main` without repository rules explicitly allowing auto-merge after human approval
- treat advisory post-merge findings as if they were release-blocking by default

## Repository-Specific Review Focus

AI review should explicitly check whether a PR changed any of these surfaces:

- GitHub Actions workflows under `.github/workflows/`
- release behavior, tags, release assets, or image publication
- OpenAPI or API route behavior
- container startup, runtime env requirements, or e2e behavior
- installation or bootstrap scripts

If any of those surfaces changed, AI should call them out clearly in the PR summary.

## Recommended Operating Model

Use AI in this order:

1. Draft PR summary and validation notes
2. Produce a first-pass review summary
3. Highlight risky files and missing checks
4. Let humans decide approval and merge

## Merge Authority

Final merge authority stays with:

- branch protection rules
- required status checks
- required human approvals
- repository maintainers

AI is a reviewer-assistant, not a branch-protection substitute.