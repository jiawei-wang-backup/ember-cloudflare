import type {IncomingMessage, ServerResponse} from "node:http";
import {isRoomId, type PulseSnapshot} from "@ember/protocol";
import {factsReply, quickFactQuestion} from "./project-facts.ts";
import {origin} from "./local.ts";
import {acceptanceReply, isAcceptanceQuestion} from "./pulse-acceptance.ts";
import {leadershipBrief, wantsLeadershipBrief} from "./pulse-brief.ts";
import {modelReply, type ProjectAssistantSources} from "./pulse-model.ts";

export function handleProjectAssistantChat(request: IncomingMessage, response: ServerResponse, secure: boolean): boolean {
  const match = request.url?.match(/^\/api\/rooms\/([\w-]+)\/project\/assistant-chat$/);
  if (!match) return false;
  const roomId = match[1];
  const send = (status: number, value: object) =>
    response.writeHead(status, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}).end(JSON.stringify(value));
  if (!roomId || !isRoomId(roomId) || request.method !== "POST") {send(404, {error: "未找到项目助手"}); return true;}
  if (!request.headers.cookie) {send(401, {error: "请先登录"}); return true;}
  if (request.headers.origin !== `${secure ? "https" : "http"}://${request.headers.host}` || request.headers["sec-fetch-site"] === "cross-site") {
    send(403, {error: "请在项目页内提问"});
    return true;
  }
  // The calls below go to the loopback HTTP proxy, which expects the HTTP cookie name.
  const secureSession = secure && request.headers.cookie.split(";").map(part => part.trim())
    .find(part => /^__Host-session_token=[\w-]{43}$/.test(part));
  if (secure && !secureSession) {send(401, {error: "请先登录"}); return true;}
  const cookie = secureSession ? secureSession.slice("__Host-".length) : request.headers.cookie;
  void (async () => {
    try {
      const parts: Buffer[] = [];
      let bytes = 0;
      for await (const part of request) {
        bytes += part.length;
        if (bytes > 16000) {send(413, {error: "问题太长"}); return;}
        parts.push(part);
      }
      let body: {question?: unknown; context?: unknown; reference?: unknown};
      try {body = JSON.parse(Buffer.concat(parts).toString());}
      catch {send(400, {error: "无法读取问题"}); return;}
      if (!body || typeof body.question !== "string" || !body.question.trim() || body.question.length > 1200) {
        send(422, {error: "请输入 1 到 1200 字的问题"});
        return;
      }
      const question = body.question.trim();
      const context = typeof body.context === "string" ? body.context.slice(-4800) : "";
      const reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 600) : "";
      const base = `${origin}/api/rooms/${roomId}/project`;
      const headers = {Cookie: cookie};
      const [native, data] = await Promise.all([
        fetch(`${base}/assistant-context`, {headers, redirect:"error", signal:AbortSignal.timeout(3500)}),
        fetch(`${base}?days=7&audience=room`, {headers, redirect:"error", signal:AbortSignal.timeout(1500)})
          .then(async r => r.ok ? await r.json() as PulseSnapshot : null).catch(() => null),
      ]);
      if (!native.ok) {send(native.status, {error: "无法读取频道，请确认你仍是频道成员。"}); return;}
      const room = await native.json() as ProjectAssistantSources;
      let reply: string | null = null;
      if (data && !reference && quickFactQuestion(question)) {
        reply = factsReply(data, roomId, question);
      } else if (data?.business && isAcceptanceQuestion(data, question)) {
        reply = await acceptanceReply(data, roomId, cookie, question + (reference ? "\n" + reference : ""), "", true);
      } else if (data?.business && wantsLeadershipBrief(data, question)) {
        reply = await leadershipBrief(data, roomId, cookie, question, true);
      } else {
        try {reply = await modelReply(data, roomId, cookie, question, undefined, reference ? context + "\n群聊引用：" + reference : context, room);}
        catch {reply = "<p>模型暂未响应，请稍后重试。</p>" + (data ? factsReply(data, roomId, question, context) : "");}
      }
      send(200, {html: reply ?? "<p>当前频道资料不足，暂时无法回答这个问题。</p>", requiresPulseGrant: data !== null});
    } catch {send(503, {error: "项目助手暂时不可用，请重试"});}
  })();
  return true;
}
