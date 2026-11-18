import type {DisplayNode} from "@ember/richtext/dom";
import type {User} from "@ember/protocol";
import {MessageBody} from "./message-body";
import {useContext} from "react";
import {ProjectFeedbackNavigation} from "./project-chat-context";

export function ProjectAdoptionCard({nodes, mentions}: {nodes: DisplayNode[]; mentions: User[]}) {
  const openWorkflow = useContext(ProjectFeedbackNavigation);
  return <div data-message-action-anchor className="my-1 w-[38rem] max-w-full overflow-hidden rounded-xl border bg-card text-message-ink">
    <div className="flex flex-wrap items-center gap-2 border-b px-3.5 py-2.5"><strong className="text-xs">已采纳 · 项目优化方案</strong><span className="rounded-full bg-hover px-2 py-0.5 text-[10px]">方案生成记录</span>{openWorkflow && <button className="ml-auto text-[11px] text-link underline" onClick={openWorkflow}>查看落实与验收</button>}</div>
    <div className="p-3.5"><MessageBody nodes={nodes.slice(0, 2)} mentions={mentions} className="text-xs leading-relaxed"/>
      <details className="mt-2 text-xs"><summary className="cursor-pointer text-link">查看优化清单、验收条件与原始讨论</summary><MessageBody nodes={nodes.slice(2)} mentions={mentions} className="mt-3 space-y-2 text-xs leading-relaxed"/></details>
    </div>
  </div>;
}
