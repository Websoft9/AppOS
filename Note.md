## Bug

## 资源

- 增加 strorage
- 资源增加拷贝功能，即基于一个资源拷贝为新资源

### 服务器

- detail page
- 服务器特殊环境配置：Docker 仓库地址、Docker 加速地址、代理地址
- 环境预装机制：在线一键脚本或由 AppOS 推送到服务器后执行
- Create Server 是，需要针对两种类型做一定的体验改善


## 隧道

- 隧道链接到服务器的 detail page

## Workflow

## 浏览器

提供一个轻量级的浏览器，它可以通过服务器的网络访问网站

## AI Copit

- AI 驾驶舱，一个交互式的 AI chat，连通云和应用
- AI 基于 cli 与应用交付

## 我的应用

## 部署

- docker 部署
- 模板部署
- 源码部署

## 镜像加速

## 发布

- 发布到临时域名，设置时长
- 发布到自定义域名
- HTTPS
- 转发
- waf

## Access Portal

免登录访问 saas 系统的控制台

## 凭据的分布

Secrets（基础设施层）
└── 哑存储：只管加密存取，不懂业务，不知道值是给谁用的

Integrations（业务层）
└── 智能连接器：知道"GitHub 需要什么"，管理 API key + endpoint + 客户端安装 + OAuth 等
    └── 其中，敏感字段通过 secretRef 指向 Secrets，自己不存明文

Settings（配置层）
└── 非敏感的全局配置

## LLM
- 本地小模型内嵌？

## 监控

- metric
- 在线用户
- 隧道连接
- 网关转发...

## UI 通用

- 大文本光标问题

## 每日


- default group 
- 协作菜单的图标，不够简洁，请采用更合适的

## 缓存问题

- 如何做？存储到哪里？




给 App detail 再接一层 compose 校验与 diff 预览，避免直接保存时改坏配置。



手工部署应该有一个完整的体验过程：

1. 采集部署数据
2. 检查和确认部署
3. 确认通过后才可以加入 pipeline

如果没有确认过的，是否可以保存下来？



给 target-based deploy 再补一层 .env 和参数表单预填
给私有 Git 再补 Secret 引用模式，避免每次手填 token


2. Install  from store 和 Custom Deployment 区块没有考虑 dark 模式
3.  

backend/
├── cmd/
│   └── appos/main.go
│
├── domain/
│   ├── lifecycle/                         # Domain: Application Lifecycle
│   │   ├── appinstance/                   #   Subdomain: App Instance Management
│   │   │   ├── model.go
│   │   │   ├── service.go
│   │   │   └── api.go
│   │   ├── operation/                     #   Subdomain: Operation Management
│   │   │   ├── model.go
│   │   │   ├── service.go
│   │   │   └── api.go
│   │   ├── release/                       #   Subdomain: Release Management
│   │   ├── exposure/                      #   Subdomain: Exposure Management
│   │   └── recovery/                      #   Subdomain: Recovery Management
│   │
│   ├── execution/                         # Domain: Lifecycle Execution
│   │   ├── pipeline/                      #   Subdomain: Pipeline Execution
│   │   ├── worker/                        #   Subdomain: Worker Scheduling
│   │   ├── projection/                    #   Subdomain: Projection Update
│   │   └── compensation/                  #   Subdomain: Compensation Control
│   │
│   ├── resourceops/                       # Domain: Resource Operations Platform
│   │   ├── remoteaccess/                  #   Subdomain: Remote Access (tunnel)
│   │   ├── terminal/                      #   Subdomain: Terminal Operations
│   │   ├── fileops/                       #   Subdomain: File Operations
│   │   ├── serviceops/                    #   Subdomain: Service Operations
│   │   └── containerops/                  #   Subdomain: Container Operations
│   │
│   ├── observability/                     # Domain: Observability
│   │   ├── telemetry/                     #   Subdomain: Telemetry
│   │   ├── health/                        #   Subdomain: Health & Diagnostics
│   │   └── platformstatus/               #   Subdomain: Platform Self-Observation
│   │
│   ├── operations/                        # Domain: Operations Management
│   │   ├── inventory/                     #   Subdomain: Resource Inventory & Topology
│   │   ├── topics/                        #   Subdomain: Operational Knowledge (Topics)
│   │   ├── space/                         #   Subdomain: Operational Knowledge (Space)
│   │   ├── incidents/                     #   Subdomain: Incident Response
│   │   └── automation/                    #   Subdomain: Operations Automation
│   │
│   ├── catalog/                           # Domain: App Catalog
│   │   ├── apps/                          #   Subdomain: Catalog Apps
│   │   ├── custom/                        #   Subdomain: Custom Apps
│   │   ├── templates/                     #   Subdomain: Templates
│   │   └── favorites/                     #   Subdomain: Favorites / Notes
│   │
│   ├── gateway/                           # Domain: Gateway Management
│   │   ├── domainbinding/                 #   Subdomain: Domain Binding
│   │   ├── routing/                       #   Subdomain: Routing & Upstreams
│   │   ├── certbinding/                   #   Subdomain: Certificate Binding
│   │   └── policies/                      #   Subdomain: Gateway Policies
│   │
│   ├── secrets/                           # Domain: Security and Secret Management
│   │   ├── vault/                         #   Subdomain: Secrets
│   │   └── policies/                      #   Subdomain: Secret Policies
│   │
│   ├── config/                            # Domain: Platform Configuration
│   │   └── settings/
│   │
│   ├── identity/                          # Domain: Identity and Access
│   │   └── access/
│   │
│   ├── audit/                             # Domain: Audit and Policy
│   │   └── logging/
│   │
│   └── integrations/                      # Domain: Integrations & Connectors
│       ├── sources/                       #   Subdomain: Source Integrations
│       ├── registries/                    #   Subdomain: Artifact & Registry
│       ├── notifications/                 #   Subdomain: Notification Integrations
│       └── ai/                            #   Subdomain: AI Provider Integrations
│
├── infra/                                 # 跨领域技术基础设施
│   ├── docker/
│   ├── crypto/
│   ├── fileutil/
│   └── cronutil/
│
└── platform/                              # 平台级关注点
    ├── migrations/
    ├── components/
    ├── hooks/
    └── supervisor/



