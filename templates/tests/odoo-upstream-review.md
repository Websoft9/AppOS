## Odoo Upstream Review Baseline

Use this checklist when the upstream Odoo source changes.

Reference:

- `templates/upstream/odoo/source.json`
- `templates/adapters/odoo.json`
- `templates/apps/odoo/`

Review categories:

- service shape changed
  - `odoo` or `postgresql` added/removed/renamed
- image or tag changed
  - upstream image source or version behavior changed
- env surface changed
  - new `W9_*`, `HOST`, `USER`, `PASSWORD`, or PostgreSQL variables added, removed, or reclassified
- publish semantics changed
  - exposed ports, protocol assumptions, or URL behavior changed
- storage behavior changed
  - data mounts, config mounts, or addon mounts changed
- network behavior changed
  - network name, external network expectation, or connectivity assumptions changed
- metadata changed
  - supported versions or documented requirements changed

Expected result of review:

- classify the change as blocking, warning, or no-impact
- update `templates/adapters/odoo.json` if adaptation intent changed
- update `templates/apps/odoo/` if normalized contract meaning changed
- update `templates/tests/odoo.expected.json` only when the normalized contract intentionally changes
