ARG DEVCONTAINER_BASE_IMAGE=mcr.microsoft.com/devcontainers/go:1.26-bookworm
FROM ${DEVCONTAINER_BASE_IMAGE}

ARG APT_MIRROR
ARG APT_SECURITY_MIRROR
ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org
ARG PIP_INDEX_URL=https://pypi.org/simple

ENV GOPROXY=${GOPROXY} \
  GOSUMDB=${GOSUMDB} \
  PIP_INDEX_URL=${PIP_INDEX_URL}

ARG GOLANGCI_LINT_VERSION=v2.5.0
ARG OPENCODE_VERSION=1.17.18

RUN set -eux; \
  if [ -n "${APT_MIRROR}" ]; then \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -ri "s|https?://deb.debian.org/debian|${APT_MIRROR}|g; s|https?://security.debian.org/debian-security|${APT_SECURITY_MIRROR:-${APT_MIRROR}}|g" /etc/apt/sources.list.d/debian.sources; \
    fi; \
    if [ -f /etc/apt/sources.list ]; then \
      sed -ri "s|https?://deb.debian.org/debian|${APT_MIRROR}|g; s|https?://security.debian.org/debian-security|${APT_SECURITY_MIRROR:-${APT_MIRROR}}|g" /etc/apt/sources.list; \
    fi; \
  fi; \
  apt-get update && apt-get install -y --no-install-recommends nodejs npm && rm -rf /var/lib/apt/lists/*

RUN GOBIN=/usr/local/bin go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@${GOLANGCI_LINT_VERSION}

RUN GOBIN=/usr/local/bin go install github.com/rhysd/actionlint/cmd/actionlint@latest

RUN GOBIN=/usr/local/bin go install golang.org/x/vuln/cmd/govulncheck@latest

RUN GOBIN=/usr/local/bin go install github.com/zricethezav/gitleaks/v8@latest

ENV DISABLE_TELEMETRY=1 \
  DO_NOT_TRACK=1

WORKDIR /workspace

CMD ["sleep", "infinity"]
