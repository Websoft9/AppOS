# Epic 8: Resources

## Overview

**Platform-level shared resource management** — servers, secrets, env groups, databases, cloud accounts, certificates, connectors, and scripts that can be referenced by multiple applications. Resources are platform-defined (not user-extensible), each with its own PocketBase Collection and migration. Apps reference resources; they don't own them.

> Env Groups detail spec: see [Epic 24](epic24-shared-envs.md)

**Status**: Active | **Priority**: P1 | **Depends on**: Epic 1, Epic 3

This epic now covers both:

1. the delivered Phase 1 Resource Store foundation
2. the next-stage resource taxonomy refactor that introduces canonical `Service Instances`, `Platform Accounts`, and `Connectors`

Companion ADR for the next-stage taxonomy: [specs/adr/resource-taxonomy-instance-connector.md](specs/adr/resource-taxonomy-instance-connector.md)

## Current Phase Split

Epic 8 is now split conceptually into two phases.

### Phase 1: Resource Store foundation

Phase 1 delivered the original resource-store model with separate collections such as servers, secrets, databases, cloud accounts, certificates, legacy endpoints, and scripts.

### Phase 2: Resource taxonomy refactor

Phase 2 evolves the original resource-store taxonomy into four canonical resource families:

1. `Servers`
2. `Service Instances`
3. `Platform Accounts`
4. `Connectors`

This phase does not require full operational depth for every instance kind on day one. Its first goal is to stabilize ownership, naming, references, and migration direction.

## Phase 2 Problem Statement

The current model has three structural problems:

1. some long-lived external dependencies are still stored under `settings`
2. the legacy `endpoints` concept is too narrow as a long-term home for all connection-oriented resources
3. there is no canonical home yet for service-like app dependencies such as RDS, object storage, model services, or managed registries

Without the taxonomy refactor, future work on LLM, S3, registry, DNS, SMTP, backup targets, and managed runtime dependencies will continue to drift into inconsistent resource families.

## Phase 2 Goals

Phase 2 of Epic 8 is responsible for:

1. establishing `instances` as a canonical resource family for concrete app dependencies
2. completing the evolution from legacy `endpoints` toward `connectors`
3. defining when a dependency belongs to `instance` versus `connector`
4. moving long-lived resource ownership out of `settings`
5. defining how settings, apps, deploy, and workflows reference the new resource families

## Phase 2 Non-Goals

Phase 2 is not responsible for:

1. delivering full health, backup, discovery, or lifecycle automation for all instance kinds
2. fully modeling every possible provider account integration in one release
3. rewriting all existing resource UIs in one iteration
4. provisioning cloud services directly

## Phase 2 Canonical Resource Families

| Family | Product label | Typical examples |
| --- | --- | --- |
| `server` | `Servers` | server nodes, SSH targets, host compute environments |
| `instance` | `Service Instances` | RDS, MySQL, Redis, Kafka, MinIO, object storage, model services |
| `provider_account` | `Platform Accounts` | AWS account, GitHub installation, Cloudflare account |
| `connector` | `Connectors` | OpenAI, SMTP, DNS, Webhook, MCP, registry login |

Product/UI label uses `Platform Accounts`, while backend domain terminology remains `provider_account`.

## Phase 2 Scope Split

### Track A: Taxonomy and naming

1. define route, collection, and frontend naming for `instances`, `provider accounts`, and `connectors`
2. update resource hub taxonomy and future navigation labels
3. document classification rules for ambiguous technology families such as `llm`, `s3`, and `registry`

### Track B: LLM extraction from settings

1. remove LLM provider ownership from `settings`
2. expose dedicated LLM resource routes during the transition period
3. migrate the current settings-owned LLM provider configuration into `connectors`
4. reserve self-hosted or managed model-service inventory for future `instance` kinds rather than mixing both shapes in one resource type

### Track C: Instance foundation

1. introduce minimal `instances` backend domain and CRUD surface
2. support registration-only instance objects with stable identity semantics
3. enable apps and deploy workflows to reference an instance as a dependency

### Track D: Connector evolution

1. evolve the legacy `endpoints` model toward `connectors`
2. introduce template-aware connector modeling where needed
3. preserve lightweight connection-testing semantics

### Track E: Settings as reference layer

1. convert settings entries that currently own business resources into reference settings where appropriate
2. keep policy and default selection in `settings`
3. stop using `settings` as canonical persistence for long-lived resource objects

## Phase 2 Initial Classification Rules

