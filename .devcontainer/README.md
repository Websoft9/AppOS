# DevContainer

This folder defines the AppOS development workspace container.

## Purpose

The devcontainer is the default environment for:

- editing code
- running `make install`, `make build`, `make test`, `make qa`, and `make openapi-sync`
- using project tooling without installing Go, Node, or linters on the host

The devcontainer is not the AppOS runtime image.

## First Use

After opening the repository on the remote host:

1. Run `Dev Containers: Reopen in Container`.
2. Wait for the initial container build to finish.
3. Wait for `postCreateCommand` to finish.
4. In the devcontainer terminal, verify the main tools:
`go version`
`node -v`
`docker version`
`opencode --version`
5. Start normal work from inside the devcontainer.

The initial setup installs project dependencies and makes the `opencode` command available inside the devcontainer.

## What Runs Where

### Devcontainer

Use the devcontainer for:

- source code edits
- dependency installation
- linting and tests
- backend and frontend builds
- Docker commands that operate on the host Docker daemon

### Runtime Container

Use the runtime container for:

- manual UI verification
- runtime smoke tests
- staging / RC / release validation

The runtime container is built from `build/Dockerfile`.

## Remote Host Workflow

Typical setup:

1. Open the repository on the remote host in VS Code through Remote SSH.
2. Run `Dev Containers: Reopen in Container`.
3. VS Code builds `.devcontainer/Dockerfile` on the remote host.
4. The repository is mounted into the devcontainer as the working directory.
5. `postCreateCommand` runs `make install`.
6. `postCreateCommand` installs `opencode` if it is not already present.
7. After startup, use the integrated terminal inside the devcontainer.

## Source Mounting

The repository is bind-mounted into the devcontainer.

That means:

- file edits made in the devcontainer change the real repository on the remote host
- code changes are visible immediately inside the container
- changing application code does not require rebuilding the devcontainer

## When To Rebuild The Devcontainer

Rebuild the devcontainer only when the environment definition changes, for example:

- `.devcontainer/Dockerfile`
- `.devcontainer/devcontainer.json`
- devcontainer features
- base language or system tool versions

Do not rebuild the devcontainer just because application code changed.

## After Code Changes

Typical flow after editing code:

1. Run `make build` or a narrower target such as `make build backend`.
2. Run tests such as `make test backend` or `make test web`.
3. If you need to update the running AppOS container, run `make run`.

Typical daily flow:

1. Open the repository in the devcontainer.
2. Edit code.
3. Run `make build`, `make test`, or `make qa lint` as needed.
4. Run `make start latest` once if the runtime container is not up yet.
5. Run `make run` to copy rebuilt artifacts into the runtime container.
6. Open the AppOS UI through the forwarded runtime port.
7. Use `make opencode` when you want the agent to run inside the devcontainer.

`make run` updates the separate AppOS runtime container. It does not rebuild the devcontainer.

## Docker Boundary

The devcontainer uses Docker access to control containers on the host.

This means the host Docker daemon starts:

- the AppOS runtime container
- test dependency containers from `tests/env/docker-compose.yml`

These services do not run inside the devcontainer itself.

## Current Scope

The current devcontainer is intentionally minimal.

Included:

- Go 1.26.5
- Node.js 22
- `bash`, `make`, `git`, `curl`, `gcc`, `sudo`
- project dependencies and developer tooling installed by `make install`
- `opencode` CLI

Not included by default:

- Redis, Traefik, VictoriaMetrics runtime services
- Playwright browser dependencies
- Python-based template tooling
- editor-specific extension configuration

## Current Gaps

The current setup is intentionally limited to the main development path.

- `make tl ...` is not ready yet because Python is not installed in the devcontainer
- browser E2E is not ready yet because Playwright system dependencies are not installed in the devcontainer
