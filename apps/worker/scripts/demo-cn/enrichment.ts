import { AVATAR_PATH, uploadPartPath, uploadsPath, type RoomIconName, type RoomId, type Upload } from "@ember/protocol";
import type { BotAnswer, Bots } from "@ember/protocol/bots";
import { Conversation, RoomSocket, type Ember, type Session } from "../seed/client.ts";
import { codeBlock, html, linkWithPreview, mention } from "../seed/markup.ts";
import { projects } from "./data.ts";
import { avatar, original, textFile } from "./files.ts";
import { callbackToken, interactiveCard } from "./demo-bot.ts";
import { roomHistory } from "./project-cards.ts";

function picture(index: number, user?: object): FormData {
  const file = avatar(index);
  const form = new FormData();
  const blob = new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: file.type });
  form.set("avatar", blob, file.name); form.set("variant", blob, file.name);
  if (user) form.set("user", JSON.stringify(user));
  return form;
}

export async function enrichDemo(ember: Ember, sessions: Session[], rooms: Record<string, RoomId>) {
  const admin = sessions[0]!;
  for (let i = 0; i < sessions.length; i++) await ember.request(AVATAR_PATH, { method: "PUT", session: sessions[i], body: picture(i) });
  const list = await (await ember.request("/api/account/bots", { session: admin })).json() as Bots;
  const github = list.bots.find(bot => bot.name === "GitHub Bot · 演示");
  if (github) {
    const file = original("deploy-bot.png", "image/png");
    const form = new FormData();
    const blob = new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: file.type });
    form.set("user", JSON.stringify({ name: github.name }));
    form.set("avatar", blob, file.name); form.set("variant", blob, file.name);
    await ember.request(`/api/account/bots/${github.id}`, { method: "PATCH", session: admin, body: form });
  }
  const existing = list.bots.find(bot => bot.name === "协作演示助手");
  const fields = { name: "协作演示助手", webhookUrl: `${ember.origin}/__demo_cn_bot/${callbackToken()}` };
  const { bot } = await (await ember.request(existing ? `/api/account/bots/${existing.id}` : "/api/account/bots", {
    method: existing ? "PATCH" : "POST", session: admin, body: picture(9, fields), expected: existing ? [200] : [201],
  })).json() as BotAnswer;
  const icons: Record<string, RoomIconName> = {
    "直播监控平台": "activity", "智能剪辑工作台": "film", "直播互动组件": "messages-square", "AI接入网关": "cpu", "统一设计组件库": "palette", "内容策略中台": "chart-no-axes-combined",
    "交付与验收": "rocket", "公告与通知": "megaphone", "研发日常": "coffee", "项目进度": "list-checks", "技术讨论": "code", "问题与反馈": "bug", "核心研发讨论": "lock", "项目排期协调": "calendar-days",
  };
  for (const [name, icon] of Object.entries(icons)) await ember.json(`/api/rooms/${rooms[name]!}`, "PATCH", { icon }, { session: admin });
  let added = 0;
  for (const [i, project] of projects.entries()) {
    const id = rooms[project.name]!;
    const history = await roomHistory(ember, admin, id);
    const marker = `DEMOCNFEATURE${i}V1`;
    if (history.some(message => message.plainText.includes(marker))) continue;
    const room = new Conversation(ember, id);
    const lead = sessions[project.team[0]!]!, reviewer = sessions[project.team[1]!]!;
    try {
      let root = await room.say(lead, html`<p><strong>本轮协作演示 · ${project.name}</strong></p><p>${mention(reviewer.user)} 先核对下面的交付清单，再确认本轮边界。</p><ul><li><strong>已准备：</strong>${project.scenes[0]![1]!}</li><li><em>待跟进：</em>${project.scenes[3]![5]!}</li></ul><p>演示编号：${marker}</p>`); added++;
      root = await room.edit(root, html`<p><strong>本轮协作演示 · ${project.name}（已补充范围说明）</strong></p><p>${mention(reviewer.user)} 按下面的清单核对，并在此 Thread 留下证据。</p><ul><li><strong>已准备：</strong>${project.scenes[0]![1]!}</li><li><em>待跟进：</em>${project.scenes[3]![5]!}</li><li><del>PR 合并即视为最终交付</del> → 开发、测试与业务验收分别确认。</li></ul><p>这条消息经过真实编辑，可现场查看编辑标记。演示编号：${marker}</p>`);
      await room.replyInThread(reviewer, root, "我把本轮检查清单放在线程附件里，复核时无需在整段频道记录中查找文件。"); added++;
      const file = textFile(`${project.name}-线程验收清单.json`, "application/json", JSON.stringify({ demo: true, project: project.name, owner: lead.user.name, checks: project.scenes.map(scene => ({ item: scene[0], conclusion: scene[5] })), businessAccepted: project.name === "统一设计组件库" }, null, 2));
      const upload = await (await ember.json(uploadsPath(id), "POST", { name: file.name, type: file.type, size: file.bytes.length, clientMessageId: crypto.randomUUID(), parentId: root.message.id, alsoSend: false }, { session: reviewer, expected: [201] })).json() as Upload;
      if (upload.parts !== 1) throw new Error("演示清单应只占一个上传分片");
      await ember.request(uploadPartPath(id, upload.id, 1), { method: "PUT", session: reviewer, body: file.bytes as Uint8Array<ArrayBuffer>, expected: [200, 201] }); added++;
      await room.reply(reviewer, root, "已按更新后的说明复核，线程里保留检查记录；未验收项继续标为待办。"); added++;
      await room.react(reviewer, root, "👀");
      await room.react(admin, root, "待验收");
      await room.say(lead, codeBlock("typescript", `// ${project.name}：仅演示数据，不执行真实交付\nconst review = { project: ${JSON.stringify(project.name)}, owner: ${JSON.stringify(lead.user.name)}, stage: ${JSON.stringify(project.progress)}, evidenceRequired: true };\nconsole.log(review);`)); added++;
      await ember.star(lead, id);
      await ember.json(`/api/rooms/${id}/involvement`, "PUT", { involvement: "mentions" }, { session: reviewer });
    } finally { room.close(); }
  }
  for (const name of ["交付与验收", "技术讨论"]) {
    const id = rooms[name]!;
    const history = await roomHistory(ember, admin, id);
    if (!history.some(message => message.creator.id === bot.id && message.plainText.includes("DEMOCNINTERACTIVEV1"))) {
      const room = new Conversation(ember, id);
      try { await room.watch(admin); await room.post(bot, interactiveCard()); added++; } finally { room.close(); }
    }
  }
  const technicalId = rooms["技术讨论"]!;
  const technicalHistory = await roomHistory(ember, admin, technicalId);
  if (!technicalHistory.some(message => message.plainText.includes("DEMOCNBOTREPLYV1"))) {
    const listener = await RoomSocket.open(ember, admin, technicalId, false);
    const conversation = new Conversation(ember, technicalId);
    try {
      const reply = listener.next(frame => frame.type === "message.created" && frame.message.creator.id === bot.id ? frame.message : undefined);
      // Register the observer before mentioning the bot, so even an immediate local answer is seen.
      const settled = reply.then(message => ({ message }), error => ({ error }));
      await conversation.say(admin, html`<p>${mention(bot)} 请介绍本地交付演示的操作边界。DEMOCNBOTREPLYV1</p>`); added++;
      const result = await settled;
      if ("error" in result) throw result.error;
      if (!result.message.plainText.includes("非 AI")) throw new Error("演示机器人未返回预期的规则说明。");
      added++;
    } finally { listener.close(); conversation.close(); }
  }
  const dailyId = rooms["研发日常"]!;
  const dailyHistory = await roomHistory(ember, admin, dailyId);
  if (!dailyHistory.some(message => message.plainText.includes("DEMOCNTOURV1"))) {
    const room = new Conversation(ember, dailyId);
    try {
      await room.say(sessions[5]!, "DEMOCNTOURV1 · 研发协作演示路线：频道→Thread→附件→Bot 按钮→搜索。头像已换成不同的本地人物插画。菜单仍沿用 Ember 原有语言。"); added++;
      await room.say(sessions[4]!, linkWithPreview("研发资料卡片：", { url: "https://github.com/NYLLON-SOFTWARE/ember-cloudflare", title: "Ember · 开源实时协作项目", description: "人工整理的项目资料预览，链接指向公开仓库。该描述不是网页实时抓取结果。" })); added++;
      await room.share(sessions[5]!, original("sunrise.jpg", "image/jpeg", "研发日常-周末日出分享.jpg"), original("sunrise.jpg", "image/jpeg")); added++;
      await room.say(sessions[6]!, "演示时可用两个浏览器配置文件登录不同成员，现场输入观察正在输入、在线成员、未读和 Activity，再使用 @成员、文字回应及 Thread 继续讨论。"); added++;
    } finally { room.close(); }
  }
  const designId = rooms["统一设计组件库"]!;
  const designHistory = await roomHistory(ember, admin, designId);
  if (!designHistory.some(message => message.attachment?.name === "通用品牌规范-原项目演示素材.pdf")) {
    await ember.upload(sessions[5]!, designId, original("brand-guide.pdf", "application/pdf", "通用品牌规范-原项目演示素材.pdf")); added++;
  }
  console.log(`增强完成：九位成员人物头像、六项目线程清单、频道图标、PDF 与图片、链接预览、收藏/提及偏好和可交互 Bot；新增 ${added} 条持久化消息。`);
  return added;
}
