# Version Compatibility Matrix

## Scope

This document defines the release compatibility policy for tag-driven AppOS releases.

## Rules

- The Git tag is the single source of truth for each release version and must follow `v<semver>`.
- Release channels are derived from the tag: plain SemVer tags are `stable`, prerelease tags like `-rc.1` are `preview`.
- Compatibility notes, if needed, must be recorded in this document or the release notes.
- Minor or major divergence between components must be documented here before release publication.

## Current Matrix

| AppOS Release | Channel | Compatibility Note |
| --- | --- | --- |
| v0.1.0 | stable | Initial normalized Epic 1 release baseline |

## Maintainer Workflow

1. Prepare the release commit on `main`.
2. Update this matrix only if a compatibility note is needed for the upcoming release.
3. Push a Git tag that matches `v<semver>`.
4. Allow `.github/workflows/release.yml` to generate `CHANGELOG.md` and publish release notes.
