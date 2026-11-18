import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, readFileSync, renameSync, writeFileSync} from "node:fs";
import path from "node:path";
import {promisify} from "node:util";
import type {RoomId, RoomSettings} from "@ember/protocol";
import {botSlackPath, type Bots} from "@ember/protocol/bots";
import {verifiedDemoEmber, signIn, state} from "./local.ts";

export const pilotRepo = "jiawei-wang-dev/project-pulse";
export const companyPilotRepo = "JUXON-AI/VideoHighlightCut";
export const companyPilotKeychainService = "ember-cn-pr-videohighlightcut";
export const companyPilotRoomName = "直播监控";
export const companyPilotBinding = path.join(state, "pr-pilot-videohighlightcut-room.json");
const run = promisify(execFile);
export const companyPilotLedger = path.join(state, "pr-pilot-videohighlightcut-state.json");

interface Pull {
  number: number;
  title: string;
  user: {login: string};
  state: "open" | "closed";
  draft: boolean;
  created_at: string;
  closed_at: string | null;
  merged_at: string | null;
  html_url: string;
}
type Checkpoint = Record<string, string>;

function eventOf(pr: Pull) {
  const kind = pr.merged_at ? "merged" : pr.state;
  const at = pr.merged_at || pr.closed_at || pr.created_at;
  return {kind, at, revision: kind === "open" ? "open" : kind + ":" + at};
}

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

async function companyToken(): Promise<string> {
  try {
    const {stdout} = await run("/usr/bin/security", [
      "find-generic-password", "-s", companyPilotKeychainService, "-a", companyPilotRepo, "-w",
    ], {timeout: 10_000});
    const token = stdout.trim();
    if (token.startsWith("github_pat_")) return token;
  } catch {
    // Do not report command output, and never fall back to gh's existing account.
  }
  throw new Error(`钥匙串里没有可读取的 ${companyPilotRepo} 细粒度令牌`);
}

export async function syncPilotPRs({verify = false, company = false} = {}) {
  const repo = company ? companyPilotRepo : pilotRepo;
  const roomName = company ? companyPilotRoomName : "project-pulse";
  const ledger = company ? companyPilotLedger : path.join(state, "pr-pilot-state.json");
  const token = company ? await companyToken() : undefined;
  const ember = await verifiedDemoEmber();
  const {rooms} = JSON.parse(readFileSync(path.join(state, "monitor-sync.json"), "utf8")) as {rooms: Record<string, RoomId>};
  const roomId = company ? (JSON.parse(readFileSync(companyPilotBinding, "utf8")) as {roomId: RoomId}).roomId : rooms[repo.toLowerCase()];
  if (!roomId) throw new Error("未配置 PR 试点频道");
  const {accounts, password} = JSON.parse(readFileSync(path.join(state, "accounts.json"), "utf8"));
  const admin = await signIn(ember, accounts[0].emailAddress, password);
  const {bots} = await (await ember.request("/api/account/bots", {session: admin})).json() as Bots;
  const bot = bots.find(item => item.name === "Pulse 产出同步");
  if (!bot) throw new Error("未配置产出同步 Bot");
  const botId = bot.id;
  async function checkRoom() {
    const settings = await (await ember.request(`/api/rooms/${roomId}/settings`, {session: admin})).json() as RoomSettings;
    if (settings.room.kind !== "closed" || settings.room.name !== roomName) throw new Error("PR 试点频道不匹配");
    const members = new Set(settings.people.filter(person => person.member).map(person => person.id));
    if (!members.has(botId)) throw new Error("产出同步 Bot 未加入频道");
    if (company && (!members.has(admin.user.id) || members.size !== 2)) throw new Error("私有仓库试点频道成员已变化，暂停推送");
  }
  await checkRoom();
  if (!company) {
    const project = await ember.request(`/api/rooms/${roomId}/project?audience=room`, {session: admin});
    const binding = await project.json() as {project?: {key?: string}};
    if (binding.project?.key?.toLowerCase() !== repo.toLowerCase()) throw new Error("PR 试点项目不匹配");
  }

  let output: string;
  try {
    ({stdout: output} = await run(process.env.PR_PILOT_GH || "/opt/homebrew/bin/gh", [
      "api", "--hostname", "github.com", "--paginate", "--slurp", `repos/${repo}/pulls?state=all&per_page=100`,
    ], {timeout: 20_000, maxBuffer: 8 * 1024 * 1024, env: token ? {...process.env, GH_TOKEN: token, GH_DEBUG: ""} : process.env}));
  } catch {throw new Error("GitHub PR 拉取失败");}
  const pulls = (JSON.parse(output) as Pull[][]).flat();
  if (!pulls.every(pr => Number.isInteger(pr.number) && pr.html_url.toLowerCase() === `https://github.com/${repo.toLowerCase()}/pull/${pr.number}`)) throw new Error("GitHub 返回了非试点仓库的 PR");
  const initialized = existsSync(ledger);
  const previous: Checkpoint = initialized ? JSON.parse(readFileSync(ledger, "utf8")) : {};
  const latest = {...previous};
  let sent = 0;

  async function publish(pr: Pull, verification = false) {
    if (company) await checkRoom();
    const {kind, at, revision} = eventOf(pr);
    const delivery = createHash("sha256").update(`${repo.toLowerCase()}#${pr.number}:${verification ? "verify:" : ""}${revision}`).digest("hex");
    const label = verification ? "GitHub PR 联调" : "GitHub PR 同步";
    const status = (kind === "open" && pr.draft ? "open · 草稿" : kind);
    const title = `PR #${pr.number} · ${pr.title.slice(0, 110)}`;
    const payload = {text: `${label} · ${title}`, blocks: [
      {type: "header", text: {type: "plain_text", text: `【${label}】${title}`}},
      {type: "section", fields: [
        {type: "mrkdwn", text: `*项目*\n${roomName}`},
        {type: "mrkdwn", text: `*记录状态*\n${status}`},
        {type: "mrkdwn", text: `*来源时间*\n${at}`},
      ]},
      {type: "section", text: {type: "mrkdwn", text: `作者：${escape(pr.user.login)}\n来源仓库：${repo}\n${pr.html_url}`}},
      {type: "context", elements: [{type: "plain_text", text: `${verification ? "现有 PR，测试推送和去重。 " : ""}事件编号：PULSEPR${delivery}`}]},
    ]};
    const response = await fetch(new URL(botSlackPath(roomId!, bot!.key), ember.origin), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: {"Content-Type": "application/json", "X-Ember-Delivery-Id": delivery},
      body: JSON.stringify(payload),
    });
    if (!response.ok || (await response.text()).trim() !== "ok") throw new Error("PR 卡片推送失败");
    return delivery;
  }

  for (const pr of pulls) {
    const {kind, revision} = eventOf(pr);
    const prior = previous[pr.number];
    if (initialized && prior !== revision && (kind !== "open" || !prior)) {
      await publish(pr);
      sent++;
    }
    latest[pr.number] = revision;
  }
  const temporary = `${ledger}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(latest), {mode: 0o600});
  renameSync(temporary, ledger);
  if (verify && pulls[0]) {
    const delivery = await publish(pulls[0], true);
    await publish(pulls[0], true);
    return {roomId, scanned: pulls.length, sent, delivery};
  }
  return {roomId, scanned: pulls.length, sent};
}
