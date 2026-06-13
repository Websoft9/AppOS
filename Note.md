## Bug

## 资源

- 增加 strorage

### 服务器

- 服务器特殊环境配置：Docker 仓库地址、Docker 加速地址、代理地址


## Workflow

## 浏览器

提供一个轻量级的浏览器，它可以通过服务器的网络访问网站

## AI Copit

- AI 驾驶舱，一个交互式的 AI chat，连通云和应用
- AI 基于 cli 与应用交付

## 我的应用

## 应用商店

由文件管理机制机制，迁移至后端提供

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



但它们不等于宇宙完备分类。将来还可能出现这些不太适合硬塞进去的类型：

identity/：OAuth Provider、OIDC、LDAP、SSO
storage/：S3、OSS、NAS、对象存储
messaging/：Kafka、RabbitMQ、NATS、MQTT
mail/：SMTP、邮件服务商
dns/：DNS provider、域名解析
llm/：如果后续有模型、用量、流式响应、工具调用等专属语义
artifact/：如果你未来不只管镜像，还管 Helm Chart、包仓库、插件源
所以答案是：

这四个能覆盖“当前大多数外联资源”，但不应被当成最终固定全集。

我更建议你这样理解：


resource/  server/  database/  integration/  registry/  ...
这里的 resource/ 是“外部资源命名空间”，而不是“只有这四类”。


1. 如果你要把“网络可达性”再升级成应用层探测，我下一步可以把 MySQL/PostgreSQL/Redis/Kafka 从 TCP 通断扩展到协议握手级检查。
2. 把 connectors 和 servers 里还保留的旧版 “新建 Secret” 对话框也完全切到 SecretCreateDialog.tsx。

add resource 统一入口，仍然没有链接到具体的创建弹窗，而仅仅是列表页。除了 server 之外

tunnul 的Port Forward  Effective Mappings 区域没有显示具体的内容了

请将 epic29 下的几个 story 名称更改一下

除了 story29.xx 名称的前缀之外，文件名称最多不超过3个单词

ports tab 不稳定，经常打开显示  somethins wrong

addons 的 netdata restart 报错

去掉所有与 docker.sock 的强依赖与硬编码

## 去nginx 改造

## dockerfile

1. 明确 curl/wget, tar,unzip 等目前是走容器命令，还是走的 golang 包

数据初始化怎么做的？

rss hub 网站

顶部增加一个搜索入口，它搜索主要是搜索页面

docker.1ms.run

数据库的随机密码，不应该太复杂。否则部署应用时，很慢




1. queued 的 Action 没有显示在 actions list 中
2. queued 的应用，竟然也是 installed
3. Uninstall 也在等待一个 install running 的



docker.m.daocloud.io
docker.zhai.cm
docker.1ms.run


再更改一下 wordpress 模板

1. W9_ADMIN_PATH="/wp-admin" 起始这个只是一个说明，它不是环境变量。
2. WORDPRESS_ROOT_URL 我们也把它当做一个说明，它不算环境变量。
root url 

docker image 下载完成后，记得镜像更名


AI settings 哪里，应该是禁用哪些厂商。默认全部启用

activity metadata 区展开后会导致页面抖动


对。不管是 chat、agent、还是后续任何 AI 能力，模型选择都应该在执行时那一刻决定，而不是绑在 provider 配置上。

这和现实世界是一样的：你注册了一个 DeepSeek 账号（provider），不等于你永远只用 deepseek-chat；你也可能今天用 chat、明天换 reasoner。选择权在执行时，不在注册时。

唯一需要持久化的偏好是"上次用的是什么"，这样用户打开 chat 不用每次都重选。但这只是一个 UI 状态记录（localStorage 或 user preference），不会污染 provider 的业务数据。

所以最终模型是：

层	职责	存储
Provider	endpoint + credential + kind	数据库
模型列表	fetch-models 运行时拉取	不存
默认偏好	上次用哪个 model	前端 localStorage 或用户偏好字段


getconf 是唯一硬编码的 OS 命令，Linux 基本都有。其余命令由 catalog 模板定义，非后端硬编码。


proxy 的消费还没有测试
proxy 开关设计

改 Go 代码，给 fetchProviderModels 里的 http.Client 加上 SOCKS5 dialer，通过环境变量（如 SOCKS5_PROXY）控制







add  external service 流程优化

1. Password Secret 项去掉或不显示 Generate，这个场景不需要
2. 下拉清单中的 Secret 不要出现 (Token / Single Value) 这种类型说明，没有一样


edit external service 流程优化
1. Name 仍然作为标题栏重新，节省空间
2. Password Secret 处
-如果是新增，应该可直接填写值或选择已有
-如果是修改，应该点击编辑按钮后天呢或选择已有





认证方式，原数据化


ai provider 元数据优化

另外，google gemini 模型在拉取 models list 时报错：Loading models timed out. Check network connectivity and confirm the provider endpoint is reachable. 


数据库增加 external json 结构，便于未来拓展？

每一个chat 窗口，提供一个 token 统计

settings > proxy 界面优化
Proxy Providers: Proxy nodes and service instances
Platform Proxy: Global proxy settings for platform modules
Remote Proxy: Proxy configurations for remote servers

每个区域一个独立的框，标题和说明放在框之外。
所有的设置tab 今后都采用这种策略

问题根因是后端更新接口复用了完整的 upsert 校验，编辑时不仅要求 name 和 url，也要求 format。前端 PATCH 之前只补了 url，但仍然没传 format，所以继续触发 Invalid feed source format。我已在编辑模式的请求体中补上 format: formFormat，现在编辑时会提交完整字段集：name、url、format、favicon_url、status。

改动在 web/src/routes/_app/_auth/feeds.tsx。如果你愿意，下一步我可以顺手把这个编辑提交流程补一条前端测试，避免这类字段遗漏再次出现
