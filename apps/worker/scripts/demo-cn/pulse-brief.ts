import type {PulseMessagePage, PulseSnapshot} from "@ember/protocol";
import {html, type Markup} from "../seed/markup.ts";
import {origin} from "./local.ts";

export function wantsLeadershipBrief(data: PulseSnapshot, question: string) {
  return data.project.key === "jiawei-wang-dev/project-pulse" &&
    /项目速览|领导简报|项目简报|汇报.{0,6}进度|项目还差什么|(?:项目)?(?:现在|目前)?(?:做到哪(?:儿|里)?了|进展(?:怎样|如何|怎么样)|进度(?:怎么样|如何))|项目(?:现在|目前)?怎么样/u.test(question);
}

export async function leadershipBrief(data: PulseSnapshot, roomId: string, cookie: string, question = "", compact = false) {
  const room = `/rooms/${encodeURIComponent(roomId)}`;
  const titles = new Map(data.business?.modules.flatMap(module =>
    module.milestones.map(stage => [stage.sourceTitle, stage.title] as const)));
  const complete = data.milestones.filter(m => m.state === "completed" || m.state === "accepted");
  const pending = data.milestones.find(m => m.state !== "completed" && m.state !== "accepted");
  const title = (raw: string) => titles.get(raw) ?? raw;
  const progress = data.milestone_progress;
  const progressText = progress ? `${progress.completed ?? progress.accepted}/${progress.total} 项有完成记录` : "暂无整体完成数";
  const captured = data.freshness?.captured_at ?? data.fetched_at;
  const date = Number.isFinite(Date.parse(captured))
    ? new Date(captured).toLocaleDateString("zh-CN", {timeZone: "Australia/Melbourne"}) : "";
  const sourceLabel = [date, data.freshness?.status === "snapshot" ? "快照" : ""].filter(Boolean).join(" ");
  const highlights = complete.slice(-2).map(m => title(m.title)).join("、");

  let record: Markup | string = "";
  if (pending) {
    const history = await fetch(`${origin}/api${room}/project/messages?kind=bot`, {
      headers: {Cookie: cookie}, redirect: "error", signal: AbortSignal.timeout(2500),
    }).then(async response => response.ok ? await response.json() as PulseMessagePage : null).catch(() => null);
    const card = history?.messages.find(m => !m.deleted && m.cards?.length && m.plainText.startsWith(`【阶段证据】${pending.title}\n`));
    if (card) record = html` · <a href="${room}/@${encodeURIComponent(card.id)}">查看阶段记录</a>`;
  }

  const next = pending ? (pending.evidence || title(pending.title)).slice(0, 200) : "已上报的阶段均已完成。";
  const needsAttention = data.project.status === "blocked" ? "项目目前受阻。 " : "";
  const gapsOnly = /项目还差什么/u.test(question);
  if (compact) return html`${gapsOnly ? "" : html`<p><strong>做到哪了</strong> ${progressText}${highlights ? "。已完成：" + highlights : ""}。</p>`}
    <p><strong>卡在哪儿</strong> ${needsAttention}${pending ? title(pending.title) : "未见待完成项"}。</p>
    <p><strong>接下来做什么</strong> ${next}</p>
    <p><a href="${room}?view=overview">项目总览</a>${sourceLabel ? " · 截至 " + sourceLabel : ""}${record}</p>`.body;
  return html`<p><strong>项目速览 · Project Pulse</strong>${sourceLabel ? " · " + sourceLabel : ""}</p>
    ${gapsOnly ? "" : html`<p>把分散在多台电脑上的项目进度和交付记录汇到一个看板。</p>
    <p><strong>做到哪了</strong> ${progressText}${highlights ? "。其中包括" + highlights : ""}。</p>`}
    <p><strong>还差什么</strong> ${needsAttention}${pending ? title(pending.title) : "未看到待完成项"}${record}</p>
    <p><strong>接下来做什么</strong> ${next}</p>
    <p><a href="${room}?view=overview">项目总览</a> · <a href="${room}?view=feedback">反馈与落实</a></p>`.body;
}
