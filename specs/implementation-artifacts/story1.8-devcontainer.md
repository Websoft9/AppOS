# Story 1.8: Development Container Baseline

**Epic**: Epic 1 - DevOps  
**优先级**: P2  
**状态**: Done

> Historical note (2026-07-29): AppOS now uses `.devcontainer/devcontainer.json` as a CLI-only development container specification, backed by `.devcontainer/Dockerfile`. The VS Code extension workflow remains retired.

## User Story
作为开发者，我想要一个最小可用的开发容器，这样我可以在统一的容器化开发环境中直接运行 AppOS 的构建、测试和镜像命令，并且不依赖 VS Code devcontainer 黑盒逻辑。

## 验收标准
- [x] 提供 `.devcontainer/Dockerfile` 作为开发镜像事实来源
- [x] 提供 `.devcontainer/devcontainer.json` 作为 CLI-only 开发容器规范入口
- [x] 容器内包含 Go 1.26、Node.js、Python 和开发工具链
- [x] 容器内可访问宿主机 Docker daemon，用于 `make image build`、`docker compose` 和测试环境命令
- [x] 提供幂等的工作区 bootstrap，而不是依赖 VS Code `postCreateCommand`
- [x] 废弃 VS Code devcontainer extension workflow
- [x] 本地浏览器 E2E 依赖（Playwright Chromium + system deps）可在开发容器内就绪

## 实现
- `.devcontainer/devcontainer.json`
- `.devcontainer/Dockerfile`
- `.devcontainer/bootstrap.sh`
- `Makefile`

## Notes
- development container 负责开发工具链与一致性，不复用运行时镜像。
- host-side entry commands use `make host ...`; project commands run as plain `make ...` inside the development container.
- 生产镜像仍由 `build/Dockerfile` 负责，保持最小运行时职责。
