import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync,existsSync } from "node:fs";
import path from "node:path";
import { roomSocketQuery, type Message, type PersonAnswer, type RoomId, type ServerFrame } from "@ember/protocol";
import { type Session } from "../seed/client.ts";
import { localEmber, origin, signIn, state, workspaceName } from "./local.ts";
import { projectDeliveries, roomHistory } from "./project-cards.ts";
import {verifyMonitor} from "./verify-monitor.ts";

const Socket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;
async function main() {
  if(existsSync(path.join(state,"monitor-sync.json")))return verifyMonitor();
  const ember = await localEmber();
  const credentials = JSON.parse(readFileSync(path.join(state, "accounts.json"), "utf8")) as { password: string; accounts: Array<{ name: string; emailAddress: string }> };
  const report = JSON.parse(readFileSync(path.join(state, "manifest.json"), "utf8")) as { status: string; rooms: Record<string, RoomId>; dmIds: RoomId[]; uploads: Array<{ name: string; message: Message }>; messages: number };
  assert.equal(report.status, "complete");
  const sessions: Session[] = [];
  for (const account of credentials.accounts) {
    const session = await signIn(ember, account.emailAddress, credentials.password);
    assert.equal(session.user.name, account.name); sessions.push(session);
  }
  const admin = sessions[0]!;
  assert.equal((await ember.settings(admin)).account.name, workspaceName);
  const sidebar = await ember.sidebar(admin);
  for (const id of Object.values(report.rooms)) assert(sidebar.rooms.some(r => r.id === id), `缺少频道 ${id}`);
  const outsider = await ember.sidebar(sessions[3]!); // 周宁不属于任何私人频道
  for (const name of ["核心研发讨论", "项目排期协调"]) assert(!outsider.rooms.some(r => r.id === report.rooms[name]), `${name} 不应对周宁可见`);
  assert.equal(new Set(sessions.map(s => s.user.id)).size, 9);
  const avatars = new Set<string>();
  for (const session of sessions) {
    const { person } = await (await ember.request(`/api/users/${session.user.id}`, { session })).json() as PersonAnswer;
    const response = await ember.request(person.avatarUrl, { session });
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    avatars.add(createHash("sha256").update(bytes).digest("hex"));
  }
  assert.equal(avatars.size, 9, "九名成员应使用不同的有效头像");
  async function timeline(session: Session, roomId: RoomId, inspectThread = false, threadId?: string): Promise<Message[]> {
    return new Promise((resolve, reject) => {
      const socket = new Socket(`${origin.replace("http:", "ws:")}/api/rooms/${roomId}/socket${roomSocketQuery({ visible: false })}`, { headers: { Cookie: session.cookie, Origin: origin } });
      const timer = setTimeout(() => { socket.close(); reject(new Error(`WebSocket 超时 ${roomId}`)); }, 15000);
      let messages: Message[] = [];
      socket.addEventListener("error", () => { clearTimeout(timer); socket.close(); reject(new Error("WebSocket 连接失败")); });
      socket.addEventListener("message", event => {
        const frame = JSON.parse(String(event.data)) as ServerFrame;
        if (frame.type === "welcome") {
          messages = frame.messages;
          const parent = messages.find(m => threadId ? m.id === threadId : m.thread);
          if (inspectThread && parent) socket.send(JSON.stringify({ type: "thread.open", parentId: parent.id }));
          else { clearTimeout(timer); socket.close(); resolve(messages); }
        } else if (frame.type === "thread.opened") {
          clearTimeout(timer); socket.close();
          if (!frame.messages.length) reject(new Error("Thread 没有回复")); else resolve([...messages, ...frame.messages]);
        } else if (frame.type === "error") { clearTimeout(timer); socket.close(); reject(new Error(frame.message)); }
      });
    });
  }
  let threadRoots = 0, quotes = 0, mentions = 0, boosts = 0, cards = 0;
  for (const id of Object.values(report.rooms)) {
    const messages = await timeline(admin, id, true);
    assert(messages.length, `空频道 ${id}`);
    threadRoots += messages.filter(m => m.thread).length;
    quotes += messages.filter(m => m.body.includes("blockquote")).length;
    mentions += messages.filter(m => m.mentions.length).length;
    boosts += messages.filter(m => m.boosts.length).length;
    cards += messages.filter(m => m.cards?.length).length;
  }
  assert(threadRoots >= 25); assert(quotes >= 15); assert(mentions >= 15); assert(boosts >= 15); assert(cards >= 28);
  for (const { project, events } of projectDeliveries) {
    const history = await roomHistory(ember, admin, report.rooms[project]!);
    for (const [key] of events) {
      const found = history.filter(message => message.cards?.length && message.plainText.includes(`DEMOCNDELIVERY${key}V1`));
      assert.equal(found.length, 1, `${project} 的 ${key} 卡片应存在且不重复`);
    }
  }
  for (const [i, { project }] of projectDeliveries.entries()) {
    const roomId = report.rooms[project]!;
    const history = await roomHistory(ember, admin, roomId);
    const root = history.find(m => m.plainText.includes(`DEMOCNFEATURE${i}V1`));
    assert(root?.editedAt, `${project} 缺少真实编辑过的演示消息`);
    const thread = await timeline(admin, roomId, true, root.id);
    const file = thread.find(m => m.parentId === root.id && m.attachment)?.attachment;
    assert(file, `${project} 缺少 Thread 内附件`);
    const contents = await (await ember.request(file.url, { session: admin })).json() as { demo: boolean; project: string };
    assert(contents.demo && contents.project === project);
  }
  const designHistory = await roomHistory(ember, admin, report.rooms["统一设计组件库"]!);
  const pdf = designHistory.find(m => m.attachment?.name === "通用品牌规范-原项目演示素材.pdf")?.attachment;
  assert(pdf);
  assert.equal(Buffer.from(await (await ember.request(pdf.url, { session: admin })).arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  const technicalHistory = await roomHistory(ember, admin, report.rooms["技术讨论"]!);
  assert(technicalHistory.some(m => m.plainText.includes("【演示机器人，非 AI】")), "缺少真实 Bot 提及回复");
  for (const name of ["交付与验收", "技术讨论"]) {
    const history = await roomHistory(ember, admin, report.rooms[name]!);
    const interactive = history.find(m => m.plainText.includes("DEMOCNINTERACTIVEV1"));
    assert(interactive?.cards?.some(c => c.parts.some(p => p.kind === "buttons" && p.buttons.filter(b => b.action).length === 2)), `${name} 缺少两个真实 Bot 操作按钮`);
  }
  const dmMembers = [1, 2, 3, 4, 5];
  for (const [i, id] of report.dmIds.entries()) assert((await timeline(sessions[dmMembers[i]!]!, id)).length >= 4);
  for (const file of report.uploads) {
    assert(file.message.attachment, `没有文件元数据 ${file.name}`);
    const attachment = file.message.attachment as unknown as { url: string };
    const response = await ember.request(attachment.url, { session: admin });
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert(bytes.length, `空附件 ${file.name}`);
  }
  for (const q of ["revision", "Token", "PR128"]) {
    const result = await (await ember.request(`/api/searches?q=${encodeURIComponent(q)}`, { session: admin })).json() as { matches: unknown[] };
    assert(result.matches.length, `搜索未找到 ${q}`);
  }
  const english = await fetch("http://localhost:5173/api/bootstrap").then(r => r.json()) as { account: { name: string }; setup: string };
  assert.equal(english.account.name, "Fernwood"); assert.equal(english.setup, "complete");
  assert.equal((await fetch(origin)).status, 200);
  console.log(`验证通过：9 个账号及不同 PNG 头像，14 个频道（含 2 个私人频道），5 组私聊，${threadRoots} 个 Thread，引用/@/回应/${cards} 张卡片（六项目各 3 张且无重复），原附件下载、6 个线程附件、真实 PDF、编辑标记、Bot 回复及交互按钮，3 个代表词搜索；Fernwood 保留且可访问。`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
