<p align="center">
  <img src="docs/screenshots/banner.png" alt="Ember: team chat that's yours, on your own Cloudflare account. Open source, deployed in one click, with no per-seat fees, and every message kept.">
</p>

<p align="center">
  A real-time chat app that runs entirely on Cloudflare.<br>
  Rooms, threads, DMs, files, search, bots and push notifications, deployed in one click.
</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/NYLLON-SOFTWARE/ember-cloudflare"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>
</p>

<p align="center">
  <a href="#everything-your-team-needs">Features</a> ·
  <a href="#ember-and-slack-side-by-side">Ember vs Slack</a> ·
  <a href="#what-it-costs">What it costs</a> ·
  <a href="#get-started">Get started</a> ·
  <a href="docs/self-hosting.md">Self-hosting guide</a>
</p>

## 中文局域网接入

**[下载 r22 客户端 ZIP](docs/lan-client/project-pulse-report-3.6.0-lan-r22.zip)** · [下载接入提示词 TXT](docs/lan-client/ember-lan-onboarding-r22.txt)

ZIP 的 SHA-256 为 `cad574d594f6cbde6fd04508d508e74df245a7c635b590baa78bc2c3454c82fb`。

用 Codex 打开解压目录，复制下方提示词。仅检查连通性时，使用 ZIP 内的《空数据验连提示词.txt》。公司仓库授权要求见 [Project Pulse 客户端接入](docs/project-pulse-client-onboarding.md)。

当前分支的服务端仅支持已绑定项目频道的成员代答。r22 可检测全频道订阅能力，实际可用范围以服务端支持和真实频道测试为准。

<details>
<summary>展开并复制完整接入提示词</summary>

