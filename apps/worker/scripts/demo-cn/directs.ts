import assert from "node:assert/strict";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { roomSocketQuery, type Message, type RoomId, type RoomSettings, type ServerFrame } from "@ember/protocol";
import { Conversation, type Said, type Session } from "../seed/client.ts";
import { html, paragraph, replyMarkup, type Markup } from "../seed/markup.ts";
import { directScenes } from "./direct-content.ts";
import { textFile } from "./files.ts";
import { localEmber, signIn, state, workspaceName } from "./local.ts";
import { EXPECTED_PROJECTS, MONITOR_URL, type MonitorSnapshot } from "./monitor-source.ts";
import { roomHistory } from "./project-cards.ts";

interface DirectRecord { id: RoomId; members: string[]; project: string; posts: Record<string, string> }
interface Receipt { version: 1; source: string; capturedAt: string; rooms: Record<string, DirectRecord> }
interface Backup { rooms: Array<{ id: RoomId; messages: Message[] }> }

const receiptPath = path.join(state, "direct-demo.json");
const sourcePath = path.join(state, "direct-demo-source.json");
const backupPath = path.join(state, "direct-demo-before.json");
const read = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
function save(file: string, value: unknown) {
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}
const signature = (members: string[]) => [...members].sort().join(",");

async function threadMessages(origin: string, session: Session, roomId: RoomId, parentId: string): Promise<Message[]> {
  const Socket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;
  return new Promise((resolve, reject) => {
    const socket = new Socket(`${origin.replace("http:", "ws:")}/api/rooms/${roomId}/socket${roomSocketQuery({ visible: false })}`, { headers: { Cookie: session.cookie, Origin: origin } });
    const finish = (messages: Message[], error?: Error) => { clearTimeout(timer); socket.close(); error ? reject(error) : resolve(messages); };
    const timer = setTimeout(() => finish([], new Error(`私聊 Thread 读取超时：${roomId}`)), 15000);
    socket.addEventListener("error", () => finish([], new Error("私聊 Thread 连接失败")));
    socket.addEventListener("message", event => {
      const frame = JSON.parse(String(event.data)) as ServerFrame;
      if (frame.type === "welcome") socket.send(JSON.stringify({ type: "thread.open", parentId }));
      else if (frame.type === "error") finish([], new Error(frame.message));
      else if (frame.type === "thread.opened" && frame.parentId === parentId) finish(frame.messages);
    });
  });
}

