# Changelog

All notable changes to this project will be documented in this file.

This file is generated from Conventional Commits during the release workflow.

## [0.1.0] - 2026-04-29

### Features
- Establish Git tags as the canonical release version source for Epic 1 release-managed components.
- Add a dedicated GitHub Actions release workflow that validates SemVer tags, generates changelog output, and publishes GitHub Releases.
- Add generated release notes with Docker tags, install command guidance, known issues, and compatibility references.

### Build
- Add local `make version-check` validation for release tags and git-derived version metadata.

### Documentation
- Add release compatibility matrix and known-issues source documents for release notes.
