# Coding decisions

## Story 规范{#story}

Story 专注于**需求（做什么）**，而非实现细节（怎么做）。

**必须包含**：
- **Objective**: 一句话说明交付目标
- **Requirements**: 完整列出所有功能需求（用列表/表格，不遗漏）
- **Acceptance Criteria**: 可验证的 checklist
- **Integration Notes**: 与其他 story/epic 的依赖关系

**可以包含**：
- 关键技术决策（如选择 CSS Grid vs Flexbox、状态管理方案）
- 文件结构规划
- ASCII 架构图（布局、流程）

**避免**：
- TypeScript interface 定义（属于实现阶段）
- CSS/代码片段（属于实现阶段）
- 详细的组件 props 设计
- 冗余描述（同一信息不要在多个 section 重复）

**原则**：story 是给开发者的"做什么"清单 + 必要的"怎么做"决策，不是实现指南。

## UI{#ui}

Design System Foundation (shadcn/ui, Tailwind, Dark/Light theme)

## Container Development{#container}

**Image Build Directory**: Use `build/` directory exclusively for image construction. Ignore other directories including `docker/`.

**Testing Protocol**: All backend and frontend code must be tested within containers. During development, copy code to the appropriate container paths.

**Development Workflow**: Use `make` commands for all operations (build, start, stop, logs, clean, etc.).

## Testing

**External Endpoint Access**: Always use `http://127.0.0.1:<port>` for external testing, **never** `http://localhost:<port>`.

**Rationale**: HTTP proxy settings may prevent `localhost` connections. Using `127.0.0.1` bypasses proxy and ensures direct local access.

**Applies to**:
- API endpoint testing: `curl http://127.0.0.1:9091/api/health`
- Dashboard access: `http://127.0.0.1:9091/`
- Development server: `http://127.0.0.1:5173/`
- Container health checks (internal): Use `localhost` (no proxy inside container)