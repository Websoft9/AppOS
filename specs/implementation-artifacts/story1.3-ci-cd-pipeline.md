# Story 1.3: GitHub Actions CI/CD Pipeline

**Epic**: Epic 1 - 基础架构与构建系统  
**优先级**: P1  
**状态**: Done

## User Story
作为开发者，我想要自动化的质量检查流程，这样每次 PR 和 main 分支推送都能自动运行 lint、test 和安全扫描。

## 验收标准
- [x] **ci.yml**: PR + push to main 触发
- [x] `lint` job: golangci-lint（含 gosec）+ ESLint
- [x] `test` job: `go test ./...` + Vitest
- [x] `sec` job: govulncheck + npm audit + gitleaks
- [x] `scan` job: trivy 镜像扫描 + SARIF 上传到 GitHub Security + SBOM 推送到 Dependency Graph（仅 main）
- [x] 并发取消：同一 ref 的旧 run 自动取消
- [x] scan job 依赖 lint/test/sec 全部通过后才运行

## 实现
`.github/workflows/ci.yml`
