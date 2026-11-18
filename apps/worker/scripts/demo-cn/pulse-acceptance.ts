import {feedbackStatuses, threadPath, validFeedbackUrl, type FeedbackEvent, type FeedbackPage, type ProjectFeedback, type PulseMessagePage, type PulseSnapshot} from "@ember/protocol";
import {html, type Markup} from "../seed/markup.ts";
import {origin} from "./local.ts";

const pilot = "jiawei-wang-dev/project-pulse";
const done = (state: string) => state === "completed" || state === "accepted";
const short = (value: string, limit = 160) => value.length > limit ? value.slice(0, limit) + "…" : value;
const link = (href: string, label: string) => html`<a href="${href}">${label}</a>`;
const textLine = (label: string, body: string | Markup) => html`<p><strong>${label}</strong> ${body}</p>`.body;

export function isAcceptanceQuestion(data: PulseSnapshot, question: string) {
  return data.project.key === pilot && /(?:能|行|可不可以|可以|是否|何时|怎么|如何).{0,10}验收|验收.{0,10}(?:了吗|条件|还差|缺什么|通过)|验收检查/u.test(question);
}

export async function acceptanceReply(data: PulseSnapshot, roomId: string, cookie: string, question: string, messagePath = "", compact = false) {
  const base = `/rooms/${encodeURIComponent(roomId)}`;
  async function get<T>(suffix: string): Promise<T | null> {
    const response = await fetch(`${origin}/api${base}/project${suffix}`, {
      headers: {Cookie: cookie}, redirect: "error", signal: AbortSignal.timeout(3000),
    }).catch(() => null);
    return response?.ok ? await response.json().catch(() => null) as T | null : null;
  }

  const [feedback, history] = await Promise.all([
    get<FeedbackPage>("/feedback"),
    get<PulseMessagePage>("/messages?kind=all"),
  ]);
  const threadId = messagePath.startsWith(base + "/threads/") ? messagePath.slice(base.length).match(/^\/threads\/([\w-]+)/)?.[1] : undefined;
  const root = history?.messages.find(message => message.id === threadId && !message.deleted);
  const subject = question + (root ? "\n" + short(root.plainText, 900) : "");
  const referenced = [...new Set([...subject.matchAll(/\bfeedback=([\w-]{1,80})(?=[&#\s]|$)/g)].map(match => match[1]!))];
  const feedbackPath = (item: ProjectFeedback) => `${base}?view=feedback&feedback=${encodeURIComponent(item.id)}`;
  const matches = feedback?.items.filter(item => item.title.length >= 5 && subject.includes(item.title)) ?? [];
  const requestedId = referenced.length === 1 ? referenced[0] : matches.length === 1 ? matches[0]?.id : undefined;
  const detail = requestedId ? await get<{item: ProjectFeedback; events: FeedbackEvent[]}>(`/feedback/${encodeURIComponent(requestedId)}`) : null;
  if ((referenced.length > 0 && !detail) || (referenced.length === 0 && matches.length > 1)) {
    return html`<p>我还没找到你说的那条反馈。发我一条${link(base + "?view=feedback", "反馈详情链接")}，我帮你看看还差哪一步。</p>`.body;
  }

  const milestones = data.business?.modules.flatMap(module => module.milestones.map(stage => ({...stage, module}))) ?? [];
  const named = milestones.filter(stage => subject.includes(stage.title) || subject.includes(stage.sourceTitle));
  const stage = detail?.item.milestoneId ? milestones.find(item => item.id === detail.item.milestoneId)
    : named.length === 1 ? named[0] : named.length === 0 && /多机|多台电脑|定时同步|按时上传/.test(subject)
      ? milestones.find(item => item.id === "collection-2") : undefined;
  const modules = data.business?.modules.filter(module => subject.includes(module.name)) ?? [];
  const module = stage?.module ?? (detail ? data.business?.modules.find(item => item.id === detail.item.moduleId) : modules.length === 1 ? modules[0] : undefined);
  const specific = stage ? [stage] : module?.milestones ?? [];
  const overview = data.milestones.map(item => ({
    ...item, sourceTitle: item.title, title: milestones.find(stage => stage.sourceTitle === item.title)?.title ?? item.title,
  }));
  const stages = module ? specific : overview;
  const pending = stages.filter(item => !done(item.state));
  const completed = stages.filter(item => done(item.state));
  const progress = data.milestone_progress;
  const progressText = progress ? `项目阶段 ${progress.completed ?? progress.accepted}/${progress.total} 已记录完成` : "暂无项目阶段完成数";
  const captured = data.freshness?.captured_at ?? data.fetched_at;
  const sourceDate = Number.isFinite(Date.parse(captured)) ? new Date(captured).toLocaleDateString("zh-CN", {timeZone: "Australia/Melbourne"}) : "";
  const freshness = data.freshness?.status === "snapshot" ? ` · ${sourceDate} 快照` : sourceDate ? ` · ${sourceDate}` : "";

  const parts: string[] = [];
  const sources: Markup[] = [];
  const record = (label: string, body: Markup) => {
    if (compact) sources.push(body);
    else parts.push(textLine(label, body));
  };
  const item = detail?.item;
  const scope = item?.title ?? stage?.title ?? module?.name ?? "项目整体";
  const verdict = item?.status === "accepted" ? "这条反馈已验收" : pending.length ? "还有未完成事项" : completed.length ? "已上报阶段均已完成" : "暂无阶段记录";
  parts.push(compact ? textLine(verdict, scope) : textLine("验收检查", html`${short(scope)} · ${link(base, progressText)}${freshness}`));

  if (item) {
    const acceptance = detail?.events.findLast(event => event.action === "accept" && event.to === "accepted");
    const label = item.demo ? "演示反馈" : "反馈";
    parts.push(textLine("做完了什么", html`${link(feedbackPath(item), label + " · " + feedbackStatuses[item.status])}。${acceptance && item.status === "accepted" ? "确认人 " + acceptance.actor.name + "。 " + short(acceptance.note) : ""}${item.evidence.length ? " 已提交 " + item.evidence.length + " 份交付依据。" : ""}`));
    const missing = item.status === "accepted" ? "这条反馈已有验收记录。"
      : item.status === "awaiting_acceptance" ? "交付已提交，等负责人核对验收条件和证据。"
      : item.status === "rejected" ? "这条反馈暂不采纳，请负责人确认是否重开。"
      : item.evidence.length ? "仍需完成落实，并提交负责人验收。" : "还缺交付证据和负责人确认。";
    parts.push(textLine("还缺什么", `${missing}${item.criteria && item.status !== "accepted" ? " 验收条件：" + short(item.criteria) : ""}`));
    parts.push(textLine("找谁确认", `${item.assignee ? "执行人 " + item.assignee.name + " 负责提供证据。 " : ""}由项目负责人确认；反馈验收只覆盖该事项。`));
  } else {
    const summary = completed.length ? completed.slice(0, compact ? 2 : 4).map(item => item.title).join("、") : "该范围暂无完成记录";
    parts.push(textLine("做完了什么", summary));
    const next = pending.length ? pending.slice(0, 2).map(item => item.evidence || item.title).join("；")
      : "当前未看到待完成节点。";
    parts.push(textLine("还缺什么", short(next, compact ? 140 : 300)));
    parts.push(textLine("更新来源", "负责人的客户端 Codex 自动上报到监控面板。"));
  }

  const messageLink = (m: PulseMessagePage["messages"][number]) => m.parentId ? threadPath(roomId, m.parentId, m.id) : `${base}/@${encodeURIComponent(m.id)}`;
  const cards = history?.messages.filter(m => !m.deleted && m.cards?.length && /事件编号：PULSE/.test(m.plainText)) ?? [];
  const stageNames = new Set([...(pending.length ? pending : completed).slice(0, 2), ...(stage ? [] : completed.slice(0, 1))].map(m => m.sourceTitle));
  const stageCards = cards.filter(m => [...stageNames].some(title => m.plainText.startsWith("【阶段证据】" + title + "\n")));
  for (const card of stageCards.slice(0, compact ? 1 : 3)) {
    record("阶段记录", link(messageLink(card), compact ? "阶段记录" : short(card.plainText.split("\n")[0]!.replace(/^【阶段证据】/, ""), 80)));
  }

  const matchedPulls = data.pulls.filter(pr => subject.includes(pr.url) || subject.includes(pr.title) ||
    new RegExp(`(?:PR\\s*)?#${Number(pr.number)}(?!\\d)`, "i").test(subject) || item?.evidence.some(e => e.url === pr.url));
  const pulls = compact || matchedPulls.length || module || item ? matchedPulls : data.pulls.slice(0, 2);
  for (const pr of pulls.slice(0, 2)) {
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(pr.url)) continue;
    const status = pr.is_draft ? "草稿" : pr.state === "merged" ? "已合并" : pr.state === "closed" ? "已关闭" : "待合并";
    const delivery = cards.find(card => card.plainText.includes(pr.url));
    const prLabel = `#${pr.number} ${short(pr.title, 80)} · ${status}`;
    record(matchedPulls.length ? "相关 PR" : "项目 PR（参考）", html`${link(pr.url, compact ? `PR #${pr.number}` : prLabel)}${delivery ? html` · ${link(messageLink(delivery), "交付卡片")}` : ""}`);
  }
  if (item) {
    for (const evidence of item.evidence.filter(e => validFeedbackUrl(e.url)).slice(0, 3)) {
      record("交付依据", link(evidence.url, short(evidence.label, compact ? 28 : 80)));
    }
  } else {
    const related = feedback?.items.filter(f => stage ? f.milestoneId === stage.id : module ? f.moduleId === module.id : true) ?? [];
    for (const f of (compact && !stage && !module ? [] : related.slice(0, compact ? 1 : 2))) {
      record(f.demo ? "演示反馈" : "本地反馈", link(feedbackPath(f), compact ? "相关反馈" : `${short(f.title, 60)} · ${feedbackStatuses[f.status]}`));
    }
  }
  if (compact) {
    const links = [link(base, "项目总览"), ...sources.slice(0, 3)];
    parts.push("<p>" + links.map(source => source.body).join(" · ") + html`${freshness}</p>`.body);
  }
  if (!feedback || !history) parts.push("<p>部分反馈或交付记录暂时读不到，可以打开原频道复核。</p>");
  return parts.join("");
}