| Object | Canonical family |
| --- | --- |
| third-party RDS | `instance` |
| self-hosted MySQL or Redis | `instance` |
| object storage used as long-lived app dependency | `instance` |
| self-hosted model service | `instance` |
| current LLM provider configuration migrated from settings | `connector` |
| OpenAI or Anthropic access | `connector` |
| SMTP delivery target | `connector` |
| DNS automation target | `connector` |
| webhook target | `connector` |
| cloud or source-control account | `provider_account` |

## Phase 2 Migration Principles

1. users should see stable product labels before deep backend refactors become visible
2. existing resources must migrate incrementally instead of through one destructive rewrite
3. each migrated object family must end with one canonical owner only
4. backward-compatible transition routes are acceptable during the migration window
5. settings should reference resources, not own them

## Phase 1 Legacy Reference

The remaining sections in this part of the document preserve the original Phase 1 resource-store design for migration context.

Current canonical naming for connection-oriented resources is `Connectors`, surfaced at `/resources/connectors` and `/api/connectors`.

### Frontend Navigation

Resource Store uses a **two-level sidebar menu**:

```
Resources (一级)
  ├── Servers
  ├── Secrets
  ├── Env Groups
  ├── Databases
  ├── Cloud Accounts
  ├── Certificates
  ├── Connectors
  └── Scripts
```

Each sub-item is a full list + form page. Route structure: `/resources/:type` (e.g. `/resources/servers`, `/resources/secrets`).

## Scope Design: Secrets vs Env Vars vs App Credentials

Three distinct layers handle sensitive and non-sensitive config:

**Secrets — Resource Store only (no app scope)**
Regardless of whether a secret is used by one app or many, it must always be created in the Resource Store. This enforces consistent encryption handling. The extra step is intentional friction.

**Env Vars** — see [Epic 24](epic24-shared-envs.md) for the two-layer design (app-inline vs Resource Store Env Groups).

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
- `env_groups[]` Relation — references to Resource Store env groups (see [Epic 24](epic24-shared-envs.md))

### Legacy Phase 1 Architecture

```
Resource Store (independent collections)
  ├── resource_groups → User-defined cross-type grouping labels
  ├── servers       → SSH targets for lifecycle execution and managed app operations
  ├── secrets       → Encrypted credentials, tokens, keys
  ├── env_groups    → see Epic 24
  ├── databases     → External DB connections (password → secrets)
  ├── cloud_accounts → Cloud provider credentials (secret → secrets)
  ├── certificates   → TLS certs, private key → secrets
  ├── connectors     → Reusable external capability access such as REST APIs, outbound webhooks, MCP servers, SMTP, registry, and DNS (credential → secrets)
  └── scripts        → Reusable scripts (`python3` / `bash`)

Apps collection
  ├── env_vars      → JSON (non-sensitive inline config)
  ├── credentials   → JSON encrypted (App-scoped deployment passwords)
  └── references    → server, secrets[], env_groups[], databases[], cloud_accounts[], certificates[], connectors[], scripts[]

Resource Groups (many-to-many)
  └── each resource collection carries a `groups` Relation[] → resource_groups
      (PocketBase native multi-relation; no junction table needed)
```

Resources are managed via PocketBase Collection API (Go migrations). Each resource type is a separate collection — no generic/EAV tables.

### Legacy Phase 1 Collections

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

> **Env Groups** (`env_groups` / `env_group_vars`) — see [Epic 24](epic24-shared-envs.md) for collection schema.

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

### `connectors` (product term: Connectors)
Reusable external capability access: REST APIs, outbound webhooks, MCP servers, SMTP delivery, registry login, and DNS automation.

| Field | Type | Notes |
|-------|------|-------|
| name | Text | required |
| kind | Select | `llm` / `rest_api` / `webhook` / `mcp` / `smtp` / `registry` / `dns` |
| is_default | Bool | explicit runtime default within a kind |
| template_id | Text | built-in connector profile ID |
| endpoint | Text | required for networked connector kinds |
| auth_scheme | Select | `none` / `api_key` / `bearer` / `basic` |
| credential | Relation | → secrets (optional) |
| config | JSON | template-specific fields such as headers, event, region, namespace, TLS, etc. |
| description | Text | |
| groups | Relation[] | → resource_groups; auto-filled with `default` on create if empty |

`template_id` is a profile identifier under a connector kind. Templates provide defaults and field metadata without changing the canonical connector model.

### `scripts`
Reusable scripts for automation and operations.

