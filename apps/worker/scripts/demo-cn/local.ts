import { Ember, type Session } from "../seed/client.ts";
import path from "node:path";

export const origin = "http://localhost:5174";
export const state = path.resolve(import.meta.dirname, "../../../../.wrangler/demo-cn");
export const workspaceName = "Project Pulse · 研发协作中心";
export async function localEmber(): Promise<Ember> {
  if (process.argv.length > 2) throw new Error("中文演示不接受目标地址或额外参数，只能写入固定本地环境。");
  return verifiedDemoEmber();
}

export async function verifiedDemoEmber(): Promise<Ember> {
  const result = await fetch(`${origin}/__demo_cn_identity`, { redirect: "error", signal: AbortSignal.timeout(5000) });
  const marker = await result.json() as { identity?: string; storage?: string };
  if (marker.identity !== "ember-demo-cn-v1" || marker.storage !== ".wrangler/demo-cn/state") throw new Error("不是独立中文演示环境，拒绝写入。请先运行 pnpm dev:demo-cn。");
  return new Ember(origin);
}
export async function signIn(ember: Ember, emailAddress: string, password: string): Promise<Session> {
  // As e2e/fixtures.ts does, give simulated local clients a documentation-range address. Otherwise
  // repeated nine-person verification consumes the browser's shared loopback sign-in allowance.
  if (ember.origin !== origin) throw new Error("演示登录仅允许固定本地地址。");
  const response = await ember.request("/api/session", {
    method: "POST", body: JSON.stringify({ emailAddress, password }), expected: [201],
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `2001:db8::${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}` },
  });
  const { user } = await response.json() as Pick<Session, "user">;
  return { user, cookie: response.headers.getSetCookie()[0]!.split(";")[0]! };
}
