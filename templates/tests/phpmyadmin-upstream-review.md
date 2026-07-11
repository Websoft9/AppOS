## phpMyAdmin Upstream Review Baseline

Use this checklist when the upstream phpMyAdmin source changes.

Reference:

- `templates/upstream/phpmyadmin/source.json`
- `templates/adapters/phpmyadmin.json`
- `templates/apps/phpmyadmin/`

Review categories:

- service shape changed
  - `phpmyadmin` service added/removed/renamed
- image or tag changed
  - upstream image source, edition, or version behavior changed
- env surface changed
  - new `W9_*` or `PMA_*` variables (PMA_ARBITRARY, PMA_HOST, PMA_PORT, UPLOAD_LIMIT) added, removed, or reclassified
- publish semantics changed
  - exposed port (HTTP 80), protocol assumptions, healthcheck, or URL behavior changed
- storage behavior changed
  - any newly required persistent mount introduced (currently stateless)
- network behavior changed
  - network name, external network expectation, or connectivity assumptions changed
- metadata changed
  - supported versions or documented requirements changed

Expected result of review:

- classify the change as blocking, warning, or no-impact
- update `templates/adapters/phpmyadmin.json` if adaptation intent changed
- update `templates/apps/phpmyadmin/` if normalized contract meaning changed
- update `templates/tests/phpmyadmin.expected.json` only when the normalized contract intentionally changes
