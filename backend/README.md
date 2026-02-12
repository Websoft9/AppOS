# AppOS Backend

Go-based unified API backend for AppOS.

## Features

- **Unified REST API**: Single endpoint for CLI, Dashboard, and integrations
- **Task Queue**: Asynq for reliable async task execution
- **Web Terminal**: xterm.js compatible WebSocket terminal
- **Docker Operations**: Manage containers via Docker socket
- **Convex Integration**: Auth and data management

## Architecture

```
┌─────────────────────────────────────┐
│     AppOS Backend (All-in-One)      │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  chi HTTP Server            │   │
│  │  - REST API (port 8080)     │   │
│  │  - WebSocket (terminal)     │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  Asynq Worker               │   │
│  │  - Embedded in process      │   │
│  │  - 10 concurrent workers    │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

## Getting Started

### Prerequisites

- Go 1.23+
- Redis (for Asynq)
- Docker (for container operations)
- Convex account

### Installation

```bash
# Clone repository
cd backend

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
vim .env

# Install dependencies
go mod download

# Run with hot reload
make dev

# Or build and run
make run
```

### Development Tools

```bash
# Install dev tools
make install-tools

# Run with hot reload
make dev

# Run tests
make test

# Lint code
make lint

# Format code
make fmt
```

## Project Structure

```
backend/
├── cmd/
│   └── server/
│       └── main.go              # Application entry point
├── internal/
│   ├── config/
│   │   └── config.go            # Configuration management
│   ├── server/
│   │   ├── server.go            # Server setup
│   │   ├── handlers/            # HTTP handlers
│   │   │   ├── apps.go
│   │   │   ├── deployments.go
│   │   │   ├── health.go
│   │   │   └── terminal.go
│   │   └── middleware/          # HTTP middleware
│   │       ├── auth.go
│   │       └── logger.go
│   ├── tasks/                   # Asynq task definitions
│   ├── convex/                  # Convex client
│   └── docker/                  # Docker operations
├── .air.toml                    # Hot reload config
├── .env.example                 # Environment template
├── Dockerfile                   # Container image
├── Makefile                     # Build commands
└── go.mod                       # Go dependencies
```

## API Endpoints

### Health Checks
- `GET /health` - Health status
- `GET /ready` - Readiness status

### Applications
- `GET /v1/apps` - List all applications
- `GET /v1/apps/:name` - Get application details
- `POST /v1/apps/deploy` - Deploy application
- `DELETE /v1/apps/:name` - Delete application
- `GET /v1/apps/:name/logs` - Get application logs

### Deployments
- `GET /v1/deployments` - List deployments
- `GET /v1/deployments/:id` - Get deployment details

### Tasks
- `GET /v1/tasks/:id` - Get task status

### Terminal
- `WS /terminal` - WebSocket terminal connection

## Configuration

Environment variables (see `.env.example`):

```bash
# Server
PORT=8080
ENV=development

# Redis (Asynq)
REDIS_URL=redis://localhost:6379

# Convex
CONVEX_URL=https://your-deployment.convex.cloud
CONVEX_DEPLOY_KEY=your-key

# CORS
CORS_ALLOWED_ORIGINS=http://localhost:5173

# Logging
LOG_LEVEL=debug
LOG_FORMAT=pretty
```

## Docker

```bash
# Build image
make docker-build

# Run container
docker run -p 8080:8080 --env-file .env appos-backend:latest
```

## Testing

```bash
# Run tests
make test

# Run with coverage
make test-coverage

# Test specific package
go test -v ./internal/server/...
```

## Production Deployment

```bash
# Build optimized binary
CGO_ENABLED=0 go build -ldflags="-s -w" -o appos-backend cmd/server/main.go

# Run
./appos-backend
```

## License

MIT
