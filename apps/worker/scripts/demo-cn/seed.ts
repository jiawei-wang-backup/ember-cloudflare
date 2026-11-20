import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RoomId } from "@ember/protocol";
import { Conversation, type Session, type Said } from "../seed/client.ts";
import { codeBlock, html, mention } from "../seed/markup.ts";
import { people, projects, channels } from "./data.ts";
import { attachments, avatar } from "./files.ts";
import { localEmber, origin, state, workspaceName } from "./local.ts";
import { addProjectCards } from "./project-cards.ts";
import { enrichDemo } from "./enrichment.ts";

async function main() {
  const ember = await localEmber();
  const credentialsFile = path.join(state, "accounts.json");
  if (await ember.isSetUp()) {
    console.log("中文环境已初始化：安全跳过，未添加或覆盖任何数据。若之前中断，请先检查 manifest.json 是否 complete。\n账号请查看 .wrangler/demo-cn/accounts.json；验证：pnpm verify:demo-cn");
    return;
  }
  mkdirSync(state, { recursive: true });
  if (existsSync(credentialsFile)) throw new Error("已有初始化凭证但服务未初始化。为防止覆盖，已停止；请检查本地端口和持久化目录。");
  const password = randomBytes(15).toString("base64url");
  const accounts = people.map(([key, name, bio]) => ({ name, emailAddress: `${key}@demo.example.com`, bio }));
  // Written before the first mutation so credentials survive a partial seed. Never overwrite it.
  writeFileSync(credentialsFile, JSON.stringify({ origin, password, accounts, status: "initializing" }, null, 2), { mode: 0o600, flag: "wx" });
  const sessions: Session[] = [];
  const admin = await ember.setUp({ ...accounts[0]!, password }, avatar(0));
  sessions.push(admin);
  await ember.changeAccount(admin, { name: workspaceName, tagline: "研发协作、版本交付与 AI 工作空间" });
  const { joinCode } = await ember.settings(admin);
  if (!joinCode) throw new Error("没有可用的本地加入码");
  for (let i = 1; i < accounts.length; i++) sessions.push(await ember.join(joinCode, { ...accounts[i]!, password }, avatar(i)));
  for (let i = 0; i < sessions.length; i++) await ember.changeProfile(sessions[i]!, { bio: accounts[i]!.bio });
  const roomIds: Record<string, RoomId> = {};
  const first = await ember.sidebar(admin);
  for (const [i, name] of ["公告与通知", "研发日常"].entries()) {
    const room = first.rooms.find(r => r.kind === "open" && r.name === (i === 0 ? "general" : "random"))!;
    await ember.json(`/api/rooms/${room.id}`, "PATCH", { name }, { session: admin });
    roomIds[name] = room.id;
  }
  for (const [name] of channels.slice(2)) roomIds[name] = (await ember.createRoom(admin, { name, kind: "open" })).id;
  for (const project of projects) roomIds[project.name] = (await ember.createRoom(sessions[project.team[0]!]!, { name: project.name, kind: "open" })).id;
  const privateGroups = [
    { name: "核心研发讨论", members: [0, 4, 8, 1], text: "仅核心研发可见：讨论 revision 协议、模型隔离和线上风险。本频道内容也全部是模拟数据。" },
    { name: "项目排期协调", members: [0, 6, 5, 2], text: "仅排期协调成员可见：剪辑与内容中台先做范围澄清，避免把计划日期当作交付承诺。" },
  ];
  for (const group of privateGroups) roomIds[group.name] = (await ember.createRoom(admin, { name: group.name, kind: "closed", memberIds: group.members.map(i => sessions[i]!.user.id) })).id;
  let messages = 0, threads = 0, quotes = 0, mentions = 0, reactions = 0;
  const references: Record<string, string> = {};
  const date = (daysAgo: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Australia/Melbourne" }).format(new Date(Date.now() - daysAgo * 86400000));
  // Ember's public API stamps creation time on the server. Dates below label historical scenario
  // events honestly; we do not rewrite storage or pretend these were sent days before import.
  for (const [pi, project] of projects.entries()) {
    const room = new Conversation(ember, roomIds[project.name]!);
    const team = project.team.map(i => sessions[i]!);
    try {
      await room.say(team[0]!, `频道说明：${project.description}\n所有讨论、PR 编号和测试指标均为演示数据。场景日期是近两周的模拟活动日期，消息入库时间为实际导入时间。`); messages++;
      for (const [si, scene] of project.scenes.entries()) {
        const [title, opening, problem, approach, implementation, conclusion] = scene;
        const lead = team[si % team.length]!;
        const peer = team[(si + 1) % team.length]!;
        const reviewer = team[(si + 2) % team.length]!;
        const root = await room.say(lead, html`<p><strong>【演示 · ${date(12 - si * 3)}】${title!}</strong></p><p>${opening!} ${mention(peer.user)}</p>`);
        messages++; mentions++; threads++;
        if (si === 0) references[project.name] = `/rooms/${room.roomId}/@${root.message.id}`;
        await room.say(peer, problem!); messages++;
        await room.replyInThread(reviewer, root, approach!); messages++;
        await room.reply(peer, root, implementation!); messages++; quotes++;
        await room.replyInThread(lead, root, conclusion!, { alsoSend: si === 0 }); messages++;
        await room.say(reviewer, codeBlock("json", JSON.stringify({ demo: true, project: project.name, scenario: title, stage: ["设计与联调", "定位与回归", "范围评审", "阶段确认"][si], owner: lead.user.name, evidence: "参见本 Thread 与对应附件", businessAccepted: project.name === "统一设计组件库" }, null, 2))); messages++;
        await room.say(team[(si + 3) % team.length]!, html`<p>${mention(lead.user)} 请保留本条问题的证据链：<a href="${origin}/rooms/${room.roomId}/@${root.message.id}">${title!}</a>；${project.name}的下一步以这里的结论为准。</p>`); messages++; mentions++;
        await room.react(peer, root, ["👍", "🔍", "✅", "🧪"][si]!); reactions++;
        await room.react(reviewer, root, ["👀", "🚀", "💡", "收到"][si]!); reactions++;
      }
    } finally { room.close(); }
    console.log(`已创建项目讨论：${project.name}`);
  }
  const topics = [
    ["演示团队启用", "欢迎加入 Project Pulse。这里的人员、项目、交付与指标全部为模拟数据。", "演示时先看直播监控平台的状态恢复，再到交付与验收追踪 PR #128。", "所有成员都有独立账号，请分别登录检查权限。"],
    ["今日联调约定", "联调时请附复现步骤与请求标识，避免只贴一张失败截图。", "中文输入法、弱网恢复与空状态是本轮共同检查项。", "遇到阻塞及时在项目频道开 Thread，结论留在原讨论。"],
    ["六项目阶段汇总", projects.map(p => `${p.name}：${p.progress}`).join("；"), "设计组件库只在约定的 1.0 范围完成；内容策略中台仍在筹备。", "其余项目必须区分开发、测试和业务验收，进度仅为背景模拟。"],
    ["消息幂等与可观测性", "状态恢复使用 revision，重复事件使用 eventId，两者不能互相替代。", "建议保留请求 traceId，在日志与告警中串起同一次请求。", "错误重试要有总预算，避免弱网下请求放大。"],
    ["回归缺陷闭环", "状态重连、字幕漂移、中文输入法三个问题均已建立场景。", "请把修复和回归结论写进各自 Thread，未测设备继续列出。", "代表性检索词：revision、Token、PR128、状态同步。"],
    ["研发事件与验收边界", "协作演示助手通过 Ember 原生 Slack Webhook 发出结构化卡片。", "模拟 PR 合并不代表业务验收，测试环境部署不代表生产上线。", "卡片按钮只跳转到真实本地讨论，绝不假装审批成功。"],
  ];
  for (const [i, [name, description]] of channels.entries()) {
    const room = new Conversation(ember, roomIds[name]!);
    try {
      const topic = topics[i]!;
      const a = sessions[(i + 1) % 9]!, b = sessions[(i + 4) % 9]!, c = sessions[(i + 6) % 9]!;
      const root = await room.say(a, html`<p><strong>${topic[0]!}</strong></p><p>${description}</p><p>${topic[1]!}</p>`); messages++; threads++;
      await room.say(b, html`<p>${mention(c.user)} ${topic[2]!}</p>`); messages++; mentions++;
      await room.replyInThread(c, root, topic[3]!); messages++;
      await room.reply(b, root, "讨论结论会保留在对应项目里，方便换人后继续跟进。"); messages++; quotes++;
      for (const [j, project] of projects.entries()) {
        await room.say(sessions[(i + j) % 9]!, html`<p><a href="${origin}${references[project.name]!}">${project.name}</a> · ${project.progress}（演示背景）。${[project.description, project.scenes[0]![5], project.scenes[1]![5], project.scenes[2]![5], project.scenes[3]![5], `跟进负责人：${sessions[project.team[0]!]!.user.name}；点击链接查看原始讨论。`][i]!}</p>`); messages++;
      }
      await room.react(c, root, "📌"); reactions++;
    } finally { room.close(); }
  }
  for (const group of privateGroups) {
    const room = new Conversation(ember, roomIds[group.name]!);
    try {
      const root = await room.say(admin, group.text); messages++; threads++;
      for (const i of group.members.slice(1)) { await room.replyInThread(sessions[i]!, root, `${sessions[i]!.user.name}已确认：按职责维护相关证据，排期变化在本频道同步，不对未加入成员公开。`); messages++; }
    } finally { room.close(); }
  }
  const directs = [[1, 8], [2, 6], [3, 7], [4, 8, 0], [5, 6, 7]];
  const dmIds: RoomId[] = [];
  for (const [i, members] of directs.entries()) {
    const a = sessions[members[0]!]!, b = sessions[members[1]!]!;
    const id = await ember.startDirect(a, members.slice(1).map(n => sessions[n]!)); dmIds.push(id);
    const room = new Conversation(ember, id);
    try {
      const project = projects[i]!;
      const root = await room.say(a, `${project.name}的联调资料收到了吗？公开结论会同步回项目频道。`); messages++;
      await room.say(b, `收到了，我重点关注：${project.scenes[0]![0]}。先核对复现步骤再看修复。`); messages++;
      await room.reply(a, root, "我把附件和讨论链接留在频道里，私聊只协调时间，不把结论藏在这里。"); messages++; quotes++;
      await room.say(sessions[members.at(-1)!]!, "确认，涉及其他成员时会回到原 Thread，保留完整上下文。"); messages++;
    } finally { room.close(); }
  }
  const uploaded: Array<{ roomId: RoomId; message: Said["message"]; name: string; type: string }> = [];
  for (const item of attachments()) {
    const roomId = roomIds[item.room]!;
    const message = await ember.upload(admin, roomId, item.file, item.preview);
    uploaded.push({ roomId, message, name: item.file.name, type: item.file.type }); messages++;
  }
  const { added, bot } = await enrichDemo(ember, sessions, roomIds);
  messages += added;
  const deliveries = new Conversation(ember, roomIds["交付与验收"]!);
  try {
    await deliveries.watch(admin);
    const events = [
      [0, "Bug 告警", "状态同步延迟升高", "Warning · 待处理", "梁沐", "DEMO-W128"],
      [0, "新建 Pull Request", "修复断线重连后的状态同步问题", "等待 Code Review", "梁沐", "PR128 / #128"],
      [0, "Code Review", "revision 比较与乱序覆盖用例", "评审建议已落实", "陈序", "PR128 / #128"],
      [0, "PR 合并", "重连恢复修复已合并", "开发完成，待回归", "梁沐", "PR128 / #128"],
      [0, "CI 测试", "断网恢复、旧快照与重复事件", "模拟测试通过，压测待完成", "林屿", "PR128 / #128"],
      [0, "告警恢复", "状态同步延迟回落", "测试样本恢复，业务验收待完成", "陈序", "DEMO-W128"],
      [3, "PR 合并", "新增模型调用 Token 统计", "已合并，账单对账未验收", "陈序", "PR142 / #142"],
      [2, "CI 测试", "自动化与兼容性回归", "通过；长时压测待完成", "周宁", "DEMO-CI75"],
      [1, "部署通知", "v0.3.2 剪辑边界修复", "测试环境部署成功", "许言", "DEMO-v0.3.2"],
      [4, "范围验收", "组件库 1.0 冻结范围", "本次约定范围验收完成", "沈青", "DEMO-UI1.0"],
    ] as const;
    for (const [projectIndex, event, title, status, owner, reference] of events) {
      const project = projects[projectIndex]!;
      await deliveries.post(bot, {
        text: `【演示数据】${project.name} · ${event} · ${title} · ${status}`,
        blocks: [
          { type: "header", text: { type: "plain_text", text: `【演示数据】${event}` } },
          { type: "section", text: { type: "mrkdwn", text: `*${title}*\n项目：${project.name}\n编号：${reference}（模拟）` } },
          { type: "section", fields: [{ type: "mrkdwn", text: `*状态*\n${status}` }, { type: "mrkdwn", text: `*负责人*\n${owner}` }, { type: "mrkdwn", text: "*环境*\n本地演示 / 测试环境" }, { type: "mrkdwn", text: `*记录时间*\n${date(0)}` }] },
          { type: "context", elements: [{ type: "mrkdwn", text: "模拟事件，不连接真实 GitHub；开发、测试、部署与验收分别记录。" }] },
        ],
      }); messages++;
    }
  } finally { deliveries.close(); }
  messages += await addProjectCards(ember, admin, bot, roomIds);
  await ember.star(admin, roomIds["交付与验收"]!);
  await ember.star(admin, roomIds["直播监控平台"]!);
  await ember.dismissInvitation(admin);
  const ai = await ember.request("/api/account/agents", { session: admin, expected: [200, 409] });
  const aiStatus = ai.status === 409 ? "未配置模型；已提供三个中文 Agent 配置草案，未调用付费 API。" : "AI 已开启；本次未创建或调用 Agent。";
  const report = { status: "complete", workspaceName, generatedAt: new Date().toISOString(), messages, threads, quotes, mentions, reactions, rooms: roomIds, dmIds, uploads: uploaded, botId: bot.id, aiStatus, historicalDates: "正文标注近两周场景日期；服务器时间为真实导入时间" };
  writeFileSync(path.join(state, "manifest.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  writeFileSync(credentialsFile, JSON.stringify({ origin, password, accounts, status: "complete" }, null, 2), { mode: 0o600 });
  console.log(`${workspaceName} 已就绪：${origin}\n${messages} 条消息，${threads} 个 Thread，${quotes} 次引用，${mentions} 次 @，${uploaded.length} 个附件。\n${aiStatus}\n统一密码：${password}\n${accounts.map(a => `${a.name}  ${a.emailAddress}`).join("\n")}\n本地凭证：${credentialsFile}`);
}
main().catch(error => { console.error(error); console.error("若初始化中断，重复执行会安全跳过。请保留凭证与日志，勿删除英文环境数据。"); process.exitCode = 1; });
