# Development Container

AppOS development now uses a Docker-first development container.

The development container is defined by:

- `build/Dockerfile.dev`
- `build/docker-compose.dev.yml`
- `build/dev/bootstrap.sh`

`build/Dockerfile.dev` currently uses a Microsoft Go development image as its base OS/toolchain layer, but the workflow does not depend on VS Code devcontainer features or editor-managed initialization.

The old VS Code `.devcontainer` flow has been retired.

## Purpose

The development container is the default environment for:

- editing code
- running `make build`, `make test`, `make qa`, and `make openapi-sync`
- running `make opencode`
- using project tooling without installing Go, Node, Python, or security tools on the host

It is not the AppOS runtime image.

## Startup Flow

First use:

1. `make dev-build`
2. `make dev-up`
3. `make dev-bootstrap`
4. `make dev-shell`

Daily use:

1. `make dev-up`
2. `make dev-shell`
3. edit code and run project commands inside the container
4. `make dev-bootstrap` only when dependencies changed or the workspace is incomplete

Host responsibility is intentionally small:

- start the development container
- store the repository checkout
- provide the Docker daemon

Project development commands should run inside the development container, not directly on the host.

## Rebuild Policy

The development container should not be rebuilt for normal code changes.

Rebuild it only when one of these changes:

- `build/Dockerfile.dev`
- the baked-in tool versions
- the base image

Application code changes, `go.mod` changes, and npm lockfile changes do not require rebuilding the container image.

## Bootstrap Policy

`build/dev/bootstrap.sh` is intentionally separate from image build.

It performs workspace synchronization only:

- `backend/go.mod` → `go mod download`
- `web/package-lock.json` → `npm ci` when needed
- `tests/package-lock.json` → `npm ci` when needed

Bootstrap is idempotent and records lockfile hashes under `.cache/dev-bootstrap/`.

This keeps the container image stable while still allowing the workspace dependencies to track source changes.

## Runtime Boundary

The development container does not run AppOS runtime services.

It only provides the toolchain and Docker CLI access.

The host Docker daemon starts:

- the AppOS runtime container from `build/Dockerfile`
- the local external test dependency containers from `tests/env/docker-compose.yml`

## What Is Inside The Development Container

- Go 1.26
- Node.js
- Python 3
- Docker CLI
- `golangci-lint`
- `actionlint`
- `govulncheck`
- `gitleaks`
- `syft`
- `opencode`
- `qodo`

## What Stays Outside

- Redis runtime service
- VictoriaMetrics runtime service
- Traefik runtime service
- AppOS runtime process tree

Those belong to the runtime container, not to the development container.
