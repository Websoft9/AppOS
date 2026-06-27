# Investigation: Feeds — 滚动加载失效 & Per-Source Retention 数量限制未生效

## Hand-off Brief

1. **What happened.**
   - **(Confirmed)** Per-source retention cap (默认 100) 未在首次拉取/手动拉取时生效：`UpsertSourceItems` 无上限逻辑，retention 仅由 cron（每小时）执行，因此新增 source 初次 poll 会全量入库（如 1021 条），直到下次 cron sweep 才裁剪到 ~100。
   - **(Confirmed)** 前端「Scroll to load more」失效的根因是滚动监听对象绑错：Feeds 页面实际滚动的是 AppShell 的 `main` 内容容器，而代码把 listener 绑在 `window`，并用 `document.documentElement` 计算剩余高度，因此不会随着实际列表滚动触发加载。

2. **Where the case stands.** Investigation concluded. Both root causes confirmed. Fixes handed off to implementation.

3. **What's needed next.** （已转为开发任务）Issue 2 需在 `UpsertSourceItems` 中接入 per-source cap 或在 poll 后立即运行 retention；Issue 1 需把 scroll listener 和高度计算迁到实际滚动容器。

## Case Info

| Field            | Value                                    |
| ---------------- | ---------------------------------------- |
| Ticket           | N/A                                      |
| Date opened      | 2026-06-26                               |
| Date closed      | 2026-06-27                               |
| Status           | Concluded                                |
| System           | appos (backend Go + frontend React/TS)   |
| Evidence sources | Source code, repo memory entries         |

## Problem Statement

用户报告两个 feeds 功能异常：

1. **Feeds 列表页无法通过下滚加载更多文章。** "Scroll to load more" 文字提示出现（说明 `items.length < feedTotalItems`），但滚动到底部不触发加载。

2. **Settings > Feeds 中 Per Source Retention Cap（默认 100）未生效。** 新增 OpenAI News feed 后拉取了 1021 篇文章；手动点击下拉按钮也拉取 1021；但偶尔又只显示 100 篇。

## Evidence Inventory

| Source                        | Status    | Notes                                              |
| ----------------------------- | --------- | -------------------------------------------------- |
| `web/src/routes/_app/_auth/feeds.tsx` (scroll logic) | Available | `maybeLoadMore` at L1657, useEffect at L1649       |
| `web/src/routes/_app/_auth/feeds.tsx` (fetchFeedItems) | Available | L845-898, useCallback with `[]` deps               |
| `backend/domain/routes/feeds.go` (list handler) | Available | L318-435, pagination via OFFSET/LIMIT              |
| `backend/domain/feeds/poller.go` (UpsertSourceItems) | Available | L100-160, NO retention cap during ingestion        |
| `backend/domain/feeds/cleanup.go` (RunRetentionSweep) | Available | L47-55, only called from cron                      |
| `backend/cmd/appos/bootstrap/cron.go` | Available | L69, retention cron: `0 * * * *` (hourly)         |
| `backend/domain/feeds/settings.go` | Available | L46, PerSourceCap default 100, range [20, 1000]    |
| Browser runtime (network/logs) | Partial   | 静态代码已足够确认滚动容器错绑，无需再依赖运行时证据 |

## Investigation Backlog

| # | Path to Explore                                      | Priority | Status | Notes                                      |
| - | ---------------------------------------------------- | -------- | ------ | ------------------------------------------ |
| 1 | `UpsertSourceItems` 缺少 per-source cap 逻辑         | High     | Done   | 确认为 Issue 2 根因                        |
| 2 | cron retention sweep 调用链确认                       | High     | Done   | `0 * * * *` 每小时执行                    |
| 3 | 页面实际滚动容器与 listener 绑定对象是否一致          | High     | Done   | 已确认不一致：容器滚动，代码监听 `window`   |
| 4 | `maybeLoadMore` 闭包中 `feedPage` 陈旧引用排查        | Medium   | Done   | 不是主因                                    |
| 5 | `handleSourcePoll` 后 `fetchFeedItems` 时序问题       | Medium   | Done   | 非主因，UpsertSourceItems 无 cap 已覆盖此问题 |

## Timeline of Events

