
.PHONY: help install tidy build run test test-strict test-fast lint lint-strict lint-fast fmt fmt-strict fmt-fast check check-fast sec sec-strict sec-fast artifact-scan \
	backend web backend-targeted fast strict build-local latest dev \
	image start stop restart logs stats delete rm kill-port redo \
	openapi-gen openapi-merge openapi-check openapi-sync

# ============================================================
# Default values
# ============================================================
CONTAINER := appos
COMPOSE_FILE := build/docker-compose.yml
COMPOSE_CMD := cd build && docker compose

# Support positional args: make kill-port 9091
ARG2 := $(word 2,$(MAKECMDGOALS))
ARG3 := $(word 3,$(MAKECMDGOALS))
QUALITY_MODE := $(if $(filter fast,$(ARG2) $(ARG3)),fast,strict)
QUALITY_SCOPE := $(firstword $(filter-out fast,$(ARG2) $(ARG3)))
GITLEAKS_ARGS := $(if $(CI),--redact,--no-git --redact)
GOLANGCI_LINT_BIN ?= golangci-lint
GOVULNCHECK_BIN ?= govulncheck
GITLEAKS_BIN ?= gitleaks
ACTIONLINT_BIN ?= actionlint
GITLEAKS_REPORT_PATH ?= build/reports/gitleaks-report.json
GO_BIN_DIR := $(shell GOBIN="$$(go env GOBIN)"; if [ -n "$$GOBIN" ]; then printf '%s' "$$GOBIN"; else printf '%s/bin' "$$(go env GOPATH)"; fi)
DEFAULT_GOLANGCI_LINT_BIN := $(GO_BIN_DIR)/golangci-lint
DEFAULT_GOVULNCHECK_BIN := $(GO_BIN_DIR)/govulncheck
DEFAULT_ACTIONLINT_BIN := $(GO_BIN_DIR)/actionlint

# ============================================================
# Help
# ============================================================
help:
	@echo ""
	@printf "\033[1mAppOS Development Commands\033[0m\n"
	@echo "=============================="
	@echo ""
	@printf "\033[36mDev:\033[0m\n"
	@echo "  make install              Install dev dependencies (Go tools, build-essential, npm packages)"
	@echo "  make tidy                 Tidy Go modules"
	@echo "  make build                Build all (backend + web)"
	@echo "  make build backend        Build Go binaries → backend/appos + backend/appos-agent"
	@echo "  make build web            Build React app → web/dist"
	@echo "  make run                  Copy artifacts + restart services (~10s)"
	@echo "  make run 9092             Copy artifacts + restart on custom port"
	@echo "  make redo                 Full rebuild: rm volumes + build + image + start dev"
	@echo ""
	@printf "\033[36mTesting & Quality:\033[0m\n"
	@echo "  make test                 Run strict tests (Go + JS + E2E smoke, stop early)"
	@echo "  make test fast            Run faster tests (Go + JS, no E2E)"
	@echo "  make test backend         Run strict backend Go tests from backend/"
	@echo "  make test backend fast    Run faster backend Go tests from backend/"
	@echo "  make test web            Run web tests from web/"
	@echo "  make test backend-targeted Run backend routes/secrets/migrations test set"
	@echo "  make test e2e            Run the full end-to-end suite entrypoint"
	@echo "  make test e2e fast       Run the smoke E2E suite"
	@echo "  make lint                 Run strict linters (golangci-lint, actionlint, eslint, web typecheck)"
	@echo "  make lint fast            Run advisory/fast lint mode"
	@echo "  make fmt                  Format code in strict mode"
	@echo "  make fmt fast             Format code in tolerant/fast mode"
	@echo "  make check                Run strict quality checks (lint + fmt + openapi-check + test), stop at first error"
	@echo "  make check fast           Run faster quality check flow"
	@echo "  make version-check        Validate Git tag version metadata or print current git-derived version"
	@echo ""
	@printf "\033[36mOpenAPI:\033[0m\n"
	@echo "  make openapi-gen          Auto-generate OpenAPI spec skeleton from route source"
	@echo "  make openapi-merge        Merge ext-api.yaml + native-api.yaml -> api.yaml"
	@echo "  make openapi-check        Validate code->spec coverage and group-matrix generated anchors"
	@echo "  make openapi-sync         Generate + validate OpenAPI in one command"
	@echo ""
	@printf "\033[36mSecurity & Artifacts:\033[0m\n"
	@echo "  make sec                  Run strict source security scan (govulncheck, npm audit, gitleaks, trivy config)"
	@echo "  make sec fast             Run advisory/fast security scan"
	@echo "  make artifact-scan        Generate SBOM and scan the built image (syft + trivy)"
	@echo ""
	@printf "\033[36mBuild Image:\033[0m\n"
	@echo "  make image build          Build production image (multi-stage Dockerfile)"
	@echo "  make image build-local    Build dev image (Dockerfile.local, pre-built artifacts)"
	@echo ""
	@printf "\033[36mContainer Management:\033[0m\n"
	@echo "  make start                Start container (interactive: choose image & port)"
	@echo "  make start dev            Start with dev image (skip interactive)"
	@echo "  make start latest         Start with latest image (skip interactive)"
	@echo "  make stop                 Stop container"
	@echo "  make restart              Restart container"
	@echo "  make logs                 View container logs (follow mode)"
	@echo "  make stats                Show all services status inside container"
	@echo "  make delete               Stop and remove container (keeps volumes)"
	@echo "  make rm                   Force remove container and volumes"
	@echo ""
	@printf "\033[36mUtilities:\033[0m\n"
	@echo "  make kill-port 9091       Kill process using port"
	@echo "  make help                 Show this help"
	@echo ""

