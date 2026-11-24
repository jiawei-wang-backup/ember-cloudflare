# Project Pulse 客户端接入

从团队渠道获取对应部署的客户端 ZIP、SHA-256、服务地址和 CA 指纹。解压后以包内接入提示词为准。

- 空数据验收只检查依赖、连通性、本人登录、只读 OAuth 和频道访问。
- 首次正式接入先确认项目范围。客户端查询 Ember 频道并按完整的仓库名复用已有绑定，确认没有绑定才创建私有频道。已选项目可直接试报，再分别核对设备身份、看板、频道发布和实际 @ 回复。
- 升级时停止原监听、更新脚本，保留原项目选择、游标、待续传目录和授权。用 `pulse-onboard.py sync-ember` 查看剩余步骤。

`pulse-onboard.py preflight` 检查本机采集器是否可执行。Windows 优先使用 PowerShell 7 并遵循团队的脚本执行策略。监听已启动代表客户端可连到 SSE 并有监听进程，实际代答仍需在频道验证。

`submit` 先提交 Pulse，随后尝试 Ember 绑定与发布。若 Pulse 已有成功回执且仅 Ember 未完成，运行 `sync-ember` 补绑定、发布和监听即可。用 `verify-projects` 对照看板现有字段和选中会话。

## 公司 GitHub 仓库

服务端 `gh` 和成员本机 `gh` 分别授权。公司组织的细粒度 Token 使用 `Contents: Read` 和 `Pull requests: Read`；仓库范围、期限及审批遵循组织规则。凭据放在服务账号可读的本机目录，由 `PULSE_GH_COMPANY_TOKEN_FILE` 指向文件，组织名由 `PULSE_GH_COMPANY_ORG` 指定。

服务端默认只同步公开仓库。允许发布私有仓库产出摘要时，由管理员设置 `PULSE_GH_PRIVATE_POLICY_FILE`，指向一个以小写 `owner/repo` 为键的 JSON 文件。每项包含 `roomId` 和明确获准的 `memberIds`。频道必须为私有，名单覆盖所有当前成员。私有仓库的摘要限于提交、发布和 PR 信息，原文不进入频道代答或项目助手上下文。
