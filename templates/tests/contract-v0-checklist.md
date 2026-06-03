## Contract v0 Checklist

Use this checklist when validating one normalized template under `templates/apps/<key>/`.

### Blocking checks

- required files exist: `manifest.json`, `inputs.schema.json`, `render.json`, `source.json`
- each required JSON file parses successfully
- `manifest.json` contains: `contractVersion`, `key`, `name`, `trademark`, `capabilities`, `requirements`, `versions`
- `inputs.schema.json` contains a `fields` array
- each input field has: `key`, `type`, `label`, `required`, `visibility`, `storage_mode`
- input keys are unique within the template
- `storage_mode` values are limited to `system_managed`, `operator_editable`, `secret_backed`
- `visibility` values are limited to `system`, `basic`, `advanced`
- `render.json` contains at least one of: `env`, `compose_values`, `files`, `exposure`
- `source.json` contains: `origin_kind`, `origin_ref`, `template_revision`, `adapter_version`

### Warning checks

- service role mapping appears ambiguous or missing a likely `primary`
- newly introduced secret-like variables appear outside `secret_backed` inputs
- exposure intent conflicts with declared capabilities
- adapter metadata and normalized template disagree on primary service or publish kind
- upstream source metadata exists but semantic review has not been refreshed after an upstream update

### Render sanity checks

- env placeholders are either intentional template placeholders or resolvable through ingress layers
- compose values align with declared service roles
- exposure target matches a declared service and expected target port
- defaults do not collapse secret-backed values into plaintext output by mistake