| Time   | Event                                                | Source                          | Confidence |
| ------ | ---------------------------------------------------- | ------------------------------- | ---------- |
| N/A    | 用户新增 OpenAI News feed source                     | User report                     | Hypothesis |
| N/A    | Cron (每5分钟) 或手动 poll 触发 `pollSourceRecord`   | `cron.go:58`, `poller.go:60`    | Deduced    |
| N/A    | `FetchAndParseSource` 拉取全部 1021 条               | `poller.go:69`                  | Deduced    |
| N/A    | `UpsertSourceItems` 无上限插入全部 1021 条           | `poller.go:100-160`             | Confirmed  |
| N/A    | Cron (每小时) 执行 `RunRetentionSweep`，裁剪到 ~100  | `cron.go:69`, `cleanup.go:47`   | Confirmed  |
| N/A    | 用户在前端看到 100 条（retention 后）或 1021 条（retention 前） | User report                    | Deduced    |
| N/A    | Feeds 页面内容区域在 AppShell 的 `main` 容器内滚动   | `ContentArea.tsx:8`             | Confirmed  |
| N/A    | Feeds 页面滚动加载逻辑监听 `window` 而非内容容器     | `feeds.tsx:1657-1673`           | Confirmed  |

## Confirmed Findings

### Finding 1: `UpsertSourceItems` 在写入阶段不做 per-source 数量限制

**Evidence:** `backend/domain/feeds/poller.go:100-160`

**Detail:** `UpsertSourceItems` 遍历 `candidates`（来自 `FetchAndParseSource` 返回的全部文章），逐条 upsert 到 `feed_items` 表，**无任何 per-source 上限检查**。这意味着每次 poll（无论是 cron 触发还是手动触发）都会将所有 feed 文章写入数据库。

**Impact:** 新增 source 后首次 poll 会全量入库，无视 `PerSourceCap` 设置。

### Finding 2: Retention 清理仅由 cron 触发，每小时一次

**Evidence:** `backend/cmd/appos/bootstrap/cron.go:67-73`

```go
app.Cron().MustAdd(
    feedsRetentionCronJobID,
    "0 * * * *",
    cronutil.Wrap(app, feedsRetentionCronJobID, func() {
        if _, err := feeds.RunRetentionSweep(app); err != nil {
            panic(err)
        }
    }),
)
```

**Detail:** `RunRetentionSweep` → `buildRetentionPlan` → `executeRetentionPlan` 每整点执行一次，按 `published_at DESC` 排序保留每个 source 最新的 `PerSourceCap` 条，删除超出部分。

**Impact:** 两次 cron 之间（最长 1 小时），source 文章数可远超 `PerSourceCap`。用户观察到的「偶尔只显示 100 篇」与「1021 篇」交替出现，正是 retention sweep 执行前后的状态差异。

### Finding 3: `buildRetentionPlan` 的 per-source 保留逻辑正确

**Evidence:** `backend/domain/feeds/cleanup.go:170-185`

**Detail:** `loadRetentionCandidates` 按 `published_at DESC` 返回所有文章。`buildRetentionPlan` 遍历时每 source 保留前 `perSourceCap` 条（即最新的 N 条），超出的标记删除。逻辑正确。

### Finding 4: `handleCreateFeedSource` 不触发 poll，首次拉取由 cron 或手动触发

**Evidence:** `backend/domain/feeds/source_service.go:148-164`

**Detail:** `CreateSource` 仅创建 `feed_sources` 记录，不调用 poll。新 source 的首次文章拉取由 cron（每 5 分钟，`cron.go:57`）或用户手动点击 poll 按钮（`handleFeedSourcePoll`）触发。

### Finding 5: AppShell 的内容区本身就是滚动容器，不是浏览器窗口

**Evidence:** `web/src/components/layout/AppShell.tsx:14-31`, `web/src/components/layout/ContentArea.tsx:8`

**Detail:** `AppShell` 顶层使用 `h-screen overflow-hidden`。真正承载路由内容的 `ContentArea` 是：

```tsx
<main className="overflow-y-auto p-6 min-h-0" style={{ gridArea: 'content' }}>
```

这意味着大多数页面滚动发生在 `main` 元素内部，而不是 `window` / `document.documentElement`。

### Finding 6: Feeds 的无限加载绑定到了错误的滚动对象

**Evidence:** `web/src/routes/_app/_auth/feeds.tsx:1657-1673`

**Detail:** 当前逻辑：

```tsx
const maybeLoadMore = () => {
   const doc = document.documentElement
   const remaining = doc.scrollHeight - (window.scrollY + window.innerHeight)
   if (remaining > 160) return
   void fetchFeedItems({ ...page: feedPage + 1, append: true })
}

window.addEventListener('scroll', maybeLoadMore, { passive: true })
window.addEventListener('resize', maybeLoadMore)
```

