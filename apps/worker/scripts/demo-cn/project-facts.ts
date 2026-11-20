import {compactPulseNumber, type PulseSnapshot} from "@ember/protocol";
import {html} from "../seed/markup.ts";

export const quickFactQuestion = (q: string) => /^(?:@?项目助手\s*)?(?:项目现在怎么样|项目还差什么|已经做完了什么|(?:给我)?讲(?:一)?讲项目背景|项目背景|项目介绍)[？?。]?$/u.test(q.trim());

export function factsReply(data: PulseSnapshot, roomId: string, question: string, context = "") {
  const href = `/rooms/${roomId}`;
  const about = /干[啥嘛么]|做什么的|用途|是做什么|是干什么|项目(?:介绍|背景|目标)|介绍.{0,8}项目/;
  const correction = /(?:没(?:有)?问|不是问|不是要看|不想看|别讲)(?:的是)?(?:项目)?进度/;
  const report = data.latest_report;
  const observed = report && typeof report === "object" && "observed_at" in report && typeof report.observed_at === "string" ? report.observed_at : "";
  const date = Number.isFinite(Date.parse(observed)) ? new Date(observed).toLocaleDateString("zh-CN", {timeZone: "Australia/Melbourne"}) : "";
  const source = html`<p><a href="${href}">项目总览</a>${date ? " · 阶段上报于 " + date : ""}${data.freshness?.status === "snapshot" ? " · 上次同步记录" : ""}</p>`;
  const previousQuestion = context.split("\n").findLast(line => line.startsWith("问："))?.slice(2) ?? "";
  const purpose = data.project.goal || data.business?.outcome;
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
  if (/谁|参与成员|负责人/.test(question)) {
    const names = data.members.map(member => member.display_name.replace(/\s*[·•]\s*[a-f\d]{8,}$/i, ""));
    return html`<p>${names.length ? "上报记录里的参与成员有 " + names.join("、") + "。" : "暂无参与成员记录。"}</p>${source}`.body;
  }
  if (/额度/.test(question)) return html`<p>${data.quota.reason}</p>${source}`.body;
  if (/token|用量|费用|额度/i.test(question)) {
    return html`<p>近 ${data.window.days} 天，输入 ${compactPulseNumber(data.usage.input_tokens)}，输出 ${compactPulseNumber(data.usage.output_tokens)}。${data.cost.label}。</p>${source}`.body;
  }
  if (/PR|产出文档/i.test(question)) {
    const pulls = [...data.pulls].sort((a,b) => b.updated_at.localeCompare(a.updated_at));
    const links = pulls.slice(0, 3).map(pr =>
      /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(pr.url)
        ? html`<p><a href="${pr.url}">#${pr.number} ${pr.title}</a></p>`
        : html`<p>#${pr.number} ${pr.title}</p>`).map(link => link.body).join("");
    return html`<p>已收录 ${pulls.length} 条代码变更。</p>`.body + links + source.body;
  }
  if (/活动|最近开发/.test(question)) {
    const recent = data.activities.slice(0, 2).map(a => a.title || a.summary).filter(Boolean);
    return html`<p>${recent.length ? recent.join("；") : "这个时间段没有上报活动。"}</p>${source}`.body;
  }
  if (/模块/.test(question)) return html`<p>${data.business?.modules.map(m => m.name).join("、") || "暂未收录模块。"}</p>${source}`.body;
  if (/能用什么|哪些功能能用|有什么功能|做完了什么/.test(question)) {
    return html`<p>${done.length ? "已上报完成 " + done.length + " 项，包括" + done.slice(-3).map(m => label(m.title)).join("、") + "。" : "暂时没有已完成的阶段记录。"}</p>${source}`.body;
  }
  const asksGaps = /还差|缺少|卡点|阻塞|验收|风险|延期/.test(question);
  const feedback = pending.find(stage => stage.ember_message_id && /^[a-z0-9]{16}$/.test(stage.ember_message_id));
  const asksStatus = /进度|怎么样|做到|做完|完成|速览|现状|里程碑|周报|整体/.test(question);
  if (!asksGaps && !asksStatus) {
    return html`<p>你想先了解哪一块？可以问我项目做什么、现在到哪了、卡在哪儿，或者已经做完了什么。</p>${source}`.body;
  }
  const doneText = done.slice(-2).map(stage => label(stage.title)).join("、");
  const blocked = data.project.status === "blocked" ? "项目目前受阻。" : "";
  const gapText = pending.slice(0, 3).map(stage => label(stage.title)).join("、") || "暂无待完成记录";
  return html`${/验收/.test(question) ? html`<p><strong>上报进度</strong> ${progressText}</p>` : ""}
    ${!asksGaps || asksStatus ? html`<p><strong>做到哪了</strong> ${progressText}${doneText ? " 已完成：" + doneText + "。" : ""}</p>` : ""}
    <p><strong>还差哪几步</strong> ${blocked}${gapText}。</p>
    ${asksGaps && feedback?.ember_message_id ? html`<p>${feedback.evidence ?? ""} <a href="${href}/@${feedback.ember_message_id}">查看原讨论</a></p>` : ""}
    ${/验收/.test(question) ? html`<p>项目进度由客户端 Codex 自动上报。</p>` : ""}
    ${source}`.body;
}
