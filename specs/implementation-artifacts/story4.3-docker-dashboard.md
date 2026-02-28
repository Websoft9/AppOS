# Story 4.3: Frontend — Docker Resource Dashboard

**Epic**: Epic 4 - Docker Operations Layer  
**Priority**: P1  
**Status**: Complete  
**Depends on**: Story 4.1 + 4.2 (API), Epic 7 (layout, design system)

## User Story
As an administrator, I want a dashboard page to view and manage all Docker resources (compose projects, images, containers, networks, volumes), so that I can monitor and operate Docker directly from the web UI.

## Acceptance Criteria
- [x] New route `/docker` accessible from sidebar
- [x] 5-tab layout: Containers | Images | Volumes | Networks | Compose
- [x] Each tab shows a list table with host column
- [x] Action buttons per resource (start/stop/restart/remove/prune)
- [x] Compose tab: logs viewer + config editor
- [x] Server selector (multi-select for filtering) in top bar
- [x] Run Command dialog (lg tier) with server picker + terminal output
- [x] All data fetched via PB SDK `pb.send('/api/ext/docker/...')`
- [x] Loading/error states handled

## Definition of Done
- [x] All 5 tabs render data from API
- [x] Actions trigger API calls with visual feedback
- [x] Compose logs display in full-tier scrollable dialog
- [x] Compose config editor saves via PUT
- [x] Page works in dark/light mode
- [x] `npm run build` passes

---

## Technical Context

### Existing Infrastructure (from Epic 7)
- **Routing**: TanStack Router, file-based under `dashboard/src/routes/`
- **Layout**: AppShell with Sidebar/Header/ContentArea (Story 7.6)
- **UI primitives**: shadcn/ui — table, card, button, dialog, badge, dropdown-menu, sheet
- **State**: TanStack Query for server data
- **Theme**: dark/light mode via theme-provider

### Route Structure

```
dashboard/src/routes/_app/_auth/
  docker.tsx              ← page component (tab container)
```

Add "Docker" to sidebar navigation.

### Page Layout

```
┌─────────────────────────────────────────┐
│ [🖥 local ▾] Server Selector    [▶ Run Command] │
├─────────────────────────────────────────┤
│ Tabs: [Containers] [Images] [Volumes] [Networks] [Compose] │
├─────────────────────────────────────────┤
│ Tab Content:                            │
│  - Data table with host column          │
│  - Action buttons per row               │
│  - Prune button (images/volumes)        │
└─────────────────────────────────────────┘

Command Dialog (lg tier, 896px):
┌─────────────────────────────────────────┐
│ ▶ Run Docker Command                    │
├─────────────────────────────────────────┤
│ [Server: local ▾] docker [command input] │
├─────────────────────────────────────────┤
│ Terminal output area (scrollable)       │
│ > $ docker ps                           │
│   CONTAINER ID  IMAGE  ...              │
└─────────────────────────────────────────┘
```

### API Calls (via PB SDK)

```typescript
// List
pb.send('/api/ext/docker/containers', { method: 'GET' })
pb.send('/api/ext/docker/images', { method: 'GET' })
pb.send('/api/ext/docker/networks', { method: 'GET' })
pb.send('/api/ext/docker/volumes', { method: 'GET' })

// Actions
pb.send('/api/ext/docker/containers/{id}/stop', { method: 'POST' })
pb.send('/api/ext/docker/containers/{id}?force=1', { method: 'DELETE' })  // force remove
pb.send('/api/ext/docker/compose/up', { method: 'POST', body: { projectDir } })
pb.send('/api/ext/docker/compose/logs', { method: 'GET', query: { projectDir, tail: 100 } })
pb.send('/api/ext/docker/compose/config', { method: 'GET', query: { projectDir } })

// Inspect
pb.send('/api/ext/docker/images/{id}/inspect', { method: 'GET' })
pb.send('/api/ext/docker/volumes/{id}/inspect', { method: 'GET' })

// Registry
pb.send('/api/ext/docker/images/registry/status', { method: 'GET' })   // Docker Hub reachability
pb.send('/api/ext/docker/images/registry/search?q=&limit=', { method: 'GET' })  // search, limit≤100
```

