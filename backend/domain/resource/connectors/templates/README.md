# Connector Templates

This folder is organized by connector kind.

- Each subfolder maps to one `kind`, such as `llm`, `smtp`, or `registry`.
- `_template.json` defines the shared base shape for that kind.
- `generic-*.json` files define reusable default profiles for the kind.
- vendor or platform profile files such as `openai.json` or `ghcr.json` only override what differs from the base.

Keep profiles sparse. Put shared fields in `_template.json`, keep generic defaults in the generic profile, and let vendor profiles only carry vendor-specific endpoint, aliases, and field overrides.