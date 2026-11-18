import { readFileSync,existsSync } from "node:fs";
import path from "node:path";
import type { RoomId } from "@ember/protocol";
import { localEmber, signIn, state, workspaceName } from "./local.ts";
import { enrichDemo } from "./enrichment.ts";

async function main() {
  if(existsSync(path.join(state,"monitor-sync.json"))){console.log("已切换到监控项目演示，请使用 pnpm sync:demo-pulse 更新背景；未重新写入旧虚构项目。");return;}
  const ember = await localEmber();
  const credentials = JSON.parse(readFileSync(path.join(state, "accounts.json"), "utf8")) as { password: string; accounts: Array<{ emailAddress: string }> };
  const manifest = JSON.parse(readFileSync(path.join(state, "manifest.json"), "utf8")) as { status: string; rooms: Record<string, RoomId> };
  if (manifest.status !== "complete") throw new Error("请先完整初始化中文环境。");
  const sessions = [];
  for (const account of credentials.accounts) sessions.push(await signIn(ember, account.emailAddress, credentials.password));
  if ((await ember.settings(sessions[0]!)).account.name !== workspaceName) throw new Error("工作空间不匹配，拒绝修改。");
  await enrichDemo(ember, sessions, manifest.rooms);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
