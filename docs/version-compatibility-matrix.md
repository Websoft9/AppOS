# Version Compatibility Matrix

## Scope

This document defines the release compatibility policy for AppOS-managed release metadata in Epic 1.

## Rules

- `core_version` is the canonical release version and must match the Git tag as `v<core_version>`.
- All component versions in `version.json` must follow SemVer.
- A release is considered internally aligned when every component version listed below is explicitly declared for the same release record.
- Minor or major divergence between components must be documented here before release publication.

## Current Matrix

| AppOS Release | core | apphub | deployment | git | proxy | media | library | Compatibility Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.1.0 | 0.1.0 | 0.1.0 | 0.1.0 | 0.1.0 | 0.1.0 | 0.1.0 | 0.1.0 | Initial normalized Epic 1 release baseline |

## Maintainer Workflow

1. Update `version.json`.
2. Update this matrix if any component version diverges from the default aligned baseline.
3. Push a Git tag that matches `v<core_version>`.
4. Allow `.github/workflows/release.yml` to generate `CHANGELOG.md` and publish release notes.
