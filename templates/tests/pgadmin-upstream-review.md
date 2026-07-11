## pgAdmin Upstream Review Baseline

Use this checklist when the upstream pgAdmin source changes.

Reference:

- `templates/upstream/pgadmin/source.json`
- `templates/adapters/pgadmin.json`
- `templates/apps/pgadmin/`

Review categories:

- service shape changed
  - `pgadmin` service added/removed/renamed
- image or tag changed
  - upstream image source, edition, or version behavior changed
- env surface changed
  - new `W9_*` or `PGADMIN_*` variables added, removed, or reclassified
- publish semantics changed
  - exposed port (HTTP 80), protocol assumptions, `/misc/ping` healthcheck, or URL behavior changed
- storage behavior changed
  - `/var/lib/pgadmin` data mount changed
- network behavior changed
  - network name, external network expectation, or connectivity assumptions changed
- metadata changed
  - supported versions or documented requirements changed

Expected result of review:

- classify the change as blocking, warning, or no-impact
- update `templates/adapters/pgadmin.json` if adaptation intent changed
- update `templates/apps/pgadmin/` if normalized contract meaning changed
- update `templates/tests/pgadmin.expected.json` only when the normalized contract intentionally changes
