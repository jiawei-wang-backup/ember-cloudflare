# Ember × Project Pulse：本地集成 MVP

> 本文记录早期本地集成原型。`127.0.0.1:4186` 的旧库不是截图监控面板的数据源，
> 原型频道现已隐藏，误导入的内容已回退，旧 4186 查询服务已停止。
> 当前六项目的折叠统计和项目助手直接查询正确的局域网 Dashboard，
> 见[当前监控演示指南](./monitor-demo-guide.md)。下文中的旧库配置与启动命令仅用于历史参考。

## 已运行的入口

中文 Ember：<http://localhost:5174>。进入私人频道 **Project Pulse · 实际研发**：
<http://localhost:5174/rooms/00mwj0ixfde04hqs>。

登录使用中文演示账号，凭证只在忽略提交的 `.wrangler/demo-cn/accounts.json` 中。当前运行的后端为
`http://127.0.0.1:4186`，只读原有 PostgreSQL；没有制造采集数据，没有生产部署。
原 Fernwood 继续使用 5173 和原来的独立存储。

## 原架构检查与决策

Ember 使用 React/Vite、Cloudflare Worker、Workspace/ChatRoom Durable Objects、SQLite/D1、R2。
身份由原有 session 验证，频道成员由 Workspace 管理。原生 AI 在 ChatRoom 中读取必要会话上下文，
通过 `EmberTool` 和各模型格式的 tool calling 查询房间历史和外部应用。

Project Pulse 位于 `/Users/wangjiawei/Desktop/监控面板/project-pulse`，使用 Node HTTP、pg、PostgreSQL。
`backend.mjs` 已实现采集、全局聚合，`src/live-workspace.js` 绘制现有 Dashboard；`db/` 管理采集表和迁移。
真实采集表具备仓库 UUID、设备/会话关联、Token、模型、PR、目标观察和显式里程碑。
现有前端演示数据还有任务与人员模型，但它们不是 PostgreSQL 真实任务数据，不能拿来填充真实项目统计。

原 `/api/v1/dashboard` 缺少读鉴权。本次默认改为服务凭证保护；只有明确选择 `PULSE_LOCAL_VIEW=1`
且原服务器限制回环监听的本地查看模式可以不带 Dashboard token。新的 Ember 服务不启用此模式。
如原看板需要继续本地查看，使用原 `ops/local.sh` 的本地查看选项，或明确配置对应权限；不要把此模式对外暴露。

采用最小改动方案：Project Pulse 新增按仓库 UUID 的只读聚合，Ember Worker 做服务端代理与频道/项目双重校验；
顶部组件只显示六项摘要，展开详情显示成员、模型、PR、里程碑和近期活动。
映射保存在操作者控制的配置中，不以名称、目录别名或 Token 数量猜测项目。多个 room ID 可指向同一 repository UUID。
没有增加数据库字段或迁移：此次仅读取已有表，兼容本地尚未应用 009 的 `project_evidence` 字段。

## API 与权限

|接口|认证与作用|
|---|---|
|Pulse `GET /api/v1/projects/:repositoryId?days=7`|`PULSE_EMBER_TOKEN` 服务凭证，且仓库 UUID 在 `PULSE_EMBER_PROJECTS` 白名单中|
|Ember `GET /api/rooms/:roomId/project?days=7`|原生登录 + 频道成员访问 + 显式项目授权；客户端不能通过 projectId 参数换项目|
|同一接口的 `audience=room`|另验证私人频道所有读者均获授权，用于向整个频道发布项目答案|
|Pulse `GET /api/v1/dashboard`|默认要求 `PULSE_DASHBOARD_TOKEN`，不把全局数据转交 Ember|

时间窗只接受 1/7/30 天，本次项目 API 使用从查询时刻回溯的滚动窗口，并返回精确 since/until，
区别于原 Dashboard 的 UTC+8 自然日口径。所有用量 SQL 通过 `(device_id, session_id)` 关联到明确的 repository_id，
仅汇总 billable 事件。Cached Input 是 Input 子集，分别显示，绝不把二者相加。
NULL 表示未采集，显示未知；不把未知记成零。缺少供应商价格/账单则费用未知。
账号额度可能涉及其他项目，当前不向此项目组共享账号级快照。

