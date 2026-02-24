.PHONY: help install tidy build run test lint fmt \
	image start stop restart logs stats delete rm kill-port redo

# ============================================================
# Default values
# ============================================================
CONTAINER := appos
COMPOSE_FILE := build/docker-compose.yml
COMPOSE_CMD := cd build && docker compose

# Support positional args: make kill-port 9091
ARG2 := $(word 2,$(MAKECMDGOALS))

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
	@echo "  make build                Build all (backend + dashboard)"
	@echo "  make build backend        Build Go binary → backend/appos"
	@echo "  make build dashboard      Build React app → dashboard/dist"
	@echo "  make run                  Copy artifacts + restart services (~10s)"
	@echo "  make run 9092             Copy artifacts + restart on custom port"
	@echo "  make redo                 Full rebuild: rm volumes + build + image + start dev"
	@echo ""
	@printf "\033[36mTesting & Quality:\033[0m\n"
	@echo "  make test                 Run all tests (Go + JS)"
	@echo "  make lint                 Run linters (golangci-lint, eslint)"
	@echo "  make fmt                  Format code (gofmt, prettier)"
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
	@if [ -f "dashboard/package.json" ]; then \
		echo "→ npm packages..."; \
		cd dashboard && npm install; \
	fi
	@echo "✓ Dependencies installed"

tidy:
	@echo "Tidying Go modules..."
	@cd backend && go mod tidy
	@echo "✓ Go modules tidied"

build:
ifeq ($(ARG2),backend)
	@echo "Building backend (static binary, no dependencies)..."
	@cd backend && CGO_ENABLED=0 go build -ldflags="-w -s" -o appos ./cmd/appos
	@echo "✓ Backend built → backend/appos (statically linked)"
else ifeq ($(ARG2),dashboard)
	@echo "Building dashboard..."
	@cd dashboard && npm run build
	@echo "✓ Dashboard built → dashboard/dist/"
else ifeq ($(ARG2),library)
	@echo "'make build library' is no longer needed - library is downloaded during Docker build (cached)"
else
	@echo "Building all..."
	@cd backend && CGO_ENABLED=0 go build -ldflags="-w -s" -o appos ./cmd/appos
	@echo "✓ Backend built → backend/appos"
	@cd dashboard && npm run build
	@echo "✓ Dashboard built → dashboard/dist/"
	@echo "✓ All built"
endif

redo:
	@echo "Full rebuild: removing container + volumes, then building and restarting..."
	@$(COMPOSE_CMD) down -v 2>/dev/null || true
	@echo "✓ Container and volumes removed"
	@$(MAKE) build
	@$(MAKE) image build-local
	@$(MAKE) start dev

run:
	@echo "Hot reload: copying pre-built artifacts..."
	@docker cp backend/appos $(CONTAINER):/usr/local/bin/appos
	@docker cp dashboard/dist/. $(CONTAINER):/usr/share/nginx/html/dashboard/
	@docker exec $(CONTAINER) supervisorctl -c /etc/supervisor/supervisord.conf restart appos nginx
	@echo "✓ Hot reload complete"
	@echo "  → http://127.0.0.1:$(PORT_EFFECTIVE)/"

# ============================================================
# Testing & Quality
# ============================================================
test:
	@echo "Running tests..."
	@if [ -f "backend/go.mod" ]; then \
		echo "→ Go tests..."; \
		cd backend && go test ./... -v || true; \
	fi
	@if [ -f "dashboard/package.json" ]; then \
		echo "→ JS tests..."; \
		cd dashboard && npm test 2>/dev/null || true; \
	fi
	@echo "✓ Tests completed"

lint:
	@echo "Running linters..."
	@if command -v golangci-lint >/dev/null 2>&1; then \
		echo "→ golangci-lint..."; \
		cd backend && golangci-lint run ./... || true; \
	else \
		echo "→ go vet (golangci-lint not installed)..."; \
		cd backend && go vet ./... || true; \
	fi
	@if [ -f "dashboard/node_modules/.bin/eslint" ]; then \
		echo "→ eslint..."; \
		cd dashboard && npx eslint src/ || true; \
	fi
	@echo "✓ Linting completed"

fmt:
	@echo "Formatting code..."
	@if [ -f "backend/go.mod" ]; then \
		echo "→ gofmt..."; \
		find backend -name "*.go" -exec gofmt -w {} +; \
	fi
	@if [ -f "dashboard/node_modules/.bin/prettier" ]; then \
		echo "→ prettier..."; \
		cd dashboard && npx prettier --write "src/**/*.{ts,tsx,css,json}" 2>/dev/null || true; \
	fi
	@echo "✓ Code formatted"

# ============================================================
# Build Image
# ============================================================
image:
ifeq ($(ARG2),build)
  ifeq ($(ARG3),)
	@echo "Building production image (multi-stage)..."
	docker build -f build/Dockerfile -t websoft9/appos:latest .
	@echo "✓ Image built: websoft9/appos:latest"
	@docker images websoft9/appos:latest --format "  Size: {{.Size}}"
  else
	@echo "Unknown image subcommand: $(ARG3)"
	@echo "Usage: make image build | make image build-local"
  endif
else ifeq ($(ARG2),build-local)
	@echo "Building dev image (pre-built artifacts)..."
	@# Verify artifacts exist
	@test -f backend/appos || { echo "Error: backend/appos not found. Run 'make build backend' first."; exit 1; }
	@test -d dashboard/dist || { echo "Error: dashboard/dist/ not found. Run 'make build dashboard' first."; exit 1; }
	@# Pass host proxy into build (replace 127.0.0.1 with host-gateway for container access)
	$(eval HOST_PROXY := $(shell \
		P=$${all_proxy:-$${ALL_PROXY:-$${http_proxy:-$${HTTP_PROXY:-}}}}; \
		if [ -n "$$P" ]; then \
			echo "$$(echo $$P | sed 's/127\.0\.0\.1/host-gateway/g;s/localhost/host-gateway/g')"; \
		fi))
	$(eval PROXY_ARGS := $(if $(HOST_PROXY),--add-host=host-gateway:host-gateway --build-arg ALL_PROXY=$(HOST_PROXY),))
	docker build $(PROXY_ARGS) -f build/Dockerfile.local -t websoft9/appos:dev .
	@echo "✓ Dev image built: websoft9/appos:dev"
	@docker images websoft9/appos:dev --format "  Size: {{.Size}}"
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
		$(COMPOSE_CMD) down -v 2>/dev/null || true; \
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

# Swallow positional args (e.g., make start 9092, make build backend)
%:
	@:
