## Template Validation Samples

This folder contains the first validation and regression baseline for Epic 32.

It is intentionally small. The goal is to make template work reviewable before a full validator or CI pipeline exists.

Validation layers in v0:

1. contract validation
2. render validation
3. sample regression validation
4. upstream change review

Current sample target:

- `wordpress`
- `odoo`

Current artifacts:

- `contract-v0-checklist.md`: minimum blocking checks and warning checks
- `wordpress.expected.json`: expected normalized shape for the sample template
- `odoo.expected.json`: expected normalized shape for the sample template
- `wordpress-upstream-review.md`: semantic review categories for upstream updates
- `odoo-upstream-review.md`: semantic review categories for upstream updates

This folder now contains a minimal executable validator plus review baselines. It is still a small v0 foundation, not a full CI-grade validation system.

Executable baseline:

- `validate_templates.py`: minimal contract and sample-regression validator for `templates/apps/`
- `examples/*.values.json`: sample override values for ingress rendering demos

Usage:

```bash
python3 templates/tests/validate_templates.py
python3 templates/tests/validate_templates.py wordpress
```
