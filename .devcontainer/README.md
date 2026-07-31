# Devcontainer CLI Workflow

This directory defines the AppOS development container specification.

It exists for `devcontainer` CLI usage only.

The AppOS workflow does not depend on VS Code "Reopen in Container" or editor-managed lifecycle hooks.

## Source Of Truth

The development container is defined by:

- `.devcontainer/devcontainer.json`
- `.devcontainer/Dockerfile`
- `.devcontainer/bootstrap.sh`

The current setup intentionally uses devcontainer features for the generic toolchain pieces:

- Node.js
- Docker CLI / compose socket workflow

The Dockerfile keeps only the AppOS-specific additions and a small amount of system packaging.

## Rules

- use `devcontainer` CLI or the `make host ...` wrappers on the host
- run project commands inside the development container
- do not treat the host as the project toolchain environment

## Command Flow

Host:

- `make host dev-pull-base`
- `make host dev-build`
- `make host dev-build mirror`
- `make host dev-up`
- `make host dev-shell`
- `make host dev-bootstrap`
- `make host dev-down`

Inside the development container:

- `make build`
- `make test`
- `make test e2e smoke`
- `make test e2e`
- `make qa lint`
- `make start`
- `make run`
- `make opencode`

Inside the development container, project commands stay as plain `make ...` with no extra prefix.

The development container also runs `.devcontainer/bootstrap.sh` automatically on first creation through `postCreateCommand`.

Bootstrap also ensures Playwright Chromium is installed inside the persistent browser cache volume so local browser E2E can run from the development container.

`make host dev-bootstrap` remains available as an explicit host-side wrapper that re-runs the same bootstrap script inside the running development container.

`make host dev-pull-base` is the dedicated base-image preparation step. `make host dev-build` calls it automatically when the base image is missing.

## Mirror Handling

`make host dev-build mirror` switches the package sources used while building the development image.

Mirror mode affects:

- Debian APT sources
- npm registry
- Go module proxy
- pip index URL

It does not handle the development base image pull itself. Base image pulling is handled by `make host dev-pull-base`, which reuses the existing mirror-aware host image pull flow.