前端没有数据库连接、服务 token 或服务端配置文件内容。服务间不跟随重定向，设置超时，
返回项目 UUID 也必须与请求一致；失败时显示错误/重试，不显示旧房间数据。
没有 CORS 放开或关闭原有身份校验。

**频道内项目答案仅允许私人频道**：公开频道未来加入的新成员也能读历史答案，单纯校验提问人不够。
因此 `Workspace.canSharePulse` 检查整个私人频道读者白名单，防止未授权成员通过其他人的 Agent 回答读取数据。
本次首次配置明确授权现有本地演示团队；之后重跑关联命令保留原授权，不自动授权未来新加入的用户。
正式使用时必须由项目管理员核对配置中的 Ember user ID，不能把本地演示名单当作生产身份映射。

## 项目助手与 AI 工具

原生 AI 工具已接入 ChatRoom 的首次回答和继续调用流程：

- `get_project_overview`
- `get_project_members`
- `get_member_activity`
- `get_project_usage`
- `get_project_quota`
- `get_project_pull_requests`
- `get_project_milestones`
- `get_recent_deliveries`（PR/里程碑证据，不代表业务验收）

讨论查询复用原有 `search_messages`，只搜索当前房间及 Thread。工具从执行上下文固定 room/repository ID，
不给模型选择另一个项目的机会。工具按需返回有界的字段、来源和时间窗，不向 Prompt 塞全局 Dashboard。
返回的近期活动/PR 最多 30/50 条，成员最多 100 名；这些限制不影响用量全量汇总。

**当前没有配置 LLM，所以尚未实测真实模型推理。** 已配置一个原生 Bot “项目助手”，作为可运行回退：
被 @ 时识别成员、用量、PR、里程碑或周报查询，调用受保护的项目接口，然后确定性排版真实结果，
明确标注“结构化查询模式，非 LLM 分析”。它不根据聊天推测风险、负责人、延期或完成率。
回调只在中文本地启动器存在，校验随机路径 token、房间和当前提问人的成员资格，再检查整个频道的项目授权。
机器人凭证和本地代理会话只在被忽略的 0600 文件中；会话失效时需重新运行关联命令。

要使用真正的 AI 分析：在 Ember Admin → AI assistant 配置你愿意使用的模型账户，创建例如“项目数据分析助手”，
限制到该私人项目频道并给出“只引用工具和聊天证据、不推断缺失事实”的 Instructions。
将新 Agent 的 user ID 明确加入 `pulse-link.json` 的授权列表，再运行关联命令、重启中文服务。
原生项目工具会随该房间的 AI 调用自动提供。模型连接测试可能产生费用，当前未替你调用。

## 真实数据与当前边界

本次检查数据库有 10 个会话，只有 1 个存在明确仓库 UUID 映射。因此没有把其余未归属会话按目录名补进统计。
近 7 天实际返回 Input 4,349,249、Output 15,410、Cached 4,214,912，来自 37 个事件；1 名参与者、1 个 PR。
这些是当时的数据库快照，不是预置固定值；刷新和改变时间窗会重新查询。

负责人默认未配置，不能把参与者 JIAWEI WANG 自动称为负责人。需要显式指定时，在 Pulse 私有环境配置
`PULSE_PROJECT_OWNERS`，格式为仓库 UUID → developer UUID 的 JSON 对象。即使负责人没有采集会话也能显示，
但配置应由真实项目授权人确认。没有依据 Token 或提交数量推断岗位。

当前正式 `project_milestones` 表为空，显示未配置，不拿 AI 观察报告的建议当作已验收里程碑。
没有新增完整任务管理、GitHub Issues 同步、岗位分配 UI、截止日预测、价格表维护或账号额度授权 UI。
PR 没有 assignee 字段；因此不展示虚构的 PR 负责人。近期成果显示真实 PR/活动证据，不自动称为交付完成。

## 本地启动

首次需要已经初始化的中文环境保持运行。实际项目路径如下。

```sh
# 启动现有数据库（保留卷内数据）
/Applications/Docker.app/Contents/Resources/bin/docker start project-pulse-local-db

cd /Users/wangjiawei/Desktop/ember-cloudflare
corepack pnpm build
# 若中文环境尚未运行，先用原命令启动它，供关联命令认证。
corepack pnpm dev:demo-cn
```

另一终端：

