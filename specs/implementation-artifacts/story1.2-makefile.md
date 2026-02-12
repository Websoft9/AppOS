# Story 1.2: Makefile Development Workflow

**Epic**: Epic 1 - Infrastructure & Build System  
**Priority**: P2  
**Status**: Ready for Dev

---

## User Story

As a developer, I want simplified Makefile commands, so that I don't need to remember complex docker/go/npm commands.

## Acceptance Criteria

- [ ] Makefile in project root with categorized commands
- [ ] `make help` displays all commands with descriptions
- [ ] Commands support flexible parameter passing
- [ ] Build commands for backend and dashboard
- [ ] Container lifecycle management (start/stop/restart/logs)
- [ ] Hot reload workflow for fast iteration
- [ ] Compatible with Linux/macOS

---

## Command Structure

### Dev
```bash
make install              # Install dev dependencies (Go tools, npm packages)
make tidy                 # Tidy Go modules
make build backend        # Build Go binary → backend/main
make build dashboard      # Build React app → dashboard/dist
make run                  # Copy artifacts + restart (default port 9091)
make run 9092             # Copy artifacts + restart on port 9092
```

### Testing & Quality
```bash
make test                 # Run all tests (Go + JS)
make lint                 # Run linters (golangci-lint, eslint)
make fmt                  # Format code (gofmt, prettier)
```

### Build Image
```bash
make image build          # Build production image (multi-stage Dockerfile)
make image build-local    # Build dev image (Dockerfile.local)
```

### Container Management
```bash
make start                # Start container on default port (9091)
make start 9092           # Start on custom port
make start PORT=9092      # Start on custom port (env var)
make stop                 # Stop container
make restart              # Restart container
make logs                 # View container logs (follow mode)
make delete               # Stop and remove container (keeps volumes)
make rm                   # Force remove container and volumes (with confirmation)
```

### Utilities
```bash
make kill-port 9091       # Kill process using port
make kill-port PORT=9091  # Kill using env var
make help                 # Show all commands
```

---

## Implementation Notes

### Parameter Passing

**Two methods supported**:
1. Positional: `make start 9092`
2. Environment variable: `make start PORT=9092`

### Subcommands Pattern

```bash
make build backend        # Compiles Go
make build dashboard      # Builds React
make image build          # Production image
make image build-local    # Dev image
```

### Hot Reload Workflow

`make run` performs fast update without rebuilding image:
1. Build backend binary
2. Build dashboard static files
3. Copy to running container via `docker cp`
4. Restart services via supervisorctl

**Result**: ~10 seconds update (vs ~5 minutes full rebuild)

### Docker Compose Integration

All container commands use docker-compose:
- `start` → `docker-compose up -d`
- `stop` → `docker-compose stop`
- `logs` → `docker-compose logs -f`
- `delete` → `docker-compose down`
- `rm` → `docker-compose down -v`

---

## Directory Structure

```
/
├── Makefile                    # This story: Command definitions
├── backend/
│   ├── main                    # Built binary
│   └── cmd/server/main.go
├── dashboard/
│   ├── dist/                   # Built static files
│   └── src/
└── build/                      # Story 1.1: Dockerfiles and configs
    ├── Dockerfile              # Production multi-stage build
    ├── Dockerfile.local        # Dev build (pre-built artifacts)
    ├── docker-compose.yml      # Container orchestration
    ├── .env                    # Environment variables
    ├── supervisord.conf        # Process manager config
    └── nginx.conf              # Internal proxy config
```

---

## Usage Examples

### Daily Development

```bash
# Initial setup
make install
make image build-local
make start

# Code → Test cycle
# ... edit code ...
make run              # Hot reload in 10 seconds
make test             # Verify changes
```

### Production Build

```bash
make image build      # Full multi-stage build
make start
```

### Testing

```bash
make test             # Run all tests
make lint             # Check code quality
make fmt              # Auto-format code
```

### Container Management

```bash
# Start with custom port
make start 9092
curl http://127.0.0.1:9092/

# View logs
make logs

# Restart services
make restart

# Clean up
make stop
make delete           # Keeps data
make rm               # Removes data (with confirmation)
```

### Troubleshooting

```bash
# Port conflict
make kill-port 9091

# Check services inside container
docker exec appos supervisorctl status

# Fresh start
make rm               # Remove everything
make image build-local
make start
```

---

## Verification

### Command Help
```bash
make help
# Should display categorized commands with descriptions
```

### Build Workflow
```bash
make install
make build backend
ls backend/main           # Should exist

make build dashboard
ls dashboard/dist/        # Should contain index.html
```

### Image Build
```bash
make image build
docker images | grep appos:latest

make image build-local
docker images | grep appos:dev
```

### Container Lifecycle
```bash
make start
curl http://127.0.0.1:9091/

make logs               # View output
make restart            # Restart services
make stop               # Stop container
```

### Hot Reload
```bash
make start
# ... modify code ...
make run                # Updates in ~10 seconds
curl http://127.0.0.1:9091/
```

---

## Implementation Tasks

- [ ] Create root Makefile with command categories
- [ ] Implement `help` with colored categorized output
- [ ] Implement Dev commands: `install`, `tidy`, `build`, `run`
- [ ] Implement Testing commands: `test`, `lint`, `fmt`
- [ ] Implement Image commands: `image build`, `image build-local`
- [ ] Implement Container commands: `start`, `stop`, `restart`, `logs`, `delete`, `rm`
- [ ] Implement Utilities: `kill-port`, `help`
- [ ] Test parameter passing (numeric + env var)
- [ ] Test hot reload workflow
- [ ] Test on Linux and macOS
- [ ] Add colored output for better UX

---

## Status

**Current**: Ready for Dev  
**Last Updated**: 2026-02-12  
**Estimated Effort**: 1 day  

**Dependencies**:
- Story 1.1 completed (Dockerfiles and build configs)
- Docker and docker-compose installed
- Go 1.22+ and Node.js 20+ for local builds  
