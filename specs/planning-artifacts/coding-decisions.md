# Coding decisions

## Story/Epic 规范{#story}

Story/Epic 专注于**需求（做什么）**，而非实现细节（怎么做）。

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

### Dialog Size Tiers{#dialog-sizes}

Standardized dialog widths based on content type. Override via `className` on `<DialogContent>`.

| Tier | Tailwind Class | Width | Use Case |
|------|---------------|-------|----------|
| **sm** | `max-w-sm` | 384px | Confirmations, simple alerts |
| **default** | (shadcn default `sm:max-w-lg`) | 512px | Forms, simple CRUD dialogs |
| **md** | `max-w-2xl` | 672px | Multi-field forms, detail views |
| **lg** | `max-w-4xl` | 896px | Terminal/code output, wide tables, command runners |
| **xl** | `max-w-6xl` | 1152px | Complex editors, side-by-side layouts |
| **full** | `max-w-[90vw] max-h-[85vh]` | ~90% viewport | Log viewers, full-screen editors |

**Guidelines:**
- Always pair large dialogs with `max-h-[85vh] flex flex-col` for scroll containment
- Mobile fallback is handled by shadcn's `max-w-[calc(100%-2rem)]`
- Prefer the smallest tier that avoids horizontal scrolling or cramped content

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