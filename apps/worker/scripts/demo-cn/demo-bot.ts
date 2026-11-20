import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { state } from "./local.ts";

export const DEMO_ASSISTANT_NAME = "协作演示助手";

export function callbackToken(): string {
  const file = path.join(state, "callback-token");
  if (!existsSync(file)) writeFileSync(file, randomBytes(24).toString("hex"), { flag: "wx", mode: 0o600 });
  return readFileSync(file, "utf8").trim();
}

export function interactiveCard(view: "checklist" | "scope" = "scope", reader?: string) {
  const checklist = view === "checklist";
  return {
    text: "【演示数据】原生 Bot 按钮与回调 DEMOCNINTERACTIVEV1",
    blocks: [
      { type: "header", text: { type: "plain_text", text: "【演示】可交互的交付说明" } },
      { type: "section", text: { type: "mrkdwn", text: checklist
        ? "*验收检查清单*\n• PR 合并：仅表示开发阶段\n• CI 通过：核对测试范围与未测项\n• 部署成功：区分测试与生产环境\n• 业务验收：由负责人按约定范围确认\n\n此按钮只切换说明，不执行审批、部署或真实测试。"
        : "*当前交付边界*\n监控平台：压测与业务验收待完成\n剪辑工作台：批量素材验收待完成\n互动组件：长时压测待完成\nAI 网关：真实供应商对账待完成\n组件库：1.0 冻结范围验收完成\n内容中台：筹备中，尚未开发部署" } },
      { type: "actions", block_id: "demo_delivery_view", elements: [
        { type: "button", action_id: "demo_checklist", text: { type: "plain_text", text: "查看验收清单" }, style: checklist ? "primary" : undefined },
        { type: "button", action_id: "demo_scope", text: { type: "plain_text", text: "查看项目边界" }, style: checklist ? undefined : "primary" },
      ] },
      { type: "context", elements: [{ type: "mrkdwn", text: `${reader ? `${reader.replace(/[<>&]/g, "")}通过真实本地回调切换了说明。` : "点击按钮，Ember 将事件发给本地演示 Bot 并更新这张卡片。"} 演示编号：DEMOCNINTERACTIVEV1。规则说明由脚本提供，不是 AI 回答。` }] },
    ],
  };
}

/** Only this loopback development server hosts the demo callback. No production route is added. */
export function handleDemoBot(req: IncomingMessage, res: ServerResponse): boolean {
  if (!req.url?.startsWith("/__demo_cn_bot/")) return false;
  if (req.method !== "POST" || req.url !== `/__demo_cn_bot/${callbackToken()}`) { res.writeHead(404); res.end(); return true; }
  let size = 0;
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > 65536) { res.writeHead(413); res.end(); req.destroy(); }
    else chunks.push(chunk);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { type?: string; actions?: Array<{ action_id?: string }>; user?: { name?: string } };
      if (body.type === "block_actions") {
        const action = body.actions?.[0]?.action_id;
        if (action !== "demo_checklist" && action !== "demo_scope") { res.writeHead(422); res.end(); return; }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(interactiveCard(action === "demo_checklist" ? "checklist" : "scope", body.user?.name)));
      } else {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("【演示机器人，非 AI】我可以展示交付检查清单。请使用交互卡片的“查看验收清单”和“查看项目边界”；不会执行审批、部署或真实测试。");
      }
    } catch { res.writeHead(400); res.end(); }
  });
  return true;
}
