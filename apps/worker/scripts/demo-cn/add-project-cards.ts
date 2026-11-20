import { readFileSync,existsSync } from "node:fs";
import path from "node:path";
import type { RoomId } from "@ember/protocol";
import type { Bots } from "@ember/protocol/bots";
import { localEmber, signIn, state, workspaceName } from "./local.ts";
import { addProjectCards } from "./project-cards.ts";
import { DEMO_ASSISTANT_NAME } from "./demo-bot.ts";

async function main() {
  if(existsSync(path.join(state,"monitor-sync.json"))){console.log("已切换到监控项目演示，请使用 pnpm sync:demo-pulse 更新产出卡片；未追加旧虚构项目卡片。");return;}
  const ember = await localEmber();
  const credentials = JSON.parse(readFileSync(path.join(state, "accounts.json"), "utf8")) as { password: string; accounts: Array<{ emailAddress: string }> };
  const manifest = JSON.parse(readFileSync(path.join(state, "manifest.json"), "utf8")) as { status: string; rooms: Record<string, RoomId> };
  if (manifest.status !== "complete") throw new Error("请先完整初始化独立中文演示环境。");
  const admin = await signIn(ember, credentials.accounts[0]!.emailAddress, credentials.password);
  if ((await ember.settings(admin)).account.name !== workspaceName) throw new Error("工作空间不匹配，拒绝添加卡片。");
  const { bots } = await (await ember.request("/api/account/bots", { session: admin })).json() as Bots;
  const bot = bots.find(item => item.name === DEMO_ASSISTANT_NAME);
  if (!bot) throw new Error("请先运行 pnpm enrich:demo-cn 初始化协作演示助手。");
  console.log(`完成：新增 ${await addProjectCards(ember, admin, bot, manifest.rooms)} 张项目卡片；再次执行按持久化事件编号跳过。`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