async function main() {
  const ember = await localEmber(); // Fixed origin + independent storage identity, before any mutation.
  const credentials = read<{ password: string; accounts: Array<{ name: string; emailAddress: string }> }>(path.join(state, "accounts.json"));
  const sync = read<{ rooms: Record<string, RoomId> }>(path.join(state, "monitor-sync.json"));
  const link = read<{ source: string; sourceUrl: string; bindings: Record<string, { projectId: string }> }>(path.join(state, "pulse-link.json"));
  assert.equal(link.source, "dashboard");
  assert.equal(link.sourceUrl, new URL(MONITOR_URL).origin);
  // Deliberately enrich from the already verified six-project import, not a different/live database.
  // Freeze that snapshot so a retry cannot change message text or duplicate conversations.
  const snapshot = read<MonitorSnapshot>(existsSync(sourcePath) ? sourcePath : path.join(state, "monitor-snapshot.json"));
  assert.deepEqual(snapshot.projects.map(p => p.name), [...EXPECTED_PROJECTS]);
  assert(snapshot.source.startsWith(`${MONITOR_URL}；`));
  assert.equal(new Set(snapshot.projects.map(p => p.key)).size, 6);
  assert.equal(Object.keys(sync.rooms).length, 6);
  const sessions: Session[] = [];
  assert.equal(credentials.accounts.length, 9);
  for (const account of credentials.accounts) {
    assert(account.emailAddress.endsWith("@demo.example.com"));
    const session = await signIn(ember, account.emailAddress, credentials.password);
    assert.equal(session.user.name, account.name);
    sessions.push(session);
  }
  const admin = sessions[0]!;
  assert.equal((await ember.settings(admin)).account.name, workspaceName);
  const sidebars = await Promise.all(sessions.map(s => ember.sidebar(s)));
  const projectCards = new Map<string, string>();
  for (const project of snapshot.projects) {
    const id = sync.rooms[project.key]; assert(id);
    assert.equal(project.key.split("/").at(-1), project.name);
    assert.equal(link.bindings[id]?.projectId, project.key);
    const settings = await (await ember.request(`/api/rooms/${id}/settings`, { session: admin })).json() as RoomSettings;
    assert.equal(settings.room.name, project.name);
    assert.equal(settings.room.kind, "closed");
    for (const session of sessions) assert(settings.people.some(p => p.id === session.user.id && p.member));
    for (const pull of project.pulls) {
      const url = new URL(pull.url);
      assert.equal(url.origin, "https://github.com");
      const repository = url.pathname.split("/").slice(1, 3).join("/").toLowerCase();
      assert(repository === project.key || (project.name === "jxaccount" && repository === "juxon-ai/jxmcphub"));
    }
    const card = (await roomHistory(ember, admin, id)).find(m => m.cards?.length && m.plainText.includes("事件编号：PULSE"));
    assert(card, `${project.name} 缺少已导入的交付卡片`);
    projectCards.set(project.name, `/rooms/${id}/@${card.id}`);
  }
  if (!existsSync(sourcePath)) save(sourcePath, snapshot);
  const receipt: Receipt = existsSync(receiptPath) ? read(receiptPath) : { version: 1, source: MONITOR_URL, capturedAt: snapshot.capturedAt, rooms: {} };
  assert.equal(receipt.version, 1); assert.equal(receipt.source, MONITOR_URL); assert.equal(receipt.capturedAt, snapshot.capturedAt);
  if (!existsSync(backupPath)) {
    const backup: Backup = { rooms: [] };
    for (const scene of directScenes) {
      const memberIds = scene.members.map(i => sessions[i]!.user.id);
      const existing = sidebars[scene.members[0]!]!.rooms.find(r => r.kind === "direct" && signature(r.members.map(m => m.id)) === signature(memberIds));
      if (existing) backup.rooms.push({ id: existing.id, messages: await roomHistory(ember, sessions[scene.members[0]!]!, existing.id) });
    }
    save(backupPath, backup);
  }
  const sourceDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Australia/Melbourne", dateStyle: "short", timeStyle: "short" }).format(new Date(snapshot.capturedAt));
  let added = 0, files = 0, replies = 0;
  for (const scene of directScenes) {
    const members = scene.members.map(i => sessions[i]!);
    const [lead, partner] = members as [Session, Session, ...Session[]];
    const third = members[2] ?? lead;
    const key = scene.members.join("-");
    const project = snapshot.projects.find(p => p.name === scene.project)!; assert(project?.report);
    const id = await ember.startDirect(lead, members.slice(1));
    const sidebar = await ember.sidebar(lead);
    const direct = sidebar.rooms.find(r => r.id === id);
    assert(direct?.kind === "direct");
    assert.equal(signature(direct.members.map(m => m.id)), signature(members.map(m => m.user.id)));
    const record = receipt.rooms[key] ??= { id, members: members.map(m => m.user.id), project: project.key, posts: {} };
    assert.equal(record.id, id); assert.equal(record.project, project.key);
    assert.equal(signature(record.members), signature(members.map(m => m.user.id)));
    save(receiptPath, receipt);
    const history = await roomHistory(ember, lead, id);
    const conversation = new Conversation(ember, id);
    const matches = (m: Message, author: Session, text: string) => m.creator.id === author.user.id && m.plainText.trim().endsWith(text.trim());
    async function say(key: string, author: Session, text: string, markup = paragraph(text), parent?: Said): Promise<Said> {
      const pool = parent ? await threadMessages(ember.origin, lead, id, parent.message.id) : history;
      const saved = pool.find(m => m.id === record.posts[key]);
      if (saved) assert(matches(saved, author, text), `${scene.topic} 的 ${key} 已被修改，请人工核对后再重试`);
      const existing = saved ?? pool.find(m => matches(m, author, text));
      const result = existing ? { message: existing, markup, author: author.user } : parent
        ? await conversation.replyInThread(author, parent, markup)
        : await conversation.say(author, markup);
      if (!existing) { added++; if (parent) replies++; else history.push(result.message); }
      record.posts[key] = result.message.id; save(receiptPath, receipt);
      return result;
    }
    try {
      await say("intro", lead, `【演示私聊 · ${scene.project}】${scene.topic}\n根据 ${sourceDate}（墨尔本时间）的六项目监控快照生成，不是真实团队原话；中文姓名是演示角色，不代表实际贡献者。`);
      await say("goal", partner, `先对齐原项目目标：${project.report.goal}`);
      await say("discussion-0", lead, scene.discussion[0]);
      await say("discussion-1", partner, scene.discussion[1]);
      const completed = project.report.milestones.filter(m => m.state === "completed");
      const pending = project.report.milestones.filter(m => m.state !== "completed");
      await say("source-completed", partner, `监控快照中的阶段产出：\n${completed.slice(0, 3).map(m => `• ${m.title}：${m.evidence}`).join("\n")}\n完整条目和来源时间放在本私聊的核对单附件里。`);
      await say("discussion-2", lead, scene.discussion[2]);
      await say("source-pending", third, `仍需跟进的原始待办：\n${pending.slice(0, 3).map(m => `• ${m.title}`).join("\n")}\n这些是监控记录的未完成事项，本次演示不改变项目进度。`);
      await say("discussion-3", partner, scene.discussion[3]);
      const ownPulls = project.pulls.filter(p => new URL(p.url).pathname.toLowerCase().startsWith(`/${project.key}/`));
      const selectedPulls = (ownPulls.length ? ownPulls : project.pulls).slice(0, 2);
      if (selectedPulls.length) {
        for (const pull of selectedPulls) {
          const repository = new URL(pull.url).pathname.split("/").slice(1, 3).join("/");
          const text = `来源 PR：${repository} #${pull.number} · ${pull.title}\n快照状态：${pull.state}${pull.is_draft ? "（草稿）" : ""}；更新时间：${pull.updated_at}。PR 状态与正式上线、业务验收分别确认。`;
          await say(`pr-${repository}-${pull.number}`, partner, text, html`<p><a href="${pull.url}">查看原 PR</a></p>${paragraph(text)}`);
        }
      } else {
        await say("source-no-pr", partner, "该项目的监控快照没有 PR。阶段产出依据来自里程碑和会话摘要；不编造 PR，也没有把原始手册或安装包当作本次已读取的附件。请从项目频道的来源记录继续核查。");
      }
      const root = await say("question", lead, scene.thread[0]);
      await say("answer-1", partner, scene.thread[1], undefined, root);
      await say("answer-2", third, scene.thread[2], undefined, root);
      await say("discussion-4", third, scene.discussion[4]);
      await say("quote", partner, scene.discussion[5], replyMarkup(root.markup, lead.user, `/rooms/${id}/@${root.message.id}`, paragraph(scene.discussion[5])));
      const filename = `${scene.project}-${members.map(m => m.user.name).join("与")}-协作核对单.md`;
      const contents = `# ${scene.topic}\n\n【演示协作核对单】按已导入的真实项目快照生成，非原始项目文档，非真实团队对话。\n演示角色：${members.map(m => m.user.name).join("、")}，不代表实际负责人。\n\n数据源：${MONITOR_URL}\n快照：${snapshot.capturedAt}\n项目：${project.key}\n源状态：${project.status ?? "unknown"}（unknown 表示未提供）\n目标：${project.report.goal}\n\n## 原始里程碑与证据\n\n${project.report.milestones.map(m => `- [${m.state}] ${m.title}\n  来源摘要：${m.evidence}`).join("\n")}\n\n## 本私聊的演示讨论\n\n${scene.discussion.map(t => `- ${t}`).join("\n")}\n\n## 待执行的验收讨论\n\n${scene.thread.join("\n\n")}\n\n## 相关真实 PR（快照状态）\n\n${selectedPulls.length ? selectedPulls.map(p => `- [${p.title}](${p.url}) — ${p.state}${p.is_draft ? "，草稿" : ""}；更新 ${p.updated_at}`).join("\n") : "源快照未提供 PR，不生成虚构链接。"}\n\n未读取原始 PR diff、业务手册全文或构建包。本核对单不代表测试、发布或业务验收已经完成。\n项目频道：/rooms/${sync.rooms[project.key]}\n交付卡片：${projectCards.get(project.name)}\n`;
      let attachment = history.find(m => m.attachment?.name === filename && m.creator.id === partner.user.id);
      if (!attachment) {
        attachment = (await conversation.share(partner, textFile(filename, "text/markdown", contents))).message;
        history.push(attachment); added++; files++;
      }
      record.posts.file = attachment.id; save(receiptPath, receipt);
      const downloaded = await (await ember.request(attachment.attachment!.url, { session: lead })).text();
      assert.equal(downloaded, contents);
      await say("links", third, "项目进度、来源材料和 Bot 交付卡片都在对应项目频道；项目助手请在该项目频道中使用。私聊内的核对单和验收建议属于生成的演示协作内容。", html`<p><a href="${`/rooms/${sync.rooms[project.key]}`}">打开 ${project.name} 项目频道</a> · <a href="${projectCards.get(project.name)!}">查看项目交付卡片</a></p>${paragraph("项目进度、来源材料和 Bot 交付卡片都在对应项目频道；项目助手请在该项目频道中使用。私聊内的核对单和验收建议属于生成的演示协作内容。")}`);
      const current = await roomHistory(ember, lead, id);
      if (!current.find(m => m.id === root.message.id)?.boosts.some(b => b.booster.id === partner.user.id && b.content === "👍")) await conversation.react(partner, root, "👍");
    } finally { conversation.close(); }
    console.log(`${members.map(m => m.user.name).join("、")}：${project.name} · ${scene.topic}`);
  }

  // Verify persisted data, permissions and old history through the app's APIs, not the search index.
  const finalSidebars = await Promise.all(sessions.map(s => ember.sidebar(s)));
  const backup = read<Backup>(backupPath);
  let total = 0;
  for (const scene of directScenes) {
    const record = receipt.rooms[scene.members.join("-")]!;
    const member = sessions[scene.members[0]!]!;
    for (const [index, sidebar] of finalSidebars.entries()) {
      const room = sidebar.rooms.find(r => r.id === record.id);
      if (scene.members.includes(index)) {
        assert(room?.kind === "direct" && room.involvement !== "invisible");
        assert.equal(signature(room.members.map(m => m.id)), signature(record.members));
      } else assert(!room, "私人对话被非成员看到");
    }
    const history = await roomHistory(ember, member, record.id);
    const thread = await threadMessages(ember.origin, member, record.id, record.posts.question!);
    assert.equal(thread.filter(m => [record.posts["answer-1"], record.posts["answer-2"]].includes(m.id)).length, 2);
    for (const id of Object.values(record.posts)) assert([...history, ...thread].some(m => m.id === id));
    assert.equal(history.filter(m => m.id === record.posts.intro).length, 1);
    assert(history.find(m => m.id === record.posts.quote)?.body.includes("<blockquote>"));
    assert(history.find(m => m.id === record.posts.question)?.thread?.count! >= 2);
    assert(history.find(m => m.id === record.posts.links)?.body.includes(`/rooms/${sync.rooms[record.project]}`));
    for (const old of backup.rooms.find(r => r.id === record.id)?.messages ?? []) {
      const preserved = history.find(m => m.id === old.id);
      assert(preserved); assert.equal(preserved.body, old.body); assert.equal(preserved.creator.id, old.creator.id);
    }
    total += Object.keys(record.posts).length;
  }
  const english = await fetch("http://localhost:5173/api/bootstrap").then(r => r.json()) as { account: { name: string } };
  assert.equal(english.account.name, "Fernwood");
  console.log(`验证通过：${directScenes.length} 组私聊、${total} 条演示消息（含附件和 Thread）；本次新增 ${added} 条，其中附件 ${files} 份、Thread 回复 ${replies} 条。原有聊天保留；Fernwood 未写入。`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
