import { useId, useMemo, useState } from "react";
import type { Card } from "@ember/protocol";
import { plainText, displayBody } from "@ember/richtext/dom";
import { NavArrowDown, Page } from "@/components/icons/iconoir";
import { cn } from "@/lib/utils";
import { MessageBody, MessageLink } from "./message-body";
import { PulseStatusBadge } from "./pulse-status";
import { Marked } from "./search-marks";
const textOf = (html: string) => plainText(html, () => undefined);

export function PulseDeliveryCard({card}: {card: Card}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const data = useMemo(() => {
    const header = card.parts.find(part => part.kind === "header" || part.kind === "title");
    const title = header && "text" in header ? header.text : "项目交付";
    const fields = card.parts.flatMap(part => part.kind === "fields" || part.kind === "section" ? part.fields || [] : []);
    const value = (label: string) => {
      const field = fields.find(field => field.title === label || textOf(field.html).startsWith(`${label}\n`));
      return field ? textOf(field.html).replace(new RegExp(`^${label}\\s*`), "").trim() : "";
    };
    const evidence = card.parts.flatMap(part => (part.kind === "text" || part.kind === "section") && part.html ? [part.html] : []);
    const text = evidence.map(html => textOf(html)).join("\n");
    const url = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.exec(text)?.[0];
    const status = value("记录状态");
    const kind = /^【([^】]+)】/.exec(title)?.[1] || value("证据类型");
    const delivered = kind === "阶段证据" || Boolean(url) || /^(?:真实 PR|GitHub PR (?:同步|联调))$/.test(kind);
    const state = delivered ? "completed" : /草稿/.test(status) ? "draft" : /^(open|merged|closed)\b/.exec(status)?.[1] || (/待(?:业务)?验收/.test(status) ? "awaiting_acceptance" : /待完成|待确认/.test(status) ? "pending" : /记录为已完成/.test(status) ? "recorded" : /blocked/.test(status) ? "blocked" : /on_track/.test(status) ? "on_track" : "unknown");
    const prStatus = /草稿|draft/i.test(status) ? "草稿" : ({open: "已提交", merged: "已合并", closed: "已关闭"} as Record<string, string>)[status.split(/\s/)[0] || ""];
    return {prStatus, title: title.replace(/^【[^】]+】/, ""), kind, delivered, project: value("项目"), when: value("来源时间"), status, state, url, evidence};
  }, [card]);
  return <article aria-label={`${data.project} · ${data.title}`} className="w-[38rem] max-w-full overflow-hidden rounded-xl border bg-card">
    <div className="space-y-3 p-3.5 max-md:p-3">
      <div className="flex flex-wrap items-center gap-2"><span className="flex min-w-0 items-center gap-1.5 text-[11px] text-message-muted"><Page className="size-3.5 shrink-0"/>{data.project}</span><span className="text-[10px] text-muted-foreground">{data.kind}</span><span className="ml-auto"><PulseStatusBadge value={data.state} label={data.state === "unknown" ? "采集记录" : undefined}/></span></div>
      <h4 className="text-sm leading-relaxed font-semibold break-words"><Marked>{data.title}</Marked></h4>
      <div className="flex flex-wrap items-center gap-2">
        {data.url && <MessageLink href={data.url} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground no-underline hover:opacity-85">查看 PR</MessageLink>}
        <button type="button" aria-expanded={expanded} aria-controls={id} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-hover" onClick={() => setExpanded(value => !value)}>{expanded ? "收起证据" : data.delivered ? "查看交付记录" : "查看证据"}<NavArrowDown className={cn("size-3.5 transition-transform motion-reduce:transition-none", expanded && "rotate-180")}/></button>
        {data.when && <time className="ml-auto text-[10px] text-muted-foreground" dateTime={data.when} title={data.when}>{new Date(data.when).toLocaleDateString("zh-CN")}</time>}
      </div>
    </div>
    {expanded && <div id={id} className="space-y-2 border-t bg-surface px-3.5 py-3 text-xs">
      {!data.delivered && data.status && <p className="text-message-muted">源记录状态：{data.status}</p>}
      {data.url && data.prStatus && <p className="text-message-muted">代码变更 · {data.prStatus}</p>}
      {data.evidence.map((html, i) => <MessageBody key={i} nodes={displayBody(html, "", location.hostname)} mentions={[]} className="text-xs leading-relaxed"/>)}
    </div>}
  </article>;
}
