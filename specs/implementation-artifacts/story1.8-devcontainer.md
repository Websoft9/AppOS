# Story 1.8: Development Container Baseline

**Epic**: Epic 1 - DevOps  
**优先级**: P2  
**状态**: Done

> Historical note (2026-07-29): the original VS Code `.devcontainer` approach has been retired. AppOS now uses a Docker-first development container defined by `build/Dockerfile.dev` and `build/docker-compose.dev.yml`.

## User Story
作为开发者，我想要一个最小可用的开发容器，这样我可以在统一的容器化开发环境中直接运行 AppOS 的构建、测试和镜像命令，并且不依赖 VS Code devcontainer 黑盒逻辑。

## 验收标准
- [x] 提供 `build/Dockerfile.dev` 作为开发镜像事实来源
- [x] 提供 `build/docker-compose.dev.yml` 作为开发容器启动入口
- [x] 容器内包含 Go 1.26、Node.js、Python 和开发工具链
- [x] 容器内可访问宿主机 Docker daemon，用于 `make image build`、`docker compose` 和测试环境命令
- [x] 提供幂等的工作区 bootstrap，而不是依赖 VS Code `postCreateCommand`
- [x] 废弃 `.devcontainer/` 方案

## 实现
- `build/Dockerfile.dev`
- `build/docker-compose.dev.yml`
- `build/dev/bootstrap.sh`
- `Makefile`

## Notes
- development container 负责开发工具链与一致性，不复用运行时镜像。
- 生产镜像仍由 `build/Dockerfile` 负责，保持最小运行时职责。
