# Story 16.2: Server Onboarding

**Epic**: Epic 16 – SSH Tunnel: Local Server Management
**Status**: Done | **Priority**: P1 | **Depends on**: Story 16.1

---

## User Story

As a superuser, I can add a local server (behind NAT) to appos by copying a generated `autossh` command, so that the server becomes manageable via Terminal, Files, and Docker without a public IP or agent software.

---

## Implementation

### New files

```
backend/internal/routes/tunnel.go          # API routes + TokenValidator + SessionHooks impls
backend/internal/migrations/
  1741500000_add_tunnel_fields.go          # servers + secrets schema extension
  1741500001_seed_tunnel_settings.go       # tunnel port range in app_settings
  1741500002_add_tunnel_token_type.go      # adds "tunnel_token" to secrets.type select values
dashboard/src/
  components/servers/
    TunnelSetupWizard.tsx                  # two-phase onboarding wizard
  routes/_app/_auth/resources/servers.tsx  # extend with connect_type selector (existing file)
```

---

### Schema migration — `1741500000_add_tunnel_fields.go`

Extends the `servers` collection with four new optional fields:

| Field | Type | Notes |
|-------|------|-------|
| `connect_type` | text | default `"direct"` |
| `tunnel_status` | text | `"online"` \| `"offline"` \| `""` |
| `tunnel_last_seen` | datetime | nullable |
| `tunnel_services` | json | nullable, written by backend only |

No breaking change — all fields are optional and existing `direct` servers leave them empty.

Also extends `secrets` with `type = 'tunnel_token'` value added via migration `1741500002_add_tunnel_token_type.go` (the `type` select field previously did not include this value, causing silent create failures).

---

### Settings migration — `1741500001_seed_tunnel_settings.go`

Inserts two rows into `app_settings` (upsert — idempotent):

```go
{"key": "tunnel.port_range_start", "value": "40000", "group": "infrastructure"}
{"key": "tunnel.port_range_end",   "value": "49999", "group": "infrastructure"}
```

---

### routes/tunnel.go — business layer

#### Startup wiring (called from `routes.go → RegisterAll`)

```go
func RegisterTunnelServer(se *core.ServeEvent, g *router.RouterGroup[*core.RequestEvent]) {
    // 1. Read port range from app_settings
    start := readSettingInt(se.App, "tunnel.port_range_start", 40000)
    end   := readSettingInt(se.App, "tunnel.port_range_end",   49999)

    // 2. Load existing tunnel_services from DB → portpool
    pool := tunnel.NewPortPool(start, end)
    records := loadTunnelServers(se.App)    // query servers where connect_type = "tunnel"
    pool.LoadExisting(records)

    // 3. Load or generate host key
    hostKey := loadOrGenerateHostKey(se.App) // pb_data/tunnel_host_key

    // 4. Build hooks and validator implementations (see below)
    hooks     := &pbSessionHooks{app: se.App, pool: pool}
    validator := &pbTokenValidator{app: se.App}
    sessions  := tunnel.NewRegistry()

    // 5. Start tunnel server
    srv := tunnel.NewServer(pool, sessions, validator, hooks, hostKey)
    go srv.ListenAndServe(":2222")

    // 6. Register routes
    registerTunnelRoutes(g, se.App, sessions, pool)
    registerTunnelPublicRoutes(se.Router, se.App)
}
```

#### `pbTokenValidator` — implements `tunnel.TokenValidator`

```go
func (v *pbTokenValidator) Validate(rawToken string) (serverID string, ok bool) {
  // load all tunnel_token secrets
  secrets, err := v.app.FindRecordsByFilter("secrets",
    "type = 'tunnel_token' && value != ''", "", 0, 0)
  if err != nil { return "", false }

  for _, secret := range secrets {
    dec, err := crypto.Decrypt(secret.GetString("value"))
    if err != nil || dec != rawToken { continue }

    // find server linked via servers.credential relation
    server, err := v.app.FindFirstRecordByFilter("servers", "credential = {:cid}", dbx.Params{"cid": secret.Id})
    if err == nil { return server.Id, true }
  }
  return "", false
}
```

Token lookup is O(n) over tunnel tokens at connect time. Acceptable for MVP — at most
thousands of tokens. Can be indexed later if needed.

#### `pbSessionHooks` — implements `tunnel.SessionHooks`

