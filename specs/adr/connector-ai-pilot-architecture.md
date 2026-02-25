# ADR: Connector Layer, AI Core & Pilot — 平台扩展架构

**Date**: 2026-02-25  
**Status**: Proposed  
**Decision Makers**: Dev Team  

---

## Context

随着 Epic 14（File API）推进，讨论延伸至平台未来如何统一管理对外部服务的访问，并集成 AI 能力。涉及的核心问题：

1. SSH Terminal / SFTP / DB Client / API Debugger 等工具如何避免各自重复实现连接逻辑？
2. Epic 8 Resource Store 已存储连接配置，新工具如何复用而非重复存储？
3. 面向 AI 的工具调用（MCP）与面向人的工作流如何共享基础设施？
4. 各工具的 AI Chat 能力如何统一后端、分散嵌入前端？

---

## 核心决策

### 决策 1：两条执行路径，共享 Connector Layer

AppOS 有两种本质不同的执行范式：

```
路径 A：AI 式（概率性）
  用户自然语言意图 → AI 规划 → MCP Tool Call → 外部服务
  适用场景：探索性任务、未知问题、复杂编排

路径 B：确定性（工作流）
  用户触发事件 → 预定义步骤 → Connector 执行 → 内部/外部服务
  适用场景：生产自动化、定时任务、可审计操作
```

两条路径**共享同一个 Connector Layer**，不各自实现协议细节。

```
Resource Store（凭证 SSOT）
        ↓
Connector Layer（实际执行）
SSH / SFTP / DB / HTTP / ...
    ↑              ↑
MCP Tool Call   工作流 Step
    ↑              ↑
AI Chat UI      工作流编排 UI
```

### 决策 2：Resource Store 是唯一凭证源（SSOT）

Connector API **不存储连接配置**，只做运行时操作。所有凭证和连接参数引用 Epic 8 Resource Store 已有记录：

| Resource Store Collection | 对应用途 |
|--------------------------|---------|
| `servers` | SSH / SFTP 连接目标 |
| `databases` | DB Client 连接参数 |
| `integrations` | HTTP API 端点 + 凭证 |
| `secrets` | 各协议 Token / Key |
| `ai_providers`（新增） | AI Provider 端点 + API Key |

MCP Server 插件的凭证同样引用 Resource Store，不单独存储。

### 决策 3：Connector API 设计原则

```
配置层（Epic 8，已有）     运行时层（Epic 15，新增）
────────────────            ────────────────────────────────
Resource Store              Connector API
  servers/:id      →        POST /api/ext/connect/servers/:id/session
  databases/:id    →        POST /api/ext/connect/databases/:id/session
  integrations/:id →        POST /api/ext/connect/integrations/:id/exec
```

Connector 接口必须同时满足两个消费者的约束：

| 约束 | 工作流消费者 | MCP 消费者 |
|------|------------|-----------|
| 执行模式 | 同步、可重试 | Tool Call，结构化输出 |
| 输入 | 明确参数 | JSON Schema 描述 |
| 输出 | 明确成功/失败 | 结构化 JSON |
| 操作标注 | 是否幂等 | 读操作 vs 写操作 |

**Connector 接口（Go）设计约束**：

```go
type Connector interface {
    Connect(cfg ConnectorConfig) (Session, error)
    Execute(session Session, req Request) (Result, error)  // 结构化输入输出
    Schema() ToolSchema                                     // 供 MCP 使用
    Close(session Session) error
}
```

### 决策 4：Epic 规划边界

| Epic | 名称 | 核心内容 | 依赖 |
|------|------|---------|------|
| **Epic 14** | File API | AppOS 本地 `/appos/data/` CRUD API | Epic 1, 3 |
| **Epic 15** | Web Terminal | SSH Connector + SFTP Connector + Docker exec；Terminal UI + File Manager UI | Epic 8 |
| **Epic 16** | Dev Tools | DB Connector + HTTP Connector；DB Client UI + API Debugger UI | Epic 8, 15 |
| **Epic 17** | AI Core + Pilot | AI Provider 路由、MCP Server 管理、对话历史、Pilot UI（Chat + Flows） | Epic 8, 15, 16 |

**YAGNI 原则**：不预先建通用 Connector Layer 抽象，在 Epic 15 定义接口，Epic 16 添加实现，Epic 17 启动时如有需要再统一抽象。

### 决策 5：Pilot — 统一 AI + 工作流界面

**名称**：`Pilot`（AppOS Pilot）

**定位**：意图驱动的统一工作区，不是"什么都有"的门户。

```
Pilot
  ├── Chat    → AI 对话路径（概率性）
  └── Flows   → 工作流路径（确定性）
```

**与其他工具的边界**：

- Terminal、Files（SFTP）、DB Client 是**独立入口**，目标明确的操作工具
- Pilot 是**意图入口**，用户不确定怎么做时使用
- Pilot Chat 可以**跳转并传递上下文**到 Terminal / DB Client，但不整合界面

### 决策 6：AI Chat 是嵌入式基础能力

AI Chat 不是独立产品，而是各工具可按需嵌入的能力：

| 工具 | 嵌入层次 | 参考产品 |
|------|---------|---------|
| SSH Terminal | 内嵌 AI Panel（分屏） | Warp Terminal |
| DB Client | 内嵌 AI Panel（SQL 生成 + 解释） | DataGrip AI |
| SFTP / File Manager | 悬浮 AI 入口（上下文感知） | 轻量集成 |
| Pilot | 完整 AI Chat 界面 | LobeChat |

**同一套后端**（Epic 17 AI Core），**不同前端嵌入形态**，各 Epic 按需集成。

---

## 被拒绝的方案

### 方案：为所有外部服务枚举专用 Epic

- 外部服务类型无穷无尽（消息队列、对象存储、邮件、DNS...）
- **拒绝原因**：长尾需求由 AI Agent（路径 A）覆盖，不应用 Epic 列表穷举

### 方案：Connector API 独立管理凭证

- 与 Resource Store 重复存储，破坏 SSOT 原则
- **拒绝原因**：凭证统一归 Resource Store 管理，Connector 只做运行时

### 方案：将 Terminal / SFTP 整合进 Pilot

- Terminal 和 SFTP 是目标明确的操作工具，心智模型与 Pilot 不同
- **拒绝原因**：强行整合导致产品焦点模糊，保持独立入口 + 上下文跳转

---

## 对 Epic 8 的影响

需新增 `ai_providers` collection（建议在 Epic 13 Settings 阶段同步添加配置 UI）：

```
ai_providers collection
  ├── name          → "My OpenAI", "Local Ollama"
  ├── provider_type → "openai" | "anthropic" | "ollama" | "azure_openai"
  ├── base_url      → API 端点
  ├── api_key       → Relation → secrets collection
  ├── default_model → "gpt-4o" / "claude-3-5-sonnet"
  ├── enabled       → Bool
  └── is_default    → Bool
```

MCP Server 管理（`mcp_servers` collection）在 Epic 15 添加，凭证引用 Resource Store，不新增存储机制。

---

## 优先级与实现顺序

```
Epic 14（进行中）→ Epic 15 → Epic 16 → Epic 17
                                         └── AI Core 后端先交付
                                             → Terminal AI Panel
                                             → DB Client AI Panel
                                             → Pilot UI 最后完整实现
```

Epic 17 的 AI Core 后端（Provider 路由 + 对话历史 API）应在 Pilot UI 之前独立交付，使 Epic 15/16 的 AI Panel 可以提前集成。
