# Resource Namespace

This directory is a code namespace for operator-managed external resources.

The actual domain boundaries are the child directories under it.

- `server/`: managed server access and runtime control capabilities.
- `tunnel/`: reverse-SSH tunnel runtime and server registration transport.
- `endpoints/`: reusable externally callable service targets such as REST APIs, webhooks, and MCP servers.

Rules:

- Do not treat `resource/` itself as a bounded context, aggregate root, or domain service container.
- Put code under the child directory that owns the business meaning.
- If a package only lives here because it is "resource-related" but does not fit an existing child directory, revisit the model before adding another abstraction layer.