```go
func (h *pbSessionHooks) OnConnect(serverID string, services []tunnel.Service, conflicts []tunnel.ConflictResolution) {
    server, _ := h.app.FindRecordById("servers", serverID)
    server.Set("tunnel_status",   "online")
    server.Set("tunnel_last_seen", time.Now().UTC())
  server.Set("tunnel_services",  services)
    h.app.Save(server)

    // Resolve port conflicts reported by portpool
    for _, cr := range conflicts {
        audit.Write(h.app, audit.Entry{
            Action: "tunnel.port_conflict_resolved",
            Detail: map[string]any{"old_port": cr.OldPort, "new_port": cr.NewPort},
        })
    }

    audit.Write(h.app, audit.Entry{
        Action:       "tunnel.connect",
        ResourceType: "server",
        ResourceID:   serverID,
        Status:       audit.StatusSuccess,
        Detail:       map[string]any{"services": services},
    })
}

func (h *pbSessionHooks) OnDisconnect(serverID string) {
    // If a replacement session already registered (kick-old scenario),
    // skip marking offline — the new session's OnConnect already set status to online.
    if h.sessions != nil {
        if _, active := h.sessions.Get(serverID); active { return }
    }
    server, _ := h.app.FindRecordById("servers", serverID)
    server.Set("tunnel_status", "offline")
    h.app.Save(server)

    audit.Write(h.app, audit.Entry{
        Action:       "tunnel.disconnect",
        ResourceType: "server",
        ResourceID:   serverID,
        Status:       audit.StatusSuccess,
    })
}
```

#### Authenticated routes (`/api/ext/tunnel/`, `RequireSuperuserAuth()`)

```
POST  /api/ext/tunnel/servers/:id/token    → generate or rotate Tunnel Token
GET   /api/ext/tunnel/servers/:id/setup    → return autossh command + systemd unit text
GET   /api/ext/tunnel/servers/:id/status   → return { status, last_seen, services }
```

#### Unauthenticated route (registered on `se.Router` directly, like `registerSetupRoutes`)

```
GET   /tunnel/setup/{token}    → setup shell script (text/x-sh), no auth required
```

**POST `/api/ext/tunnel/servers/:id/token`** (idempotent)

1. Find server record; verify `connect_type = tunnel`
2. If existing `credential` linked **and no `?rotate=true` param**: decrypt and return existing token — no side effects, no disconnect
3. If `?rotate=true` (or first time): generate new token, encrypt, save to `secrets`, write audit event
4. On rotation: call `tunnelSessions.Disconnect(serverID)` to immediately close active tunnel
5. Return `{ token }` (plaintext)

> Callers (e.g., the wizard) must use `?rotate=true` explicitly to trigger rotation. Repeated calls without the flag are safe to make on every wizard open.

**GET `/api/ext/tunnel/servers/:id/setup`**

Reads the server's token from `secrets`, decrypts, and returns:

```json
{
  "token": "ABCD...",
  "autossh_cmd": "autossh -M 0 -N -R 0:localhost:22 -R 0:localhost:80 -p 2222 {TOKEN}@{APPOS_HOST} -o ServerAliveInterval=30 -o ServerAliveCountMax=3",
  "systemd_unit": "[Unit]\nDescription=appos tunnel\n...\n[Service]\nExecStart=/usr/bin/autossh ...\nRestart=always\n...\n[Install]\nWantedBy=multi-user.target",
  "setup_script_url": "/tunnel/setup/{TOKEN}"
}
```

Including `token` here allows the wizard to open `GET /setup` alone on subsequent opens without needing to call `POST /token`.

**GET `/tunnel/setup/{token}` (unauthenticated)** — setup shell script

Returns a `text/x-sh` script that:
1. Detects package manager and installs `autossh` if absent; falls back to plain `ssh` if autossh cannot be installed
2. Stops any existing `appos-tunnel` service (`systemctl stop appos-tunnel || true`) before overwriting the unit file — allows re-running the script to reconfigure
3. Writes the systemd unit file
4. Runs `systemctl daemon-reload && systemctl enable --now appos-tunnel`

**GET `/api/ext/tunnel/servers/:id/status`**

Returns live state from in-memory `Registry` (not DB) for zero latency:

```json
{ "status": "online", "last_seen": "2026-02-27T10:00:00Z", "services": [...] }
```

Falls back to DB value if server not in registry (i.e., `offline`).

---

### `resolveServerConfig` extension (`routes/terminal.go`)

