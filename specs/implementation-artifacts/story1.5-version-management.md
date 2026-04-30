# Story 1.5: 版本管理规范化

**Epic**: Epic 1 - 基础架构与构建系统  
**优先级**: P2  
**状态**: Done

## User Story
作为项目维护者，我想要清晰的版本管理策略，这样用户可以明确知道每个版本的变更和兼容性。

## 验收标准
- [x] Git tag 作为发布版本的单一事实来源
- [x] 版本号遵循 SemVer（主.次.补丁）
- [x] `CHANGELOG.md` 自动生成（Features/Fixes/Breaking Changes）
- [x] Release notes 包含 Docker tag、安装命令、已知问题
- [x] 版本兼容性矩阵文档

## 技术细节
**发布 tag 示例**:
```text
v2.0.3
v2.0.3-rc.1
```

**规范**:
- Conventional Commits
- GitHub Actions 自动生成 CHANGELOG

**涉及文件**:
- `CHANGELOG.md`
- `.github/workflows/release.yml`

## 实现

- Git tag 作为 Epic 1 发布版本单一事实来源，当前基线为 `v0.1.0`
- `make version-check` 调用 `.github/scripts/validate-version.mjs` 校验显式 tag 或输出当前 git 推导版本
- `.github/workflows/release.yml` 在 `v*.*.*` tag 上执行版本校验、CHANGELOG 生成、release notes 生成与 GitHub Release 发布
- `.github/git-cliff.toml` 使用 Conventional Commits 分组生成 Features/Fixes/Breaking Changes 等 changelog 分类
- `.github/scripts/build-release-notes.mjs` 生成包含 Docker tag、安装命令、已知问题与 changelog 节的 `release-notes.md`
- `docs/version-compatibility-matrix.md` 定义版本兼容性矩阵与发布维护规则
- `docs/release-known-issues.md` 作为 release notes 的已知问题来源

## File List

- `.github/scripts/validate-version.mjs`
- `.github/scripts/build-release-notes.mjs`
- `.github/git-cliff.toml`
- `.github/workflows/release.yml`
- `CHANGELOG.md`
- `docs/version-compatibility-matrix.md`
- `docs/release-known-issues.md`
- `Makefile`

## Dev Agent Record

- 实现了 Epic 1 的 tag-driven 版本管理与发布自动化基础设施，覆盖 SemVer tag 校验、CHANGELOG 自动生成、release notes 组装和兼容性文档。
- 本地已验证 `make version-check` 通过。

## 测试
```bash
# 验证 release tag 格式
node .github/scripts/validate-version.mjs v0.1.0
# 检查 CHANGELOG 生成
git log --oneline --pretty=format:"%s"
# 本地版本校验
make version-check
```
