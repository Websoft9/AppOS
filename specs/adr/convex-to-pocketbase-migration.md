# ADR: Convex to PocketBase Migration

**Date**: 2026-02-12  
**Status**: Implemented  
**Decision Makers**: Dev Team  

---

## Context

During Story 1.1 implementation (Container Build & Deployment), we encountered critical binary compatibility issues preventing Convex from running in our Alpine Linux-based container:

**Technical Issues**:
- Host-compiled Go backend (glibc) incompatible with Alpine (musl) → exit 127
- Convex backend requires glibc 2.38+ (Alpine provides 2.35)
- Symbol errors: `__isoc23_sscanf`, `libstdc++.so.6` missing

**Attempted Solutions**:
1. Add `gcompat` package → Insufficient
2. Add `libstdc++` library → Insufficient  
3. Add full glibc 2.35 + `/lib64` symlink → Still insufficient (requires 2.38+)

**Options Evaluated**:
- Option A: Upgrade to Debian base image (native glibc 2.38+) → +400MB image size
- Option B: Separate Convex container (docker-compose services) → Complexity increase
- Option C: Replace with PocketBase → **Selected**

---

## Decision

**Replace Convex with PocketBase v0.36.2** as the BaaS platform for AppOS.

---

## Rationale

### Why PocketBase?

| Aspect | Convex | PocketBase | Winner |
|--------|--------|------------|--------|
| **Compatibility** | Requires glibc 2.38+ | Go binary, native Alpine | ✅ PocketBase |
| **Image Size** | 526MB (with workarounds) | 195MB | ✅ PocketBase |
| **Dependencies** | External glibc deps | Zero external deps | ✅ PocketBase |
| **Admin UI** | Separate dashboard | Built-in at `/pb/_/` | ✅ PocketBase |
| **Database** | Custom | SQLite (industry standard) | ✅ PocketBase |
| **Auth** | Custom SDK | JWT + built-in | ✅ PocketBase |
| **Realtime** | Reactive queries | Server-Sent Events + subscriptions | ✅ Both |
| **Maturity** | Beta (self-hosted) | Stable, production-ready | ✅ PocketBase |

### Key Benefits

1. **Native Alpine Compatibility**: Single Go binary, no glibc dependencies
2. **Smaller Footprint**: 195MB vs 526MB container image (63% reduction)
3. **SQLite-Based**: Industry-standard database, easy backups
4. **Built-in Admin UI**: No separate dashboard needed (`/pb/_/`)
5. **Zero Configuration**: Works out-of-box, no dependency hell
6. **Production Ready**: Stable v0.36.2, active community

---

## Implementation Changes

### Configuration Files Updated

1. **build/supervisord.conf**:
   ```diff
   - [program:convex]
   - command=/usr/local/bin/convex-backend
   - http=127.0.0.1:3210
   + [program:pocketbase]
   + command=/usr/local/bin/pocketbase serve --dir /appos/data/pocketbase --http 127.0.0.1:8090
   ```

2. **build/nginx.conf**:
   ```diff
   - location /convex/ {
   -     proxy_pass http://127.0.0.1:3210/;
   + location /pb/ {
   +     proxy_pass http://127.0.0.1:8090/;
   ```

3. **build/entrypoint.sh**:
   ```diff
   - mkdir -p /appos/data/convex
   + mkdir -p /appos/data/pocketbase
   ```

4. **backend/internal/config/config.go**:
   ```diff
   - ConvexURL      string `env:"CONVEX_URL"`
   - ConvexDeployKey string `env:"CONVEX_DEPLOY_KEY"`
   + PocketBaseURL   string `env:"POCKETBASE_URL" envDefault:"http://127.0.0.1:8090"`
   + PocketBaseToken string `env:"POCKETBASE_TOKEN"`
   ```

