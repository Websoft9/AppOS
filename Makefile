



.PHONY: help install init-env tidy build run test qa gate sec \
	backend web latest test-env image start stop restart logs stats delete rm kill-port redo sync-store tl e2e-browser source artifact \
	e2e runtime smoke pr merge staging release up down \
	_test-backend _test-web _test-e2e-runtime _test-e2e-smoke _test-e2e-acceptance _qa-lint _qa-format _qa-openapi _sec-source _sec-artifact \
	openapi-gen openapi-merge openapi-check openapi-sync opencode opencode-clear

# ============================================================
# Default values
# ============================================================
CONTAINER := appos
COMPOSE_FILE := build/docker-compose.yml
COMPOSE_CMD := cd build && docker compose
TEST_ENV_COMPOSE_FILE := tests/env/docker-compose.yml
TEST_ENV_COMPOSE_CMD := docker compose -f $(TEST_ENV_COMPOSE_FILE)
LOCAL_ENV_DIR := .environments
LOCAL_ENV_FILE := $(LOCAL_ENV_DIR)/local.env
LOCAL_ENV_TEMPLATE := $(LOCAL_ENV_DIR)/local.env.example
TEST_ENV_IMAGES := linuxserver/openssh-server:latest mysql:8.4 postgres:16-alpine axllent/mailpit:latest

# Support positional args: make kill-port 9091
ARG2 := $(word 2,$(MAKECMDGOALS))
ARG3 := $(word 3,$(MAKECMDGOALS))
ARG4 := $(word 4,$(MAKECMDGOALS))
GITLEAKS_ARGS := --no-git --redact
GOLANGCI_LINT_BIN ?= golangci-lint
GOVULNCHECK_BIN ?= govulncheck
GITLEAKS_BIN ?= gitleaks
ACTIONLINT_BIN ?= actionlint
GITLEAKS_REPORT_PATH ?= build/reports/gitleaks-report.json
TRIVY_CACHE_DIR ?= $(HOME)/.cache/trivy
GO_BIN_DIR := $(shell GOBIN="$$(go env GOBIN)"; if [ -n "$$GOBIN" ]; then printf '%s' "$$GOBIN"; else printf '%s/bin' "$$(go env GOPATH)"; fi)
DEFAULT_GOLANGCI_LINT_BIN := $(GO_BIN_DIR)/golangci-lint
DEFAULT_GOVULNCHECK_BIN := $(GO_BIN_DIR)/govulncheck
DEFAULT_ACTIONLINT_BIN := $(GO_BIN_DIR)/actionlint
IMAGE_PULL_MIRRORS_URL ?= https://artifact.websoft9.com/websoft9/dev/mirrors.json
IMAGE_PULL_NETWORK_TIMEOUT ?= 5
IMAGE_PULL_MIRROR_RETRIES ?= 2
IMAGE_PULL_MIRROR_TIMEOUT ?= 30

ifeq ($(CI),)
ALL_PROXY :=
HTTP_PROXY :=
HTTPS_PROXY :=
NO_PROXY :=
all_proxy :=
http_proxy :=
https_proxy :=
no_proxy :=
ifneq ($(wildcard $(LOCAL_ENV_FILE)),)
include $(LOCAL_ENV_FILE)
endif
ALL_PROXY := $(strip $(ALL_PROXY))
HTTP_PROXY := $(strip $(HTTP_PROXY))
HTTPS_PROXY := $(strip $(HTTPS_PROXY))
NO_PROXY := $(strip $(NO_PROXY))
all_proxy := $(ALL_PROXY)
http_proxy := $(HTTP_PROXY)
https_proxy := $(HTTPS_PROXY)
no_proxy := $(NO_PROXY)
export ALL_PROXY HTTP_PROXY HTTPS_PROXY NO_PROXY all_proxy http_proxy https_proxy no_proxy
endif

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
	@echo "  make init-env             Create .environments/local.env from template (auto-loaded outside CI)"
	@echo "  make tidy                 Tidy Go modules"
	@echo "  make build                Build all (backend + web)"
	@echo "  make build backend        Build Go binary → backend/appos"
	@echo "  make build web            Build React app → web/dist"
	@echo "  make sync-store           Refresh backend/domain/catalog/seed/*.json from artifact.websoft9.com"
	@echo "  make run                  Copy artifacts + restart services (~10s)"
	@echo "  make run 9092             Copy artifacts + restart on custom port"
	@echo "  make redo                 Full rebuild: build + image, then replace container/volumes + start latest"
	@echo ""
	@printf "\033[36mTesting & Quality:\033[0m\n"
	@echo "  make test backend         Backend unit + integration tests"
	@echo "    example: make test backend TARGET=./domain/iac/..."
	@echo "    example: make test backend TARGET=./domain/routes RUN=TestIACRoutes"
	@echo "  make test web             Frontend unit + integration tests"
	@echo "  make test e2e runtime     Container/runtime smoke"
	@echo "  make test e2e smoke       Runtime smoke + Playwright browser smoke"
	@echo "  make test e2e             Smoke + acceptance browser tests"
	@echo "  make test-env up          Start local external test dependencies"
	@echo "  make test-env down        Stop local external test dependencies"
	@echo "  make qa lint              Lint gate (Go lint + actionlint + eslint + web typecheck)"
	@echo "  make qa format            Format gate (gofmt + prettier)"
	@echo "  make qa openapi           OpenAPI generation + coverage gate"
	@echo "  make qa check             lint + format + openapi + test backend + test web"
	@echo "  make sec source           Source/config security checks (govulncheck, npm audit, gitleaks, trivy config)"
	@echo "  make sec artifact         Built artifact / image security checks and generate SBOM (syft + trivy)"
	@echo "  make sec                  sec source + sec artifact"
	@echo "  make gate pr              PR gate = qa check"
	@echo "  make gate merge           Merge gate = qa check + sec source + test e2e smoke"
	@echo "  make gate staging         Staging gate = merge + test e2e"
	@echo "  make gate release         Release gate = staging + sec artifact"
	@echo "  make version-check        Validate Git tag version metadata or print current git-derived version"
	@echo ""
	@printf "\033[36mOpenAPI:\033[0m\n"
	@echo "  make openapi-gen          Auto-generate OpenAPI spec skeleton from route source"
	@echo "  make openapi-merge        Merge ext-api.yaml + native-api.yaml -> api.yaml"
	@echo "  make openapi-check        Validate code->spec coverage and group-matrix generated anchors"
	@echo "  make openapi-sync         Generate + validate OpenAPI in one command"
	@echo ""
	@printf "\033[36mBuild Image:\033[0m\n"
	@echo "  make image build          Build the AppOS image from pre-built host artifacts"
	@echo "  make image pull IMAGE=... Pull an image (normal registry first, then configured mirrors)"
	@echo ""
	@printf "\033[36mContainer Management:\033[0m\n"
	@echo "  make start                Start container (interactive port prompt when attached to a TTY)"
	@echo "  make start latest         Start with latest image (skip interactive)"
	@echo "  make stop                 Stop container"
	@echo "  make restart              Restart container"
	@echo "  make logs                 View container logs (follow mode)"
	@echo "  make stats                Show all services status inside container"
	@echo "  make delete               Stop and remove container (keeps volumes)"
	@echo "  make rm                   Force remove container and volumes"
	@echo ""
	@printf "\033[36mUtilities:\033[0m\n"
	@echo "  make opencode             Launch opencode with proxy disabled"
	@echo "  make opencode-clear       Clear ALL opencode session data (with confirmation)"
	@echo "  make kill-port 9091       Kill process using port"
	@echo "  make tl                   Show template tooling commands"
	@echo "  make tl validate          Validate normalized templates"
	@echo "  make tl validate wordpress Validate one normalized template sample"
	@echo "  make tl ingress           Render sample template ingress payload (default: wordpress)"
	@echo "  make tl ingress wordpress Render sample template ingress payload for one template"
	@echo "  make tl ingress wordpress TL_VALUES=templates/tests/examples/wordpress.values.json"
	@echo "  make tl verify            Run template validation and ingress rendering"
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

