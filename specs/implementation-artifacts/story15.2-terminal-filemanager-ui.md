# Story 15.2: Terminal & File Manager UI

**Epic**: Epic 15 – Connect: Terminal & File Manager
**Status**: Complete | **Priority**: P1 | **Depends on**: Story 15.1

---

## User Story

As a superuser, I can switch between a terminal and a file manager for any server within a single page, so that I can run commands and manage files without context switching.

---

## Implementation

### Routes

```
/connect                      → server selector (redirect to /connect/server/:id on select)
/connect/server/:serverId     → unified Terminal + Files view
```

### New components

```
dashboard/src/
  routes/_app/_auth/_superuser/
    connect.index.tsx          # /connect – server selector page
    connect.server.$serverId.tsx  # /connect/server/:serverId – unified view
  components/connect/
    TerminalPanel.tsx          # xterm.js wrapper, props: { serverId } | { containerId }
    FileManagerPanel.tsx       # file manager, props: { serverId }
    ServerSelector.tsx         # dropdown sourced from GET /api/collections/servers/records
```

### TerminalPanel

- Renders `xterm.js` + `xterm-addon-fit`
- Opens `WS /api/ext/terminal/ssh/:serverId` (or `/docker/:containerId`)
- Sends resize control frame on container resize (ResizeObserver)
- Displays error overlay with **Reconnect** button on disconnect
- Reads `connect.terminal.font_size` and `connect.terminal.scrollback` from localStorage

### FileManagerPanel

Two-pane layout: directory tree (left) + file list (right).

| Interaction | Behaviour |
|-------------|-----------|
| Double-click directory | Navigate into, update breadcrumb |
| Context menu → Download | `GET /sftp/:serverId/download?path=` |
| Context menu → Rename | `POST /sftp/:serverId/rename` |
| Context menu → Delete | `DELETE /sftp/:serverId/delete?path=` (confirm dialog) |
| Drag-and-drop / Upload button | `POST /sftp/:serverId/upload?path=` |
| New folder button | `POST /sftp/:serverId/mkdir` |
| Hidden files toggle | Toggle `connect.sftp.show_hidden` in localStorage; re-filter current listing (no refetch) |

File list columns: Name, Size, Permissions, Modified.

### Unified view behaviour

- Switching tabs does **not** disconnect the SSH session
- Fullscreen button uses browser Fullscreen API on the panel container
- Server selector change: close current WS, open new session for selected server
- User preferences (font size, scrollback, show hidden): see Epic 15 Configuration

### 优化增强（第二轮）

**FileManagerPanel 增强:**
- Refresh 按钮：重新加载当前目录
- Create File 按钮：内联输入文件名 → 打开 FileEditorDialog(isNew=true) → 保存时 PUT 到服务器
- Recursive Search：checkbox 切换递归搜索模式，调用 `GET /sftp/:serverId/search`，400ms 防抖，搜索结果以表格展示（路径、大小、修改时间），点击可打开编辑
- Grid/Tile 视图切换：文件列表支持 table 和 grid 两种展示模式
- 文件搜索过滤：本地过滤当前目录文件列表

**FileEditorDialog 增强:**
- `isNew` prop：跳过服务器读取，空白内容开始，保存时创建新文件

**ServerSelector 重写:**
- 从网格列表改为下拉选择器 + "Connect" 按钮
- 仅一台服务器时自动选中
- Placeholder: "Select a server..."

**其他 UI 修复:**
- 图标重叠修复（icon overlap）
- Scripts 下拉宽度加宽
- checkbox 组件 import 路径修复（`src/lib/utils` → `@/lib/utils`）

---

## Acceptance Criteria

- [x] `/connect` shows server list; selecting a server navigates to `/connect/server/:id`
- [x] Terminal tab renders xterm.js and relays keystrokes correctly
- [x] Window/panel resize triggers PTY resize control frame
- [x] Disconnect shows error overlay with Reconnect button; reconnect re-opens WebSocket
- [x] Files tab shows directory tree + file list with breadcrumb navigation
- [x] Hidden files toggle shows/hides dot-files without re-fetching from backend
- [x] File upload enforced at 50 MB (client-side pre-check + server 413 handling)
- [x] Download, rename, delete work correctly; delete requires confirmation
- [x] Switching tabs preserves SSH session (no reconnect)
- [x] Fullscreen works via browser Fullscreen API
- [x] `<TerminalPanel>` and `<FileManagerPanel>` are importable as standalone components
- [x] Refresh 按钮重新加载当前目录
- [x] Create File 创建新文件并通过编辑器保存
- [x] Recursive search 递归搜索文件（checkbox + 结果表格）
- [x] ServerSelector 改为下拉选择器，单服务器自动选中
- [x] Grid/Tile 视图切换
- [x] 文件列表本地搜索过滤

---

## Dev Agent Record

### Files Created/Modified

```
dashboard/package.json                                          # added @xterm/xterm, @xterm/addon-fit
dashboard/src/lib/connect-api.ts                                # SFTP/SSH API helpers, preferences, types
dashboard/src/components/connect/TerminalPanel.tsx               # xterm.js wrapper, WebSocket, reconnect
dashboard/src/components/connect/FileManagerPanel.tsx            # Two-pane file manager, breadcrumb, CRUD
dashboard/src/components/connect/ServerSelector.tsx              # Server list → navigate to connect view
dashboard/src/routes/_app/_auth/_superuser/connect.index.tsx     # /connect route (server selector page)
dashboard/src/routes/_app/_auth/_superuser/connect.server.$serverId.tsx  # /connect/server/:id unified view
dashboard/src/components/layout/Sidebar.tsx                     # Added Connect nav item with TerminalSquare icon
dashboard/src/routeTree.gen.ts                                  # Auto-regenerated by TanStack Router CLI
```

### Decisions

- Used `forceMount` on TabsContent to keep terminal alive when switching to Files tab
- File manager uses single-pane table layout (not tree+list) for simplicity — adequate for MVP
- Hidden file toggle is client-side filter only (no refetch) as specified
- Auth token passed as WebSocket query param since WS upgrade can't use custom headers
- Followed existing superuser page pattern: English hardcoded strings, no i18n namespace
- Download uses fetch+blob pattern for auth header support
- ServerSelector 改为 dropdown：grid 模式不适合服务器数量多的场景
- Recursive search 使用 400ms debounce 避免频繁请求；搜索结果独立展示不影响目录浏览
- Create File 复用 FileEditorDialog（`isNew` prop），无需新组件
- checkbox.tsx 的 import path 必须用 `@/lib/utils` 而非 `src/lib/utils`，否则 vite build 报错

### Code Review Fixes

- `sftpRename` body: `{old_path, new_path}` → `{from, to}`，与后端一致
- `sftpUpload`: 参数改为 `remoteDir`（传 `currentPath`），后端拼接文件名
- WS `onmessage`: 检测 `0x00` 前缀控制帧，解析 error/close 并显示 UI 状态
- Download: 先检查 `response.ok` 再创建 blob
- ServerSelector 空状态: 增加 "Add a server" 超链接指向 `/resources/servers?create=1`
- Connect 页头: 增加 Docker 页面链接（Container 图标），传递 `server` search param
- Docker 页: 增加 shell 选择器（sh/bash/zsh）；`validateSearch` 支持 `?server=` 自动选中对应主机