```sh
cd /Users/wangjiawei/Desktop/ember-cloudflare
corepack pnpm link:pulse
```

关联命令读取已有 `.pulse/local.env` 和本地 Docker 端口，生成本地服务配置，创建/复用私人项目频道。
之后仅重启中文 `dev:demo-cn`（5174/8790），让它加载 `.wrangler/demo-cn/pulse.wrangler.json`。

另一个终端启动 Project Pulse 的受保护接口：

```sh
cd /Users/wangjiawei/Desktop/监控面板/project-pulse
node --env-file=.pulse/ember.env server.mjs 4186
```

后续保持这两个服务运行即可。Docker 重启后若数据库动态端口变化，应重新运行关联命令以更新连接配置。
Pulse 路径不同可设置 `PULSE_DIR`；当前关联命令只选择明确的 `jiawei-wang-dev/project-pulse`，不会猜测别名。
要关联更多项目，应在 Pulse 端逐一授权 UUID，并在 Ember 配置中明确加入 room ID、project UUID、成员白名单。
不要把一个真实仓库关联到全部六个模拟项目来制造统计覆盖。

私有运行配置：

- Ember `.wrangler/demo-cn/pulse-link.json`：稳定映射和授权白名单；`pulse-session.json`：本地回调代理会话。
- Ember `.wrangler/demo-cn/.dev.vars`、`pulse-key`：服务凭证；`pulse.wrangler.json`：本地配置。
- Pulse `.pulse/ember.env`：数据库连接、回环监听、服务凭证和仓库白名单。

以上均在已忽略的目录，不应提交。未修改根 Wrangler 正式部署配置，不部署生产服务。
跨机器/正式部署需要可达的 HTTPS 服务地址与独立凭证；Cloudflare 线上 Worker 无法直接访问本机 127.0.0.1。

## 实际演示路线

1. 登录中文 Ember，打开“Project Pulse · 实际研发”。查看顶部六项数据和查询时间。
2. 切换 1/7/30 天并刷新。展开详情，看实际参与者、角色未知、PR 链接、模型与最近采集活动。
3. @项目助手：“介绍整体进度”“谁负责？”“近一周消耗多少 Token？”或“生成项目周报并附证据”。
4. 观察真实 Webhook 答案：包含时间窗、来源、PR 链接；未知里程碑、费用与负责人会明确保留未知。
5. 在房间继续发送/引用/回复 Thread，原聊天照常使用。切到未关联频道，不出现项目面板；退出登录后项目 API 返回 401。
6. 真正的 LLM 推理需配置模型后再演示，不把当前确定性查询回复称为 AI 推理成功。

## 测试与变更清单

实际通过：Project Pulse `npm test` 48 项；Ember 项目权限/隔离/工具调用测试在 SQLite 与 D1 各 5 项，合计 10 项；
概览组件测试 3 项；原频道顶部/输入框回归 77 项；全仓库类型检查、生产构建与原中文环境集成验证。
桌面 1440 和手机 390 宽度的实际浏览器中已展开真实项目详情，实际 @ 项目助手已获得数据库查询回复。
真实 HTTP 检查：匿名/无服务凭证 401，越权仓库 403，无效时间窗 422，合法房间 200；凭证未进入响应。
没有对真实数据库运行会写入模拟数据的原 `integration/smoke.mjs`。

Ember 变更：

- `packages/protocol/src/pulse.ts`、`index.ts`：共享响应类型。
- `apps/worker/src/env.ts`、`pulse.ts`、`index.ts`：配置、权限代理与新 API。
- `apps/worker/src/workspace.ts`：频道整体读者授权；`chat-room.ts`：原生 AI 结构化工具。
- `apps/web/src/components/workspace/project-overview.tsx`、`room-view.tsx`：概览与详情。
- `apps/worker/test/pulse.test.ts`、前端 `project-overview.test.tsx`：权限、工具和界面测试。
- `apps/worker/scripts/demo-cn/link-pulse.ts`、`pulse-bot.ts`、`dev.ts`、`package.json`：本地关联、回调与启动。
- `docs/project-pulse-integration.md`：本文。

Project Pulse 变更：`project-api.mjs`、`backend.mjs`、`test/project-api.test.mjs`。
保留用户原有 `ops/report/pulse-report.pl` 未提交改动，没有覆盖它。两仓库均未提交或推送。