init-env:
	@mkdir -p "$(LOCAL_ENV_DIR)"
	@if [ -f "$(LOCAL_ENV_FILE)" ]; then \
		echo "✓ $(LOCAL_ENV_FILE) already exists"; \
		echo "  Edit it if you need to change local proxy settings."; \
	elif [ -f "$(LOCAL_ENV_TEMPLATE)" ]; then \
		cp "$(LOCAL_ENV_TEMPLATE)" "$(LOCAL_ENV_FILE)"; \
		echo "✓ Created $(LOCAL_ENV_FILE) from $(LOCAL_ENV_TEMPLATE)"; \
		echo "  Make will auto-load this file for local runs."; \
	else \
		echo "✗ Missing template: $(LOCAL_ENV_TEMPLATE)"; \
		exit 1; \
	fi

tidy:
	@echo "Tidying Go modules..."
	@cd backend && go mod tidy
	@echo "✓ Go modules tidied"

sync-store:
	@echo "Refreshing backend catalog seed JSON files..."
	@set -e; \
	base_url="https://artifact.websoft9.com/release/websoft9/store"; \
	for file in backend/domain/catalog/seed/*.json; do \
		name=$$(basename "$$file"); \
		tmp_file="$$file.tmp"; \
		echo "→ $$name"; \
		curl -fsSL "$$base_url/$$name" -o "$$tmp_file"; \
		mv "$$tmp_file" "$$file"; \
	done
	@echo "✓ Backend catalog seed JSON refreshed"

build:
ifeq ($(word 1,$(MAKECMDGOALS)),image)
	@:
else ifeq ($(ARG2),backend)
	@echo "Building backend binaries (static, no dependencies)..."
	@$(MAKE) sync-store
	@$(MAKE) openapi-sync
	@cd backend && CGO_ENABLED=0 go build -ldflags="-w -s" -o appos ./cmd/appos
	@echo "✓ Backend built → backend/appos (statically linked)"
else ifeq ($(ARG2),web)
	@echo "Building web app..."
	@cd web && npm run build
	@echo "✓ Web app built → web/dist/"
else ifeq ($(ARG2),library)
	@echo "'make build library' is no longer needed - library is downloaded during Docker build (cached)"
else
	@echo "Building all..."
	@$(MAKE) sync-store
	@$(MAKE) openapi-sync
	@cd backend && CGO_ENABLED=0 go build -ldflags="-w -s" -o appos ./cmd/appos
	@echo "✓ Backend built → backend/appos"
	@cd web && npm run build
	@echo "✓ Web app built → web/dist/"
	@echo "✓ All built"
endif

redo:
	@echo "Full rebuild: building artifacts and image before replacing container + volumes..."
	@$(MAKE) build
	@$(MAKE) image build
	@docker rm -f $$(docker ps -aq --filter name=$(CONTAINER)) 2>/dev/null || true
	@$(COMPOSE_CMD) down --timeout 5 -v 2>/dev/null || true
	@echo "✓ Previous container and volumes removed after successful build"
	@$(MAKE) start latest
	@sleep 3
	@docker exec $(CONTAINER) sv restart /etc/service/appos >/dev/null
	@sleep 2
	@echo "✓ Services restarted (migrations applied)"

run:
	@docker inspect $(CONTAINER) >/dev/null 2>&1 || { echo "AppOS container not running. Starting latest image first..."; $(MAKE) start latest; }
	@echo "Hot reload: copying pre-built artifacts..."
	@docker cp backend/appos $(CONTAINER):/usr/local/bin/appos
	@docker cp web/dist/. $(CONTAINER):/appos/web/
	@docker cp templates/apps/. $(CONTAINER):/appos/data/templates/apps/
	@docker exec $(CONTAINER) sh -lc 'mkdir -p /etc/traefik/dynamic'
	@docker cp build/traefik.yml $(CONTAINER):/etc/traefik/traefik.yml
	@docker cp build/traefik-dashboard.yml $(CONTAINER):/etc/traefik/dynamic/dashboard.yml
	@docker exec $(CONTAINER) sh -lc 'if [ -e /etc/service/appos ] && command -v sv >/dev/null 2>&1; then sv up /etc/service/appos >/dev/null 2>&1 || true; sv restart /etc/service/appos >/dev/null 2>&1 || sv start /etc/service/appos >/dev/null 2>&1; elif command -v supervisorctl >/dev/null 2>&1 && [ -f /etc/supervisor/supervisord.conf ]; then supervisorctl -c /etc/supervisor/supervisord.conf restart appos >/dev/null 2>&1; else exit 42; fi' || { status=$$?; if [ "$$status" = "42" ]; then docker restart $(CONTAINER) >/dev/null; else exit $$status; fi; }
	@docker exec $(CONTAINER) sh -lc 'if [ -e /etc/service/traefik ] && command -v sv >/dev/null 2>&1; then sv up /etc/service/traefik >/dev/null 2>&1 || true; sv restart /etc/service/traefik >/dev/null 2>&1 || sv start /etc/service/traefik >/dev/null 2>&1; fi'
	@echo "✓ Hot reload complete"
	@HOST_PORT=$$(docker port $(CONTAINER) 9000/tcp 2>/dev/null | head -n 1 | sed 's/.*://'); \
	if [ -n "$$HOST_PORT" ]; then \
		echo "  → http://127.0.0.1:$$HOST_PORT/"; \
	else \
		echo "  → http://127.0.0.1/"; \
	fi

tl:
ifeq ($(ARG2),validate)
	@echo "Running template validation..."
	@cd $(CURDIR) && python3 templates/tests/validate_templates.py $(ARG3)
	@echo "✓ Template validation completed"
else ifeq ($(ARG2),ingress)
	@echo "Rendering template ingress payload..."
	@cd $(CURDIR) && python3 templates/tools/render_ingress_payload.py $(or $(ARG3),$(TL_TEMPLATE)) $(if $(TL_VALUES),--values $(TL_VALUES),)
	@echo "✓ Template ingress payload rendered"
else ifeq ($(ARG2),verify)
	@echo "Running template verify flow..."
	@$(MAKE) tl validate $(ARG3)
	@$(MAKE) tl ingress $(or $(ARG3),wordpress)
	@echo "✓ Template verify flow completed"
else
	@echo ""
	@printf "\033[1mTemplate Tooling Commands\033[0m\n"
	@echo "========================="
	@echo ""
	@echo "  make tl validate" 
	@echo "  make tl validate wordpress"
	@echo "  make tl ingress"
	@echo "  make tl ingress wordpress"
	@echo "  make tl ingress wordpress TL_VALUES=templates/tests/examples/wordpress.values.json"
	@echo "  make tl verify"
	@echo "  make tl verify wordpress"
	@echo ""
endif

# ============================================================
# Testing & Quality
# ============================================================
test:
	@set -e; failures=""; \
	case "$(ARG2)" in \
	  backend) \
	    $(MAKE) --no-print-directory _test-backend || failures="$$failures backend"; \
	    ;; \
	  web) \
	    $(MAKE) --no-print-directory _test-web || failures="$$failures web"; \
	    ;; \
	  e2e) \
	    case "$(ARG3)" in \
	      runtime) $(MAKE) --no-print-directory _test-e2e-runtime || failures="$$failures e2e-runtime" ;; \
	      smoke) $(MAKE) --no-print-directory _test-e2e-smoke ENV="$(ENV)" || failures="$$failures e2e-smoke" ;; \
	      "") $(MAKE) --no-print-directory _test-e2e-acceptance ENV="$(ENV)" || failures="$$failures e2e" ;; \
	      *) echo "✗ Unknown e2e layer: $(ARG3)"; exit 1 ;; \
	    esac; \
	    ;; \
	  "") \
	    $(MAKE) --no-print-directory _test-backend || failures="$$failures backend"; \
	    $(MAKE) --no-print-directory _test-web || failures="$$failures web"; \
	    ;; \
	  *) \
	    echo "✗ Unknown test scope: $(ARG2)"; \
	    exit 1; \
	    ;; \
	esac; \
	if [ -n "$$failures" ]; then \
	  echo ""; \
	  echo "✗ Test failures:"; \
	  for item in $$failures; do echo "  - $$item"; done; \
	  exit 1; \
	fi; \
	echo "✓ Tests completed"

_test-backend:
	@echo "Running backend tests..."
	@cd backend && target="$${TARGET:-./...}"; run_filter="$${RUN:-}"; failures=""; for pkg in $$(go list $$target); do \
		echo "   - $$pkg"; \
		log_file=$$(mktemp); \
		if [ -n "$$run_filter" ]; then \
			go test $$pkg -run "$$run_filter" -v >"$$log_file" 2>&1; status=$$?; \
		else \
			go test $$pkg -v >"$$log_file" 2>&1; status=$$?; \
		fi; \
		cat "$$log_file"; \
		if [ "$$status" -ne 0 ]; then failures="$$failures $$pkg"; fi; \
		rm -f "$$log_file"; \
	done; \
	if [ -n "$$failures" ]; then \
		echo "✗ Backend test package failures:"; \
		for item in $$failures; do echo "  - $$item"; done; \
		exit 1; \
	fi
	@echo "✓ Backend tests completed"

_test-web:
	@echo "Running web tests..."
	@cd web && log_file=$$(mktemp); \
		bash -lc 'NO_COLOR=1 npm test 2>&1 | tee "$$1"; exit $${PIPESTATUS[0]}' _ "$$log_file"; \
		status=$$?; \
		if [ "$$status" -ne 0 ]; then \
			fail_summary=$$(grep -E '^ FAIL |^ × ' "$$log_file" || true); \
			echo "✗ Web tests failed"; \
			if [ -n "$$fail_summary" ]; then \
				echo "Fail summary:"; \
				printf '%s\n' "$$fail_summary"; \
			fi; \
			rm -f "$$log_file"; \
			exit $$status; \
		fi; \
		rm -f "$$log_file"
	@echo "✓ Web tests completed"
_test-e2e-runtime:
	@echo "Running E2E runtime smoke..."
	@failures=""; \
	if [ ! -f backend/appos ] || [ ! -d web/dist ]; then \
	  echo "→ E2E runtime requires host build artifacts; building missing artifacts..."; \
	  $(MAKE) --no-print-directory build || failures="$$failures build"; \
	fi; \
	if [ -z "$$failures" ]; then \
	  bash tests/e2e/container-smoke.sh || failures="$$failures container-smoke"; \
	  bash tests/e2e/setup-status.sh || failures="$$failures setup-status"; \
	fi; \
	if [ -n "$$failures" ]; then \
	  echo "✗ Runtime E2E failures:"; \
	  for item in $$failures; do echo "  - $$item"; done; \
	  exit 1; \
	fi
	@echo "✓ E2E runtime smoke completed"

_test-e2e-smoke:
	@echo "Running E2E smoke..."
	@failures=""; \
	$(MAKE) --no-print-directory _test-e2e-runtime || failures="$$failures runtime"; \
	set -a; \
	if [ -n "$(ENV)" ] && [ -f "$(ENV)" ]; then . "$(ENV)"; fi; \
	set +a; \
	cd tests && npx playwright test -c playwright.config.ts --project=chromium --grep @smoke || failures="$$failures browser-smoke"; \
	if [ -n "$$failures" ]; then \
	  echo "✗ E2E smoke failures:"; \
	  for item in $$failures; do echo "  - $$item"; done; \
	  exit 1; \
	fi
	@echo "✓ E2E smoke completed"

_test-e2e-acceptance:
	@echo "Running E2E acceptance..."
	@failures=""; \
	$(MAKE) --no-print-directory _test-e2e-smoke ENV="$(ENV)" || failures="$$failures smoke"; \
	set -a; \
	if [ -n "$(ENV)" ] && [ -f "$(ENV)" ]; then . "$(ENV)"; fi; \
	set +a; \
	cd tests && npx playwright test -c playwright.config.ts --project=chromium --grep @acceptance || failures="$$failures acceptance"; \
	if [ -n "$$failures" ]; then \
	  echo "✗ E2E acceptance failures:"; \
	  for item in $$failures; do echo "  - $$item"; done; \
	  exit 1; \
	fi
	@echo "✓ E2E acceptance completed"

qa:
	@set -e; failures=""; \
	case "$(ARG2)" in \
	  lint) $(MAKE) --no-print-directory _qa-lint || failures="$$failures lint" ;; \
	  format) $(MAKE) --no-print-directory _qa-format || failures="$$failures format" ;; \
	  openapi) $(MAKE) --no-print-directory _qa-openapi || failures="$$failures openapi" ;; \
	  check|"") \
	    $(MAKE) --no-print-directory _qa-lint || failures="$$failures lint"; \
	    $(MAKE) --no-print-directory _qa-format || failures="$$failures format"; \
	    $(MAKE) --no-print-directory _qa-openapi || failures="$$failures openapi"; \
	    $(MAKE) --no-print-directory _test-backend || failures="$$failures test-backend"; \
	    $(MAKE) --no-print-directory _test-web || failures="$$failures test-web"; \
	    ;; \
	  *) echo "✗ Unknown qa scope: $(ARG2)"; exit 1 ;; \
	esac; \
	if [ -n "$$failures" ]; then \
	  echo ""; \
	  echo "✗ QA failures:"; \
	  for item in $$failures; do echo "  - $$item"; done; \
	  exit 1; \
	fi; \
	echo "✓ QA completed"

_qa-lint:
	@echo "Running lint gate..."
	@failures=""; \
	lint_bin="$(GOLANGCI_LINT_BIN)"; \
	if ! [ -x "$$lint_bin" ] && ! command -v "$$lint_bin" >/dev/null 2>&1; then lint_bin="$(DEFAULT_GOLANGCI_LINT_BIN)"; fi; \
	if [ -x "$$lint_bin" ] || command -v "$$lint_bin" >/dev/null 2>&1; then \
	  log_file=$$(mktemp); set +e; cd backend && "$$lint_bin" run --config ../.golangci.yml ./... >"$$log_file" 2>&1; status=$$?; set -e; cat "$$log_file"; rm -f "$$log_file"; \
	  if [ "$$status" -ne 0 ]; then failures="$$failures golangci-lint"; fi; \
	else failures="$$failures golangci-lint-missing"; fi; \
	actionlint_bin="$(ACTIONLINT_BIN)"; \
	if ! [ -x "$$actionlint_bin" ] && ! command -v "$$actionlint_bin" >/dev/null 2>&1; then actionlint_bin="$(DEFAULT_ACTIONLINT_BIN)"; fi; \
	if [ -x "$$actionlint_bin" ] || command -v "$$actionlint_bin" >/dev/null 2>&1; then \
	  log_file=$$(mktemp); set +e; "$$actionlint_bin" >"$$log_file" 2>&1; status=$$?; set -e; cat "$$log_file"; rm -f "$$log_file"; \
	  if [ "$$status" -ne 0 ]; then failures="$$failures actionlint"; fi; \
	fi; \
	if [ -f "web/package.json" ]; then \
	  log_file=$$(mktemp); set +e; cd web && npx eslint src/ >"$$log_file" 2>&1; status=$$?; set -e; cat "$$log_file"; rm -f "$$log_file"; \
	  if [ "$$status" -ne 0 ]; then failures="$$failures eslint"; fi; \
	  log_file=$$(mktemp); set +e; cd web && npm run typecheck >"$$log_file" 2>&1; status=$$?; set -e; cat "$$log_file"; rm -f "$$log_file"; \
	  if [ "$$status" -ne 0 ]; then failures="$$failures web-typecheck"; fi; \
	fi; \
	if [ -n "$$failures" ]; then \
	  echo "✗ Lint failures:"; for item in $$failures; do echo "  - $$item"; done; exit 1; \
	fi
	@echo "✓ Lint gate completed"

_qa-format:
	@echo "Running format gate..."
	@failures=""; \
	log_file=$$(mktemp); set +e; find backend -name "*.go" -exec gofmt -w {} + >"$$log_file" 2>&1; status=$$?; set -e; cat "$$log_file"; rm -f "$$log_file"; \
	if [ "$$status" -ne 0 ]; then failures="$$failures gofmt"; fi; \
	if [ -f "web/package.json" ]; then \
	  log_file=$$(mktemp); set +e; cd web && npx prettier --write "src/**/*.{ts,tsx,css,json}" >"$$log_file" 2>&1; status=$$?; set -e; cat "$$log_file"; rm -f "$$log_file"; \
	  if [ "$$status" -ne 0 ]; then failures="$$failures prettier"; fi; \
	fi; \
	if [ -n "$$failures" ]; then \
	  echo "✗ Format failures:"; for item in $$failures; do echo "  - $$item"; done; exit 1; \
	fi
	@echo "✓ Format gate completed"