```text
请直接完成接入。用当前解压目录的 README.md、PROMPT.txt、project-selection.md 和包内工具，不要让我手填服务端地址、编辑配置或另发提示词。

r22 使用 Ember 实时推送接收频道 @，收到后先入队，每台电脑一次处理一条。断线重连补收近 24 小时未完成的提问。同一成员有多台设备在线时，只由认领成功的一台执行。升级后请停止原监听，再运行新版监听。

Windows 升级后先停掉旧版代答监听，再用新版脚本启动监听。后台执行 Codex 和 GitHub CLI 时隐藏命令行窗口。

已授权 Ember 的设备在成功上报后会自动绑定到当前 Ember 成员。同一账号的多台设备会合在同一成员下统计。检查 ember_reporting_member，已有上报数据的设备可以执行 pulse-onboard.py sync-ember 补绑定。

如果当前目录已有接入配置，保留项目绑定、授权和续传状态。升级时替换为 r22 的脚本并重启代答监听，检查 ember_member_listener 是否就绪。

运行 pulse-onboard.py links 核对服务端地址。Project Pulse 看板和上报是 http://192.168.16.70:4185，Ember 工作区是 http://192.168.16.70:5174，Ember 网页授权是 https://192.168.16.70:5443。已有明确有效选择的升级沿用原配置；首次接入或重选时只读识别本机项目，在一条消息里列出有已核实 GitHub 仓库的候选项目，展示「中文项目名（英文仓库名）」，请我回复要接入的项目编号。优先沿用已有中文项目名，没有就按项目用途拟一个简短中文名。在同一条确认消息里展示，允许我改名，并说明下文的全频道代答范围。确认前说明：每个选中的项目都会绑定 Project Pulse 看板和对应的 Ember 项目频道，并默认开启本机 Codex 代答。其他成员在该频道 @ 本人时，Codex 只用本机已上传且服务端确认属于当前项目的会话摘要回答。新项目频道默认加入工作区当前成员和普通机器人。不要提供单独接入看板或频道的选项，也不要另问是否开启代答。在同一条确认消息里明确说明：我回复编号即确认接入该项目并默认开启 24 小时历史续聊，无需另回复「开启」。代答只读所选项目已上传且经服务端核验的指定 Codex 会话，提取与问题相关的本机对话片段；首次代答或距同一提问人上次成功代答满 24 小时重新读取。允许我同时指定关闭，例如「2」表示接入第 2 个项目并开启历史续聊，「2 关闭历史」表示接入第 2 个项目，代答仅使用已上传的摘要及关联报告。同一条确认消息还要说明：选中项目默认启用 GitHub 只读代码分析，复用这台电脑已有的 GitHub CLI 登录。架构、实现或 README 问题可读取本项目 GitHub 默认分支上相关的已提交文件，分析将回复到项目频道供全员查看，无需逐个验证频道成员的 GitHub 权限。「2 关闭代码分析」可单独关闭这项功能。未登录或仓库读权限不足时说明具体原因，继续其余接入流程。仓库归属待核实的项目先标明原因，不直接接入。不要默认全选。

我回复项目编号后，保存私有 .pulse-project-selection.json，保留 schema_version: 1，在顶层记录 "ember_paired": "uploaded-sessions"。只保存已选项目，为每个项目写入 project_name，值仅为中文显示名，英文仓库名由 Ember 自动附在括号里；按这次确认对每个已选项目写入 ember_history: true，明确关闭的项目写入 ember_history: false；同时为选中项目默认写入 ember_github_analysis: true，明确关闭代码分析的写入 false；未收到本次选择前不得修改旧配置或读取旧会话原文；核对 workspace_aliases 为已确认的本机绝对项目目录，保留已核实的原项目频道绑定。升级时停掉原解压目录启动的旧版 ember-member-listener.py 进程，移除每个项目旧的 ember_member_reply、ember_publish 字段，保留原任务和续传状态。运行 ember-connect.py connect --project-channels，命令会尝试自动打开浏览器并输出备用 HTTPS 链接。请我在同一授权页允许发消息，并勾选私有频道和创建私有项目频道。不要代我授权或索取凭证。授权后运行 pulse-onboard.py bind-channels，按仓库关联项目频道，检查读写授权，启动代答并同步项目快照。频道未绑定成功时先修复绑定，再继续试报。检查 ember_member_listener；如果返回未就绪，按 ember_member_listener_error 处理。

随后立即按 PROMPT.txt 完成试报。运行 pulse-onboard.py prepare，使用真实的本轮会话 UUID 排除接入会话。根据返回的脱敏证据在 work_dir 中准备有依据的 summaries.json、pulls.json 和 statuses.json；有新进展就写项目目标和里程碑。随后运行 pulse-onboard.py submit --work-dir <本轮返回目录>。脚本会核对 Project Pulse 回执，并把已提交的脱敏进展发布到已绑定的 Ember 频道。核对 report、ember_posts 和 ember_error。没有新日志但项目状态变化时也要提交状态，脚本会读取服务端更新并同步。Ember 临时失败时保留待发布状态，下轮自动补发。同一项目进展不重复发。不要把网页授权成功当成发布成功。

试报后用可用的定时任务工具创建或更新原有的「Project Pulse 每30分钟上报」，在本目录用同一 prepare、整理、submit 流程。即使本轮没有新日志，也要运行 sync-ember 来核对状态和补发。sync-ember 会同时检查并恢复已启用的代答监听。以后沿用已确认的项目和频道，不重复询问，也不自行加入其他项目或改频道。任务工具不可用时保留已完成的试报并说明限制。

结束时主动给出可点击的 Ember 工作区、已同步频道及 Project Pulse 看板链接（取自脚本结果），并分别说明看板回执、Ember 发布、定时任务、@成员代答就绪状态及各项目的历史续聊和 GitHub 代码分析状态。说明代答需要本机在线；没有收到另一位成员的真实 @ 并回覆前，不宣称已验证群聊代答。失败时也返回服务端地址和实际卡住的步骤。

测试时请另一位成员在已绑定的项目频道连续 @ 运行 r22 的成员，提出两个问题。第一条生成答案期间，第二条进入队列，频道会显示「已收到，排队中」；轮到处理时显示「Codex 正在思考…」。实际观察并收到回复后再报告结果。

部分数据展示：逐项目列出现有数据和缺项。verify-projects 的 partial_sections 列出按同一仓库名匹配的 PR、会话、用量、参与关系或状态。即使主项目记录或报告缺失，也展示已核实的部分。只有频道有进展时，注明来源为频道消息并给出原消息链接；Token、验收、状态等未知项保持未知。继续为有证据的缺项走标准上报和读回流程。新版频道顶部的展示功能需要部署相应 Ember Web 和 Worker。
项目验收（首次接入、升级和每 30 分钟任务均执行）
1. 逐项目核实 Git remote 的完整 owner/repo、已确认的本机目录、授权主会话 UUID 与绑定频道。按 README 的「查询记录」分批查该设备及这些会话。首次尚未上报的来源，只要本机归属唯一且已经获选，就用本包 prepare、整理、submit 完成首报，再查一次。没有匹配会话时区分「本机未发现」「未获选」「服务端尚无记录」「归属冲突」；列出具体项目和阻塞步骤，保留游标和待发请求。不得借用其他项目、其他设备或当前接入会话的 UUID。
2. 提交后运行 python3 -B pulse-onboard.py verify-projects（Windows 可用 py -3）。逐项目核对服务端地址、repository、room_id、selected_sources、reported_sources 和 dashboard_match。inventory_error 表示查询失败。reported_sources 为 0 时核查来源；dashboard_match 为 false 时核对已提交的项目报告中是否使用相同 owner/repo。对确有依据的缺项按 lan-report.md 补报。若有有效回执但仍无法读回，保留 batch_id 并报告服务端查询差异。新项目只有用量或 PR 时，继续核对 projects.full_name 或 project_reports.project_key；有依据时补齐目标、里程碑。通过绑定频道的实际概览复核显示，尚未验收的项标为待验。
3. 分列批次、usage_verified、三类 Token、PR/状态回执、项目记录读回、频道发布或无新进展。无新增日志时区分已验证无变化和未找到授权来源。禁止用 Ember send_message 手工发送进展来替代 Project Pulse 试报或补齐缺失回执；已有消息无需重发。以 submit / sync-ember 的 ember_posts 和 ember_error 核对发布。
4. 在选择确认前告知成员：新版监听接受本人可访问的公开或私有频道中的真实 @；已绑定项目频道按该项目的历史和 GitHub 选项取材，其他频道仅用当前问题及其讨论串。普通频道不会因此加入项目选择。升级时先核对旧进程的脚本路径，停止该监听，再从永久目录启动新版，保留原授权、绑定与续传数据。verify-projects 的 all_channel_stream 表示服务端全频道 SSE 能力；HTTP 400/404 时核对 Worker 是否部署了全频道支持，旧服务端可能仅能监听已绑定频道。另核对本机实际进程的路径和版本；单有监听进程或 SSE 200 均不能证明已回复。分别在已绑定和普通频道由另一位真实成员 @ 验收，并在连续两问时观察排队、思考提示和两条对应回复。
```