```go
// After existing direct-SSH resolution:
if server.GetString("connect_type") == "tunnel" {
    var services []struct {
        Name       string `json:"name"`
        TunnelPort int    `json:"tunnel_port"`
    }
    _ = json.Unmarshal([]byte(server.GetString("tunnel_services")), &services)
    for _, svc := range services {
        if svc.Name == "ssh" {
            cfg.Host = "127.0.0.1"
            cfg.Port = svc.TunnelPort
            break
        }
    }
}
```

All existing SSH terminal, SFTP, and Docker exec routes continue to work unchanged.
The tunnel server must be `online` for the connection to succeed — offline servers return
a dial error from `SSHConnector.Connect()` just as an unreachable direct server would.

---

### Frontend

#### `servers.tsx` — Add Server dialog extension

Add a `connect_type` radio at the top of the create form:

```tsx
// New field inserted before all existing fields:
{
  key: "connect_type",
  label: "Connection Type",
  type: "radio",           // new ResourcePage field type, or inline custom
  defaultValue: "direct",
  options: [
    { label: "Direct SSH",  value: "direct",  description: "Server has a reachable IP" },
    { label: "Tunnel",      value: "tunnel",  description: "Server is behind NAT" },
  ],
}
```

When `connect_type = tunnel`:
- Hide fields: `host`, `port` (overridden by tunnel — `resolveServerConfig` uses `127.0.0.1` + `tunnel_port`)
- Show fields: `name`, `description`, `groups`, `user`, `auth_type`, `credential` (SSH login credentials still required for appos to manage the server through the tunnel)
- On successful create → open `<TunnelSetupWizard serverId={newRecord.id} />`

When `connect_type = direct` (default): existing form unchanged.

#### `TunnelSetupWizard.tsx`

Two-phase dialog component.

**Phase 1** — already complete (server record was just created with SSH credentials, token auto-generated in `POST /api/ext/tunnel/servers/:id/token` called immediately after record creation).

**Phase 2** — displays commands and waits:

```
State: { token, autosshCmd, systemdSetupUrl, status }

On mount:
  1. GET /api/ext/tunnel/servers/:id/setup → populate commands
  2. pb.collection("servers").subscribe(id, (e) => {
       if (e.record.tunnel_status === "online") setStatus("connected")
     })

Render:
  ┌──────────────────────────────────────────────────────┐
  │ Connect your local server                            │
  │                                                      │
  │ Option A — Quick test (run once):                    │
  │ ┌──────────────────────────────────────────────────┐ │
  │ │ autossh -M 0 -N \                                │ │
  │ │   -R 0:localhost:22 \                            │ │
  │ │   -R 0:localhost:80 \                            │ │
  │ │   -p 2222 {TOKEN}@appos.example.com              │ │
  │ └──────────────────────────────────────────────────┘ │
  │                                          [Copy]      │
  │                                                      │
  │ Option B — Persistent service (recommended):         │
  │ ┌──────────────────────────────────────────────────┐ │
  │ │ curl -fsSL {setupScriptUrl} | bash               │ │
  │ └──────────────────────────────────────────────────┘ │
  │                                          [Copy]      │
  │                                                      │
  │  ● Waiting for connection...             [Later]     │
  │  (turns green + "Connected!" on tunnel_status=online)│
  └──────────────────────────────────────────────────────┘

On "Later": close dialog; server row shows tunnel_status = offline badge.
On connected: show success state 2 s, then close.
On unmount: pb.collection("servers").unsubscribe(id)
```

#### Servers list — tunnel_status badge

In `servers.tsx` columns, add a `tunnel_status` column rendered only for tunnel servers:

```tsx
{
  key: "tunnel_status",
  label: "Tunnel",
  render: (v, row) => {
    if (row.connect_type !== "tunnel") return null
    return <Badge variant={v === "online" ? "success" : "secondary"}>
      {v === "online" ? "Online" : "Offline"}
    </Badge>
  }
}
```

#### Token rotation — in server detail / edit dialog

Add a "Rotate Token" button in the server edit view (tunnel servers only):

```
[Rotate Token]
→ opens confirmation dialog:
  "This will immediately disconnect the tunnel. You must update and restart
   the service on the local server with the new token."
  [Cancel]  [Rotate]
→ POST /api/ext/tunnel/servers/:id/token
→ shows new token (one-time) with copy button
→ shows updated autossh command
```

---

## Audit events

| Event | When |
|-------|------|
| `tunnel.connect` | Tunnel session established |
| `tunnel.disconnect` | Tunnel session dropped |
| `tunnel.token_generated` | New token created (POST /token, first time) |
| `tunnel.token_rotated` | Token rotated (POST /token, existing) |
| `tunnel.port_conflict_resolved` | Persisted port occupied at startup, new port assigned |

