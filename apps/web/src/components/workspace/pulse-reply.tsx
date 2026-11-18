import { useId, useState, type ReactNode } from "react";
import { pulseStatusLabels, type User } from "@ember/protocol";
import type { DisplayNode } from "@ember/richtext/dom";
import { NavArrowDown } from "@/components/icons/iconoir";
import { cn } from "@/lib/utils";
import { MessageBody } from "./message-body";
import { Marked } from "./search-marks";
import { PulseStatusBadge } from "./pulse-status";

const textOf = (node: DisplayNode): string => node.kind === "text" ? node.value : node.kind === "element" ? (node.name === "br" ? "\n" : node.children.map(textOf).join("")) : "";

/** Collapse the demo assistant's verbose evidence, retaining the original safe message tree. */
export function PulseReply({nodes, text, mentions, className, trailing}: {nodes: DisplayNode[]; text: string; mentions: User[]; className?: string; trailing?: ReactNode}) {
  const [expanded, setExpanded] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const id = useId();
  const paragraphs = nodes.map(node => ({node, text: textOf(node)}));
  const summary = (label: string, legacy?: RegExp) => paragraphs.find(p => p.text.startsWith(`${label}：`))?.text.replace(`${label}：`, "") || legacy?.exec(text)?.[1] || null;
  const owner = summary("负责人", /负责人(?:（参与成员）)?：([^；\n]+)/)?.replace(/\s*[·•]\s*[a-f\d]{8,}(?=\s|[、；·•]|$)/gi, "").replace(/\s*·\s*\d+\s*个采集会话/g, "") || null;
  const progress = summary("进度", /阶段记录：([^\n]+)/);
  const next = summary("待办");
  const call = summary("本次调用") || "输入 0 Token · 输出 0 Token · 模型费用 0（结构化查询，未调用 LLM）";
  const projectUsage = summary("项目用量");
  const snapshot = summary("快照");
  const progressStatus = Object.entries(pulseStatusLabels).find(([, label]) => progress?.startsWith(`${label} ·`));
  const source = paragraphs.filter(p => p.text.startsWith("来源："));
  const details = paragraphs.filter((p, index) => index > 0 && !/^(负责人|进度|待办|来源|本次调用|项目用量|快照)：/.test(p.text));
  return <div data-message-action-anchor className={cn("w-[38rem] max-w-full overflow-hidden rounded-xl border bg-card text-message-ink", className)}>
    <div className="space-y-3 p-3.5 max-md:p-3"><div className="flex flex-wrap items-center gap-2"><strong className="text-xs">项目助手 · 查询摘要</strong><span className="rounded bg-hover px-1.5 py-0.5 text-[10px] text-muted-foreground">结构化</span></div>
      <dl className="space-y-2 text-xs leading-relaxed">{([["负责人", owner], ["进度", progress], ["待办", next]] as const).map(([label, value]) => value ? <div className="grid grid-cols-[3em_minmax(0,1fr)] gap-2" key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{label === "进度" && progressStatus ? <><PulseStatusBadge value={progressStatus[0]}/>{" "}<Marked>{value.slice(progressStatus[1].length + 2).trim()}</Marked></> : <Marked>{value}</Marked>}</dd></div> : null)}</dl>
      <p className="text-xs text-message-muted" title={call}>{call.replace(/（[^）]*）/g, "").trim()}</p>
      <div className="flex gap-3 text-xs"><button type="button" aria-expanded={expanded} aria-controls={`${id}-details`} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 hover:bg-hover" onClick={() => setExpanded(value => !value)}>{expanded ? "收起详情" : "展开详情"}<NavArrowDown className={cn("size-3.5", expanded && "rotate-180")}/></button><button type="button" aria-expanded={sourceOpen} aria-controls={`${id}-source`} className="text-message-muted underline underline-offset-2" onClick={() => setSourceOpen(value => !value)}>{sourceOpen ? "收起来源" : "查看来源"}</button></div>
    </div>
    {expanded && <div id={`${id}-details`} className="space-y-2 border-t bg-surface p-3.5"><MessageBody nodes={details.map(p => p.node)} mentions={mentions} className="text-xs leading-relaxed"/></div>}
    {sourceOpen && <div id={`${id}-source`} className="space-y-2 border-t bg-surface p-3.5">{projectUsage && <p className="text-xs text-message-muted">{projectUsage}</p>}{snapshot && <p className="text-xs text-message-muted">{snapshot}</p>}<MessageBody nodes={source.map(p => p.node)} mentions={mentions} className="text-xs leading-relaxed text-message-muted"/></div>}
    {trailing && <div className="px-3.5 pb-2">{trailing}</div>}
  </div>;
}
