# AppOS 0.1.0

## Docker Tag
- `websoft9/appos:0.1.0`
- `websoft9/appos:v0.1.0`

## Install Command
```bash
mkdir -p appos-release && cd appos-release
curl -fsSLO https://raw.githubusercontent.com/Websoft9/appos/v0.1.0/build/docker-compose.yml
APPOS_SECRET_KEY=<change-me> IMAGE_TAG=0.1.0 docker compose -f docker-compose.yml up -d
```

## Known Issues
- None documented for this release baseline.

## Compatibility Matrix
See `docs/version-compatibility-matrix.md` for the current release compatibility policy.

## Changelog
## [0.1.0] - 2026-04-29

### Features
- Establish standardized version metadata in `version.json` for all Epic 1 release-managed components.
- Add a dedicated GitHub Actions release workflow that validates SemVer tags, generates changelog output, and publishes GitHub Releases.
- Add generated release notes with Docker tags, install command guidance, known issues, and compatibility references.

### Build
- Add local `make version-check` validation for release metadata.

### Documentation
- Add release compatibility matrix and known-issues source documents for release notes.
