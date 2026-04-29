# Story 1.5: 版本管理规范化

**Epic**: Epic 1 - 基础架构与构建系统  
**优先级**: P2  
**状态**: Done

## User Story
作为项目维护者，我想要清晰的版本管理策略，这样用户可以明确知道每个版本的变更和兼容性。

## 验收标准
- [x] `version.json` 包含所有组件版本（core, apphub, deployment, git, proxy, media, library）
- [x] 版本号遵循 SemVer（主.次.补丁）
- [x] `CHANGELOG.md` 自动生成（Features/Fixes/Breaking Changes）
- [x] Release notes 包含 Docker tag、安装命令、已知问题
- [x] 版本兼容性矩阵文档

## 技术细节
**version.json 示例**:
```json
{
  "core_version": "2.0.3",
  "apphub_version": "0.2.6",
  "deployment_version": "2.20.0",
  "git_version": "1.21.0",
  "proxy_version": "2.11.0",
  "media_version": "0.1.1",
  "library_version": "0.7.3"
}
```

**规范**:
- Conventional Commits
- GitHub Actions 自动生成 CHANGELOG

**涉及文件**:
- `version.json`
- `CHANGELOG.md`
- `.github/workflows/release.yml`

## 实现

- `version.json` 作为 Epic 1 版本单一事实来源，当前基线为 `0.1.0`
- `make version-check` 调用 `.github/scripts/validate-version.mjs` 校验版本字段与可选 tag 一致性
- `.github/workflows/release.yml` 在 `v*.*.*` tag 上执行版本校验、CHANGELOG 生成、release notes 生成与 GitHub Release 发布
- `.github/git-cliff.toml` 使用 Conventional Commits 分组生成 Features/Fixes/Breaking Changes 等 changelog 分类
- `.github/scripts/build-release-notes.mjs` 生成包含 Docker tag、安装命令、已知问题与 changelog 节的 `release-notes.md`
- `docs/version-compatibility-matrix.md` 定义版本兼容性矩阵与发布维护规则
- `docs/release-known-issues.md` 作为 release notes 的已知问题来源

## File List

- `version.json`
- `.github/scripts/validate-version.mjs`
- `.github/scripts/build-release-notes.mjs`
- `.github/git-cliff.toml`
- `.github/workflows/release.yml`
- `CHANGELOG.md`
- `docs/version-compatibility-matrix.md`
- `docs/release-known-issues.md`
- `Makefile`

## Dev Agent Record

- 实现了 Epic 1 的版本管理与发布自动化基础设施，覆盖 SemVer 校验、CHANGELOG 自动生成、release notes 组装和兼容性文档。
- 本地已验证 `make version-check` 通过。

## 测试
```bash
# 验证 version.json 格式
cat version.json | jq .
# 检查 CHANGELOG 生成
git log --oneline --pretty=format:"%s"
# 本地版本校验
make version-check
```
