import type {ReactNode} from "react";
import type {User} from "@ember/protocol";
import type {DisplayNode} from "@ember/richtext/dom";
import {CheckCircle, Group, NavArrowDown, Page, WarningTriangle} from "@/components/icons/iconoir";
import {cn} from "@/lib/utils";
import {MessageBody} from "./message-body";
import {CompactReply} from "./compact-reply";

const layout = {
  做到哪了: {icon: CheckCircle, tone: "bg-positive/10 text-positive"},
  做完了什么: {icon: CheckCircle, tone: "bg-positive/10 text-positive"},
  还差什么: {icon: WarningTriangle, tone: "bg-warning/15 text-message-ink"},
  还缺什么: {icon: WarningTriangle, tone: "bg-warning/15 text-message-ink"},
  下一步: {icon: Group, tone: "bg-hover text-message-ink"},
  找谁确认: {icon: Group, tone: "bg-hover text-message-ink"},
} as const;

const sourceLabels = new Set(["阶段记录", "相关 PR", "项目 PR", "项目 PR（参考）", "交付依据", "演示反馈", "本地反馈"]);

function sectionOf(node: DisplayNode) {
  if (node.kind !== "element" || node.name !== "p") return {label: "", content: [node]};
  const [first, ...rest] = node.children;
  if (first?.kind === "element" && first.name === "strong" && first.children.every(n => n.kind === "text")) {
    return {label: first.children.map(n => n.value).join("").trim(), content: rest};
  }
  return {label: "", content: node.children};
}

export function PulseSummaryCard({nodes, mentions, className, trailing}: {
  nodes: DisplayNode[];
  mentions: User[];
  className?: string;
  trailing?: ReactNode;
}) {
  const [header, ...body] = nodes.map(sectionOf);
  const title = header?.label.replace(/^领导简报/, "项目速览") || "项目助手";
  const summary = body.filter(section => Object.hasOwn(layout, section.label));
  const sources = body.filter(section => sourceLabels.has(section.label) ||
    !section.label && section.content.some(node => node.kind === "element" && node.name === "a"));
  const notes = body.filter(section => !summary.includes(section) && !sources.includes(section));
  return <div data-message-action-anchor className={cn("my-1 w-full max-w-[39rem] min-w-0 overflow-hidden rounded-xl border bg-card text-message-ink shadow-sm", className)}>
    <div className="flex items-start gap-3 border-b bg-surface px-3.5 py-3 sm:px-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-message-muted"><Page className="size-4" aria-hidden="true"/></span>
      <div className="min-w-0">
        <h4 className="text-sm font-semibold">{title}</h4>
        {header?.content.length ? <CompactReply nodes={header.content} mentions={mentions} className="mt-1 break-words text-xs leading-relaxed text-message-muted"/> : null}
      </div>
    </div>
    <div className="space-y-3 px-3.5 py-3 sm:px-4">
      <dl className="space-y-3">
        {summary.map(({label, content}, index) => {
          const {icon: Icon, tone} = layout[label as keyof typeof layout];
          return <div key={index} className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-2.5">
            <span className={cn("row-span-2 grid size-7 place-items-center rounded-lg", tone)}><Icon className="size-4" aria-hidden="true"/></span>
            <dt className="text-xs font-semibold">{label}</dt>
            <dd className="mt-0.5 min-w-0 break-words text-sm leading-relaxed text-message-muted"><CompactReply nodes={content} mentions={mentions}/></dd>
          </div>;
        })}
      </dl>
    </div>
    {notes.length + sources.length > 0 && <details className="group/sources border-t bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-xs font-medium hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4 [&::-webkit-details-marker]:hidden">
        <NavArrowDown className="size-4 group-open/sources:rotate-180" aria-hidden="true"/>详情和链接
      </summary>
      <ul className="space-y-2 px-3.5 pb-3 text-xs leading-relaxed sm:px-4">
        {[...notes, ...sources].map(({label, content}, index) => <li key={index} className="min-w-0 break-words">
          {label && <span className="font-medium text-message-muted">{label} </span>}
          <MessageBody nodes={content} mentions={mentions} className="inline"/>
        </li>)}
      </ul>
    </details>}
    {trailing && <div className="px-3.5 pb-2">{trailing}</div>}
  </div>;
}