_qa-openapi:
	@echo "Running OpenAPI gate..."
	@$(MAKE) --no-print-directory openapi-sync
	@echo "✓ OpenAPI gate completed"

gate:
	@set -e; failures=""; baseline_status="$$(git status --porcelain --untracked-files=no)"; \
	case "$(ARG2)" in \
	  pr) \
	    $(MAKE) --no-print-directory qa check || failures="$$failures qa-check"; \
	    ;; \
	  merge) \
	    $(MAKE) --no-print-directory gate pr || failures="$$failures pr-gate"; \
	    $(MAKE) --no-print-directory sec source || failures="$$failures sec-source"; \
	    $(MAKE) --no-print-directory test e2e smoke ENV="$(ENV)" || failures="$$failures e2e-smoke"; \
	    ;; \
	  staging) \
	    $(MAKE) --no-print-directory gate merge ENV="$(ENV)" || failures="$$failures merge-gate"; \
	    $(MAKE) --no-print-directory test e2e ENV="$(ENV)" || failures="$$failures e2e-acceptance"; \
	    ;; \
	  release) \
	    $(MAKE) --no-print-directory gate staging ENV="$(ENV)" || failures="$$failures staging-gate"; \
	    $(MAKE) --no-print-directory build || failures="$$failures build"; \
	    $(MAKE) --no-print-directory image build || failures="$$failures image-build"; \
	    $(MAKE) --no-print-directory sec artifact || failures="$$failures sec-artifact"; \
	    ;; \
	  *) echo "✗ Unknown gate stage: $(ARG2)"; echo "  Use: pr | merge | staging | release"; exit 1 ;; \
	esac; \
	if [ -z "$$failures" ]; then \
	  current_status="$$(git status --porcelain --untracked-files=no)"; \
	  if [ "$$current_status" != "$$baseline_status" ]; then \
	    echo "✗ Gate introduced uncommitted tracked changes. Commit the normalized/generated updates and retry."; \
	    git status --short; \
	    failures="$$failures repo-drift"; \
	  else \
	    echo "✓ Repository tracked state unchanged after gate normalization"; \
	  fi; \
	fi; \
	if [ -n "$$failures" ]; then \
	  echo ""; \
	  echo "✗ Gate failures:"; \
	  for item in $$failures; do echo "  - $$item"; done; \
	  exit 1; \
	fi; \
	  echo "✓ Gate $(ARG2) completed"

