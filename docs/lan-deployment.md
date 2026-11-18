# 中文 Ember 局域网部署

当前入口：<http://172.16.30.144:5174>。同一局域网设备使用原中文演示账号和密码登录。
2026-11-17 本机网络地址已变化，原 `192.168.20.57` 入口不再适用；服务继续监听应用端口 5174。
本机 <http://localhost:5174> 继续可用；IP 地址与 localhost 的浏览器登录状态分别保存。
凭证位于忽略提交的 `.wrangler/demo-cn/accounts.json`，不在文档中保存密码。

## 后台服务

已安装 macOS LaunchAgent `com.ember.demo-cn.lan`：登录后自动启动，退出 Codex 或关闭终端仍会运行。
服务文件：`/Users/wangjiawei/Library/LaunchAgents/com.ember.demo-cn.lan.plist`。
电脑需要保持开机联网；休眠或断网期间无法供其他设备访问。

```sh
# 查看后台服务
launchctl print gui/501/com.ember.demo-cn.lan

# 停止本次登录中的服务
launchctl bootout gui/501 /Users/wangjiawei/Library/LaunchAgents/com.ember.demo-cn.lan.plist

# 重新启动服务
launchctl bootstrap gui/501 /Users/wangjiawei/Library/LaunchAgents/com.ember.demo-cn.lan.plist

# 查询 Wi-Fi 当前地址（DHCP 改变地址后以此为准）
ipconfig getifaddr en0
```

日志为 `.wrangler/demo-cn/lan.stdout.log` 和 `lan.stderr.log`。
手动排查时先停止后台服务，再在仓库根目录运行 `corepack pnpm dev:lan`；两个入口共用 5174，不能同时启动。
`corepack pnpm dev:demo-cn` 仍是仅本机访问的启动方式。

## 存储与访问

局域网入口只开放应用端口 5174，Worker 8790 继续监听 `127.0.0.1`。
`/__demo_cn_identity`、Bot 内部回调和 Wrangler Local Explorer 对局域网请求返回 404，内部回调通过 localhost 继续使用。
登录、频道权限、同源校验继续生效；局域网 HTTP 不强制跳转 HTTPS。
浏览器没有 `crypto.randomUUID` 时，用 `crypto.getRandomValues` 生成同样的随机 UUID，支持发送消息、Thread 与附件。

数据沿用 `.wrangler/demo-cn/state`，没有重新 seed、清空或迁移。六项目顶部统计和项目助手继续读取
`192.168.16.70:4185` 的正确监控服务，Fernwood 的 5173 和原有存储保持独立。
需要重新构建界面时运行 `corepack pnpm --filter @ember/web build`，然后刷新浏览器。

已通过局域网 IP 的真实浏览器验证：密码登录、双浏览器实时消息、Thread 回复、附件上传、项目助手及项目统计。
测试记录保存在 `.wrangler/demo-cn/lan-verification.json`，测试使用本机的局域网地址，未代替其他物理设备进行网络验证。

HTTP 模式用于当前局域网演示；需要浏览器推送、麦克风或完整 PWA 能力时，应另外配置受客户端信任的 HTTPS。