### Files to Create

| File | What |
|------|------|
| `dashboard/src/routes/_app/_auth/docker.tsx` | Page with tabs |
| `dashboard/src/components/docker/ComposeTab.tsx` | Compose list + logs + config |
| `dashboard/src/components/docker/ContainersTab.tsx` | Container list + actions |
| `dashboard/src/components/docker/ImagesTab.tsx` | Image list + pull/prune |
| `dashboard/src/components/docker/NetworksTab.tsx` | Network list + create/remove |
| `dashboard/src/components/docker/VolumesTab.tsx` | Volume list + remove/prune |

### Key UI Components to Use
- `<Tabs>` from shadcn/ui for 5-tab layout
- `<Table>` from shadcn/ui for resource lists
- `<Badge>` for container status (running/stopped/exited)
- `<Button>` + `<DropdownMenu>` for row actions
- `<Dialog>` for command execution (lg tier), compose logs (full tier), confirmations
- `<DropdownMenu>` for server selector (multi-select with green dot status indicators)
- Toast for action feedback

---

## Next Story
**Story 4.4**: Remote Execution (Future)

---

## Dev Notes (added during implementation)

**UX Iteration History** (3 iterations to reach final design):
1. **v1 - Command as tab**: Separate "Command" tab alongside resource tabs. Felt disconnected.
2. **v2 - Inline command bar**: Command input in top bar with collapsible output panel at bottom. Cluttered the main layout.
3. **v3 - Dialog popup** (final): Prominent "Run Command" button in top bar opens lg-tier dialog. Clean separation — resource browsing vs command execution are separate workflows.

**Key Decisions:**
- Server selector uses multi-select for **filtering** resource lists, but command dialog uses single-select for **targeting**
- Tab order changed from `Compose|Containers|Images|Networks|Volumes` to `Containers|Images|Volumes|Networks|Compose` (most-used first)
- `CommandTab.tsx` created then orphaned (dead code after v3 rewrite) — should be deleted
- Dialog sizes: compose logs use `full` tier (`max-w-[90vw]`), command runner uses `lg` tier (`max-w-4xl`)
- All tabs independently manage their own `host` state and display host column
- `docker compose ls` response parsed as JSON array (not NDJSON like other docker commands)

**Code Review Fixes (2026-session):**
- ContainersTab: CPU% sort 改用 `parseFloat`，Memory sort 改用 `memoryTextToBytes` 字节比较
- ContainersTab: 新增 lazy inspect/stats、force-remove checkbox、AlertDialog 确认、port 列、meta 列 toggle
- ContainersTab: 批量加载进度条动画；running 状态下 Start 按钮禁用
- ImagesTab: batch delete 改用 `Promise.allSettled` + 部分失败报告（原 `Promise.all` 单个失败导致全部报错）
- ImagesTab: prune 改为真实 API 调用（原为 mock `alert()`）
- ImagesTab: registry search + pull dialog（含连通性检查 → 搜索列表 + Official 标记 → pull 日志）
- ImagesTab: used/unused 过滤器（交叉引用运行容器判定占用状态）
- ImagesTab: 行展开显示 inspect JSON
- VolumesTab: 恢复 prune 按钮 + AlertDialog 确认 + 真实后端调用
- VolumesTab: `parentMountPath` 从组件体内移至模块级（避免每次 render 重建）
- VolumesTab: volume inspect、volume→files 跨面板导航
- ComposeTab: container name 可点击跳转 Containers tab；项目容器首次展开时懒加载
- VolumesTab: 容器列显示去重后的实际容器名（替代原 "N container(s)" 计数）
- 所有 tab: sort 方向指示器 (ArrowUp/ArrowDown)；加载中显示 Loader2 旋转图标
