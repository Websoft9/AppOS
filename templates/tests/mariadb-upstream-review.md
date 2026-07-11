## MariaDB Upstream Review Baseline

Use this checklist when the upstream MariaDB source changes.

Reference:

- `templates/upstream/mariadb/source.json`
- `templates/adapters/mariadb.json`
- `templates/apps/mariadb/`

Review categories:

- service shape changed
  - `mariadb` service added/removed/renamed
- image or tag changed
  - upstream image source, edition, or version behavior changed
- env surface changed
  - new `W9_*` or `MARIADB_*` variables added, removed, or reclassified
- publish semantics changed
  - exposed port (TCP 3306), protocol assumptions, `healthcheck.sh` healthcheck, or charset command changed
- storage behavior changed
  - `/var/lib/mysql` data mount changed
- network behavior changed
  - network name, external network expectation, or connectivity assumptions changed
- metadata changed
  - supported versions or documented requirements changed

Expected result of review:

- classify the change as blocking, warning, or no-impact
- update `templates/adapters/mariadb.json` if adaptation intent changed
- update `templates/apps/mariadb/` if normalized contract meaning changed
- update `templates/tests/mariadb.expected.json` only when the normalized contract intentionally changes
