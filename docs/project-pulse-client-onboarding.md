# Project Pulse 客户端接入

从团队渠道获取对应部署的客户端 ZIP、SHA-256、服务地址和 CA 指纹。解压后以包内接入提示词为准。

- 空数据验收只检查依赖、连通性、本人登录、只读 OAuth 和频道访问。
- 首次正式接入先确认项目范围。客户端查询 Ember 频道并按完整的仓库名复用已有绑定，确认没有绑定才创建私有频道。已选项目可直接试报，再分别核对设备身份、看板、频道发布和实际 @ 回复。
- 升级时停止原监听、更新脚本，保留原项目选择、游标、待续传目录和授权。用 `pulse-onboard.py sync-ember` 续传 Ember 快照。

`pulse-onboard.py preflight` 检查本机采集器是否可执行。Windows 优先使用 PowerShell 7 并遵循团队的脚本执行策略。监听已启动代表客户端可连到 SSE 并有监听进程，实际代答仍需在频道验证。

项目快照由 Ember 保存，频道总览和项目助手优先使用自己的项目资料。用 `prepare-ember` 创建工作目录，按包内 `PROMPT.txt` 写入 `ember-projects.json`，再运行 `sync-ember --work-dir <目录>`。旧项目首次收到 r24 快照前，可继续读取可用的 Pulse 项目数据。

会话与 Token 仍由 Pulse 处理。用 `prepare` 生成批次，再用 `sync-pulse --work-dir <目录>` 提交。两条链路分别确认回执、独立重试。也可以在同一目录准备两类文件后运行 `submit`，它先尝试 Ember，再处理 Pulse。退出 2 表示存在未完成的环节，逐项查看回执。设备关联 Pulse 与本机代答也可以各自核对。

## 公司 GitHub 仓库

服务端 `gh` 和成员本机 `gh` 分别授权。公司组织的细粒度 Token 使用 `Contents: Read` 和 `Pull requests: Read`；仓库范围、期限及审批遵循组织规则。凭据放在服务账号可读的本机目录，由 `PULSE_GH_COMPANY_TOKEN_FILE` 指向文件，组织名由 `PULSE_GH_COMPANY_ORG` 指定。

服务端默认只同步公开仓库。允许发布私有仓库产出摘要时，由管理员设置 `PULSE_GH_PRIVATE_POLICY_FILE`，指向一个以小写 `owner/repo` 为键的 JSON 文件。每项包含 `roomId` 和明确获准的 `memberIds`。频道必须为私有，名单覆盖所有当前成员。私有仓库的摘要限于提交、发布和 PR 信息，原文不进入频道代答或项目助手上下文。