sec:
	@set -e; failures=""; \
	case "$(ARG2)" in \
	  source) $(MAKE) --no-print-directory _sec-source || failures="$$failures source" ;; \
	  artifact) $(MAKE) --no-print-directory _sec-artifact || failures="$$failures artifact" ;; \
	  "") \
	    $(MAKE) --no-print-directory _sec-source || failures="$$failures source"; \
	    $(MAKE) --no-print-directory _sec-artifact || failures="$$failures artifact"; \
	    ;; \
	  *) echo "✗ Unknown sec scope: $(ARG2)"; echo "  Use: source | artifact"; exit 1 ;; \
	esac; \
	if [ -n "$$failures" ]; then \
	  echo ""; \
	  echo "✗ Security failures:"; \
	  for item in $$failures; do echo "  - $$item"; done; \
	  exit 1; \
	fi; \
	echo "✓ Security checks completed"

_sec-source:
	@echo "Running source security checks..."
	@set -e; failures=""; \
	echo "→ govulncheck (Go CVE scan)..."; \
	if [ -x "$(GOVULNCHECK_BIN)" ] || command -v "$(GOVULNCHECK_BIN)" >/dev/null 2>&1 || [ -x "$(DEFAULT_GOVULNCHECK_BIN)" ]; then \
		govuln_bin="$(GOVULNCHECK_BIN)"; \
		if ! [ -x "$$govuln_bin" ] && ! command -v "$$govuln_bin" >/dev/null 2>&1; then govuln_bin="$(DEFAULT_GOVULNCHECK_BIN)"; fi; \
		log_file=$$(mktemp); set +e; (cd backend && "$$govuln_bin" ./...) >"$$log_file" 2>&1; status=$$?; set -e; cat "$$log_file"; rm -f "$$log_file"; \
		if [ "$$status" -ne 0 ]; then failures="$$failures govulncheck"; fi; \
	else failures="$$failures govulncheck-missing"; fi; \
	echo "→ npm audit (JS CVE scan, high+critical only)..."; \
	if [ -f "web/package.json" ]; then \
		log_file=$$(mktemp); set +e; (cd web && npm audit --audit-level=high) >"$$log_file" 2>&1; status=$$?; set -e; cat "$$log_file"; rm -f "$$log_file"; \
		if [ "$$status" -ne 0 ]; then failures="$$failures npm-audit"; fi; \
	fi; \
	echo "→ gitleaks (secret / credential leak detection)..."; \
	if [ -x "$(GITLEAKS_BIN)" ] || command -v "$(GITLEAKS_BIN)" >/dev/null 2>&1; then \
		report_path="$(GITLEAKS_REPORT_PATH)"; mkdir -p "$$(dirname "$$report_path")"; \
		set +e; "$(GITLEAKS_BIN)" detect --source . $(GITLEAKS_ARGS) --report-format json --report-path "$$report_path"; status=$$?; set -e; \
		if [ "$$status" -eq 1 ]; then failures="$$failures gitleaks"; elif [ "$$status" -ne 0 ]; then failures="$$failures gitleaks-exec"; fi; \
	else failures="$$failures gitleaks-missing"; fi; \
	echo "→ trivy config (IaC / Docker / workflow misconfiguration scan)..."; \
	if command -v docker >/dev/null 2>&1; then \
		log_file=$$(mktemp); trivy_cache_dir="$(TRIVY_CACHE_DIR)"; mkdir -p "$$trivy_cache_dir"; \
		trivy_args="config --skip-check-update --skip-version-check --timeout 10m --severity HIGH,CRITICAL --exit-code 1"; \
		proxy_value="$${ALL_PROXY:-$${all_proxy:-$${HTTP_PROXY:-$${http_proxy:-$${HTTPS_PROXY:-$${https_proxy:-}}}}}}"; \
		no_proxy_value="$${NO_PROXY:-$${no_proxy:-}}"; \
		docker_proxy_args=""; \
		if [ -n "$$proxy_value" ]; then \
			host_proxy="$$(printf '%s' "$$proxy_value" | sed 's/127\.0\.0\.1/host-gateway/g;s/localhost/host-gateway/g')"; \
			docker_proxy_args="$$docker_proxy_args --add-host=host-gateway:host-gateway"; \
			docker_proxy_args="$$docker_proxy_args -e ALL_PROXY=$$host_proxy -e all_proxy=$$host_proxy"; \
			docker_proxy_args="$$docker_proxy_args -e HTTP_PROXY=$$host_proxy -e http_proxy=$$host_proxy"; \
			docker_proxy_args="$$docker_proxy_args -e HTTPS_PROXY=$$host_proxy -e https_proxy=$$host_proxy"; \
		fi; \
		if [ -n "$$no_proxy_value" ]; then \
			docker_proxy_args="$$docker_proxy_args -e NO_PROXY=$$no_proxy_value -e no_proxy=$$no_proxy_value"; \
		fi; \
		set +e; docker run --rm $$docker_proxy_args -v "$$(pwd):/workspace" -v "$$trivy_cache_dir:/root/.cache/trivy" -w /workspace aquasec/trivy:latest $$trivy_args /workspace/build >"$$log_file" 2>&1; status=$$?; set -e; cat "$$log_file"; rm -f "$$log_file"; \
		if [ "$$status" -ne 0 ]; then failures="$$failures trivy-config"; fi; \
	else failures="$$failures docker-missing-for-trivy-config"; fi; \
	if [ -n "$$failures" ]; then echo "✗ Source security failures:"; for item in $$failures; do echo "  - $$item"; done; exit 1; fi
	@echo "✓ Source security checks completed"

