# Epic 8: Resource Store

## Overview

**Platform-level shared resource management** — servers, secrets, environment variable groups, databases, cloud accounts, certificates, integrations, and scripts that can be referenced by multiple applications. Resources are platform-defined (not user-extensible), each with its own PocketBase Collection and migration. Apps reference resources; they don't own them.

**Status**: Done | **Priority**: P1 | **Depends on**: Epic 1, Epic 3

## Frontend Navigation

Resource Store uses a **two-level sidebar menu**:

```
Resources (一级)
  ├── Servers
  ├── Secrets
  ├── Env Groups
  ├── Databases
  ├── Cloud Accounts
  ├── Certificates
  ├── Integrations
  └── Scripts
```

Each sub-item is a full list + form page. Route structure: `/resources/:type` (e.g. `/resources/servers`, `/resources/secrets`).

## Scope Design: Secrets vs Env Vars vs App Credentials

Three distinct layers handle sensitive and non-sensitive config:

**Secrets — Resource Store only (no app scope)**
Regardless of whether a secret is used by one app or many, it must always be created in the Resource Store. This enforces consistent encryption handling. The extra step is intentional friction.

**Env Vars — two separate layers**

| Layer | Location | Use case |
|-------|----------|----------|
| App inline env vars | `apps.env_vars` (JSON key-value) | App-specific, non-sensitive config |
| Resource Store Env Groups | `env_groups` collection | Shared, reusable across apps |

If an inline env var needs to be sensitive, it must instead be stored as an App Credential (see below).

**App Credentials — App-scoped encrypted key-value**
Deployment passwords (e.g. app admin password, internal DB password) are App-specific runtime credentials. They are not shared, not reusable, and must not be placed in the Resource Store.

| Dimension | Resource Store Secret | App Credential |
|-----------|----------------------|----------------|
| Scope | Platform-wide, reusable | Single App, non-shareable |
| Lifecycle | Independent | Created and deleted with the App |
| Location | `secrets` collection | `apps.credentials` JSON (encrypted) |
| UI | Resource Store pages | App detail page |
| Encryption | Same underlying mechanism | Same underlying mechanism |

This means the `apps` collection carries:
- `env_vars` JSON — inline non-sensitive key-value (no encryption)
- `credentials` JSON — inline sensitive key-value (encrypted, App-scoped)
- `secrets[]` Relation — references to Resource Store secrets
- `env_groups[]` Relation — references to Resource Store env groups

## Architecture

```
Resource Store (independent collections)
  ├── resource_groups → User-defined cross-type grouping labels
  ├── servers       → SSH targets for app deployment
  ├── secrets       → Encrypted credentials, tokens, keys
  ├── env_groups    → Reusable environment variable sets
  │     └── env_group_vars (child records)
  ├── databases     → External DB connections (password → secrets)
  ├── cloud_accounts → Cloud provider credentials (secret → secrets)
  ├── certificates   → TLS certs, private key → secrets
  ├── integrations   → External integration endpoints (credential → secrets)
  └── scripts        → Reusable scripts (`python3` / `bash`)

Apps collection
  ├── env_vars      → JSON (non-sensitive inline config)
  ├── credentials   → JSON encrypted (App-scoped deployment passwords)
  └── references    → server, secrets[], env_groups[], databases[], cloud_accounts[], certificates[], integrations[], scripts[]

Resource Groups (many-to-many)
  └── each resource collection carries a `groups` Relation[] → resource_groups
      (PocketBase native multi-relation; no junction table needed)
```

Resources are managed via PocketBase Collection API (Go migrations). Each resource type is a separate collection — no generic/EAV tables.

## Collections

### `resource_groups`
User-defined cross-type grouping labels (tag-like). One system-seeded `default` group.

| Field | Type | Notes |
|-------|------|-------|
| name | Text | required, unique |
| description | Text | |
| is_default | Bool | true only for the seeded `default` group; UI hides delete for this record |

