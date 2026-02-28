# Story 15.4: Terminal & File Manager Enhancements

**Epic**: 15 | **Status**: Review | **Depends on**: 15.2, 15.3

## Acceptance Criteria

- [x] AC1 文件/目录属性：可查看并修改 `mode`/`owner`/`group`；查看 `size`/`accessed`/`modified`/`created`
- [x] AC2 软链接：支持创建 symbolic link，失败时提示
- [x] AC3 拷贝/移动：文件与目录 copy/move；展示进度；失败可见且可重试
- [x] AC4 多文件上传：批量上传；数量上限读自 settings；超限前端拦截并提示
- [x] AC5 共享：文件共享行为与 Epic9 Space 模块一致
- [x] AC6 Docker shell 策略：新增"手动选择 shell"开关；关闭时自动探测（bash→sh 回退），开启时用户选 `bash/sh/zsh`
- [x] AC7 Docker Terminal 连接修复：修复容器连接失败，覆盖关键错误路径

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
- [x] Task 3: Docker Terminal
  - [x] 3.1 修复容器连接失败根因（AC7）；写测试
  - [x] 3.2 shell 自动探测 + 手动选择开关（AC6）；写测试
  - [x] 3.3 全量回归：terminal/files 现有能力不退化

## Dev Notes

- 不引入额外页面；共享复用 Epic9 路径与权限模型；上传上限通过现有 Settings 机制读取。

## Dev Agent Record

### File List

- backend/internal/terminal/sftp.go
- backend/internal/terminal/docker_exec.go
- backend/internal/routes/terminal.go
- backend/internal/routes/terminal_test.go
- backend/internal/routes/settings.go
- backend/internal/routes/docker.go
- backend/internal/routes/docker_test.go
- dashboard/src/lib/connect-api.ts
- dashboard/src/components/connect/FileManagerPanel.tsx
- dashboard/src/components/connect/FileManagerPanel.test.tsx
- dashboard/src/components/connect/DockerPanel.tsx
- dashboard/src/components/connect/TerminalPanel.tsx
- dashboard/src/routes/_app/_auth/docker.tsx
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
- Fixed Docker terminal auth query composition bug in WebSocket URL builder (`token` + existing query params).
- Added Docker terminal manual shell toggle (default auto) and backend auto shell fallback (`/bin/bash` → `/bin/sh` → `/bin/zsh`).
- Validation: `go test ./internal/terminal ./internal/routes` passed; `npm run typecheck` passed.
- Added docker shell auto-fallback unit test to verify candidate order (`/bin/bash` → `/bin/sh` → `/bin/zsh`).
- Added minimal Vitest test harness and component tests for AC1/AC4 in FileManagerPanel.
- Validation: `npm test` passed (2 tests), `npm run typecheck` passed, backend tests still passed.
- Added tunnel-offline Docker UX guard: Docker actions disabled on offline host with explicit reason from backend `/api/ext/docker/servers`.
- Fixed `make build` error by removing unused `sftpCopy` import.
- Replaced prompt/alert based file operation UX with standardized dialogs (properties, symlink, copy/move, share) and aligned share dialog style with Epic9 Space.
- Enhanced properties workflow with owner/group name display and edit support (name or numeric), plus recursive chmod support in backend routes.
- Added permission matrix UI (Owner/Group/Public with rwx toggles) and recursive apply option, synchronized with octal mode input.
- Added reverse matrix test (mode -> checkbox state sync) and forward matrix test (checkbox -> mode + recursive save).
- Removed Docker from Admin navigation and integrated Docker operations into Connect server workspace as side panel (Terminal/Files/Docker).
- Replaced fixed 50/50 Connect split with draggable divider and persisted ratio.
- Validation: `go test ./internal/terminal ./internal/routes`, `npm test`, `npm run typecheck`, and `make build` all passed.

### Change Log

- 2026-02-27: Story created.
- 2026-02-27: Implemented core backend/frontend enhancements and docker terminal fixes; story remains in-progress for remaining test-focused subtasks.
- 2026-02-27: Added copy SSE progress UI and docker shell fallback unit test.
- 2026-02-27: Added minimal Vitest harness and completed frontend test subtasks; story moved to review.
- 2026-02-28: Added tunnel-offline Docker disable + reason; fixed build break (`TS6133`).
- 2026-02-28: Refined FileManager operation dialogs to standard modal style and synchronized AC tests.
- 2026-02-28: Added owner/group name-based properties, permission matrix UI, and recursive permission apply flow.
