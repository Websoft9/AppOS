# User Prompt

## Dev

1. Code review all code & implementations related to storyx.x
2. Implement storyx.x based on specs/implementation-artifacts/storyx.x-*.md
3. Refactor [package/component] to match [reference file/package]
4. Rename [function/component/file] to [new name] across backend and frontend
5. Diagnose why [feature/page] is broken, trace root cause, and fix it

## Test

1. Run backend tests and fix failures
2. Run frontend tests for [component/page] and fix failures
3. Add an E2E smoke test for [feature/page]
4. Check whether storyx.x acceptance criteria have enough test coverage
5. Run the local CI gate: build, backend tests, frontend tests

## Specs

1. Scan all story files under specs/implementation-artifacts and shorten long filenames to 3 words max, excluding storyx.x
2. After renaming story files, update broken epic and index references
3. Validate storyx.x: acceptance criteria, dependencies, and status
4. Update sprint-status.yaml to match actual story and epic progress
5. Scan for duplicate or overlapping story files and flag conflicts

## Docs

1. Update CHANGELOG.md from recent commits
2. Scan docs for stale references to renamed or deleted APIs/files
3. Summarize all stories in epic x in a compact table

## Build/CI

1. Run the full local CI gate and report failures with file paths
2. Review build warnings and suggest which ones should become errors