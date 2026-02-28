# Story 15.4: SFTP Enhancements

**Epic**: 15 | **Status**: Review | **Depends on**: 15.2

## Scope Positioning

This story is limited to SFTP/file manager enhancements only. Docker terminal behavior, shell strategy, and Docker connection fixes are tracked in Story 15.3.

## Acceptance Criteria

- [x] AC1 文件/目录属性：可查看并修改 `mode`/`owner`/`group`；查看 `size`/`accessed`/`modified`/`created`
- [x] AC2 软链接：支持创建 symbolic link，失败时提示
- [x] AC3 拷贝/移动：文件与目录 copy/move；展示进度；失败可见且可重试
- [x] AC4 多文件上传：批量上传；数量上限读自 settings；超限前端拦截并提示
- [x] AC5 共享：文件共享行为与 Epic9 Space 模块一致

## Tasks / Subtasks

- [x] Task 1: Backend SFTP 扩展
  - [x] 1.1 属性接口：`GET stat`、`POST chmod/chown`（AC1）；写测试
  - [x] 1.2 软链接接口：`POST symlink`（AC2）；写测试
  - [x] 1.3 copy/move 接口 + 进度 SSE（AC3）；写测试
- [x] Task 2: Frontend FileManager 扩展
  - [x] 2.1 属性面板（查看+编辑，AC1）；写组件测试
  - [x] 2.2 创建软链接交互（AC2）
  - [x] 2.3 copy/move 进度 UI 与失败处理（AC3）
  - [x] 2.4 多文件上传 + settings 数量上限拦截（AC4）；写测试
  - [x] 2.5 对齐 Epic9 共享入口（AC5）

## Dev Notes

- 不引入额外页面；共享复用 Epic9 路径与权限模型；上传上限通过现有 Settings 机制读取。

## Dev Agent Record

### File List

- backend/internal/terminal/sftp.go
- backend/internal/routes/terminal.go
- backend/internal/routes/terminal_test.go
- backend/internal/routes/settings.go
- dashboard/src/lib/connect-api.ts
- dashboard/src/components/connect/FileManagerPanel.tsx
- dashboard/src/components/connect/FileManagerPanel.test.tsx
- dashboard/src/routes/_app/_auth/_superuser/connect.server.$serverId.tsx
- dashboard/src/components/layout/Sidebar.tsx
- dashboard/src/test/setup.ts
- dashboard/vitest.config.ts
- dashboard/package.json
- specs/implementation-artifacts/sprint-status.yaml

### Completion Notes

- Implemented backend SFTP metadata/property operations: `constraints`, `stat`, `chmod`, `chown`, `symlink`, `copy`, `move`, and `copy-stream` (SSE progress).
- Implemented frontend FileManager actions for properties edit, symlink creation, copy/move with busy-state progress and retry prompt, settings-backed max upload file count, and Space-aligned sharing entry.
- Upgraded copy operation to stream progress from backend SSE (`copy-stream`) and render percentage during copy.
- Validation: `go test ./internal/terminal ./internal/routes` passed; `npm run typecheck` passed.
- Added minimal Vitest test harness and component tests for AC1/AC4 in FileManagerPanel.
- Validation: `npm test` passed (2 tests), `npm run typecheck` passed, backend tests still passed.
- Fixed `make build` error by removing unused `sftpCopy` import.
- Replaced prompt/alert based file operation UX with standardized dialogs (properties, symlink, copy/move, share) and aligned share dialog style with Epic9 Space.
- Enhanced properties workflow with owner/group name display and edit support (name or numeric), plus recursive chmod support in backend routes.
- Added permission matrix UI (Owner/Group/Public with rwx toggles) and recursive apply option, synchronized with octal mode input.
- Added reverse matrix test (mode -> checkbox state sync) and forward matrix test (checkbox -> mode + recursive save).
- Replaced fixed 50/50 Connect split with draggable divider and persisted ratio.
- Validation: `go test ./internal/terminal ./internal/routes`, `npm test`, `npm run typecheck`, and `make build` all passed.
- Docker-related completion items were reclassified to Story 15.3 to keep ownership boundaries clear.

### Change Log

- 2026-02-27: Story created.
- 2026-02-27: Implemented core backend/frontend file-manager enhancements; story remained in-progress for remaining test-focused subtasks.
- 2026-02-27: Added copy SSE progress UI and related test updates.
- 2026-02-27: Added minimal Vitest harness and completed frontend test subtasks; story moved to review.
- 2026-02-28: Fixed build break (`TS6133`).
- 2026-02-28: Refined FileManager operation dialogs to standard modal style and synchronized AC tests.
- 2026-02-28: Added owner/group name-based properties, permission matrix UI, and recursive permission apply flow.
- 2026-02-28: Reclassified Docker-related scope to Story 15.3 (documentation boundary refactor only).

**Code Review Fixes (2026-session):**
- `connect-api.ts`: Server 接口新增 `connect_type` 字段（`'direct' | 'tunnel' | string`），移除 ConnectServerPage 中的 `as any` 强转
- `connect-api.ts`: 提取共享 `checkServerStatus` + `withTimeout` 函数，消除 ServerSelector 与 ConnectServerPage 中的重复实现
- `ConnectServerPage`: 服务器切换增加连通性检查对话框 + 重连确认
- `ConnectServerPage`: 新增快速切换守卫（`if (connectingOpen) return`），防止并发切换竞态
- `ServerSelector`: 改用共享 `checkServerStatus`，移除内联重复代码和未使用 `pb` 导入；新增连通性检查 Dialog（checking → offline 两阶段，Loader2 旋转 + 目标服务器标签 + 错误提示）
