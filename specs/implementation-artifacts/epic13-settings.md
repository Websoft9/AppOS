# Epic 13: Settings Management

## Overview

**Objective**: Unified settings page — PocketBase built-in settings + AppOS custom (Ext) settings in one Dashboard view.

**Priority**: P2 | **Status**: in-progress | **Depends on**: Epic 1, Epic 3

---

## Two Settings Domains

| Domain | Storage | API | Auth |
|--------|---------|-----|------|
| **PB Settings** | `_params` table (PB internal) | `/api/settings` | superuser |
| **Ext Settings** | `app_settings` collection | `/api/settings/workspace/{module}` | superuser |

---

## PB Settings Scope

Dashboard calls PB `/api/settings` directly — no new backend code.

| Section | Key Fields |
|---------|------------|
| Application | `meta.appName`, `meta.appURL` |
| SMTP | `enabled`, `host`, `port`, `username`, `password`, `authMethod`, `tls`, `localName` |
| S3 | `enabled`, `bucket`, `region`, `endpoint`, `accessKey`, `secret`, `forcePathStyle` |
| Logs | `maxDays`, `minLevel`, `logIP`, `logAuthId` |

---

## Ext Settings Scope

| Module | Group | Fields |
|--------|-------|--------|
| `space` | `quota` | `maxSizeMB`, `maxPerUser`, `maxUploadFiles`, `shareMaxMinutes`, `shareDefaultMinutes`, `uploadAllowExts[]`, `uploadDenyExts[]` |
| `connect` | `terminal` | `idleTimeoutSeconds`, `maxConnections` |
| `proxy` | `network` | `httpProxy`, `httpsProxy`, `noProxy`, `username`, `password`* |
| `docker` | `mirror` | `mirrors[]`, `insecureRegistries[]` |
| `docker` | `registries` | `items: [{host, username, password*}]` |
| `llm` | `providers` | `items: [{name, endpoint, apiKey*}]` |

`connect.terminal.maxConnections` default is `0` (unlimited).

Data model (`app_settings` collection), API contract, seed values, mask semantics → Story 13.1 / 13.2 / 13.5.

---

## Key Design Decisions

- **Sensitive fields** (`password`, `apiKey`, `secret`): GET returns `"***"`, PATCH `"***"` preserves existing value
- **Array groups** (`registries`, `providers`): `{"items":[...]}` wrapper, UI sends full list (replace semantics)
- **Code-level defaults**: `GetGroup` always returns `(fallback, err)`, never `(nil, err)`
- **No SSO with PB Admin**: self-built UI + escape hatch link to `/_/`

---

## Stories

| Story | Title |
|-------|-------|
| 13.1 | Settings foundation (collection + helper + Ext API) |
| 13.2 | Migrate file constants → settings DB (resolves Story 9.5) |
| 13.3 | PB Settings UI (Application + SMTP + S3 + Logs) |
| 13.4 | Ext Settings UI — Space quota (+ upload allow/deny lists) |
| 13.5 | Ext infra backend (proxy/docker/llm seed + mask) |
| 13.6 | Ext infra UI (proxy/docker/llm cards) |
| 13.7 | Connect terminal settings UI (`idleTimeoutSeconds`, `maxConnections`) |

**Execution**: 13.1 → 13.2 → 13.3 (parallelisable after 13.1) → 13.4 → 13.5 → 13.6 → 13.7 (after 13.6)

---

## Out of Scope

- Backups / Crons / Sync — dedicated future module
- RateLimits / Batch / TrustedProxy UI
- Non-superuser preferences
- Settings import/export
- Settings change audit

---

## Proposed Follow-up (from Epic 15 UX cycle)

Epic keeps only theme-level follow-up direction:

- Connect session continuity policy (resume TTL)
- Per-server panel cache governance (bounded memory)
- Optional persistence policy for split/layout preferences

Detailed field proposals are maintained in Story 13.7 to avoid Epic/Story duplication.

These are backlog items and not required for current Epic 13 completion.
