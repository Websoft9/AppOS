## Quick Issue

## App 发布

- 发布到临时域名，设置时长
- 发布到自定义域名
- HTTPS
- 转发
- waf

把这个演示页接到真实 Public Access 数据结构
给 New Publish Item 弹窗补 type / expiry / visibility / target selector 等真实字段


## App Deploy

1. 部署时，镜像实际已经拉取成功，但是 activity 中滞后，导致activity 流程不能及时完成闭环。
2. 针对于同一个应用，创建新的 activity 时，如何有正在执行的，这个时候可以给一个提示，是否需要 failed 正在执行的

2026/6/24 15:03:08
install
Timed out
execute "install" timed out: install docker via script: context deadline exceeded


手工部署应该有一个完整的体验过程：

1. 采集部署数据
2. 检查和确认部署
3. 确认通过后才可以加入 pipeline

如果没有确认过的，是否可以保存下来？


给 target-based deploy 再补一层 .env 和参数表单预填
给私有 Git 再补 Secret 引用模式，避免每次手填 token

数据库的随机密码，不应该太复杂。否则部署应用时，很慢


1. queued 的 Action 没有显示在 actions list 中
2. queued 的应用，竟然也是 installed
3. Uninstall 也在等待一个 install running 的


再更改一下 wordpress 模板

1. W9_ADMIN_PATH="/wp-admin" 起始这个只是一个说明，它不是环境变量。
2. WORDPRESS_ROOT_URL 我们也把它当做一个说明，它不算环境变量。
root url 

docker image 下载完成后，记得镜像更名

## App detail

给 App detail 再接一层 compose 校验与 diff 预览，避免直接保存时改坏配置。


## server

- addons 的 netdata restart 报错
- 服务器特殊环境配置：Docker 仓库地址、Docker 加速地址、代理地址

## System

getconf 是唯一硬编码的 OS 命令，Linux 基本都有。其余命令由 catalog 模板定义，非后端硬编码。

## Tunnel 

tunnul 的Port Forward  Effective Mappings 区域没有显示具体的内容了

## 浏览器

提供一个轻量级的浏览器，它可以通过服务器的网络访问网站

基于 Webcontainer 技术，在浏览器网页上运行

## AI Copit

- AI 连通云和应用，AI 基于 cli 与应用交付
- 认证方式，原数据化
- 限制历史消息数量，每次8轮
- 捕捉token 超标的错误后，删除最早的2条消息

## Access Portal

免登录访问 saas 系统的控制台

## Backup

## Subscription  Plan

## 监控

- 在线用户
- 隧道连接
- 网关转发...

## 性能

- 缓存如何做？存储到哪里？

## dashboard

顶部增加一个搜索入口，它搜索主要是搜索页面

frame 嵌入页面实施，我把这个 iframe-page framework 再抽一层 registry，让后续消费者不必各自手写 page definition

如果你要继续，我建议下一步做 1 件事：把页面文案里的原始链接说明也补成更明确的“公开 dashboard 代理入口”，避免后面有人又按旧 /api/system/traefik 去排障。


## Small issue

connector api 路径

Runtime Instances 列表页


onlyoffice 存放在哪里的问题

进一步清理后端 instances 模型里已经不再使用的 commonFieldDefaults / omitCommonFields 结构，彻底去掉旧时代遗留


整理 instance 下 MQ 分类的元数据

1. username 可选
2. Credential 的 UI 显示时，toolpit 内容应该是 This Credential may be a Password, Token, or Secret Key.
3. 协议不固定


assets memory

## Tests

1. tests/e2e/fixtures/appos.ts 的真实资源 helper
2. 第一批 server / connector / smtp 的 acceptance 用例

登录页增加一个背景图片


如果你愿意，下一步我建议继续做两件事之一：
1. 把 CI 的 builder 层也逐步对齐到 build/Dockerfile.dev
2. 在开发容器里补 Playwright 支持，打通浏览器 E2E 开发链路


Prepare: 

 make init-env             Create .environments/local.env from template (auto-loaded outside CI)
 make image pull IMAGE=... Pull an image on the host using the mirror-aware pull flow

Dev runtime:

 make pull base-image  Pull all base images from build/source/spec.yaml
 make build dev-image  Build the development container image
 make build dev-image --from-mirror Build the development container image from packages mirror
 make dev up  Start the development container
 make dev shell  Docker exec to development container
 make dev down Stop and remove the development container
 make tidy                 Exec to dev container for tidy Go modules
 make build                Exec to dev container to build all resources (backend + web)
 make build backend   Exec to dev container to build Go binary → backend/appos
 make build web         Exec to dev container to build React web → web/dist
 make sync-store        Exec to dev container to fefresh backend/domain/catalog/seed/*.json from artifact.websoft9.com
 make build image Exec to dev container to build runtime image

Dev-OpenAPI:
  make openapi-gen          Auto-generate OpenAPI spec skeleton from route source
  make openapi-merge        Merge ext-api.yaml + native-api.yaml -> api.yaml
  make openapi-check        Validate code->spec coverage and group-matrix generated anchors
  make openapi-sync         Generate + validate OpenAPI in one command

Code Quality:
  make test backend         Backend unit + integration tests
    example: make test backend TARGET=./domain/iac/...
    example: make test backend TARGET=./domain/routes RUN=TestIACRoutes
  make test web             Frontend unit + integration tests
  make qa lint              Lint gate (Go lint + actionlint + eslint + web typecheck)
  make qa format            Format gate (gofmt + prettier)
  make qa openapi           OpenAPI generation + coverage gate
  make qa check             lint + format + openapi + test backend + test web
  make sec source           Source/config security checks (govulncheck, npm audit, betterleaks)

Runtime container:
  make start                Start container (interactive port prompt when attached to a TTY)
  make start latest       Start with latest image (skip interactive)
  make stop                 Stop container
  make restart              Restart container
  make logs                 View container logs (follow mode)
  make stats                Show all services status inside container
  make delete               Stop and remove container (keeps volumes)
  make rm                   Force remove container and volumes

Automatic Testing: 
  make test e2e runtime     Container/runtime smoke
  make test e2e smoke       Runtime smoke + Playwright browser smoke
  make test e2e             Smoke + acceptance browser tests
  make test-env up          Start local external test dependencies
  make test-env down        Stop local external test dependencies


CI Gate: 
  make gate pr              PR gate = qa check
  make gate merge           Merge gate = qa check + sec source + test e2e smoke
  make gate staging         Staging gate = merge + test e2e
  make gate release         Release gate = staging + sec artifact
  make version-check        Validate Git tag version metadata or print current git-derived version

Utilities:
  make opencode             Launch opencode with proxy disabled
  make opencode-clear       Clear ALL opencode session data (with confirmation)
  make kill-port 9091       Kill process using port
  make tl                   Show template tooling commands
  make tl validate          Validate normalized templates
  make tl validate wordpress Validate one normalized template sample
  make tl ingress           Render sample template ingress payload (default: wordpress)
  make tl ingress wordpress Render sample template ingress payload for one template
  make tl ingress wordpress TL_VALUES=templates/tests/examples/wordpress.values.json
  make tl verify            Run template validation and ingress rendering
  make help                 Show this help


