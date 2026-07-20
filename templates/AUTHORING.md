# AppOS Application Template Authoring Guide

This guide captures the explicit rules for authoring a normalized AppOS application
template under `templates/apps/<key>/`. It is derived from the existing samples
(`odoo`, `wordpress`, `metabase`) and the validator in
`templates/tests/validate_templates.py`.

Read this before creating or editing any template. The goal is that a new template
can be produced without reverse-engineering the rules out of existing samples.

## Layer boundaries (do not collapse)

See `templates/README.md`. This guide only covers the **template source layer**:

- `templates/apps/<key>/` — the normalized reusable template (what you author)
- `templates/upstream/<key>/` — preserved upstream identity/metadata
- `templates/adapters/<key>.json` — adaptation decisions and review intent
- `templates/tests/<key>.expected.json` — regression baseline for the normalized shape

These are **not** instance declarations and **not** runtime workspaces.

## Required files (per template)

A complete template contribution creates all of the following:

```
templates/apps/<key>/
  manifest.json          # identity, capabilities, versions, service roles
  inputs.schema.json     # operator/system input fields
  render.json            # env mapping, compose values, exposures
  source.json            # provenance
  compose/base.yml       # docker compose shape (W9_* placeholders)
  env/defaults.env       # illustrative default env values
  README.md              # scope + constraints note
templates/upstream/<key>/
  source.json            # upstream identity
  README.md
templates/adapters/<key>.json
templates/tests/<key>.expected.json
templates/tests/examples/<key>.values.json
templates/tests/<key>-upstream-review.md
```

`contractVersion` is `"0.1"` in every contract file.

## Naming and placeholder conventions

- **Template key** = lowercase app name, must match the directory name and
  `manifest.key`. `manifest.name` is the same string.
- **`W9_*` env keys** are the normalized runtime variable surface consumed by
  `compose/base.yml`. Common keys: `W9_ID`, `W9_REPO`, `W9_DIST`, `W9_VERSION`,
  `W9_HTTP_PORT` (container port), `W9_HTTP_PORT_SET` (host port), `W9_URL`,
  `W9_DB_EXPOSE`, `W9_DB_VERSION`, `W9_NETWORK`.
- **Placeholders inside `render.json` values** (all resolved at render time):
  - `${<input_key>}` — value from an `inputs.schema.json` field (e.g. `${app_id}`, `${version}`)
  - `${secret:<input_key>}` — resolved from a `secret_backed` input; never a literal
  - `${platform.network}` — control-plane injected network name (always used for `W9_NETWORK`)
- **Derived identity**: database host is `${app_id}-<dbservice>` (e.g. `${app_id}-postgresql`).
  The container name of the primary service is `${W9_ID}`; sidecars are `${W9_ID}-<role>`.

## File-by-file rules

### manifest.json

Required keys (validator-enforced): `contractVersion`, `key`, `name`, `trademark`,
`capabilities`, `requirements`, `versions`. Also include `category`, `docs`, `serviceRoles`.

- `trademark` — proper brand casing (e.g. `Metabase`).
- `category` — short lowercase domain tag (`erp`, `cms`, `analytics`, ...).
- `docs` — `website`, `installRequirements`, `upstream`.
- `capabilities` — booleans: `web`, `requiresDomain`, `hasBuiltinDatabase`, `supportsPublish`.
- `requirements` — `cpu`, `memoryGb`, `diskGb` (honest minimums; JVM apps need more memory).
- `versions` — `default` `{edition, version}` plus a `supported` array. `edition` is a
  free tag describing the distribution (`community`, `oss`, ...). Version tags may be
  illustrative; note this in the README.
- `serviceRoles` — maps every compose service to a role. Exactly one `primary`. Use
  `database` for the app DB, and other descriptive roles (`init`, `cache`, ...) as needed.

### inputs.schema.json

`{ contractVersion, fields: [...] }`. Each field requires (validator-enforced):
`key`, `type`, `label`, `required`, `visibility`, `storage_mode`. Field keys must be unique.

- `visibility` ∈ `system` | `basic` | `advanced`
- `storage_mode` ∈ `system_managed` | `operator_editable` | `secret_backed`
- `type` — descriptive: `string`, `select` (add `options`), `port`, `domain`, `secret_ref`.

Baseline field set (present in all samples, keep this order as the convention):

1. `app_id` — `string`, `system` / `system_managed`, default = template key
2. `version` — `select` / `operator_editable`, options mirror `manifest.versions.supported`
3. `http_port` — `port` / `operator_editable`, host port default
4. `site_url` — `domain` / `operator_editable`, `advanced`, not required
5. `db_password` — `secret_ref` / `secret_backed`, default `null`