但页面实际滚动发生在 `ContentArea` 的 `main.overflow-y-auto` 上，而不是 `window`。因此：

1. 用户在内容区下滚时，`window` 的 `scroll` 事件不会对应这次滚动
2. `window.scrollY` 与 `document.documentElement.scrollHeight` 也不是该容器的真实滚动位置/总高度

**Impact:** 页面底部的提示文案会显示（因为它只取决于 `items.length < feedTotalItems`），但滚动到底部不会触发 `maybeLoadMore`。

## Deduced Conclusions

### Conclusion 1: Retention 数量「偶尔显示 100、偶尔显示 1021」的根因

**Chain:**
1. **(Confirmed)** 新增 source 或手动 poll → `pollSourceRecord` → `FetchAndParseSource` 拉取全量 → `UpsertSourceItems` 无 cap 全量写入（Finding 1）
2. **(Confirmed)** `RunRetentionSweep` 每小时执行一次，裁剪到 `PerSourceCap`（默认 100）（Finding 2）
3. **(Deduced)** 用户在 retention sweep 前看到 1021 条，sweep 后看到 ~100 条

**Confidence: High**

### Conclusion 2: 「Scroll to load more」失效的根因

**Chain:**

1. **(Confirmed)** AppShell 顶层是 `h-screen overflow-hidden`，实际滚动发生在 `ContentArea` 的 `main.overflow-y-auto`（Finding 5）
2. **(Confirmed)** Feeds 页面无限加载逻辑把 listener 绑到 `window`，并读取 `window.scrollY` / `document.documentElement.scrollHeight`（Finding 6）
3. **(Deduced)** 当用户在内容区向下滚动时，监听器读到的不是实际滚动容器状态，因此不会在接近底部时触发分页请求

**Confidence: High**

## Hypothesized Paths

| # | Hypothesis | Status | Confirm/Refute Criteria |
| - | ---------- | ------ | ----------------------- |
| H1 | `maybeLoadMore` 中 `feedPage` 闭包陈旧导致重复请求同一页 | Refuted | 监听对象错绑已足以解释“完全不触发” |
| H2 | API 返回 `totalItems` 在分页过程中突变（retention sweep）导致 `items.length >= feedTotalItems` 提前满足 | Open | 是次要风险，不是本案主因 |
| H3 | `feedLoadingMore` 在某种路径下未正确重置 | Refuted | `finally` 中始终重置，不足以解释“完全不触发” |
| H4 | `remaining > 160` 阈值在特定布局下永远不满足 | Refuted | 更基础的问题是读错滚动容器 |

## Fix Direction

### Issue 2 (Retention Cap) — High Confidence

**Root cause:** `UpsertSourceItems` 写入阶段无 per-source 上限，retention 仅依赖 cron sweep。

**Fix approach:**
- **方案 A（推荐）**：在 `pollSourceRecord` 成功后立即对当前 source 执行 per-source retention（调用 `DeleteSourceItems`），而非等 cron。
- **方案 B**：在 `UpsertSourceItems` 中内置 cap 逻辑：排序 candidates 后只保留最新的 `PerSourceCap` 条。
- **方案 C**：将 retention cron 频率从每小时提高到每分钟，但会增加 DB 负载。

### Issue 1 (Scroll) — Low Confidence

**Root cause:** listener 与高度计算都绑定到错误的滚动对象。

**Fix approach:**
- **方案 A（推荐）**：给实际滚动容器加 `ref`，监听该元素的 `scroll`，并用 `scrollTop/clientHeight/scrollHeight` 计算剩余距离
- **方案 B**：改为 `IntersectionObserver` 监听列表底部 sentinel，避免手写滚动容器判断

## Reproduction Plan

1. 新增一个大型 RSS feed source（如 OpenAI News），确认其有 >100 篇文章
2. 手动 poll 该 source（点击下拉按钮）
3. 在浏览器 DevTools Network 面板观察 `/api/feeds/items` 请求
4. 滚动到页面底部，观察：
   - a) 当前实现下不会因为内容区滚动而触发新的 `/api/feeds/items?page=N` 请求
   - b) 若把 listener 暂时改绑到内容区，应开始触发追加分页请求
5. Issue 2 验证：poll 完成后检查 feed_items 表该 source 的记录数，确认是否 >100
