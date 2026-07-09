## Metabase Upstream Review Baseline

Use this checklist when the upstream Metabase source changes.

Reference:

- `templates/upstream/metabase/source.json`
- `templates/adapters/metabase.json`
- `templates/apps/metabase/`

Review categories:

- service shape changed
  - `metabase` or `postgresql` added/removed/renamed
- image or tag changed
  - upstream image source, edition (OSS vs enterprise), or version behavior changed
- env surface changed
  - new `W9_*`, `MB_DB_*`, or PostgreSQL variables added, removed, or reclassified
- publish semantics changed
  - exposed ports, protocol assumptions, `/api/health` healthcheck, or URL behavior changed
- storage behavior changed
  - application database mounts or PostgreSQL data mounts changed
- network behavior changed
  - network name, external network expectation, or connectivity assumptions changed
- metadata changed
  - supported versions or documented requirements changed

Expected result of review:

- classify the change as blocking, warning, or no-impact
- update `templates/adapters/metabase.json` if adaptation intent changed
- update `templates/apps/metabase/` if normalized contract meaning changed
- update `templates/tests/metabase.expected.json` only when the normalized contract intentionally changes
