# Instance Templates

- Each subfolder name must equal one `kind`.
- `kind` is the canonical resource identity and must use product-family naming.
- `Category` is navigation-only grouping and must never replace `kind`.
- `template_id` is a profile inside one `kind` only.
- Profiles inherit only from the local `_template.json` of the same `kind`.
- Do not add category-level profiles such as `custom_database`.