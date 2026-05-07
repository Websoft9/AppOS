# OpenAPI Maintenance

This directory mixes hand-maintained source files and generated output.

Hand-maintained files:
- group-matrix.yaml: route grouping and coverage rules for generated custom-route docs.
- native-api.yaml: Native PocketBase endpoints only, maintained manually.

Generated files:
- ext-api.yaml: generated from route source and comments.
- api.yaml: merged output of ext-api.yaml + native-api.yaml.

Rules:
- Do not edit ext-api.yaml directly.
- Do not edit api.yaml directly.
- For connector business routes, update route comments and group-matrix.yaml, then regenerate.
- For connector Native Record CRUD endpoints, update native-api.yaml and group-matrix.yaml.

Commands:
- make openapi-gen: regenerate ext-api.yaml.
- make openapi-merge: merge ext-api.yaml and native-api.yaml into api.yaml.
- make openapi-check: validate both directions for generated custom-route docs:
	- every custom route anchor found in route code is present in ext-api.yaml
	- every extSurface entry in group-matrix.yaml has at least one matching generated path in ext-api.yaml after make openapi-gen
- make openapi-sync: generate, merge, and validate in one step.