_sec-artifact:
	@echo "Running artifact security checks..."
	@echo "Generating Software Bill of Materials (SBOM)..."
	@if ! command -v syft >/dev/null 2>&1; then \
		echo "✗ syft not installed. Run 'make install' first."; exit 1; \
	fi
	@log_file=$$(mktemp); \
	set +e; syft . -o spdx-json --exclude '**/node_modules/**' > sbom.spdx.json 2>"$$log_file"; status=$$?; set -e; \
	cat "$$log_file"; \
	if [ "$$status" -ne 0 ]; then \
		echo "✗ Artifact scan failed at: sbom"; \
		rm -f "$$log_file"; \
		exit $$status; \
	fi; \
	rm -f "$$log_file"
	@echo "✓ SBOM generated → sbom.spdx.json"
	@wc -l sbom.spdx.json | awk '{print "  Lines: " $$1}'
	@echo ""
	@echo "Scanning container image for vulnerabilities (HIGH/CRITICAL)..."
	@if ! docker image inspect websoft9dev/appos:latest >/dev/null 2>&1; then \
		echo "✗ Image websoft9dev/appos:latest not found. Run 'make image build' first."; exit 1; \
	fi
	@if docker image inspect aquasec/trivy:latest >/dev/null 2>&1; then \
		echo "trivy scanner image already present, skip pull."; \
	else \
		echo "Pulling trivy scanner image..."; \
		$(MAKE) --no-print-directory image pull IMAGE=aquasec/trivy:latest || { \
			echo "✗ Failed to pull trivy scanner image. Abort."; exit 1; \
		}; \
	fi
	@log_file=$$(mktemp); \
	set +e; \
	trivy_db_cache="$$HOME/.cache/trivy/db/trivy.db"; \
	if [ -f "$$trivy_db_cache" ]; then \
		echo "trivy DB already cached, skipping update."; \
		db_flags="--skip-db-update"; \
	else \
		echo "trivy DB not cached, pulling via image pull..."; \
		$(MAKE) --no-print-directory image pull IMAGE=aquasec/trivy-db:2 || { \
			echo "✗ Failed to pull trivy DB image. Abort."; rm -f "$$log_file"; exit 1; \
		}; \
		mkdir -p "$$(dirname "$$trivy_db_cache")"; \
		tmp_db=$$(mktemp -d); \
		docker save aquasec/trivy-db:2 | tar xC "$$tmp_db"; \
		for blob in "$$tmp_db"/blobs/sha256/*; do \
			if tar tzf "$$blob" 2>/dev/null | grep -qx 'trivy.db' 2>/dev/null; then \
				tar xzf "$$blob" -C "$$(dirname "$$trivy_db_cache")" trivy.db metadata.json 2>/dev/null; \
				break; \
			fi; \
		done; \
		rm -rf "$$tmp_db"; \
		if [ -f "$$trivy_db_cache" ]; then \
			echo "  trivy DB extracted to cache."; \
			db_flags="--skip-db-update"; \
		else \
			echo "✗ Failed to extract trivy DB from image. Abort."; rm -f "$$log_file"; exit 1; \
		fi; \
	fi; \
	docker run --rm \
		-v /var/run/docker.sock:/var/run/docker.sock \
		-v "$$HOME/.cache/trivy:/root/.cache/trivy" \
		aquasec/trivy:latest image \
		--severity HIGH,CRITICAL \
		--exit-code 0 \
		$$db_flags \
		websoft9dev/appos:latest >"$$log_file" 2>&1; status=$$?; \
	set -e; \
	cat "$$log_file"; \
	if [ "$$status" -ne 0 ]; then \
		echo "✗ Artifact scan failed at: trivy-image"; \
		rm -f "$$log_file"; \
		exit $$status; \
	fi; \
	rm -f "$$log_file"
	@echo "✓ Image scan completed"
	@echo "✓ Artifact security checks completed"

e2e-browser:
	@echo "Running browser end-to-end tests..."
	@set -a; \
	if [ -n "$(ENV)" ] && [ -f "$(ENV)" ]; then . "$(ENV)"; fi; \
	set +a; \
	cd tests && npx playwright test -c playwright.config.ts --project=chromium
	@echo "✓ Browser E2E tests completed"

test-env:
ifeq ($(ARG2),up)
	@echo "Starting local external test dependencies..."
	@test -f "$(TEST_ENV_COMPOSE_FILE)" || { echo "✗ Missing $(TEST_ENV_COMPOSE_FILE)"; exit 1; }
	@set -e; \
	for image in $(TEST_ENV_IMAGES); do \
		$(MAKE) --no-print-directory image pull IMAGE="$$image"; \
	done
	@$(TEST_ENV_COMPOSE_CMD) up -d
	@echo "✓ Local external test dependencies started"
else ifeq ($(ARG2),down)
	@echo "Stopping local external test dependencies..."
	@$(TEST_ENV_COMPOSE_CMD) down -v --remove-orphans
	@echo "✓ Local external test dependencies stopped"
else
	@echo "Usage: make test-env up"
	@echo "       make test-env down"
endif


openapi-gen:
	@echo "Generating OpenAPI custom-route spec from route source..."
	@log_file=$$(mktemp); \
	set +e; cd backend && go run ./cmd/openapi gen >"$$log_file" 2>&1; status=$$?; set -e; \
	cat "$$log_file"; \
	if [ "$$status" -ne 0 ]; then \
		echo "✗ OpenAPI failed at: generate"; \
		rm -f "$$log_file"; \
		exit $$status; \
	fi; \
	rm -f "$$log_file"
	@echo "→ spec: backend/docs/openapi/ext-api.yaml"

openapi-merge:
	@echo "Merging OpenAPI specs (custom routes + native)..."
	@log_file=$$(mktemp); \
	set +e; cd backend && go run ./cmd/openapi merge >"$$log_file" 2>&1; status=$$?; set -e; \
	cat "$$log_file"; \
	if [ "$$status" -ne 0 ]; then \
		echo "✗ OpenAPI failed at: merge"; \
		rm -f "$$log_file"; \
		exit $$status; \
	fi; \
	rm -f "$$log_file"
	@echo "→ spec: backend/docs/openapi/api.yaml"

openapi-check:
	@echo "Checking OpenAPI coverage and group-matrix generated anchors..."
	@log_file=$$(mktemp); \
	set +e; cd backend && go test ./domain/routes/ -run 'TestAll(CustomRoutesCoveredByOpenAPISpec|MatrixExtSurfacesHaveGeneratedSpecAnchors)' -v >"$$log_file" 2>&1; status=$$?; set -e; \
	cat "$$log_file"; \
	if [ "$$status" -ne 0 ]; then \
		echo "✗ OpenAPI failed at: validate"; \
		rm -f "$$log_file"; \
		exit $$status; \
	fi; \
	rm -f "$$log_file"

openapi-sync:
	@echo "Syncing OpenAPI spec (generate + merge + validate)..."
	@$(MAKE) openapi-gen || { echo "✗ OpenAPI sync failed at: generate"; exit 1; }
	@$(MAKE) openapi-merge || { echo "✗ OpenAPI sync failed at: merge"; exit 1; }
	@$(MAKE) openapi-check || { echo "✗ OpenAPI sync failed at: validate"; exit 1; }
	@echo "✓ OpenAPI sync completed"


version-check:
	@echo "Validating version metadata..."
	@node .github/scripts/validate-version.mjs
	@echo "✓ Version metadata valid"

# ============================================================
# Build Image
# ============================================================
image:
ifeq ($(ARG2),build)
  ifeq ($(ARG3),)
	@echo "Building AppOS image (Alpine runtime, pre-built artifacts)..."
	@test -f backend/appos || { echo "Error: backend/appos not found. Run 'make build backend' first."; exit 1; }
	@test -d web/dist || { echo "Error: web/dist/ not found. Run 'make build web' first."; exit 1; }
	@docker_args=""; \
	proxy_value="$${ALL_PROXY:-$${all_proxy:-$${HTTP_PROXY:-$${http_proxy:-$${HTTPS_PROXY:-$${https_proxy:-}}}}}}"; \
	no_proxy_value="$${NO_PROXY:-$${no_proxy:-}}"; \
	if [ -n "$$proxy_value" ]; then \
		host_proxy="$$(printf '%s' "$$proxy_value" | sed 's/127\.0\.0\.1/host-gateway/g;s/localhost/host-gateway/g')"; \
		echo "→ Using build proxy: $$proxy_value"; \
		docker_args="$$docker_args --add-host=host-gateway:host-gateway"; \
		docker_args="$$docker_args --build-arg ALL_PROXY=$$host_proxy --build-arg all_proxy=$$host_proxy"; \
		docker_args="$$docker_args --build-arg HTTP_PROXY=$$host_proxy --build-arg http_proxy=$$host_proxy"; \
		docker_args="$$docker_args --build-arg HTTPS_PROXY=$$host_proxy --build-arg https_proxy=$$host_proxy"; \
	fi; \
	if [ -n "$$no_proxy_value" ]; then \
		docker_args="$$docker_args --build-arg NO_PROXY=$$no_proxy_value --build-arg no_proxy=$$no_proxy_value"; \
	fi; \
	docker build $$docker_args -f build/Dockerfile -t websoft9dev/appos:latest .
	@echo "✓ Image built: websoft9dev/appos:latest"
	@docker images websoft9dev/appos:latest --format "  Size: {{.Size}}"
  else
	@echo "Unknown image subcommand: $(ARG3)"
	@echo "Usage: make image build"
  endif
else ifeq ($(ARG2),pull)
	@if [ -z "$(IMAGE)" ]; then \
		echo "Usage: make image pull IMAGE=<image>[:<tag>]"; \
		echo "Examples:"; \
		echo "  make image pull IMAGE=nginx:alpine"; \
		echo "  make image pull IMAGE=traefik:v3.4.1"; \
		echo "  make image pull IMAGE=grafana/grafana:latest"; \
		echo "  make image pull IMAGE=ghcr.io/some/project:v1"; \
		exit 1; \
	fi
	@set -e; \
	image="$(IMAGE)"; \
	network_timeout="$(IMAGE_PULL_NETWORK_TIMEOUT)"; \
	mirror_retries="$(IMAGE_PULL_MIRROR_RETRIES)"; \
	mirror_timeout="$(IMAGE_PULL_MIRROR_TIMEOUT)"; \
	mirrors_url="$(IMAGE_PULL_MIRRORS_URL)"; \
	direct_log=$$(mktemp); \
	should_fallback=0; \
	echo "Pulling $$image from its primary registry..."; \
	set +e; \
	{ timeout --foreground "$${network_timeout}s" docker pull "$$image" 2>&1; echo $$? > "$$direct_log.exit"; } | tee "$$direct_log"; \
	set -e; \
	status=$$(cat "$$direct_log.exit"); rm -f "$$direct_log.exit"; \
	if [ "$$status" -eq 0 ]; then \
		rm -f "$$direct_log"; \
		echo "✓ Image pulled: $$image"; \
		exit 0; \
	fi; \
	if [ "$$status" -eq 124 ] || grep -Eiq 'TLS handshake timeout|Client\\.Timeout exceeded|i/o timeout|connection reset|connection refused|no route to host|temporary failure|context deadline exceeded|EOF|dial tcp|net/http: request canceled' "$$direct_log"; then \
		should_fallback=1; \
	fi; \
	if [ "$$should_fallback" -ne 1 ]; then \
		rm -f "$$direct_log"; \
		echo "✗ Primary registry pull failed without a retryable network error"; \
		exit "$$status"; \
	fi; \
	rm -f "$$direct_log"; \
	echo "Primary pull hit a network error. Loading mirrors from $$mirrors_url ..."; \
	mirror_json=$$(mktemp); \
	set +e; curl --silent --show-error --fail --connect-timeout "$$network_timeout" --max-time "$$network_timeout" "$$mirrors_url" >"$$mirror_json"; status=$$?; set -e; \
	if [ "$$status" -ne 0 ]; then \
		rm -f "$$mirror_json"; \
		echo "✗ Failed to fetch mirror list"; \
		exit "$$status"; \
	fi; \
	mirrors=$$(python3 -c 'import json, sys; data = json.load(open(sys.argv[1], encoding="utf-8")); print(" ".join(data.get("mirrors", [])))' "$$mirror_json"); \
	rm -f "$$mirror_json"; \
	if [ -z "$$mirrors" ]; then \
		echo "✗ Mirror list was empty"; \
		exit 1; \
	fi; \
	for mirror in $$mirrors; do \
		case "$$image" in \
			*/*) mirrored="$$mirror/$$image" ;; \
			*) mirrored="$$mirror/library/$$image" ;; \
		esac; \
		attempt=1; \
		while [ "$$attempt" -le "$$mirror_retries" ]; do \
			echo "Mirror $$mirror attempt $$attempt/$$mirror_retries: $$mirrored (timeout $${mirror_timeout}s)"; \
			log_file=$$(mktemp); \
			set +e; \
			{ timeout --foreground "$${mirror_timeout}s" docker pull "$$mirrored" 2>&1; echo $$? > "$$log_file.exit"; } | tee "$$log_file"; \
			set -e; \
			status=$$(cat "$$log_file.exit"); rm -f "$$log_file.exit"; \
			rm -f "$$log_file"; \
			if [ "$$status" -eq 0 ]; then \
				docker tag "$$mirrored" "$$image"; \
				echo "✓ Image pulled via mirror and retagged: $$image"; \
				exit 0; \
			fi; \
			attempt=$$((attempt + 1)); \
		done; \
	done; \
	echo "✗ Failed to pull $$image from all configured mirrors"; \
	exit 1
