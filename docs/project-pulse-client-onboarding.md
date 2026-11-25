# Project Pulse 客户端接入

成员统一从 [团队 Ember 接入页](https://192.168.16.70:5443/onboarding) 下载通用 ZIP，再把页面上的接入提示词复制到 Codex。Windows、macOS 和 Linux 使用同一个包，由 Codex 按本机系统选择启动脚本。客户端在成员本机采集、续传和监听。

- 空数据验收只检查依赖、连通性、本人登录、只读 OAuth 和频道访问。
- 首次正式接入先确认项目范围。客户端查询 Ember 频道并按完整的仓库名复用已有绑定，确认没有绑定才创建私有频道。已选项目可直接试报，再分别核对设备身份、看板、频道发布和实际 @ 回复。
- 升级时停止原监听、更新脚本，保留原项目选择、游标、待续传目录和授权。用 `pulse-onboard.py sync-ember` 续传 Ember 快照。
- 把原有的每 30 分钟上报绑定到一条固定 Codex 会话。保留历史和原频率，只留一个启用的上报任务。固定任务用 `pulse-onboard.py cycle` 续传、提交并核验，结果保存在 `.pulse-pending/last-cycle.json`。Codex 根据证据整理新快照。

`pulse-onboard.py preflight` 核对 HTTPS、工作区、账号、授权和已有项目绑定。可加 `--member "本人显示名"` 核对现有 OAuth 账号。预检也单独显示 Pulse 连通性和本机采集器状态。Windows 优先使用 PowerShell 7 并遵循团队的脚本执行策略。首次试报后，将回执里的 `verify_url` 发给有项目权限的另一位成员，请对方核对总览并确认。再运行预检查验同事确认。代答已经启动和实际收到回复分别验收。

项目快照由 Ember 保存，频道总览和项目助手优先读取 Ember 项目快照。用 `prepare-ember` 创建工作目录，按包内 `PROMPT.txt` 写入 `ember-projects.json`，再运行 `sync-ember --work-dir <目录>`。总结先写可用情况、最近交付、当前卡点和下一步，已验证的试用入口单独列出，原始证据放在折叠详情。旧项目首次收到 Ember 快照前，可继续读取可用的 Pulse 项目数据。

开放频道须在 Ember 服务端明确配置仓库绑定和全频道成员读取权限，才接收项目快照。

会话与 Token 现由局域网 Ember 的上报服务保存。已有接入包沿用兼容地址和 `sync-pulse` 命令，看板用 Ember 登录态按项目频道权限展示。未绑定 Ember 账号的会话保留待核实。用 `prepare` 生成批次，再用 `sync-pulse --work-dir <目录>` 提交。两条链路分别确认回执、独立重试。定时任务使用 `cycle` 将两条链路独立处理。只需要 Ember 快照时用 `cycle --ember-only`。退出 2 表示存在未完成的环节，逐项查看回执。设备关联 Pulse 与本机代答也可以各自核对。

## 公司 GitHub 仓库

服务端 `gh` 和成员本机 `gh` 分别授权。公司组织的细粒度 Token 使用 `Contents: Read` 和 `Pull requests: Read`；仓库范围、期限及审批遵循组织规则。凭据放在服务账号可读的本机目录，由 `PULSE_GH_COMPANY_TOKEN_FILE` 指向文件，组织名由 `PULSE_GH_COMPANY_ORG` 指定。

服务端默认只同步公开仓库。允许发布私有仓库产出摘要时，由管理员设置 `PULSE_GH_PRIVATE_POLICY_FILE`，指向一个以小写 `owner/repo` 为键的 JSON 文件。每项包含 `roomId` 和明确获准的 `memberIds`。频道必须为私有，名单覆盖所有当前成员。私有仓库的摘要限于提交、发布和 PR 信息，原文不进入频道代答或项目助手上下文。