> **Migration seed**: The `default` group is inserted at migration time. All existing resource records are back-filled with the `default` group id in their `groups` field.

### `servers`
SSH-accessible deployment targets.

| Field | Type | Notes |
|-------|------|-------|
| name | Text | required |
| host | Text | IP or hostname |
| port | Number | default 22 |
| user | Text | SSH user |
| auth_type | Select | `password` / `key` |
| credential | Relation | → secrets |
| description | Text | |
| groups | Relation[] | → resource_groups; auto-filled with `default` on create if empty |

### `secrets`
Encrypted sensitive values.

| Field | Type | Notes |
|-------|------|-------|
| name | Text | required |
| type | Select | `password` / `api_key` / `token` / `ssh_key` |
| value | Text | encrypted at rest |
| description | Text | |
| groups | Relation[] | → resource_groups; auto-filled with `default` on create if empty |

### `env_groups`
Named sets of environment variables, composable across apps.

| Field | Type | Notes |
|-------|------|-------|
| name | Text | required |
| description | Text | |
| groups | Relation[] | → resource_groups; auto-filled with `default` on create if empty |

### `env_group_vars`
Child records of env_groups.

| Field | Type | Notes |
|-------|------|-------|
| group | Relation | → env_groups, required |
| key | Text | required |
| value | Text | must be empty when is_secret=true |
| is_secret | Bool | mutually exclusive with value |
| secret | Relation | → secrets; required when is_secret=true, otherwise empty |

### `databases`
External database connections. Password always references secrets.

| Field | Type | Notes |
|-------|------|-------|
| name | Text | required |
| type | Select | `mysql` / `postgres` / `mariadb` / `redis` / `mongodb` / `clickhouse` / `neo4j` / `qdrant` / `elasticsearch` / `sqlite` |
| host | Text | |
| port | Number | |
| db_name | Text | |
| user | Text | |
| password | Relation | → secrets |
| description | Text | |
| groups | Relation[] | → resource_groups; auto-filled with `default` on create if empty |

### `cloud_accounts`
Cloud provider credentials for AWS, Aliyun, Azure, GCP, etc.

| Field | Type | Notes |
|-------|------|-------|
| name | Text | required |
| provider | Select | `aws` / `aliyun` / `azure` / `gcp` |
| access_key_id | Text | non-sensitive identifier (AWS AK ID, Azure Client ID) |
| secret | Relation | → secrets (the actual credential) |
| region | Text | default region |
| extra | JSON | provider-specific non-sensitive fields (e.g. Azure tenant_id, subscription_id) |
| description | Text | |
| groups | Relation[] | → resource_groups; auto-filled with `default` on create if empty |

### `certificates`
TLS certificates. Private key stored as a secret; cert (public) stored as plain text.

| Field | Type | Notes |
|-------|------|-------|
| name | Text | required |
| domain | Text | primary domain (e.g. *.example.com) |
| cert_pem | Text | public certificate chain (PEM) |
| key | Relation | → secrets (private key) |
| expires_at | DateTime | certificate expiry |
| auto_renew | Bool | default false |
| description | Text | |
| groups | Relation[] | → resource_groups; auto-filled with `default` on create if empty |

### `integrations`
External endpoints: REST APIs, outbound webhooks, and MCP servers.

| Field | Type | Notes |
|-------|------|-------|
| name | Text | required |
| type | Select | `rest` / `webhook` / `mcp` |
| url | Text | required |
| auth_type | Select | `none` / `api_key` / `bearer` / `basic` |
| credential | Relation | → secrets (optional) |
| extra | JSON | headers, event types, MCP transport params, etc. |
| description | Text | |
| groups | Relation[] | → resource_groups; auto-filled with `default` on create if empty |

`type` is UI/consumer hint only — storage schema is identical for all three.

### `scripts`
Reusable scripts for automation and operations.

