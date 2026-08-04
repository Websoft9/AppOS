# Story 1.6: 镜像安全扫描

**Epic**: Epic 1 - DevOps  
**优先级**: P2  
**状态**: Done

## User Story
作为开发者，我想要代码和镜像的安全检测工具，这样可以在开发阶段发现潜在漏洞和供应链风险。

## 验收标准
- [x] `make sec source`: govulncheck（Go CVE）+ npm audit（JS CVE high+）+ betterleaks（密钥泄露检测）
- [x] Runtime image vulnerability scanning and SBOM generation run in GitHub Actions release gate, not in local `make` commands
- [x] `.golangci.yml`: gosec 纳入 lint 流程，豁免 G304/G115，测试文件仅豁免 errcheck/ineffassign
- [x] CI release gate: Trivy SARIF 推送 GitHub Security 标签页，并将文本报告与 SARIF 归档为 workflow artifacts 以便后续修复
- [x] CI release gate: SBOM 生成并归档为 workflow artifact
- [x] 本地开发容器只保留源码/配置层安全扫描；镜像层扫描迁移到 GitHub Actions
- [x] 容器构建文件使用固定基础镜像标签（避免 `latest` 漂移风险）
- [x] `sbom.spdx.json` 加入 `.gitignore`

## 实现
- `.golangci.yml`
- `Makefile` target: `sec`
- `.github/workflows/_quality-gate.yml`