</details>

## Why Ember

**Pay for the chat, not for every person in it.** Ember is free and open source, and runs on your own
Cloudflare account: free for a small team, and $5 a month for the whole account as you grow. Slack Pro
charges $7.25 for every person, every month, billed annually.

**Keep every message.** Nothing ages out. Slack's free plan shows only the last 90 days and deletes
messages once they're a year old; Ember keeps every message and file for as long as you do.

**Own your conversations.** Messages live in Durable Objects, and files in an R2 bucket, in your
Cloudflare account. Nobody else hosts your team's chat, and the code is yours to read, change and run.

**Nothing to look after.** No servers, containers or databases to patch. One click puts Ember on
Cloudflare's network, quiet rooms hibernate, and every push to your copy deploys again.

## Everything your team needs

### Conversations that stay on topic

Rooms for every project, private rooms for the few who need them, and DMs with one person or a few.
Reply in a thread to keep a room on topic, and tick **Also send to the room** when everyone should see
the answer. Mention people, quote a message, react with any emoji or a few words of your own, and edit
or delete what you wrote.

Unread rooms stand out, **Activity** narrows the list to what you haven't read, and each room's bell
says whether you hear about every message, only mentions, or nothing. You see who's here and who's
typing, as it happens.

![Ember's Launch room: a deploy bot's card, reactions, and a thread open beside the room](docs/screenshots/hero.png)

<p align="center">
  <sub>The people and conversations in these screenshots are made up: they're the Fernwood team that <code>pnpm seed</code> creates.</sub>
</p>

### Say it clearly

Bold, lists, quotes, and code blocks with syntax highlighting. Paste a link and Ember shows a preview,
and share a chart, a spreadsheet or anything else right in the conversation. Light, dark, or whatever
your system says.

![Ember in dark mode: a chart, a code block, a quote and a shared CSV in the Engineering room](docs/screenshots/dark.png)

### Files, pictures and video

Share files of up to 250 MB. Pictures show in the conversation, videos play where they're posted, and
everything else is a click away. Files go to an R2 bucket in your Cloudflare account, which charges
nothing for downloads.

![A PDF, a quote and a video playing inline in the Design room](docs/screenshots/files.png)

### Bots that already speak Slack

Point Alertmanager, Grafana, your CI pipeline, or anything else that posts to a Slack incoming webhook
at Ember instead. Every bot gets a Slack-compatible webhook URL for each of its rooms, which takes the
same payloads, with Slack's formatting, attachments and Block Kit cards. Bots can answer too: mention
one, or DM it, and Ember sends the message to the bot's own webhook and posts what it answers within
30 seconds. A card's buttons can act: a click goes to the bot, which puts a new card in its place.