# ============================================================
# Dev
# ============================================================
install:
	@echo "Checking environment..."
	@# Check golang
	@if ! command -v go >/dev/null 2>&1; then \
		echo "✗ Error: Go is not installed. Install from https://go.dev/dl/"; \
		exit 1; \
	fi
	@echo "✓ Go $(shell go version | awk '{print $$3}')";
	@# Check Node.js
	@if ! command -v node >/dev/null 2>&1; then \
		echo "✗ Error: Node.js is not installed. Install from https://nodejs.org/"; \
		exit 1; \
	fi
	@echo "✓ Node.js $(shell node -v)";
	@# Check Docker
	@if ! command -v docker >/dev/null 2>&1; then \
		echo "✗ Error: Docker is not installed. Install from https://docs.docker.com/get-docker/"; \
		exit 1; \
	fi
	@echo "✓ Docker $(shell docker --version | awk '{print $$3}' | tr -d ',')";
	@# Check gcc (build-essential)
	@if ! command -v gcc >/dev/null 2>&1; then \
		echo "→ Installing build-essential..."; \
		sudo apt-get update && sudo apt-get install -y build-essential || { \
			echo "✗ Error: Failed to install build-essential. Run manually: sudo apt install build-essential"; \
			exit 1; \
		}; \
	fi
	@echo "✓ gcc $(shell gcc --version | head -1 | awk '{print $$NF}')";
	@echo ""
	@echo "Installing dev dependencies..."
	@if [ -f "backend/go.mod" ]; then \
		echo "→ Go modules..."; \
		cd backend && go mod download; \
	fi
	@if [ -f "web/package.json" ]; then \
		echo "→ npm packages..."; \
		cd web && npm install; \
	fi
	@echo "✓ Dependencies installed"
	@echo ""
	@echo "Installing Node.js CLI tools..."
	@# Qodo CLI is published on npm as @qodo/command (provides the `qodo` binary)
	@if ! command -v qodo >/dev/null 2>&1; then \
		echo "→ qodo..."; \
		npm install -g @qodo/command; \
	else \
		echo "✓ qodo already installed"; \
	fi
	@echo "✓ Node.js CLI tools installed"
	@echo ""
	@echo "Installing Go tooling..."
	@# golangci-lint
	@if [ ! -x "$(DEFAULT_GOLANGCI_LINT_BIN)" ] && ! command -v golangci-lint >/dev/null 2>&1; then \
		echo "→ golangci-lint..."; \
		go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest; \
	else \
		echo "✓ golangci-lint already installed"; \
	fi
	@if [ ! -x "$(DEFAULT_ACTIONLINT_BIN)" ] && ! command -v actionlint >/dev/null 2>&1; then \
		echo "→ actionlint..."; \
		go install github.com/rhysd/actionlint/cmd/actionlint@latest; \
	else \
		echo "✓ actionlint already installed"; \
	fi
	@echo "✓ Go tooling installed to $(GO_BIN_DIR)"
	@echo ""
	@echo "Installing security tools..."
	@# govulncheck
	@if [ ! -x "$(DEFAULT_GOVULNCHECK_BIN)" ] && ! command -v govulncheck >/dev/null 2>&1; then \
		echo "→ govulncheck..."; \
		go install golang.org/x/vuln/cmd/govulncheck@latest; \
	else \
		echo "✓ govulncheck already installed"; \
	fi
	@# gitleaks
	@if ! command -v gitleaks >/dev/null 2>&1; then \
		echo "→ gitleaks..."; \
		GLVER=$$(curl -s https://api.github.com/repos/gitleaks/gitleaks/releases/latest | grep '"tag_name"' | cut -d '"' -f 4 | tr -d 'v'); \
		ARCH=$$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/'); \
		curl -sSfL "https://github.com/gitleaks/gitleaks/releases/latest/download/gitleaks_$${GLVER}_linux_$${ARCH}.tar.gz" | tar xz -C /tmp gitleaks; \
		sudo mv /tmp/gitleaks /usr/local/bin/gitleaks; \
	else \
		echo "✓ gitleaks already installed"; \
	fi
	@# syft (SBOM)
	@if ! command -v syft >/dev/null 2>&1; then \
		echo "→ syft..."; \
		curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sudo sh -s -- -b /usr/local/bin; \
	else \
		echo "✓ syft already installed"; \
	fi
	@echo "✓ Security tools installed"

tidy:
	@echo "Tidying Go modules..."
	@cd backend && go mod tidy
	@echo "✓ Go modules tidied"

build:
ifeq ($(ARG2),backend)
	@echo "Building backend binaries (static, no dependencies)..."
	@$(MAKE) openapi-sync
	@cd backend && CGO_ENABLED=0 go build -ldflags="-w -s" -o appos ./cmd/appos
	@cd backend && CGO_ENABLED=0 go build -ldflags="-w -s" -o appos-agent ./cmd/appos-agent
	@echo "✓ Backend built → backend/appos + backend/appos-agent (statically linked)"
else ifeq ($(ARG2),web)
	@echo "Building web app..."
	@cd web && npm run build
	@echo "✓ Web app built → web/dist/"
else ifeq ($(ARG2),library)
	@echo "'make build library' is no longer needed - library is downloaded during Docker build (cached)"
else
	@echo "Building all..."
	@$(MAKE) openapi-sync
	@cd backend && CGO_ENABLED=0 go build -ldflags="-w -s" -o appos ./cmd/appos
	@cd backend && CGO_ENABLED=0 go build -ldflags="-w -s" -o appos-agent ./cmd/appos-agent
	@echo "✓ Backend built → backend/appos + backend/appos-agent"
	@cd web && npm run build
	@echo "✓ Web app built → web/dist/"
	@echo "✓ All built"
endif

redo:
	@echo "Full rebuild: removing container + volumes, then building and restarting..."
	@docker rm -f $$(docker ps -aq --filter name=$(CONTAINER)) 2>/dev/null || true
	@$(COMPOSE_CMD) down --timeout 5 -v 2>/dev/null || true
	@echo "✓ Container and volumes removed"
	@$(MAKE) build
	@$(MAKE) image build-local
	@$(MAKE) start dev
	@sleep 3
	@docker exec $(CONTAINER) supervisorctl -c /etc/supervisor/supervisord.conf restart appos 2>/dev/null || true
	@sleep 2
	@echo "✓ Services restarted (migrations applied)"

run:
	@echo "Hot reload: copying pre-built artifacts..."
	@docker cp backend/appos $(CONTAINER):/usr/local/bin/appos
	@docker cp backend/appos-agent $(CONTAINER):/usr/local/bin/appos-agent
	@docker cp web/dist/. $(CONTAINER):/usr/share/nginx/html/web/
	@docker cp build/nginx.conf $(CONTAINER):/etc/nginx/nginx.conf
	@docker exec $(CONTAINER) nginx -t
	@docker exec $(CONTAINER) supervisorctl -c /etc/supervisor/supervisord.conf restart appos nginx
	@echo "✓ Hot reload complete"
	@echo "  → http://127.0.0.1:$(PORT_EFFECTIVE)/"

# ============================================================
# Testing & Quality
# ============================================================
test:
ifeq ($(QUALITY_SCOPE),backend)
	@echo "Running backend tests ($(QUALITY_MODE))..."
ifeq ($(QUALITY_MODE),fast)
	@cd backend && go test ./... -v
else
	@cd backend && for pkg in $$(go list ./...); do \
		echo "   - $$pkg"; \
		log_file=$$(mktemp); \
		go test $$pkg -v >"$$log_file" 2>&1; \
		status=$$?; \
		cat "$$log_file"; \
		if [ "$$status" -ne 0 ]; then \
			fail_summary=$$(grep '^--- FAIL:' "$$log_file" || true); \
			echo "✗ Backend tests failed in package: $$pkg"; \
			if [ -n "$$fail_summary" ]; then \
				echo "Fail summary:"; \
				printf '%s\n' "$$fail_summary"; \
			fi; \
			rm -f "$$log_file"; \
			exit 1; \
		fi; \
		rm -f "$$log_file"; \
	 done
endif
	@echo "✓ Backend tests completed"
else ifeq ($(QUALITY_SCOPE),web)
	@echo "Running web tests..."
	@cd web && log_file=$$(mktemp); \
		NO_COLOR=1 npm test >"$$log_file" 2>&1; \
		status=$$?; \
		cat "$$log_file"; \
		if [ "$$status" -ne 0 ]; then \
			fail_summary=$$(grep -E '^ FAIL |^ × ' "$$log_file" || true); \
			echo "✗ Web tests failed"; \
			if [ -n "$$fail_summary" ]; then \
				echo "Fail summary:"; \
				printf '%s\n' "$$fail_summary"; \
			fi; \
			rm -f "$$log_file"; \
			exit 1; \
		fi; \
		rm -f "$$log_file"
	@echo "✓ Web tests completed"
else ifeq ($(QUALITY_SCOPE),backend-targeted)
	@echo "Running targeted backend tests..."
	@cd backend && go test ./domain/routes ./domain/secrets ./infra/migrations -v
	@echo "✓ Targeted backend tests completed"
else ifeq ($(QUALITY_SCOPE),e2e)
ifeq ($(QUALITY_MODE),fast)
	@echo "Running E2E smoke suite..."
	@bash tests/e2e/container-smoke.sh
	@bash tests/e2e/setup-status.sh
	@echo "✓ E2E smoke suite completed"
else
	@echo "Running full E2E suite..."
	@$(MAKE) test e2e fast
	@echo "✓ Full E2E suite completed"
endif
else
	@echo "Running tests ($(QUALITY_MODE))..."
ifeq ($(QUALITY_MODE),fast)
	@if [ -f "backend/go.mod" ]; then \
		echo "→ Go tests..."; \
		cd backend && go test ./... -v; \
	fi
	@if [ -f "web/package.json" ]; then \
		echo "→ JS tests..."; \
		cd web && npm test 2>/dev/null; \
	fi
	@echo "→ E2E skipped in fast mode"
else
	@if [ -f "backend/go.mod" ]; then \
		echo "→ Go tests (package-by-package)..."; \
		cd backend && for pkg in $$(go list ./...); do \
			echo "   - $$pkg"; \
			log_file=$$(mktemp); \
			go test $$pkg -v >"$$log_file" 2>&1; \
			status=$$?; \
			cat "$$log_file"; \
			if [ "$$status" -ne 0 ]; then \
				fail_summary=$$(grep '^--- FAIL:' "$$log_file" || true); \
				echo "✗ Backend tests failed in package: $$pkg"; \
				if [ -n "$$fail_summary" ]; then \
					echo "Fail summary:"; \
					printf '%s\n' "$$fail_summary"; \
				fi; \
				rm -f "$$log_file"; \
				exit 1; \
			fi; \
			rm -f "$$log_file"; \
		done; \
	fi
	@if [ -f "web/package.json" ]; then \
		echo "→ JS tests..."; \
		cd web && log_file=$$(mktemp); \
		NO_COLOR=1 npm test >"$$log_file" 2>&1; \
		status=$$?; \
		cat "$$log_file"; \
		if [ "$$status" -ne 0 ]; then \
			fail_summary=$$(grep -E '^ FAIL |^ × ' "$$log_file" || true); \
			echo "✗ Web tests failed"; \
			if [ -n "$$fail_summary" ]; then \
				echo "Fail summary:"; \
				printf '%s\n' "$$fail_summary"; \
			fi; \
			rm -f "$$log_file"; \
			exit 1; \
		fi; \
		rm -f "$$log_file"; \
	fi
	@echo "→ E2E smoke tests..."
	@$(MAKE) test e2e fast
endif
	@echo "✓ Tests completed"
endif

test-strict:
	@$(MAKE) test

test-fast:
	@$(MAKE) test fast

lint:
	@echo "Running linters ($(QUALITY_MODE))..."
ifeq ($(QUALITY_MODE),fast)
	@if [ -x "$(GOLANGCI_LINT_BIN)" ] || command -v "$(GOLANGCI_LINT_BIN)" >/dev/null 2>&1; then \
		echo "→ golangci-lint..."; \
		cd backend && "$(GOLANGCI_LINT_BIN)" run --config ../.golangci.yml ./... || true; \
	else \
		echo "→ go vet (golangci-lint not installed)..."; \
		cd backend && go vet ./... || true; \
	fi
	@if [ -d ".github/workflows" ]; then \
		actionlint_bin="$(ACTIONLINT_BIN)"; \
		if ! [ -x "$$actionlint_bin" ] && ! command -v "$$actionlint_bin" >/dev/null 2>&1 && [ -x "$(DEFAULT_ACTIONLINT_BIN)" ]; then \
			actionlint_bin="$(DEFAULT_ACTIONLINT_BIN)"; \
		fi; \
		if [ -x "$$actionlint_bin" ] || command -v "$$actionlint_bin" >/dev/null 2>&1; then \
			echo "→ actionlint..."; \
			"$$actionlint_bin" || true; \
		else \
			echo "→ actionlint skipped (not installed)..."; \
		fi; \
	fi
	@if [ -f "web/node_modules/.bin/eslint" ]; then \
		echo "→ eslint..."; \
		cd web && npx eslint src/ || true; \
	fi
	@if [ -f "web/package.json" ]; then \
		echo "→ web typecheck..."; \
		cd web && npm run typecheck || true; \
	fi
else
	@if [ -x "$(GOLANGCI_LINT_BIN)" ] || command -v "$(GOLANGCI_LINT_BIN)" >/dev/null 2>&1 || [ -x "$(DEFAULT_GOLANGCI_LINT_BIN)" ]; then \
		echo "→ golangci-lint..."; \
		lint_bin="$(GOLANGCI_LINT_BIN)"; \
		if ! [ -x "$$lint_bin" ] && ! command -v "$$lint_bin" >/dev/null 2>&1; then \
			lint_bin="$(DEFAULT_GOLANGCI_LINT_BIN)"; \
		fi; \
		cd backend && "$$lint_bin" run --config ../.golangci.yml ./...; \
	else \
		echo "✗ golangci-lint is required for strict lint mode."; \
		echo "  Expected binary at $(DEFAULT_GOLANGCI_LINT_BIN) or on PATH."; \
		echo "  Install it with 'make install' or run 'make lint fast' for advisory fallback mode."; \
		exit 1; \
	fi
	@if [ -d ".github/workflows" ]; then \
		actionlint_bin="$(ACTIONLINT_BIN)"; \
		if ! [ -x "$$actionlint_bin" ] && ! command -v "$$actionlint_bin" >/dev/null 2>&1; then \
			actionlint_bin="$(DEFAULT_ACTIONLINT_BIN)"; \
		fi; \
		if [ -x "$$actionlint_bin" ] || command -v "$$actionlint_bin" >/dev/null 2>&1; then \
			echo "→ actionlint..."; \
			"$$actionlint_bin"; \
		else \
			echo "✗ actionlint is required for strict lint mode."; \
			echo "  Expected binary at $(DEFAULT_ACTIONLINT_BIN) or on PATH."; \
			echo "  Install it with 'make install' or run 'make lint fast' for advisory fallback mode."; \
			exit 1; \
		fi; \
	fi
	@if [ -f "web/node_modules/.bin/eslint" ]; then \
		echo "→ eslint..."; \
		cd web && npx eslint src/; \
	fi
	@if [ -f "web/package.json" ]; then \
		echo "→ web typecheck..."; \
		cd web && npm run typecheck; \
	fi
endif
	@echo "✓ Linting completed"

lint-strict:
	@$(MAKE) lint

lint-fast:
	@$(MAKE) lint fast

fmt:
	@echo "Formatting code ($(QUALITY_MODE))..."
	@if [ -f "backend/go.mod" ]; then \
		echo "→ gofmt..."; \
		find backend -name "*.go" -exec gofmt -w {} +; \
	fi
ifeq ($(QUALITY_MODE),fast)
	@if [ -f "web/node_modules/.bin/prettier" ]; then \
		echo "→ prettier..."; \
		cd web && npx prettier --write "src/**/*.{ts,tsx,css,json}" 2>/dev/null || true; \
	fi
else
	@if [ -f "web/node_modules/.bin/prettier" ]; then \
		echo "→ prettier..."; \
		cd web && npx prettier --write "src/**/*.{ts,tsx,css,json}" 2>/dev/null; \
	fi
endif
	@echo "✓ Code formatted"

fmt-strict:
	@$(MAKE) fmt

fmt-fast:
	@$(MAKE) fmt fast

check:
	@set -e; \
	echo "Running full check ($(QUALITY_MODE), stop at first error)..."; \
	$(MAKE) lint $(if $(filter fast,$(QUALITY_MODE)),fast,) || { echo "✗ check failed at: lint"; exit 1; }; \
	$(MAKE) fmt $(if $(filter fast,$(QUALITY_MODE)),fast,) || { echo "✗ check failed at: fmt"; exit 1; }; \
	$(MAKE) openapi-check || { echo "✗ check failed at: openapi-check"; exit 1; }; \
	$(MAKE) test $(if $(filter fast,$(QUALITY_MODE)),fast,) || { echo "✗ check failed at: test"; exit 1; }; \
	echo "✓ Check completed"

check-fast:
	@$(MAKE) check fast

openapi-gen:
	@echo "Generating OpenAPI custom-route spec from route source..."
	@cd backend && go run ./cmd/openapi gen
	@echo "→ spec: backend/docs/openapi/ext-api.yaml"

openapi-merge:
	@echo "Merging OpenAPI specs (custom routes + native)..."
	@cd backend && go run ./cmd/openapi merge
	@echo "→ spec: backend/docs/openapi/api.yaml"

openapi-check:
	@echo "Checking OpenAPI coverage and group-matrix generated anchors..."
	@cd backend && go test ./domain/routes/ -run 'TestAll(CustomRoutesCoveredByOpenAPISpec|MatrixExtSurfacesHaveGeneratedSpecAnchors)' -v

openapi-sync:
	@echo "Syncing OpenAPI spec (generate + merge + validate)..."
	@$(MAKE) openapi-gen
	@$(MAKE) openapi-merge
	@$(MAKE) openapi-check
	@echo "✓ OpenAPI sync completed"


version-check:
	@echo "Validating version metadata..."
	@node .github/scripts/validate-version.mjs
	@echo "✓ Version metadata valid"

# ============================================================
# Security
# ============================================================
sec:
ifeq ($(QUALITY_MODE),fast)
	@echo "Running security checks (fast)..."
	@echo "→ govulncheck (Go CVE scan)..."
	@if [ -x "$(GOVULNCHECK_BIN)" ] || command -v "$(GOVULNCHECK_BIN)" >/dev/null 2>&1 || [ -x "$(DEFAULT_GOVULNCHECK_BIN)" ]; then \
		govuln_bin="$(GOVULNCHECK_BIN)"; \
		if ! [ -x "$$govuln_bin" ] && ! command -v "$$govuln_bin" >/dev/null 2>&1; then \
			govuln_bin="$(DEFAULT_GOVULNCHECK_BIN)"; \
		fi; \
		cd backend && "$$govuln_bin" ./... || true; \
	else \
		echo "  ⚠ govulncheck not installed. Run 'make install' first."; \
	fi
	@echo ""
	@echo "→ npm audit (JS CVE scan, high+critical only)..."
	@if [ -f "web/package.json" ]; then \
		cd web && npm audit --audit-level=high 2>/dev/null || true; \
	fi
	@echo ""
	@echo "→ gitleaks (secret / credential leak detection)..."
	@# Note: --no-git scans working directory files only.
	@# CI uses full git history (fetch-depth: 0) for broader coverage.
	@# To scan local git history too: gitleaks detect --source . --redact
	@if [ -x "$(GITLEAKS_BIN)" ] || command -v "$(GITLEAKS_BIN)" >/dev/null 2>&1; then \
		report_path="$(GITLEAKS_REPORT_PATH)"; \
		mkdir -p "$$(dirname "$$report_path")"; \
		set +e; \
		"$(GITLEAKS_BIN)" detect --source . $(GITLEAKS_ARGS) --report-format json --report-path "$$report_path"; \
		status=$$?; \
		set -e; \
		if [ "$$status" -eq 1 ]; then \
			echo "  ⚠ gitleaks found potential secret leaks. Report: $$report_path"; \
		elif [ "$$status" -ne 0 ]; then \
			echo "✗ gitleaks execution failed (exit $$status)."; \
			exit $$status; \
		fi; \
	else \
		echo "  ⚠ gitleaks not installed. Run 'make install' first."; \
	fi
	@echo ""
	@echo "→ trivy config (IaC / Docker / workflow misconfiguration scan)..."
	@if ! command -v docker >/dev/null 2>&1; then \
		echo "  ⚠ docker not installed. Skip trivy config scan."; \
	else \
			docker run --rm \
				-v "$$(pwd):/workspace" \
				-w /workspace \
				aquasec/trivy:latest config \
				--skip-check-update \
				--skip-version-check \
				--timeout 10m \
				--severity HIGH,CRITICAL \
				--exit-code 0 \
				/workspace/build || true; \
	fi
	@echo "✓ Security checks completed"

else
	@echo "Running security checks (strict)..."
	@echo "→ govulncheck (Go CVE scan)..."
	@if [ -x "$(GOVULNCHECK_BIN)" ] || command -v "$(GOVULNCHECK_BIN)" >/dev/null 2>&1 || [ -x "$(DEFAULT_GOVULNCHECK_BIN)" ]; then \
		govuln_bin="$(GOVULNCHECK_BIN)"; \
		if ! [ -x "$$govuln_bin" ] && ! command -v "$$govuln_bin" >/dev/null 2>&1; then \
			govuln_bin="$(DEFAULT_GOVULNCHECK_BIN)"; \
		fi; \
		cd backend && "$$govuln_bin" ./...; \
	else \
		echo "✗ govulncheck not installed. Run 'make install' first."; \
		exit 1; \
	fi
	@echo ""
	@echo "→ npm audit (JS CVE scan, high+critical only)..."
	@if [ -f "web/package.json" ]; then \
		cd web && npm audit --audit-level=high 2>/dev/null; \
	fi
	@echo ""
	@echo "→ gitleaks (secret / credential leak detection)..."
	@if [ -x "$(GITLEAKS_BIN)" ] || command -v "$(GITLEAKS_BIN)" >/dev/null 2>&1; then \
		report_path="$(GITLEAKS_REPORT_PATH)"; \
		mkdir -p "$$(dirname "$$report_path")"; \
		set +e; \
		"$(GITLEAKS_BIN)" detect --source . $(GITLEAKS_ARGS) --report-format json --report-path "$$report_path"; \
		status=$$?; \
		set -e; \
		if [ "$$status" -eq 1 ]; then \
			echo "  ⚠ gitleaks found potential secret leaks. Report: $$report_path"; \
		elif [ "$$status" -ne 0 ]; then \
			echo "✗ gitleaks execution failed (exit $$status)."; \
			exit $$status; \
		fi; \
	else \
		echo "✗ gitleaks not installed. Run 'make install' first."; \
		exit 1; \
	fi
	@echo ""
	@echo "→ trivy config (IaC / Docker / workflow misconfiguration scan)..."
	@if ! command -v docker >/dev/null 2>&1; then \
		echo "✗ docker is required for trivy config scan."; \
		exit 1; \
	else \
			docker run --rm \
				-v "$$(pwd):/workspace" \
				-w /workspace \
				aquasec/trivy:latest config \
				--skip-check-update \
				--skip-version-check \
				--timeout 10m \
				--severity HIGH,CRITICAL \
				--exit-code 1 \
				/workspace/build; \
	fi
	@echo "✓ Security checks completed"
endif

sec-strict:
	@$(MAKE) sec

sec-fast:
	@$(MAKE) sec fast

artifact-scan:
	@echo "Generating Software Bill of Materials (SBOM)..."
	@if ! command -v syft >/dev/null 2>&1; then \
		echo "✗ syft not installed. Run 'make install' first."; exit 1; \
	fi
	@syft dir:backend dir:web/src -o spdx-json > sbom.spdx.json
	@echo "✓ SBOM generated → sbom.spdx.json"
	@wc -l sbom.spdx.json | awk '{print "  Lines: " $$1}'
	@echo ""
	@echo "Scanning container image for vulnerabilities (HIGH/CRITICAL)..."
	@if ! docker image inspect websoft9dev/appos:latest >/dev/null 2>&1; then \
		echo "✗ Image websoft9dev/appos:latest not found. Run 'make image build' first."; exit 1; \
	fi
	docker run --rm \
		-v /var/run/docker.sock:/var/run/docker.sock \
		aquasec/trivy:latest image \
		--severity HIGH,CRITICAL \
		--exit-code 0 \
		websoft9dev/appos:latest
	@echo "✓ Image scan completed"

# ============================================================
# Build Image
# ============================================================
image:
ifeq ($(ARG2),build)
  ifeq ($(ARG3),)
	@echo "Building production image (multi-stage)..."
	docker build -f build/Dockerfile -t websoft9dev/appos:latest .
	@echo "✓ Image built: websoft9dev/appos:latest"
	@docker images websoft9dev/appos:latest --format "  Size: {{.Size}}"
  else
	@echo "Unknown image subcommand: $(ARG3)"
	@echo "Usage: make image build | make image build-local"
  endif
else ifeq ($(ARG2),build-local)
	@echo "Building dev image (pre-built artifacts)..."
	@# Verify artifacts exist
	@test -f backend/appos || { echo "Error: backend/appos not found. Run 'make build backend' first."; exit 1; }
	@test -f backend/appos-agent || { echo "Error: backend/appos-agent not found. Run 'make build backend' first."; exit 1; }
	@test -d web/dist || { echo "Error: web/dist/ not found. Run 'make build web' first."; exit 1; }
	@# Pass host proxy into build (replace 127.0.0.1 with host-gateway for container access)
	$(eval HOST_PROXY := $(shell \
		P=$${all_proxy:-$${ALL_PROXY:-$${http_proxy:-$${HTTP_PROXY:-}}}}; \
		if [ -n "$$P" ]; then \
			echo "$$(echo $$P | sed 's/127\.0\.0\.1/host-gateway/g;s/localhost/host-gateway/g')"; \
		fi))
	$(eval PROXY_ARGS := $(if $(HOST_PROXY),--add-host=host-gateway:host-gateway --build-arg ALL_PROXY=$(HOST_PROXY),))
	docker build $(PROXY_ARGS) -f build/Dockerfile.local -t websoft9dev/appos:dev .
	@echo "✓ Dev image built: websoft9dev/appos:dev"
	@docker images websoft9dev/appos:dev --format "  Size: {{.Size}}"
else
	@echo "Usage: make image build | make image build-local"
endif

# ============================================================
# Container Management
# ============================================================
start:
	@if [ "$(ARG2)" = "dev" ] || [ "$(ARG2)" = "latest" ]; then \
		IMAGE_TAG=$(ARG2); \
		PORT=9091; \
	elif [ -t 0 ]; then \
		echo ""; \
		printf "\033[1mSelect image to start:\033[0m\n"; \
		echo "  1) websoft9/appos:latest  (Production build)"; \
		echo "  2) websoft9/appos:dev     (Development build)"; \
		printf "\nChoice [1]: "; \
		read choice; \
		choice=$${choice:-1}; \
		if [ "$$choice" = "2" ]; then \
			IMAGE_TAG=dev; \
		else \
			IMAGE_TAG=latest; \
		fi; \
		printf "\nPort [9091]: "; \
		read port; \
		PORT=$${port:-9091}; \
	else \
		echo "Non-interactive mode: using latest image on port 9091"; \
		IMAGE_TAG=latest; \
		PORT=9091; \
	fi; \
	echo ""; \
	echo "Starting AppOS ($$IMAGE_TAG) on port $$PORT..."; \
	cd build && HTTP_PORT=$$PORT IMAGE_TAG=$$IMAGE_TAG docker compose up -d; \
	sleep 1; \
	STATUS=$$(docker inspect --format '{{.State.Status}}' $(CONTAINER) 2>/dev/null); \
	if [ "$$STATUS" = "created" ]; then \
		echo "⚠ Container stuck in Created state, attempting forced start..."; \
		docker start $(CONTAINER) || { \
			echo "✗ Failed to start container. Logs:"; \
			docker logs $(CONTAINER) 2>&1 | tail -20; \
			exit 1; \
		}; \
	fi; \
	echo "✓ AppOS started"; \
	echo "  Image: websoft9/appos:$$IMAGE_TAG"; \
	echo "  → http://127.0.0.1:$$PORT/"

stop:
	@echo "Stopping AppOS..."
	@$(COMPOSE_CMD) stop 2>/dev/null || echo "Container not running"
	@echo "✓ Stopped"

restart:
	@echo "Restarting AppOS..."
	@$(COMPOSE_CMD) restart 2>/dev/null || echo "Container not found"
	@echo "✓ Restarted"

logs:
	@$(COMPOSE_CMD) logs -f

stats:
	@echo "Services status inside container:"
	@echo ""
	@if docker exec $(CONTAINER) supervisorctl -c /etc/supervisor/supervisord.conf status 2>&1 | grep -q "RUNNING\|STOPPED\|FATAL\|STARTING\|BACKOFF\|EXITED"; then \
		docker exec $(CONTAINER) supervisorctl -c /etc/supervisor/supervisord.conf status 2>/dev/null || true; \
	else \
		echo "✗ Error: Container '$(CONTAINER)' not running or supervisord not available"; \
		exit 1; \
	fi
	@echo ""
	@echo "Tip: Use 'make logs' to view detailed logs"

delete:
	@echo "Stopping and removing container (keeping volumes)..."
	@$(COMPOSE_CMD) down 2>/dev/null || true
	@echo "✓ Container removed (volumes preserved)"

rm:
	@echo "⚠ This will remove the container AND all data volumes."
	@read -p "Continue? [y/N] " confirm; \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		docker rm -f $$(docker ps -aq --filter name=$(CONTAINER)) 2>/dev/null || true; \
		$(COMPOSE_CMD) down --timeout 5 -v 2>/dev/null || true; \
		echo "✓ Container and volumes removed"; \
	else \
		echo "Cancelled."; \
	fi

# ============================================================
# Utilities
# ============================================================
kill-port:
ifeq ($(strip $(PORT_EFFECTIVE)),)
	$(error PORT is required. Usage: make kill-port 9091)
endif
	@echo "Killing process on port $(PORT_EFFECTIVE)..."
	@if command -v fuser >/dev/null 2>&1; then \
		fuser -k $(PORT_EFFECTIVE)/tcp 2>/dev/null || echo "No process found on port $(PORT_EFFECTIVE)"; \
	elif command -v lsof >/dev/null 2>&1; then \
		PID=$$(lsof -t -i:$(PORT_EFFECTIVE) 2>/dev/null); \
		if [ -n "$$PID" ]; then \
			kill -9 $$PID && echo "Process $$PID killed"; \
		else \
			echo "No process found on port $(PORT_EFFECTIVE)"; \
		fi; \
	else \
		echo "Error: fuser or lsof required"; exit 1; \
	fi

backend web backend-targeted fast strict build-local latest dev:
	@:

# Swallow positional args (e.g., make start 9092, make build backend)
%:
	@:
