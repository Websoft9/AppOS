## WordPress Upstream Review Baseline

Use this checklist when the upstream WordPress source changes.

Reference:

- `templates/upstream/wordpress/source.json`
- `templates/adapters/wordpress.json`
- `templates/apps/wordpress/`

Review categories:

- service shape changed
  - `wordpress`, `mysql`, or `init` added/removed/renamed
- image or tag changed
  - upstream image source or version behavior changed
- env surface changed
  - new `W9_*` or `WORDPRESS_*` variables added, removed, or reclassified
- publish semantics changed
  - exposed ports, protocol assumptions, or URL behavior changed
- storage behavior changed
  - data mounts or config mounts changed
- network behavior changed
  - network name, external network expectation, or connectivity assumptions changed
- init behavior changed
  - bootstrap logic, sidecar behavior, or helper container semantics changed
- metadata changed
  - supported versions or documented requirements changed

Expected result of review:

- classify the change as blocking, warning, or no-impact
- update `templates/adapters/wordpress.json` if adaptation intent changed
- update `templates/apps/wordpress/` if normalized contract meaning changed
- update `templates/tests/wordpress.expected.json` only when the normalized contract intentionally changes