---

## Acceptance Criteria

- [x] Migration adds `connect_type`, `tunnel_status`, `tunnel_last_seen`, `tunnel_services` to `servers` — existing direct servers unaffected
- [x] Migration seeds `tunnel.port_range_start` and `tunnel.port_range_end` in `app_settings`
- [x] `POST /api/ext/tunnel/servers/:id/token` returns a plaintext base32 token; token stored AES-encrypted in `secrets`
- [x] `GET /api/ext/tunnel/servers/:id/setup` returns valid `autossh_cmd` and `systemd_unit` strings using the appos host URL
- [x] Setup shell script (`/tunnel/setup/{token}`) installs autossh if absent and creates + enables the systemd service
- [x] After `autossh` connects, `tunnel_status` changes to `"online"` in PocketBase within 5 s
- [x] `TunnelSetupWizard` detects `tunnel_status = online` via PB Realtime and shows "Connected" state
- [x] After appos restart, reconnecting `autossh` restores the same `tunnel_port` values (persistent assignment)
- [x] `WS /api/ext/terminal/ssh/:serverId` works for a tunnel server (resolveServerConfig override)
- [x] All SFTP routes work for a tunnel server
- [x] `connect_type = direct` Add Server flow is unchanged
- [x] Token rotation immediately closes the active tunnel; old token rejected on reconnect
- [ ] Rotation dialog shows explicit warning before proceeding  _(UI dialog deferred — rotation is API-accessible)_
- [x] `tunnel_status` badge visible in servers list (green = online, grey = offline)
- [x] All audit events written correctly for connect, disconnect, token generate/rotate, port conflict

---

## Files Created / Modified

### New
- `backend/internal/routes/tunnel.go` — pbTokenValidator, pbSessionHooks, registerTunnelRoutes, all handlers
- `backend/internal/migrations/1741500000_add_tunnel_fields.go` — schema: connect_type, tunnel_status, tunnel_last_seen, tunnel_services
- `backend/internal/migrations/1741500001_seed_tunnel_settings.go` — tunnel port_range default settings
- `backend/internal/migrations/1741500002_add_tunnel_token_type.go` — adds `tunnel_token` to secrets.type select allowed values
- `dashboard/src/components/servers/TunnelSetupWizard.tsx` — wizard UI with PB Realtime subscription

### Modified
- `backend/internal/routes/routes.go` — added `registerTunnelRoutes(se, g)` call
- `backend/internal/routes/resources.go` — added `connect_type` to serverFields
- `backend/internal/routes/terminal.go` — added tunnel SSH port override in resolveServerConfig
- `dashboard/src/components/resources/ResourcePage.tsx` — added `onCreateSuccess` callback to ResourcePageConfig
- `dashboard/src/routes/_app/_auth/resources/servers.tsx` — connect_type field, tunnel_status column, wizard integration

---

## Dev Agent Record

**Agent**: Amelia (dev)
**Completed**: Story 16.2 done. Backend compiles cleanly (`go build ./...`, `go vet ./...`). Frontend type-checks cleanly (`tsc --noEmit`). All 27 tunnel tests pass. One AC deferred: rotation dialog warning (UI polish only; rotation itself works via `?rotate=true`).

### Code Review #1 (AI) — post-implementation
**Outcome:** Changes Requested | **Date:** 2026-02-27 | **Resolved:** All

- [x] [High] Wizard called `POST /token` on every open — rotated token and disconnected active tunnel accidentally. Fixed: wizard calls `GET /setup` first; `POST /token` only on first-time create path
- [x] [High] `POST /token` always rotated — made idempotent (return existing token by default; `?rotate=true` for explicit rotation)
- [x] [High] `secrets.type` select field did not include `tunnel_token` value — token create failed silently. Fixed: migration `1741500002_add_tunnel_token_type.go`
- [x] [Med] `OnDisconnect` overwrote `online` status when old session's defer ran after new session's `OnConnect` (kick race). Fixed: check registry before marking offline
- [x] [Med] Setup script did not stop existing service before overwrite — `systemctl restart` not triggered. Fixed: added `systemctl stop appos-tunnel || true` before writing unit file
- [x] [Med] `GET /setup` did not return token — wizard had to make a separate call. Fixed: token included in response
- [x] [Low] `uninstallScript` recreated on every render — moved to module-level const
- [x] [Low] Realtime callback used stale `status` via closure — replaced with `statusRef`