5. **build/Dockerfile.local** & **build/Dockerfile**:
   ```diff
   - ADD convex-backend /usr/local/bin/
   + RUN wget -O /tmp/pocketbase.zip https://github.com/pocketbase/pocketbase/releases/download/v0.36.2/pocketbase_0.36.2_linux_amd64.zip \
   +     && unzip /tmp/pocketbase.zip -d /usr/local/bin/ \
   +     && chmod +x /usr/local/bin/pocketbase
   ```

### API Endpoints Changed

| Aspect | Convex | PocketBase v0.36.2 |
|--------|--------|-------------------|
| **Auth Endpoint** | `/api/admins/auth-with-password` | `/api/collections/_superusers/auth-with-password` |
| **API Base** | `/convex/api/` | `/pb/api/` |
| **Admin UI** | External | `/pb/_/` |
| **Health Check** | Custom | `/pb/api/health` |

### Data Structure

**Before** (`/appos/data/`):
```
├── redis/
├── convex/
├── apps/
└── appos.db
```

**After** (`/appos/data/`):
```
├── redis/
├── pocketbase/
│   ├── data.db        # Main database
│   └── auxiliary.db   # System metadata
├── apps/
└── appos.db
```

---

## Migration Impact

### Breaking Changes

1. **Authentication**: Superuser auth endpoint changed
   - Old: `POST /api/admins/auth-with-password`
   - New: `POST /api/collections/_superusers/auth-with-password`

2. **Admin Access**: UI location changed
   - Old: Separate Convex dashboard
   - New: Built-in at `http://localhost:9091/pb/_/`

3. **Superuser Management**: CLI command changed
   - Create: `pocketbase superuser create EMAIL PASS`
   - Update: `pocketbase superuser update EMAIL NEW_PASS`
   - Upsert: `pocketbase superuser upsert EMAIL PASS`

### Non-Breaking Changes

- Backend API remains compatible (abstraction layer unchanged)
- Dashboard code can continue using REST API patterns
- Data persistence location unchanged (`/appos/data/`)

---

## Verification

### Successful Tests

✅ Container builds successfully (195MB)  
✅ All services start: redis, pocketbase, backend, nginx  
✅ PocketBase API responds at `/pb/api/health`  
✅ Superuser created via CLI  
✅ Admin UI accessible at `/pb/_/`  
✅ Auth endpoint working (returns JWT token)  
✅ Nginx routing correctly configured  

### Pending Tests

⏳ Backend integration with PocketBase SDK  
⏳ Realtime subscriptions from Dashboard  
⏳ Data persistence after container restart  

---

## Rollback Plan

If PocketBase proves insufficient:

1. **Immediate Rollback**: Revert to git commit before migration
2. **Alternative Option**: Switch to Debian base image + Convex
3. **Nuclear Option**: Separate Convex container in docker-compose

**Risk Assessment**: Low - PocketBase is stable and production-ready.

---

## Documentation Updates

Files updated to reflect PocketBase:
- ✅ `specs/implementation-artifacts/story1.1-container-build.md`
- ✅ `specs/implementation-artifacts/story1.2-makefile.md`
- ✅ `specs/planning-artifacts/architecture.md`
- ✅ Created: `POCKETBASE-USAGE.md` (comprehensive guide)
- ✅ This ADR: `specs/adr/convex-to-pocketbase-migration.md`

---

## References

- PocketBase Official: https://pocketbase.io/
- PocketBase GitHub: https://github.com/pocketbase/pocketbase
- Release v0.36.2: https://github.com/pocketbase/pocketbase/releases/tag/v0.36.2
- Alpine glibc Issue: https://github.com/sgerrand/alpine-pkg-glibc/issues/176

---

## Lessons Learned

1. **Binary Compatibility Matters**: Always verify glibc requirements before choosing dependencies
2. **Simpler is Better**: Native Go binaries > cross-compiled binaries with compatibility layers
3. **Evaluate Alternatives Early**: Don't wait until deployment issues to explore options
4. **Document Everything**: Migration decisions should be recorded for future reference

---

**Status**: ✅ Migration Complete  
**Next Steps**: Complete backend integration with PocketBase SDK (Story 2.x)
