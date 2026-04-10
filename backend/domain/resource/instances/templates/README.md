# Instance Templates

- Each subfolder name must equal one `kind`.
- `kind` is the canonical resource identity and must use product-family naming.
- `Category` is navigation-only grouping and must never replace `kind`.
- `template_id` is a profile inside one `kind` only.
- Profiles inherit only from the local `_template.json` of the same `kind`.
- Do not add category-level profiles such as `custom_database`.
- Keep canonical instance fields out of template `fields`: `name`, `endpoint`, `credential`, and `description` belong to the shared instance model.
- Product UI may split canonical fields for usability, for example `endpoint` into `host` + `port`, but templates should still treat them as canonical model fields.
- Put only kind-specific, non-canonical config in template `fields`; sensitive auth should stay relation-based through `credential`, not inline template password fields.
- When the frontend injects common product-family fields, templates may hide one with `omitCommonFields`, for example `"omitCommonFields": ["username"]`.