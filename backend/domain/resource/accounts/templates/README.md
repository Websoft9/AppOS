# Provider Account Templates

This folder is organized by provider-account kind.

- Each subfolder maps to one `kind`, such as `aws`, `github`, or `cloudflare`.
- `_template.json` defines the shared base shape for that kind.
- Profile files define reusable account-scope templates for that kind.

Keep profiles sparse. Put shared fields in `_template.json`, and use profile files only for scope-specific labels, help text, and defaults.