![Alerts from a monitoring bot, firing and resolved, in the Support room](docs/screenshots/bots.png)

### Ask @ember

Turn on Ember AI and choose Claude, GPT or Grok, asked through
[Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/), or a model Cloudflare runs
itself on [Workers AI](https://developers.cloudflare.com/workers-ai/). Ember checks for new models
every day, so they show up without an update. Then mention @ember in a room or a thread, or DM it, and
it reads the conversation and answers right there, with links, lists, code and pictures, as a teammate
would. It searches the web too, when you let it, listing the pages its answer came from, and Claude,
GPT and Grok search the room for what was said before. Administrators set how long it may think and
write, and each person picks their own levels on their profile. Administrators can add agents of their
own too, each with its instructions, model and rooms, such as one that sums up long threads or drafts
replies in Support, and people mention or DM them just the same. Available Agents, in everyone's
sidebar, lists the agents they can ask, with what each does and the rooms it's in, and administrators
can keep an agent for themselves, in its rooms or only in their own DMs with it.

### Find anything

Press ⌘F, or Ctrl+F, to search every message in the rooms and DMs you're in, thread replies included,
and narrow it as you would in Slack: to a room, to what someone wrote, to what mentions you, or to
links, files or threads. Results come newest or oldest first, with the words they matched marked, and
your recent searches are a key away.

![Search results for "thanks" under Slack's filter chips, each a card naming its DM or room, with the word marked](docs/screenshots/search.png)

### On your phone

Add Ember to your home screen on an iPhone or Android phone, or install it on your computer, and turn
on push notifications for the messages you want to hear about. It's made for phones: a drawer for your
rooms, tap targets sized for thumbs, nothing hiding under the notch, and messages written without
signal send once you're back online. To sign in on your phone, scan the QR code on your profile.

![Ember on three phones: the room drawer, the Launch room, and a photo in dark mode](docs/screenshots/phones.png)

### Make it yours

Give Ember your community's name, logo and tagline, pick icons for rooms and the navigation, restyle it
with custom CSS, and serve it at your own domain, which Ember walks you through setting up. Then choose
who gets in: anyone with the join link or its QR code, the people you invite by email, anyone with an
address at your company's domain, the members of your [Memberful](https://memberful.com) site, or
everyone, with [Cloudflare Turnstile](https://www.cloudflare.com/application-services/products/turnstile/)
keeping bots out.

<p align="center">
  <img src="docs/screenshots/membership.png" width="640" alt="Membership settings: Open, Join link with its QR code, Email domain and Memberful, each with a switch">
</p>

## Ember and Slack, side by side

Slack does more, and charges for it per person. Ember does the everyday core of team chat well, and
it's yours. Slack's plans are as [slack.com/pricing](https://slack.com/pricing) listed them in October
2026.

### Price and ownership

| | Ember | Slack |
|---|---|---|
| **Price** | Free and open source. You pay Cloudflare $0, or $5 a month for the whole account | Free plan, or $7.25 (Pro) or $15 (Business+) per person a month, billed annually |
| **Message history** | Everything, for as long as you keep it | Free: the last 90 days, and messages are deleted after a year. Paid plans: everything |
| **Where it runs** | Your Cloudflare account | Slack's cloud |
| **Source code** | MIT license, on GitHub | Closed |
| **Your own domain** | ✅ such as chat.example.com | — only yourteam.slack.com |
| **Branding** | Name, logo, tagline, room and navigation icons, and custom CSS | Workspace name and icon |

### Everyday chat

| | Ember | Slack |
|---|---|---|
| **Rooms, private rooms and DMs** | ✅ | ✅ |
| **Threads** | ✅ with Also send to the room | ✅ with Also send to the channel |
| **Mentions, quotes, reactions and edits** | ✅ react with any emoji or a few words | ✅ plus custom emoji |
| **Rich text, code blocks and link previews** | ✅ | ✅ |
| **Files** | ✅ up to 250 MB each | ✅ up to 1 GB each |
| **Search** | ✅ every message in your rooms and DMs, with Slack's filters for rooms, people, links, files and threads | ✅ (Free: the last 90 days) |
| **Unread, Activity, starred rooms, per-room notifications** | ✅ | ✅ |
| **Phones** | ✅ installable web app with push notifications | ✅ native iPhone and Android apps |
| **Computers** | ✅ any modern browser, or installed as an app | ✅ native Mac, Windows and Linux apps, or the browser |
| **Light and dark** | ✅ | ✅ |
| **Incoming webhooks** | ✅ Slack-compatible, with attachments and Block Kit | ✅ |
| **Bots that answer** | ✅ through a webhook per bot | ✅ through Slack apps |
| **Ways to join** | Join link and QR code, email invitations, email domains, open sign-up with Turnstile, Memberful | Invitations, invite links and approved email domains |
| **Single sign-on** | Memberful, for membership communities | Google on every plan, and SAML SSO with SCIM on Business+ |

### Where Slack does more

| | Ember | Slack |
|---|---|---|
| **Apps and workflows** | — | ✅ a directory of 2,600+ apps (Free: 10 of them) and Workflow Builder |
| **Voice and video calls** | Huddles in any room or DM, by voice, camera and shared screen, for up to 50 people; one in a DM rings the others in it, Invite people rings whoever else in the room you pick, and whoever doesn't have Ember in view gets the invitation as a push notification; each has a message in its room to join it from, with a thread of its own, which the huddle shows beside the people in it | ✅ huddles (Free: one-on-one only) |
| **AI** | @ember and agents of your own answer when you mention or DM them, each on the model you choose | ✅ summaries, recaps and AI search on every plan, more on Business+ |
| **Canvases, lists and clips** | — | ✅ |
| **Channels shared with other companies** | — | ✅ Slack Connect |
| **Scheduled messages and reminders** | — | ✅ |
| **Guest accounts** | — | ✅ on paid plans |
| **Exports of every message, DMs included** | — not yet | ✅ on Business+ and up |
| **Support** | GitHub issues | ✅ 24/7 on Business+ |

If your team lives in canvases, workflows and a hundred integrations, Slack earns its price. If you
want fast, calm, searchable chat that you own outright, Ember is built for you.

## What it costs

Ember is free. Cloudflare runs it, at its own prices:

| | What you pay Cloudflare |
|---|---|
| **A small team** | $0 on the [Workers Free](https://developers.cloudflare.com/workers/platform/pricing/) plan. From what we measured each message writes, it carries about 100 people a day sending 30 messages each. |
| **A growing team** | $5 a month on Workers Paid, for the whole account. It includes 50 million database rows written a month, where Free allows 100,000 a day, and bills any use past its allowances. |
| **Files** | 10 GB in [R2](https://developers.cloudflare.com/r2/pricing/) free, then $0.015 per GB a month, with nothing to pay for downloads. |
| **Email, if you want it** | Free with [Resend](https://resend.com), up to 3,000 emails a month and 100 a day, or 3,000 a month included with Workers Paid through Cloudflare Email Service. |
| **@ember and agents, if you turn them on** | Claude, GPT or Grok at their makers' prices, from $0.10 for a million tokens read, paid with [AI Gateway's credits](https://developers.cloudflare.com/ai-gateway/features/unified-billing/), or Workers AI's models, free for 10,000 [Neurons](https://developers.cloudflare.com/workers-ai/platform/pricing/) a day. |
| **Huddles, if you turn them on** | Free for the first 1,000 GB a month that Cloudflare's [Realtime SFU](https://developers.cloudflare.com/realtime/sfu/pricing/) sends, which carries about 2,000 hours of five people talking, or 200 with their cameras on, then $0.05 per GB. |
| **Your own domain, if you want one** | Whatever your registrar charges. |

The free plan's allowances are daily: once a day's are used up, Ember can't save anything new until
they reset at midnight UTC, so move to Workers Paid before your team outgrows them. Against Slack,
billed annually:

| | Slack Pro | Slack Business+ | Ember |
|---|---|---|---|
| **25 people, for a year** | $2,175 | $4,500 | $0 on Workers Free, or $60 on Workers Paid |
| **100 people, for a year** | $8,700 | $18,000 | $60 on Workers Paid, plus any use past its allowances |

[What it costs](docs/self-hosting.md#what-it-costs), in the self-hosting guide, shows how the estimate
was made.

## Get started

### Deploy to Cloudflare

1. Turn on R2 in your Cloudflare dashboard, for the files people share. Each Ember needs a bucket and a
   database of its own, so if your account already runs an Ember, choose Create new when the form picks
   that one's.
2. Click **Deploy to Cloudflare** above. Cloudflare copies Ember to your GitHub or GitLab account, asks
   you to name the Worker, its bucket and its database, to choose where messages live, and to make up a
   setup password, and deploys it. Keep `do-sqlite`, which scales furthest, unless you want every
   message in one D1 database you can query and export, as
   [Storage](docs/self-hosting.md#storage-durable-object-sqlite-or-d1) explains; either way, a team of
   more than about 100 people a day needs Workers Paid. If Cloudflare first has you connect GitHub or
   GitLab, it comes back to a page for deploying one of your own repositories instead: click the button
   again, and Ember's form opens with your account connected. If that first build stops with
   `No package.json ... was found`, Cloudflare built a commit from before it finished copying Ember:
   push any commit to your copy, an edit to its README in GitHub's editor will do, and it builds again.
3. Open your Worker's address, `https://<your Worker>`, type the setup password, and create your
   community and its administrator. Only that password opens setup, so nobody who finds the address
   first can take it over. Forgot it? Give `EMBER_SETUP_PASSWORD` a new value in the Worker's
   **Settings**, under **Variables and Secrets**.
4. Add the Update Ember workflow to your copy, which Cloudflare leaves out with the rest of Ember's
   `.github` folder: the build log says how, with a link to GitHub's editor with it filled in for you
   to commit, or create `.github/workflows/update-ember.yml` in your copy with what
   [Ember's](https://github.com/NYLLON-SOFTWARE/ember-cloudflare/blob/main/.github/workflows/update-ember.yml)
   has.
5. Trim the API token Cloudflare made for your copy's builds, `<your Worker> build token`, which may edit
   nearly everything in your account, every R2 bucket included, though Ember's builds need little of
   that: in **My Profile**, under **API Tokens**, choose **Edit** on it, not Roll, and remove every
   permission but Workers Scripts, Account Settings, User Details and Memberships, and D1 if you chose
   `d1`. [The build's token](docs/self-hosting.md#the-builds-token) says why.
6. Invite your team with the join link on general's welcome card, or by email.

From then on, every push to your copy deploys again, and each new release of Ember arrives in your copy
as a pull request that deploys it once you merge it, while Ember's admin settings say it's out, with a
button that opens the workflow on GitHub to run it sooner. The
[self-hosting guide](docs/self-hosting.md) covers updating, deploying from your own machine, a custom
domain, email, push notifications, Memberful and more.

### Try it on your computer

With Node 22.22.2+, 24.15+ or 26+, and pnpm 10:

```sh
pnpm install
pnpm build      # once, for the app's files that wrangler serves
pnpm dev        # Ember at http://localhost:5173
pnpm seed       # in a second terminal: the made-up Fernwood team sets Ember up and talks
```

`pnpm seed` prints how to sign in as each of the team. [Development](docs/development.md) says more.

## Built on Cloudflare

- **Every room is its own [Durable Object](https://developers.cloudflare.com/durable-objects/)**,
  holding the room's live connections, who's here and who's typing, and, by default, its messages in
  its own SQLite database. Quiet rooms hibernate, so an idle workspace uses next to nothing.
- **Secure by default.** HTTPS everywhere with HSTS, a strict Content Security Policy, passwords hashed
  with scrypt, and setup only through the deploy's own link. Removing someone ends their sessions
  within a minute. The [security notes](docs/self-hosting.md#security-notes) have the rest.
- **Tested hard.** The Worker's tests run on both storage backends, and browser tests drive the app on
  a desktop and on seven emulated phones, from a 320px iPhone SE up.

## Learn more

- [Self-hosting guide](docs/self-hosting.md): deploying, what it costs, custom domains, who can join,
  email, push notifications, files and security.
- [Slack-compatible webhooks](docs/slack-webhooks.md): what bots can post, and how it looks.
- [The models file](docs/models.md): the models every copy of Ember offers, and how to change them.
- [Development](docs/development.md): the code's layout, running Ember locally, tests and performance.
- [The database](docs/database.md): Ember's schema beside Campfire's.
- [Security policy](SECURITY.md): how to report a vulnerability privately.

## Credits

Ember grew out of [Campfire](https://github.com/basecamp/once-campfire), 37signals' group chat, and
rebuilds it on Workers and Durable Objects with a design of its own. It's [MIT licensed](LICENSE). Its
icons are [Iconoir](https://iconoir.com)'s, and the made-up team's pictures are credited in
[the seed's files](apps/worker/scripts/seed/files/README.md).

Slack is a trademark of Slack Technologies, LLC. Ember is not created by, affiliated with, or
supported by Slack Technologies, LLC.
