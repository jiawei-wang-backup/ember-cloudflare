import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import {promisify} from "node:util";
import {botSlackPath, type Bots} from "@ember/protocol/bots";
import type {RoomId, RoomSettings} from "@ember/protocol";
import {verifiedDemoEmber, signIn, state} from "./local.ts";

const run = promisify(execFile);
export const deliveryContexts = new Map<string, {repository: string; text: string}>();

async function github(route: string) {
  const {stdout} = await run("gh", ["api", "--hostname", "github.com", "--method", "GET", route], {
    timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    env: {...process.env, GH_PROMPT_DISABLED: "1"},
  });
  return JSON.parse(stdout);
}

async function repositoryOutput(repo: string) {
  const base = "repos/" + repo;
  const [revision, releases, pulls] = await Promise.all([
    github(base + "/commits?per_page=1"), github(base + "/releases?per_page=4"),
    github(base + "/pulls?state=all&sort=updated&per_page=5"),
  ]);
  const sha = revision[0]?.sha;
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid GitHub revision");
  const tree = await github(base + "/git/trees/" + sha + "?recursive=1");
  const docs = tree.tree.filter((item: {type: string; path: string; size: number}) =>
    item.type === "blob" && item.size < 150000 && /^(README\.md|docs\/[\w.-]+\.md)$/i.test(item.path));
  const files = await Promise.all(docs.slice(0, 16).map(async (item: {path: string; sha: string}) => {
    const blob = await github(base + "/git/blobs/" + item.sha);
    return {file: item.path, url: "https://github.com/" + repo + "/blob/" + sha + "/" + item.path,
      text: Buffer.from(blob.content, "base64").toString("utf8").slice(0, 1300)};
  }));
  const changes = [
    "提交 " + sha.slice(0,8) + " " + revision[0].commit.message.split("\n")[0] + " " + revision[0].html_url,
    ...releases.map((r: {tag_name: string; html_url: string}) => "发布 " + r.tag_name + " " + r.html_url),
    ...pulls.map((r: {number: number; title: string; state: string; html_url: string}) => "PR #" + r.number + " " + r.state + " " + r.title + " " + r.html_url),
  ];
  return {changes, files};
}

export async function syncGithubDeliveries() {
  const ember = await verifiedDemoEmber();
  const {accounts,password} = JSON.parse(readFileSync(path.join(state, "accounts.json"), "utf8"));
  const session = await signIn(ember, accounts[0].emailAddress, password);
  const {bots} = await (await ember.request("/api/account/bots", {session})).json() as Bots;
  const bot = bots.find(b => b.name === "Pulse 产出同步");
  if (!bot) return;
  const {projects} = await (await ember.request("/api/pulse/projects", {session})).json() as {projects: {roomId: RoomId}[]};
  for (const {roomId} of projects) {
    try {
      const readProject = async () => ((await (await ember.request("/api/rooms/" + roomId + "/project?audience=room", {session})).json()) as {project:{full_name:string}}).project.full_name;
      const repo = await readProject();
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) continue;
      const output = await repositoryOutput(repo);
      const settings = await (await ember.request("/api/rooms/" + roomId + "/settings",{session})).json() as RoomSettings;
      if (!settings.people.some(p => p.id === bot.id && p.member) || await readProject() !== repo) continue;
      const text = ["GitHub 产出 · " + repo, ...output.changes, ...output.files.slice(0,3).map(f => f.file + " " + f.url)].join("\n");
      const delivery = createHash("sha256").update(roomId + "\n" + text).digest("hex");
      const response = await fetch(new URL(botSlackPath(roomId,bot.key),ember.origin), {
        method:"POST", redirect:"error", headers:{"Content-Type":"application/json","X-Ember-Delivery-Id":delivery},
        body:JSON.stringify({text}), signal:AbortSignal.timeout(10000),
      });
      if (!response.ok || (await response.text()).trim() !== "ok") throw new Error("Delivery failed");
      deliveryContexts.set(roomId,{repository:repo,text:JSON.stringify(output)});
      console.log("GitHub 产出已同步",repo,output.files.length);
    } catch { deliveryContexts.delete(roomId); console.error("GitHub 产出同步失败",roomId); }
  }
}
