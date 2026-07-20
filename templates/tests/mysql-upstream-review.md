## MySQL Upstream Review Baseline

Use this checklist when the upstream MySQL source changes.

Reference:

- `templates/upstream/mysql/source.json`
- `templates/adapters/mysql.json`
- `templates/apps/mysql/`

Review categories:

- service shape changed
  - `mysql` service added/removed/renamed
- image or tag changed
  - upstream image source, edition, or version behavior changed
- env surface changed
  - new `W9_*` or `MYSQL_*` variables added, removed, or reclassified
- publish semantics changed
  - exposed port (TCP 3306), protocol assumptions, `mysqladmin ping` healthcheck, or charset command changed
- storage behavior changed
  - `/var/lib/mysql` data mount changed
- network behavior changed
  - network name, external network expectation, or connectivity assumptions changed
- metadata changed
  - supported versions or documented requirements changed

Expected result of review:

- classify the change as blocking, warning, or no-impact
- update `templates/adapters/mysql.json` if adaptation intent changed
- update `templates/apps/mysql/` if normalized contract meaning changed
- update `templates/tests/mysql.expected.json` only when the normalized contract intentionally changes
