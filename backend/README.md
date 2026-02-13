# AppOS Backend

PocketBase-based application server with custom business logic compiled into a single Go binary.

## Architecture

- **PocketBase** as application framework (auth, DB, realtime, admin UI)
- **Custom routes** for Docker operations, proxy management, terminal, backup
- **Asynq + Redis** for persistent async task processing (embedded worker)

## Prerequisites

- Go 1.26+
- Redis (for Asynq task queue)
- Docker (host access via socket)

## Development

```bash
# Install dependencies
go mod tidy

# Run with hot-reload (requires air: go install github.com/air-verse/air@latest)
air

# Or run directly
go run cmd/appos/main.go serve --dev

# Build
go build -o appos cmd/appos/main.go

# Run production binary
./appos serve --http=0.0.0.0:8090
```

## Project Structure

```
backend/
├── cmd/appos/main.go              # Entry point: PocketBase + extensions
├── internal/
│   ├── routes/                    # Custom API route handlers
│   │   ├── routes.go              # Route registration
│   │   ├── apps.go                # App lifecycle (deploy, restart, stop)
│   │   ├── proxy.go               # Reverse proxy management
│   │   ├── system.go              # Metrics, terminal, files
│   │   └── backup.go              # Backup/restore
│   ├── hooks/hooks.go             # PocketBase event hooks
│   ├── worker/worker.go           # Asynq task worker (embedded)
│   ├── docker/docker.go           # Docker Engine API client
│   ├── terminal/terminal.go       # WebSocket + PTY terminal
│   └── migrations/                # PocketBase auto-migrations
├── Dockerfile
├── .air.toml                      # Hot-reload config
└── .env.example
```

## API Endpoints

### Custom Routes (all under `/api/appos/`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/apps/deploy` | user | Deploy application |
| POST | `/apps/{id}/restart` | user | Restart application |
| POST | `/apps/{id}/stop` | user | Stop application |
| DELETE | `/apps/{id}` | user | Delete application |
| GET | `/apps/{id}/logs` | user | Stream app logs |
| GET | `/apps/{id}/env` | user | Get environment vars |
| PUT | `/apps/{id}/env` | user | Update environment vars |
| POST | `/proxy/domains` | admin | Add domain binding |
| GET | `/proxy/domains` | admin | List domains |
| DELETE | `/proxy/domains/{domain}` | admin | Remove domain |
| POST | `/proxy/domains/{domain}/ssl` | admin | Request SSL cert |
| POST | `/proxy/reload` | admin | Reload proxy |
| GET | `/system/metrics` | admin | System metrics |
| GET | `/system/terminal` | admin | WebSocket terminal |
| GET | `/system/files` | admin | File browser |
| POST | `/backup/create` | admin | Create backup |
| POST | `/backup/restore` | admin | Restore backup |
| GET | `/backup/list` | admin | List backups |

### Built-in PocketBase Routes

- `/api/collections/*` — CRUD for all collections
- `/api/realtime` — SSE subscriptions
- `/_/` — Admin UI