| Field | Type | Notes |
|-------|------|-------|
| name | Text | required |
| language | Select | `python3` / `bash` |
| code | Text | required, script content |
| description | Text | |
| groups | Relation[] | → resource_groups; auto-filled with `default` on create if empty |

## API Routes

All under `/api/ext/resources/`. All require authentication.

### Resource Groups

| Method | Path | Description |
|--------|------|-------------|
| GET | `/groups` | List all resource groups (with resource count) |
| POST | `/groups` | Create resource group |
| GET | `/groups/:id` | Get group detail |
| PUT | `/groups/:id` | Update group |
| DELETE | `/groups/:id` | Delete group (blocked if `is_default=true`) |
| GET | `/groups/:id/resources` | List all resources in the group (cross-type, unified response with `type` field) |
| POST | `/groups/:id/resources/batch` | Batch add/remove resources to/from the group (`action: "add"\|"remove"`, `items: [{type, id}]`) |

### Resources

| Method | Path | Description |
|--------|------|-------------|
| GET | `/servers` | List all servers |
| POST | `/servers` | Create server |
| GET | `/servers/:id` | Get server |
| PUT | `/servers/:id` | Update server |
| DELETE | `/servers/:id` | Delete server |
| GET | `/secrets` | List secrets (value field masked) |
| POST | `/secrets` | Create secret |
| GET | `/secrets/:id` | Get secret (value visible to superuser only) |
| PUT | `/secrets/:id` | Update secret |
| DELETE | `/secrets/:id` | Delete secret |
| GET | `/env-groups` | List env groups with vars |
| POST | `/env-groups` | Create env group |
| GET | `/env-groups/:id` | Get env group with vars |
| PUT | `/env-groups/:id` | Update env group and vars |
| DELETE | `/env-groups/:id` | Delete env group and all vars |
| GET | `/databases` | List databases (password masked) |
| POST | `/databases` | Create database connection |
| GET | `/databases/:id` | Get database connection |
| PUT | `/databases/:id` | Update database connection |
| DELETE | `/databases/:id` | Delete database connection |
| GET | `/cloud-accounts` | List cloud accounts (secret masked) |
| POST | `/cloud-accounts` | Create cloud account |
| GET | `/cloud-accounts/:id` | Get cloud account |
| PUT | `/cloud-accounts/:id` | Update cloud account |
| DELETE | `/cloud-accounts/:id` | Delete cloud account |
| GET | `/certificates` | List certificates |
| POST | `/certificates` | Create certificate |
| GET | `/certificates/:id` | Get certificate |
| PUT | `/certificates/:id` | Update certificate |
| DELETE | `/certificates/:id` | Delete certificate |
| GET | `/integrations` | List integrations |
| POST | `/integrations` | Create integration |
| GET | `/integrations/:id` | Get integration |
| PUT | `/integrations/:id` | Update integration |
| DELETE | `/integrations/:id` | Delete integration |
| GET | `/scripts` | List scripts |
| POST | `/scripts` | Create script |
| GET | `/scripts/:id` | Get script |
| PUT | `/scripts/:id` | Update script |
| DELETE | `/scripts/:id` | Delete script |

## Permission Rules

- **List / View**: authenticated users (except `secrets`)
- **Secrets List / View**: superuser only (Phase 1)
- **Create / Update / Delete**: superuser only (Phase 1)
- **Secret values**: never returned in list responses; only returned via `GET /secrets/:id` to superuser
- **Certificate private key**: never returned from certificate endpoints; private key is only referenced via `certificates.key -> secrets`

## Extensibility

New resource types → new collection + migration + route group. No changes to existing collections. Naming convention: plural snake_case (`registries`, `git_repos`).

## Stories

