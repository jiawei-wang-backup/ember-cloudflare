import { useId, useState, type ComponentProps } from "react";
import type { DisplayNode } from "@ember/richtext/dom";
import { NavArrowDown } from "@/components/icons/iconoir";
import { cn } from "@/lib/utils";
import { MessageBody } from "./message-body";

const summaryLimit = 140;
const address = /(?:https?:\/\/|www\.)[^\s<]+/gi;
const detailBlock = new Set(["a", "blockquote", "cite", "img", "ol", "pre", "table", "ul"]);

function needsDetails(node: DisplayNode): boolean {
  if (node.kind === "preview") return true;
  if (node.kind === "text") return /https?:\/\/|www\./i.test(node.value);
  return node.kind === "element" && (detailBlock.has(node.name) || node.children.some(needsDetails));
}

function summaryText(node: DisplayNode): string {
  if (node.kind === "text") return node.value.replace(address, "");
  if (node.kind !== "element" || detailBlock.has(node.name)) return "";
  return node.name === "br" ? "\n" : node.children.map(summaryText).join("");
}

/** Keep the original sanitized message available without putting its details in the timeline. */
export function CompactReply({nodes, trailing, className, snapshot = false, delivery = false, ...props}: ComponentProps<typeof MessageBody> & {snapshot?: boolean; delivery?: boolean}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const shareHeading = summaryText(nodes[0] ?? {kind:"text", value:""}).startsWith("项目助手 · ");
  const answerNodes = shareHeading ? nodes.slice(1) : nodes;
  const lines = answerNodes.flatMap(node => summaryText(node).split("\n")).map(line => line.trim()).filter(Boolean);
  const long = lines.length > 2 || lines.join(" ").length > summaryLimit;
  if (props.emoji || (!snapshot && !delivery && !long && !nodes.some(needsDetails))) return <MessageBody nodes={nodes} trailing={trailing} className={className} {...props}/>;

  let visible = 0;
  let length = 0;
  for (const node of shareHeading || snapshot || delivery ? [] : nodes.slice(0, 2)) {
    const text = summaryText(node);
    if (!text.trim() || needsDetails(node) || text.split("\n").filter(line => line.trim()).length > 1 || length + text.length > summaryLimit) break;
    length += text.length;
    visible++;
  }
  // Old snapshot notices start with repository, status and goal, before the actual progress.
  const first = (delivery
    ? lines[1] ?? "GitHub 交付记录已同步。"
    : snapshot
    ? lines.find(line => !/^(?:项目进展|状态|目标|自动同步|已完成|待完成)\s*·|^PR #/.test(line)) ?? lines[1] ?? "项目进展已同步。"
    : lines.slice(0, 2).join(" ")).replace(/^(?:#{1,6}|[-*])\s+/, "");
  const sentences = first.match(/^.{1,140}?[。！？!?](?=\s|[^\x00-\x7f]|$)/u);
  const preview = first.length > summaryLimit ? (sentences?.[0] || first.slice(0, summaryLimit).trimEnd() + "…") : first;
  const summary = visible ? nodes.slice(0, visible) : preview ? [{kind:"text" as const, value:preview}] : [];
  return <div className={cn("min-w-0", className)} data-message-action-anchor>
    {snapshot && <p className="mb-0.5 text-xs text-message-muted">项目进展 · 自动同步</p>}
    {delivery && <p className="mb-0.5 text-xs text-message-muted">GitHub 产出 · 自动同步</p>}
    {(summary.length > 0 || trailing) && <MessageBody nodes={summary} trailing={trailing} {...props}/>}
    <button type="button" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(value => !value)}
      className="mt-1 inline-flex cursor-pointer items-center gap-1 rounded py-0.5 text-xs text-message-muted hover:underline focus-visible:outline-2">
      {open ? "收起详情" : "详情和链接"}<NavArrowDown className={cn("size-3.5", open && "rotate-180")} aria-hidden/>
    </button>
    <div id={detailsId} hidden={!open}>
      {open && <MessageBody nodes={nodes.slice(visible)} {...props} className="mt-1.5 border-t pt-1.5 text-sm break-words"/>}
    </div>
  </div>;
}