else
	@echo "Usage: make image build"
	@echo "       make image pull IMAGE=<image>[:<tag>]"
endif

# ============================================================
# Container Management
# ============================================================
start:
	@if [ "$(ARG2)" = "latest" ]; then \
		IMAGE_TAG=latest; \
		PORT=9091; \
	elif [ -t 0 ]; then \
		IMAGE_TAG=latest; \
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
	@if docker inspect $(CONTAINER) >/dev/null 2>&1; then \
		docker exec $(CONTAINER) sh -lc 'sv status /etc/service/*' 2>/dev/null || true; \
	else \
		echo "✗ Error: Container '$(CONTAINER)' not running"; \
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

opencode:
	@echo "Starting opencode (proxy disabled)..."
	@unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy; \
	no_proxy="*" NO_PROXY="*" opencode

opencode-clear:
	@OPENCODE_DATA="$${OPENCODE_DIR:-$$HOME/.local/share/opencode}"; \
	if [ ! -d "$$OPENCODE_DATA" ]; then \
		echo "✓ No opencode data directory found at $$OPENCODE_DATA"; \
		exit 0; \
	fi; \
	DB="$$OPENCODE_DATA/opencode.db"; \
	if [ ! -f "$$DB" ]; then \
		echo "✓ No opencode database found (nothing to clear)"; \
		exit 0; \
	fi; \
	SESSION_COUNT=$$(sqlite3 "$$DB" "SELECT COUNT(*) FROM session WHERE parent_id IS NULL;" 2>/dev/null || echo "0"); \
	DB_SIZE=" ($$(du -h "$$DB" | cut -f1))"; \
	echo ""; \
	echo "========================================="; \
	printf "  Sessions in opencode store (%s sessions)%s\n" "$$SESSION_COUNT" "$$DB_SIZE"; \
	echo "========================================="; \
	if [ "$$SESSION_COUNT" -gt 0 ]; then \
		sqlite3 -header -column "$$DB" \
			"SELECT ROW_NUMBER() OVER (ORDER BY time_updated DESC) as '#', \
			        title, \
			        datetime(time_updated / 1000, 'unixepoch', 'localtime') as updated \
			 FROM session WHERE parent_id IS NULL ORDER BY time_updated DESC;" 2>/dev/null; \
	fi; \
	echo ""; \
	echo "⚠  This will clear ALL opencode session data at $$OPENCODE_DATA"; \
	printf "   This includes: conversations, repo caches, snapshots, tool outputs, and logs.\n\n"; \
	read -p "Continue? [y/N] " confirm; \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		rm -f "$$DB" "$$DB-wal" "$$DB-shm"; \
		rm -rf "$$OPENCODE_DATA/repos" "$$OPENCODE_DATA/snapshot" "$$OPENCODE_DATA/tool-output" "$$OPENCODE_DATA/log"; \
		echo "✓ OpenCode session data cleared"; \
	else \
		echo "Cancelled."; \
	fi

backend web latest e2e runtime smoke pr merge staging release source artifact up down:
	@:

# Swallow positional args (e.g., make start 9092, make build backend)
%:
	@:
