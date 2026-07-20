# Epic 33: App Migration

**Module**: Application Lifecycle | **Status**: Proposed | **Priority**: P2 | **Depends on**: Epic 4, 14, 16, 17, 20

## Overview

将托管服务器上已有但未被管理的 Docker Compose 应用导入到 AppOS 管理体系，导入后的效果与通过 AppOS 原生部署的应用基本一致。

核心理念：**Wrap, not rewrite**。保留所有业务配置（image、ports、volumes、environment 等），注入 AppOS 的身份标识和管理外壳。

## Identity & Discovery

三类标记（无服务级 labels）：

| 标记 | 位置 | 用途 |
|------|------|------|
| Project name `appos-{app_id}` | Docker Compose project name | `docker compose ls` 直接区分 |
| Folder `/opt/appos/compose/{app_id}/` | 托管服务器文件系统 | 路径即身份 |
| `x-appos` 块 | GitOps 仓库中的 IaC 模板 | 来源追溯、平台元数据 |

### 野应用发现

```
1. docker compose ls → 过滤 appos- 前缀
2. 扫描 compose 路径，排除 /opt/appos/compose/
3. 读取 x-appos.managed 二次确认
4. 剩余 → 迁移候选
```

## IaC vs 运行时 双层模型

```
IaC 模板（GitOps）                      render（去 x-appos，展开变量）
apps/{name}/docker-compose.yml   ─────────────────────────────────→  运行时文件
含 x-appos 块 + 变量占位符                                           /opt/appos/compose/{id}/docker-compose.yml
                                                                     纯 compose，无 x-appos
                                         迁移（transform）
                                   ←───────────────────────────────  注入 x-appos + 标准化
```

## Data Model

AppInstance 新增字段：

```json
{
  "source": "migrated",
  "migration_origin": {
    "server_path": "/opt/myapp/docker-compose.yml",
    "migrated_at": "2026-06-10T...",
    "original_hash": "sha256:abc123..."
  }
}
```

关系：**1 个 compose 文件 = 1 个 AppInstance**（多 service 不拆分）

## Transform Rules

| 操作 | 规则 |
|------|------|
| **保留** | image, ports, volumes, environment, depends_on, command, entrypoint |
| **注入** | x-appos 块、restart/logging 标准化 |
| **处理** | container_name 冲突 → 重命名；已有 labels → 合并不覆盖 |

## UX Flow

1. 选择目标服务器
2. 自动发现野生 compose 项目（排除已管理）
3. 逐应用确认名称 / 模板
4. 执行迁移：注入 x-appos → 写入 IaC → 创建 AppInstance + Deployment → 容器零中断

## Stories

- [Story 33.1: Discovery Engine](story33.1-discovery.md) — 托管服务器侧扫描野 compose 项目
- [Story 33.2: Transform Engine](story33.2-transform.md) — 运行时 compose → IaC 模板
- [Story 33.3: Registration Pipeline](story33.3-registration.md) — AppInstance + Deployment 创建
- [Story 33.4: Migration Wizard UX](story33.4-wizard.md) — 前端 4 步向导
- [Story 33.5: End-to-End Integration](story33.5-integration.md) — 全链路联调、fixture