Add app-specific fields (e.g. wordpress `admin_path`) after the baseline as needed.

### render.json

Requires `contractVersion` and at least one of `env`, `compose_values`, `files`, `exposures`.

- **`env`** — object of string→string. Every value is a string. Use placeholders as
  defined above. This maps normalized `W9_*` and app-native env vars to input/secret sources.
  Reuse one secret across multiple vars where upstream requires it (e.g. metabase feeds
  `db_password` to both `MB_DB_PASS` and `POSTGRES_PASSWORD`).
- **`compose_values`** — `{ primaryService, databaseService }`, both matching
  `serviceRoles`.
- **`exposures`** — array; each entry: `label`, `service`, `port`, `protocol`
  (optional `default`). No other keys allowed. `service`/`protocol`/`port` triples must
  be unique. **At most one** entry may have `default: true`.

### source.json (in apps/)

Requires: `contractVersion`, `origin_kind`, `origin_ref`, `template_revision`,
`adapter_version`. Convention: `origin_kind: "official"`, `origin_ref` = authoritative
upstream URL, `template_revision: "v0-initial"`, `adapter_version: "v0"`, plus a
`compatibility` block.

### compose/base.yml

Docker Compose using only `${W9_*}` / app-native env placeholders (values come from
`env/defaults.env` locally and from `render.json` at render time).

- Primary service `container_name: ${W9_ID}`, published as `${W9_HTTP_PORT_SET}:<containerPort>`.
- Sidecars named `${W9_ID}-<role>`.
- Persist stateful data with named volumes; include upstream-recommended `healthcheck`
  and special mounts (e.g. metabase `/dev/urandom:/dev/random:ro`) when documented.
- Network block must be:
  ```yaml
  networks:
    default:
      name: ${W9_NETWORK}
      external: true
  ```

### env/defaults.env

Flat `KEY=VALUE` illustrative defaults for local rendering/preview. Do **not** put secret
values here (omit `*_PASSWORD` / secret vars).

### upstream/<key>/ and adapters/<key>.json

- `upstream/<key>/source.json` — `originKind`, `sourceRepo`, `sourcePath`, `sourceBranch`,
  `observedFiles`, `references`, `notes`.
- `adapters/<key>.json` — `templateKey`, `upstreamRef`, `normalizedTemplateRef`,
  `adapterVersion`, `automaticNormalization`, `reviewRequired`, `currentDecisions`
  (`primaryService`, `databaseService`, `publishKind`, `secretBackedInputs`), `notes`.

### tests baselines

- `<key>.expected.json` — the regression contract. The validator checks: `requiredFiles`
  exist; selected `manifest` values; input `fieldKeys` order, `secretBacked`,
  `systemManaged`; `render.exposures` equality; `primaryService`/`databaseService`;
  `secretRefs` (derived from `${secret:...}` in render env); source mapping; adapter
  `primaryService`/`publishKind`. Keep it in sync intentionally, never loosely.
- `examples/<key>.values.json` — sample operator override values.
- `<key>-upstream-review.md` — semantic review checklist for upstream changes.

## Authoring workflow

1. Read this guide and pick the closest existing sample as a structural reference
   (single-service, app+SQL DB, etc.).
2. Gather the upstream truth: official image, recommended compose, env vars, ports,
   volumes, healthcheck. Record it in `upstream/<key>/`.
3. Decide adaptation: primary service, database service, publish kind, which inputs are
   secret-backed. Record in `adapters/<key>.json`.
4. Author `manifest.json` → `inputs.schema.json` → `render.json` → `compose/base.yml`
   → `env/defaults.env` → `source.json` → `README.md`.
5. Write the regression baseline `tests/<key>.expected.json` and `examples/<key>.values.json`
   and `tests/<key>-upstream-review.md`.
6. Validate until green:
   ```bash
   python3 templates/tests/validate_templates.py <key>
   python3 templates/tests/validate_templates.py   # full suite, no regressions
   ```

A template is done only when `validate_templates.py` prints `OK <key>` and the full suite
still passes.

## Invariants checklist

- [ ] Directory name = `manifest.key` = `manifest.name`
- [ ] Exactly one `primary` in `serviceRoles`; `compose_values` match it
- [ ] Every compose service has a `serviceRoles` entry
- [ ] Secrets only via `secret_backed` inputs + `${secret:...}`; never in `env/defaults.env`
- [ ] `render.env` values are all strings; placeholders reference real input keys
- [ ] At most one exposure `default: true`; unique service/protocol/port
- [ ] `contractVersion: "0.1"` in all contract files
- [ ] `validate_templates.py` green for the template and the full suite
