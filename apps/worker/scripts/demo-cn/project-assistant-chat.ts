import type {IncomingMessage, ServerResponse} from "node:http";
import {isRoomId, type PulseSnapshot} from "@ember/protocol";
import {html} from "../seed/markup.ts";
import {origin} from "./local.ts";
import {acceptanceReply, isAcceptanceQuestion} from "./pulse-acceptance.ts";
import {leadershipBrief, wantsLeadershipBrief} from "./pulse-brief.ts";
import {modelReply} from "./pulse-model.ts";

function factsReply(data: PulseSnapshot, roomId: string, question: string, context: string) {
  const href = `/rooms/${roomId}`;
  const about = /干[啥嘛么]|做什么的|用途|是做什么|是干什么|项目(?:介绍|背景|目标)|介绍.{0,8}项目/;
  const correction = /(?:没(?:有)?问|不是问|不是要看|不想看|别讲)(?:的是)?(?:项目)?进度/;
  const source = html`<p><a href="${href}">项目总览</a></p>`;
  const previousQuestion = context.split("\n").findLast(line => line.startsWith("问："))?.slice(2) ?? "";
  const purpose = data.business?.outcome || data.project.goal;
  if (about.test(question) || (correction.test(question) && about.test(previousQuestion))) {
    return html`<p>${purpose ? "简单说，" + purpose : "我翻了下项目记录，暂时还没写明用途。"}</p>${source}`.body;
  }
  if (correction.test(question)) return html`<p>明白啦，你是想了解项目做什么、现在能用什么，还是别的方面？</p>`.body;
  const stages = data.business?.modules.flatMap(module => module.milestones) ?? [];
  const label = (title: string) => stages.find(stage => stage.sourceTitle === title)?.title ?? title;
  const done = data.milestones.filter(stage => stage.state === "completed" || stage.state === "accepted");
  const pending = data.milestones.filter(stage => !done.includes(stage));
  const progress = data.milestone_progress;
  const progressText = progress ? `${progress.completed ?? progress.accepted}/${progress.total} 项有完成记录。` : "暂无阶段进度记录。";
  const captured = new Date(data.freshness?.captured_at ?? data.fetched_at);
  const date = Number.isFinite(captured.getTime()) ? captured.toLocaleDateString("zh-CN", {timeZone: "Australia/Melbourne"}) : "";
  if (/能用什么|哪些功能能用|有什么功能/.test(question)) {
    const available = data.business?.modules.flatMap(module => module.available).slice(0, 3) ?? [];
    return html`<p>${available.length ? available.join("；") + "。" : "项目记录暂未列出可用功能。"}</p>${source}`.body;
  }
  const asksGaps = /还差|缺少|卡点|阻塞|验收/.test(question);
  const asksStatus = /进度|怎么样|做到|做完|完成|速览|现状/.test(question);
  if (!asksGaps && !asksStatus) {
    return html`<p>你想先了解哪一块？可以问我项目做什么、现在到哪了、卡在哪儿，或者已经做完了什么。</p>${source}`.body;
  }
  const doneText = done.slice(-2).map(stage => label(stage.title)).join("、");
  const gapText = pending.slice(0, 3).map(stage => label(stage.title)).join("、") || "暂无待完成记录";
  return html`${/验收/.test(question) ? html`<p><strong>上报进度</strong> ${progressText}</p>` : ""}
    ${!asksGaps || asksStatus ? html`<p><strong>做到哪了</strong> ${progressText}${doneText ? " 已完成：" + doneText + "。" : ""}</p>` : ""}
    <p><strong>还差哪几步</strong> ${gapText}。</p>
    ${/验收/.test(question) ? html`<p>项目进度由客户端 Codex 自动上报。</p>` : ""}
    <p><a href="${href}">项目总览</a>${date ? " · 数据截至 " + date : ""}</p>`.body;
}

export function handleProjectAssistantChat(request: IncomingMessage, response: ServerResponse): boolean {
  const match = request.url?.match(/^\/api\/rooms\/([\w-]+)\/project\/assistant-chat$/);
  if (!match) return false;
  const roomId = match[1];
  const send = (status: number, value: object) =>
    response.writeHead(status, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}).end(JSON.stringify(value));
  if (!roomId || !isRoomId(roomId) || request.method !== "POST") {send(404, {error: "未找到项目助手"}); return true;}
  if (!request.headers.cookie) {send(401, {error: "请先登录"}); return true;}
  if (request.headers.origin !== `http://${request.headers.host}` || request.headers["sec-fetch-site"] === "cross-site") {
    send(403, {error: "请在项目页内提问"});
    return true;
  }
  const cookie = request.headers.cookie;
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
      const project = await fetch(`${origin}/api/rooms/${roomId}/project?days=7`, {
        headers: {Cookie: cookie}, redirect: "error", signal: AbortSignal.timeout(8000),
      });
      if (!project.ok) {send(project.status, {error: "无法读取这个项目的数据，请确认你仍有频道权限。"}); return;}
      const data = await project.json() as PulseSnapshot;
      if (!data.business) {send(404, {error: "此频道未启用项目助手"}); return;}
      let reply: string | null = null;
      if (isAcceptanceQuestion(data, question)) {
        reply = await acceptanceReply(data, roomId, cookie, question + (reference ? "\n" + reference : ""), "", true);
      } else if (wantsLeadershipBrief(data, question)) {
        reply = await leadershipBrief(data, roomId, cookie, question, true);
      } else {
        try {reply = await modelReply(data, roomId, cookie, question, undefined, reference ? context + "\n群聊引用：" + reference : context);}
        catch {send(503, {error: "模型暂未答复，请重试或先问项目进度。"}); return;}
      }
      send(200, {html: reply ?? factsReply(data, roomId, question, context)});
    } catch {send(503, {error: "项目助手暂时不可用，请重试"});}
  })();
  return true;
}
