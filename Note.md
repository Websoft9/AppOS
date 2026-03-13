## Bug
- add server 失败：Failed to create record.

## 资源

- 增加 strorage
- 资源增加拷贝功能，即基于一个资源拷贝为新资源

### 服务器


服务器特殊环境配置：Docker 仓库地址、Docker 加速地址、代理地址
环境预装机制：在线一键脚本或由 AppOS 推送到服务器后执行


## 隧道

- 增加一个隧道管理页面
- Create Server 是，需要针对两种类型做一定的体验改善
- 为什么 /tunnel 被 Nginx 代理了？

## Workflow

## SFTP/SSH

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