- [x] 8.1: Migrations — define all collections via PocketBase Go migrations (servers, secrets, env_groups, env_group_vars, databases, cloud_accounts, certificates)
- [x] 8.1b: Migration — add `integrations` collection
- [x] 8.1c: Migration — add `scripts` collection
- [x] 8.2: Backend routes — CRUD API for all resource types
- [x] 8.2b: Backend routes — CRUD API for integrations
- [x] 8.2c: Backend routes — CRUD API for scripts
- [x] 8.3: Secret encryption — AES-256-GCM via `internal/crypto`, keyed by `APPOS_ENCRYPTION_KEY` env var
- [x] 8.4: Dashboard UI — Resource Hub + list/form pages for all 6 types
- [x] 8.4b: Dashboard UI — Integrations list/form page + Hub card
- [x] 8.4c: Dashboard UI — Scripts list/form page + Hub card
- [x] 8.5: App resource binding — `env_vars`, `credentials` (encrypted) JSON + relation fields on Apps collection (`1740100000_add_apps_resource_bindings.go`)
- [x] 8.6: Resource Groups — Migration: `resource_groups` collection + seed `default` group + back-fill `groups` field on all 8 resource collections
- [x] 8.7: Resource Groups — Backend API: CRUD for `/groups`, cross-type list (`/groups/:id/resources`), batch add/remove (`/groups/:id/resources/batch`)
- [x] 8.8: Resource Groups — Dashboard UI: Groups management page (`/resources/groups`), group detail page with unified resource list + batch assign/remove; `[Resource Groups]` link on Hub page; `Groups` multi-select field in all resource create/edit forms; multi-select + batch toolbar on each resource list page

## Implementation Notes (Dashboard UI)

### Resource Hub 卡片布局
- 图标 + 标题 + `(n)` 数量在同一行，数量字体与标题一致（`text-sm font-medium`），颜色 `text-muted-foreground`
- 描述文字在图标/标题行下方，左对齐图标右侧
- 加载中时在括号位置显示内联 spinner

### Navigation structure
Resources is a single sidebar entry (no sub-items). Clicking it opens the **Resource Hub** at `/resources` — a card grid showing all 8 resource types with live counts. Each card is fully clickable and navigates to the resource list page (`/resources/servers`, etc.). No action buttons on the Hub; `[+ Create]` lives only on the list page.

```
Sidebar: Resources  →  /resources (Hub: 8 cards with counts)
                             ↓  click card
                        /resources/secrets  (list + Create button)
```

Hub 页右上角有两个并排操作入口：

- **[Resource Groups]** 链接 → 导航至 `/resources/groups`（资源组管理页）
- **[+ Add Resource ▾]** 按钮 → Popover 下拉菜单，列出全部 8 种资源类型

```
[Resource Groups]   [+ Add Resource ▾]
                    ┌─────────────────┐
                    │  Server         │  → /resources/servers?create=1
                    │  Secret         │  → /resources/secrets?create=1
                    │  Env Group      │  → /resources/env-groups?create=1
                    │  Database       │  → /resources/databases?create=1
                    │  Cloud Account  │  → /resources/cloud-accounts?create=1
                    │  Certificate    │  → /resources/certificates?create=1
                    │  Integration    │  → /resources/integrations?create=1
                    │  Script         │  → /resources/scripts?create=1
                    └─────────────────┘
```

设计原则：Popover 而非 Modal，减少交互层级；熟练用户两次点击完成创建导航。

### Resource Groups UI

**Groups 管理页** (`/resources/groups`)
- 表格：Name / Description / Resource Count / Actions
- `default` 组：Delete 按钮禁用，显示 lock 图标
- 点击行 → 进入 Group 详情页

**Group 详情页** (`/resources/groups/:id`)
- 统一列表展示组内所有资源：Type / Name / Description / Actions（移出本组）
- 支持按 Type 过滤
- 右上角 **[+ Add Resources]** 按钮：打开多选弹窗，按类型 tab 浏览并选择资源加入本组

**Assign to Groups 批量工具栏**（`/resources/servers` 等）
- 列表行支持多选（checkbox）
- 多选后底部出现批量工具栏：**[Assign to Groups]** 按钮
- 点击按钮打开 Dialog，列出所有 group（Checkbox 多选），确认后批量分配，支持一次分配到多个 group
- 批量工具栏同时显示已选数量

