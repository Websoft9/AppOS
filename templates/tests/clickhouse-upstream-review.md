## ClickHouse Upstream Review Baseline

Use this checklist when the upstream ClickHouse source changes.

Reference:

- `templates/upstream/clickhouse/source.json`
- `templates/adapters/clickhouse.json`
- `templates/apps/clickhouse/`

Review categories:

- service shape changed
  - `clickhouse` service added/removed/renamed, or a sidecar (e.g. keeper) introduced
- image or tag changed
  - upstream image source, edition, or version behavior changed
- env surface changed
  - new `W9_*` or `CLICKHOUSE_*` variables added, removed, or reclassified
- publish semantics changed
  - exposed ports (HTTP 8123, native 9000), protocol assumptions, `/ping` healthcheck, or URL behavior changed
- storage behavior changed
  - `/var/lib/clickhouse` data mount, `/var/log/clickhouse-server` log mount, or config/user config mounts changed
- runtime behavior changed
  - `ulimit nofile`, `cap_add` (SYS_NICE), or default-user access management expectations changed
- network behavior changed
  - network name, external network expectation, or connectivity assumptions changed
- metadata changed
  - supported versions or documented requirements changed

Expected result of review:

- classify the change as blocking, warning, or no-impact
- update `templates/adapters/clickhouse.json` if adaptation intent changed
- update `templates/apps/clickhouse/` if normalized contract meaning changed
- update `templates/tests/clickhouse.expected.json` only when the normalized contract intentionally changes
