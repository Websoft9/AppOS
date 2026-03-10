# Story 1.6: 镜像安全扫描

**Epic**: Epic 1 - 基础架构与构建系统  
**优先级**: P2  
**状态**: Done

## User Story
作为开发者，我想要代码和镜像的安全检测工具，这样可以在开发阶段发现潜在漏洞和供应链风险。

## 验收标准
- [x] `make sec`: govulncheck（Go CVE）+ npm audit（JS CVE high+）+ gitleaks（密钥泄露检测）
- [x] `make scan`: trivy 镜像扫描（HIGH/CRITICAL，advisory 模式不阻断）— 通过 Docker 运行，无需安装
- [x] `make sbom`: syft 生成 SBOM → `sbom.spdx.json`（范围：backend + dashboard/src）
- [x] `.golangci.yml`: gosec 纳入 lint 流程，豁免 G304/G115，测试文件仅豁免 errcheck/ineffassign
- [x] CI `scan` job: trivy SARIF 推送 GitHub Security 标签页，SBOM 推送 GitHub Dependency Graph
- [x] 工具安装集成到 `make install`（govulncheck/gitleaks/syft；trivy 通过 Docker 运行无需安装）
- [x] 容器构建文件使用固定基础镜像标签（避免 `latest` 漂移风险）
- [x] `sbom.spdx.json` 加入 `.gitignore`

## 实现
- `.golangci.yml`
- `Makefile` targets: `sec`, `scan`, `sbom`
- `.github/workflows/ci.yml` → `scan` job
