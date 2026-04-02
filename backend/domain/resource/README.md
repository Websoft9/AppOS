# Resource Namespace

This directory is a code namespace, not a domain boundary.

The actual domain boundaries are the child directories under it.

- `control/`: resource access, connection, and control capabilities.
- `organization/`: resource references, grouping, relationships, and collaboration-oriented organization.

Rules:

- Do not treat `resource/` itself as a bounded context, aggregate root, or domain service container.
- Put code under the child directory that owns the business meaning.
- If a package only lives here because it is "resource-related" but does not fit `control/` or `organization/`, that is a modeling smell and should be revisited.