**资源创建 / 编辑表单**
- 增加 `Groups` 字段：多选下拉，选项来自 `/api/ext/resources/groups`
- 创建时默认已勾选 `default` 组
- 适用于所有 8 种资源类型（`ResourcePage` 通用 fieldDef + `EnvGroupsPage` 各自扩展）

### Groups 路由结构
`/resources/groups` 下有两层路由，需要 layout + index 分离：
- `groups.tsx` — layout，仅含 `<Outlet />`
- `groups.index.tsx` — 列表页组件，route id `/_app/_auth/resources/groups/`
- `groups.$id.tsx` — 详情页，route id `/_app/_auth/resources/groups/$id`

routeTree.gen.ts 中 `AppAuthResourcesGroupsRouteChildren` 包含 `AppAuthResourcesGroupsIndexRoute` 和 `AppAuthResourcesGroupsIdRoute` 两个子路由。

### Generic `ResourcePage` component
All resource types except Env Groups use the shared `ResourcePage` component (`src/components/resources/ResourcePage.tsx`). It supports the following field config options:

| Option | Purpose |
|--------|---------|
| `type: "relation"` | Renders a `<select>` populated from `relationApiPath` (list API returning `{id, name}` records) |
| `type: "file-textarea"` | Multi-line textarea with an Upload button; file content is read client-side and injected into the field |
| `dynamicType` | Overrides `type` at runtime based on another field's value (e.g. `value` field becomes `file-textarea` when `type === "ssh_key"`) |
| `showWhen` | Conditionally hides a field based on another field's value |
| `onValueChange` | Side-effect callback on field change (used for port auto-fill in databases) |

### Sensitive credential handling
All sensitive values are always stored in the `secrets` collection. Other collections reference secrets via PocketBase Relation fields — never store raw credentials in `databases.password`, `cloud_accounts.secret`, `certificates.key`, `servers.credential`, or `env_group_vars.secret`. This is enforced at the UI level by using `type: "relation"` with `relationApiPath: "/api/ext/resources/secrets"`.

### SSH Key
The `secrets.value` field is a single-line password input for `password / api_key / token` types. When `type === "ssh_key"`, `dynamicType` switches the input to `file-textarea`, allowing multi-line PEM content and optional file upload (`.pem`, `.key`, `.txt`).

### Env Groups — custom component
Env Groups require a nested dynamic vars editor (each row: key + value or secret selector) which cannot be expressed in flat `FieldDef[]`. The route uses a standalone `EnvGroupsPage` component instead of `ResourcePage`.

### Databases — port auto-fill & supported types
`type` select 支持 10 种数据库，`onValueChange` 自动填充默认端口：

| Type | 场景 | 默认端口 |
|------|------|---------|
| mysql | 关系型 OLTP | 3306 |
| postgres | 通用关系型 | 5432 |
| mariadb | 关系型 OLTP | 3306 |
| redis | 缓存 / KV | 6379 |
| mongodb | 文档数据库 | 27017 |
| clickhouse | 分析 OLAP | 9000 |
| neo4j | 图数据库 | 7687 |
| qdrant | 向量数据库 | 6333 |
| elasticsearch | 搜索 / 分析 | 9200 |
| sqlite | 嵌入式 / 文件 | — |

> 集合层 `type` 字段 Select 选项同步更新（迁移文件需追加新选项）。

## Dependencies

- Prerequisites: Epic 1 (infra), Epic 3 (auth)
- Consumers (other Epics that read these resources): Epic 4 (remote executor), Epic 6 (app deployment)

## Out of Scope

- Resource operations (SSH connect, DB ping, cert renewal execution) — separate Epic
- App Credentials UI (shown on App detail page, not Resource Store) — App Epic
- User-level resource isolation / per-resource RBAC (Phase 2)
- Secret rotation / audit log (Phase 2)
