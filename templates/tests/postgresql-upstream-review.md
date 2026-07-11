## PostgreSQL Upstream Review Baseline

Use this checklist when the upstream PostgreSQL source changes.

Reference:

- `templates/upstream/postgresql/source.json`
- `templates/adapters/postgresql.json`
- `templates/apps/postgresql/`

Review categories:

- service shape changed
  - `postgresql` service added/removed/renamed, or the reference backup sidecar behavior changed
- image or tag changed
  - upstream image source, edition, or version behavior changed
- env surface changed
  - new `W9_*` or `POSTGRES_*` variables added, removed, or reclassified; `PGDATA` path changed
- publish semantics changed
  - exposed port (TCP 5432), protocol assumptions, or `pg_isready` healthcheck changed
- storage behavior changed
  - `/var/lib/postgresql/data` data mount or `PGDATA` subdirectory changed
- network behavior changed
  - network name, external network expectation, or connectivity assumptions changed
- metadata changed
  - supported versions or documented requirements changed

Expected result of review:

- classify the change as blocking, warning, or no-impact
- update `templates/adapters/postgresql.json` if adaptation intent changed
- update `templates/apps/postgresql/` if normalized contract meaning changed
- update `templates/tests/postgresql.expected.json` only when the normalized contract intentionally changes
