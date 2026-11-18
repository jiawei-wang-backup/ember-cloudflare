import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { RoomId, RoomSettings } from "@ember/protocol";
import type { BotAnswer, Bots } from "@ember/protocol/bots";
import { userForm } from "../seed/client.ts";
import { localEmber, signIn, state } from "./local.ts";
import { callbackToken } from "./demo-bot.ts";
import { readMonitorSnapshot, MONITOR_URL } from "./monitor-source.ts";

async function main() {
  // Verify the screenshot source before making changes; never query the old local DB.
  const snapshot = await readMonitorSnapshot();
  const ember = await localEmber();
  const sync = JSON.parse(readFileSync(path.join(state, "monitor-sync.json"), "utf8")) as {rooms: Record<string, RoomId>};
  if (Object.keys(sync.rooms).length !== 6 || snapshot.projects.some(project => !sync.rooms[project.key])) throw new Error("请先同步正确六项目频道，再关联实时数据。");
  const accounts = JSON.parse(readFileSync(path.join(state, "accounts.json"), "utf8"));
  const sessions = [];
  for (const account of accounts.accounts) sessions.push(await signIn(ember, account.emailAddress, accounts.password));
  const admin = sessions[0]!;
  const linkFile = path.join(state, "pulse-link.json");
  const previous = existsSync(linkFile) ? JSON.parse(readFileSync(linkFile, "utf8")) : null;
  const bots = await (await ember.request("/api/account/bots", {session: admin})).json() as Bots;
  const existing = bots.bots.find(bot => bot.name === "项目助手");
  const assistantForm = userForm({name: "项目助手", webhookUrl: `http://localhost:5174/__pulse_bot/${callbackToken()}`}, {
    name: "project-assistant.png",
    type: "image/png",
    bytes: readFileSync(new URL("./assets/project-assistant.png", import.meta.url)),
  });
  const bot = await (await ember.request(existing ? `/api/account/bots/${existing.id}` : "/api/account/bots", {
    ...assistantForm, method: existing ? "PATCH" : "POST", session: admin, expected: existing ? [200] : [201],
  })).json() as BotAnswer;
  const syncBot = bots.bots.find(bot => bot.name === "Pulse 产出同步");
  if (!syncBot) throw new Error("找不到产出同步 Bot，请先运行 sync:demo-pulse。");
  const knownIds = [...sessions.map(session => session.user.id), bot.bot.id, syncBot.id];
  const bindings: Record<string, {projectId: string; memberIds: string[]}> = {};
  for (const project of snapshot.projects) {
    const id = sync.rooms[project.key]!;
    const settings = await (await ember.request(`/api/rooms/${id}/settings`, {session: admin})).json() as RoomSettings;
    if (settings.room.kind !== "closed" || settings.room.name !== project.name) throw new Error(`频道 ${project.name} 的身份或私人设置不符，停止关联。`);
    const memberIds = [...new Set([...settings.people.filter(person => person.member).map(person => person.id), bot.bot.id])];
    await ember.json(`/api/rooms/${id}`, "PATCH", {kind: "closed", memberIds}, {session: admin});
    const prior = previous?.source === "dashboard" ? previous.bindings?.[id] : null;
    // Preserve explicit existing grants. New readers need an operator's grant.
    const granted: string[] = prior?.projectId === project.key ? [...new Set([...prior.memberIds, bot.bot.id])] : knownIds;
    bindings[id] = {projectId: project.key, memberIds: granted};
    console.log(`已关联 ${project.name}：顶部统计 + 项目助手 → 正确监控服务。`);
  }
  const root = path.resolve(import.meta.dirname, "../../../..");
  const config = ts.parseConfigFileTextToJson("wrangler.jsonc", readFileSync(path.join(root, "wrangler.jsonc"), "utf8")).config;
  config.main = path.join(root, config.main); config.assets.directory = path.join(root, config.assets.directory);
  for (const database of config.d1_databases) database.migrations_dir = path.join(root, database.migrations_dir);
  const source = new URL(MONITOR_URL).origin;
  config.vars = {...config.vars, PULSE_SOURCE: "dashboard", PULSE_URL: source, PULSE_HTTP_ORIGIN: source, PULSE_ROOMS: JSON.stringify(bindings)};
  // The LAN Dashboard needs no service token; remove the old local token.
  const varsFile = path.join(state, ".dev.vars");
  if (existsSync(varsFile)) writeFileSync(varsFile, readFileSync(varsFile, "utf8").split("\n").filter(line => !/^PULSE_TOKEN=/.test(line)).join("\n"), {mode: 0o600});
  writeFileSync(linkFile, JSON.stringify({legacyRoomId: previous?.legacyRoomId || previous?.roomId, source: "dashboard", sourceUrl: source, bindings, botId: bot.bot.id}, null, 2), {mode: 0o600});
  writeFileSync(path.join(state, "pulse-session.json"), JSON.stringify(admin), {mode: 0o600});
  writeFileSync(path.join(state, "pulse.wrangler.json"), JSON.stringify(config, null, 2), {mode: 0o600});
  console.log("六项目关联已保存。重启中文 dev:demo-cn 以更新项目助手；Fernwood 未修改。");
}
main().catch(error => {console.error(error instanceof Error ? error.message : "关联失败"); process.exitCode = 1;});
