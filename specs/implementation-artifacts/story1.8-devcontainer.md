# Story 1.8: Dev Container Baseline

**Epic**: Epic 1 - DevOps  
**优先级**: P2  
**状态**: Done

## User Story
作为开发者，我想要一个最小可用的 devcontainer，这样我可以在统一的容器化开发环境中直接运行 AppOS 的构建、测试和镜像命令。

## 验收标准
- [x] 提供 `.devcontainer/devcontainer.json`
- [x] 容器内包含 Go 1.26 开发环境
- [x] 容器内包含 Node.js 运行环境
- [x] 容器内可访问宿主机 Docker daemon，用于 `make image build`、`docker compose` 和测试环境命令
- [x] 容器初始化后自动执行 `make install`
- [x] 不引入 editor-only 扩展配置，保持极简

## 实现
- `.devcontainer/devcontainer.json`

## Notes
- devcontainer 负责开发工具链与一致性，不复用运行时镜像。
- 生产镜像仍由 `build/Dockerfile` 负责，保持最小运行时职责。