| Field | Type | Notes |
|-------|------|-------|
| name | Text | required |
| language | Select | `python3` / `bash` |
| code | Text | required, script content |
| description | Text | |
| groups | Relation[] | → resource_groups; auto-filled with `default` on create if empty |

### Legacy Phase 1 API Routes

Phase 1 resource routes lived under `/api/ext/resources/`. Current connector routes are mounted at `/api/connectors`.

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
| *(env-groups)* | — | See [Epic 24](epic24-shared-envs.md) |
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
| GET | `/connectors` | List connectors |
| POST | `/connectors` | Create connector |
| GET | `/connectors/:id` | Get connector |
| PUT | `/connectors/:id` | Update connector |
| DELETE | `/connectors/:id` | Delete connector |
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

## Phase 2 Proposed Stories

### [Story 8.1: Resource Taxonomy Contract](story8.1-resource-taxonomy-contract.md)

Define canonical route names, resource family language, and classification rules for `instance`, `connector`, and `provider_account`.

### [Story 8.2: LLM Ownership Extraction](story8.2-llm-ownership-extraction.md)

Finish extraction of LLM provider ownership from `settings` and place it under the `connectors` resource family. Self-hosted model services remain future `instance` work and are not part of this migration story.

### Story 8.3: Instance Backend Foundation

Introduce `instances` collection, domain model, CRUD API, and minimal validation for registration-only instance objects.

### Story 8.4: Resource Hub and Navigation Refactor

Update dashboard resource navigation to expose `Service Instances`, `Connectors`, and `Platform Accounts` using the canonical product labels.

### [Story 8.5: Endpoints to Connectors Refactor](story8.5-endpoints-to-connectors-refactor.md)

Refactor `endpoints` into `connectors`, preserving existing generic target use cases while tightening connector semantics.

### Story 8.6: Settings Reference Migration

Replace settings-owned business resources with resource references where appropriate.

### [Story 8.7: Connector Domain Foundation](story8.7-connector-domain-foundation.md)

Introduce the minimal reusable connector domain model so current LLM resources and future endpoint migrations share one canonical backend shape.

## Phase 2 Target Route Direction

| Family | Expected backend path |
| --- | --- |
| `server` | `/api/servers` |
| `instance` | `/api/instances` |
| `provider_account` | `/api/provider-accounts` |
| `connector` | `/api/connectors` |

Phase 2 does not require all target routes to exist immediately, but new stories should align with this target naming.

## Stories

- [x] 8.1: Migrations — define all collections via PocketBase Go migrations (servers, secrets, env_groups, env_group_vars, databases, cloud_accounts, certificates)
- [x] 8.1b: Migration — add `integrations` collection for endpoint resources
- [x] 8.1c: Migration — add `scripts` collection
- [x] 8.2: Backend routes — CRUD API for all resource types
- [x] 8.2b: Backend routes — CRUD API for endpoint resources
- [x] 8.2c: Backend routes — CRUD API for scripts
- [x] 8.3: Secret encryption — AES-256-GCM via `internal/crypto`, keyed by `APPOS_ENCRYPTION_KEY` env var
- [x] 8.4: Dashboard UI — Resource Hub + list/form pages for all 6 types
- [x] 8.4b: Dashboard UI — legacy endpoint list/form page + Hub card
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
                    │  Env Group      │  → /resources/env-groups?create=1  *(see Epic 24)*
                    │  Database       │  → /resources/databases?create=1
                    │  Cloud Account  │  → /resources/cloud-accounts?create=1
                    │  Certificate    │  → /resources/certificates?create=1
                    │  Connector      │  → /resources/connectors?create=1
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
All sensitive values are stored in the `secrets` collection (see [Epic 19](epic19-secrets.md)). Other collections reference secrets via PocketBase Relation fields — never store raw credentials directly. Servers now use PB collection API (`/api/collections/secrets/records`) with server-side filter; other resource types will be migrated in Story 19.4.

### SSH Key
The `secrets` module uses file-based templates (`templates.json`). The `ssh_key` template supports `textarea` + `upload: true` for PEM key content.

> **Env Groups** custom component — see [Epic 24](epic24-shared-envs.md) for implementation notes.

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
- Consumers (other Epics that read these resources): Epic 4 (remote executor), Epic 17 (lifecycle execution), Epic 18 (lifecycle management)

## Out of Scope

- Resource operations (SSH connect, DB ping, cert renewal execution) — separate Epic
- App Credentials UI (shown on App detail page, not Resource Store) — App Epic
- User-level resource isolation / per-resource RBAC (Phase 2)
- Secret rotation / audit log (Phase 2)
