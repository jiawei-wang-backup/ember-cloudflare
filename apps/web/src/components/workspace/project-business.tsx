import {useId, useState} from "react";
import type {BusinessMilestone, PulseSnapshot} from "@ember/protocol";
import {NavArrowRight} from "@/components/icons/iconoir";
import {Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger} from "@/components/ui/dialog";
import {cn} from "@/lib/utils";
import {PulseStatusBadge} from "./pulse-status";
import {ProjectQuickLook} from "./project-quick-look";

function milestoneDone({state}: Pick<BusinessMilestone, "state">) {
  return state === "completed" || state === "accepted";
}

function MilestonePipeline({stages, roomId, onFeedback}: {
  roomId?: string;
  stages: Array<Pick<BusinessMilestone, "title" | "state"> & {evidence?: string | null; sourceTitle?: string; ember_message_id?: string}>;
  onFeedback?: (index: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const detailId = useId();
  const stage = selected === null ? undefined : stages[selected];
  if (!stages.length) return <p className="text-xs text-message-muted">暂无里程碑</p>;
  return <div className="min-w-0">
    <ol aria-label="里程碑流水线" className="flex overflow-x-auto px-1 py-2">
      {stages.map((item, index) => {
        const done = milestoneDone(item);
        const status = item.state === "accepted" ? "已验收" : done ? "阶段已记录" : item.state === "blocked" ? "卡住了" : "待确认";
        return <li key={index} className="relative min-w-28 flex-1">
          {index < stages.length - 1 && <span aria-hidden="true" className={cn("absolute top-[19px] left-1/2 h-px w-full", done ? "bg-positive/50" : "bg-border")}/>}
          <button type="button" aria-expanded={selected === index} aria-controls={selected === index ? detailId : undefined} onClick={() => setSelected(current => current === index ? null : index)} className={cn("relative flex h-full w-full flex-col items-center gap-2 rounded-md px-2 pb-1 text-center text-xs focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", selected === index && "bg-hover/50")}>
            <span aria-hidden="true" className={cn("grid size-10 place-items-center rounded-full border bg-card text-sm", done ? "border-positive/50 text-positive" : "text-muted-foreground", selected === index && "ring-2 ring-ring")}>{done ? "✓" : index + 1}</span>
            <span className="max-w-40 break-words font-medium">{item.title}</span>
            <span className="text-message-muted">{status}</span>
          </button>
        </li>;
      })}
    </ol>
    {stage && <div id={detailId} className="mt-2 space-y-2 rounded-lg border bg-surface p-3 text-xs">
      {stage.sourceTitle && <p className="font-medium">原始记录：{stage.sourceTitle}</p>}
      <p className="whitespace-pre-wrap break-words">{stage.evidence || "暂无详细记录"}</p>
      {roomId && stage.ember_message_id && /^[a-z0-9]{16}$/.test(stage.ember_message_id) && <a className="text-link hover:underline" href={`/rooms/${encodeURIComponent(roomId)}/@${stage.ember_message_id}`}>查看原讨论</a>}
      {onFeedback && selected !== null && <button className="text-link hover:underline" onClick={() => onFeedback(selected)}>提出里程碑反馈</button>}
    </div>}
  </div>;
}

function BusinessModuleTile({module, onFeedback}: {
  module: NonNullable<PulseSnapshot["business"]>["modules"][number];
  onFeedback: (moduleId: string, milestoneId?: string) => void;
}) {
  const total = module.milestones.length;
  const done = module.milestones.filter(milestoneDone).length;
  return <Dialog>
    <DialogTrigger className="flex min-h-20 min-w-0 flex-col justify-between gap-2 rounded-xl border bg-card p-3 text-left hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring">
      <span className="flex w-full items-start justify-between gap-1.5 text-sm font-semibold">
        <span className="min-w-0 wrap-anywhere">{module.name}</span>
        <NavArrowRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground"/>
      </span>
      {total > 0 && <span className="text-sm tabular-nums text-message-muted">
        <span className="sr-only">已记录完成 </span>{done}/{total}<span className="sr-only"> 项</span>
      </span>}
    </DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto overscroll-contain pr-6 sm:max-w-3xl">
      <div className="space-y-1 pr-6">
        <DialogTitle className="text-base font-semibold">{module.name}</DialogTitle>
        <DialogDescription className="text-sm text-message-muted">{module.outcome}</DialogDescription>
      </div>
      <div className="min-w-0 space-y-3 text-sm leading-relaxed">
        <p><strong className="font-medium">什么时候用：</strong>{module.scenario}</p>
        {module.available.length > 0 && <div>
          <h3 className="font-medium">已经做了什么</h3>
          <ul className="mt-1 list-inside list-disc space-y-1 text-message-muted">{module.available.map(title => <li key={title}>{title}</li>)}</ul>
        </div>}
        {module.blockers.length > 0 && <div>
          <h3 className="font-medium">还差什么</h3>
          <ul className="mt-1 list-inside list-disc space-y-1 text-message-muted">{module.blockers.map(title => <li key={title}>{title.replace(/^尚待验证：/, "")}</li>)}</ul>
        </div>}
        <MilestonePipeline stages={module.milestones} onFeedback={module.id === "reported" ? undefined : index => {
          const milestone = module.milestones[index];
          if (milestone) onFeedback(module.id, milestone.id);
        }}/>
        <details>
          <summary className="cursor-pointer font-medium">怎么确认能用？</summary>
          <p className="mt-2">{module.acceptance}</p>
          <p className="mt-2 text-message-muted">{module.help}</p>
        </details>
      </div>
      <button type="button" className="justify-self-start rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-hover" onClick={() => onFeedback(module.id)}>提出反馈</button>
    </DialogContent>
  </Dialog>;
}

export function ProjectBusiness({roomId, data, onFeedback, onDiscussion}: {
  roomId?: string;
  data: PulseSnapshot;
  onFeedback: (moduleId: string, milestoneId?: string) => void;
  onDiscussion: () => void;
}) {
  const business = data.business;
  if (!business) return null;
  const blockers = business.modules.flatMap(m => m.blockers.map(title => ({module: m.name, title})));
  const progress = data.milestone_progress;
  const completed = progress?.completed ?? progress?.accepted ?? 0;
  const stageTitles = new Map(business.modules.filter(module => module.id !== "other")
    .flatMap(module => module.milestones.map(stage => [stage.sourceTitle, stage.title] as const)));
  const projectStages = data.milestones.map(stage => ({
    ...stage,
    sourceTitle: stage.title,
    title: stageTitles.get(stage.title) ?? stage.title,
  }));
  return <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 max-md:px-3 max-md:py-3" aria-label="业务项目总览">
    <div className="mx-auto max-w-5xl space-y-5">
      <ProjectQuickLook data={data} onDiscussion={onDiscussion}/>
      <section aria-label="业务模块">
        <h2 className="mb-2 text-base font-semibold">业务模块</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {business.modules.map(module => <BusinessModuleTile key={module.id} module={module} onFeedback={onFeedback}/>)}
        </div>
      </section>
      <section id="project-milestones" className="rounded-xl border bg-card p-4" aria-label="项目里程碑进度">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">项目里程碑进度</h2>
          {progress && progress.total > 0 && <span className="text-sm tabular-nums text-message-muted">{progress.basis === "reported" ? "阶段记录完成" : "里程碑验收"} {completed}/{progress.total}{completed < progress.total && ` · ${progress.total - completed} 项待确认`}</span>}
        </div>
        <MilestonePipeline roomId={roomId} stages={projectStages}/>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold">项目背景</h2><PulseStatusBadge value={data.project.status}/></div>
        <p className="mt-2 text-sm leading-relaxed">{data.introduction?.background || data.project.goal}</p>
        <p className="mt-2 text-xs text-message-muted">服务对象：{business.audience}</p>
        <p className="mt-2 text-sm leading-relaxed">{business.outcome}</p>
        {data.introduction?.pains.length ? <details className="mt-3 text-xs"><summary className="cursor-pointer text-message-muted">当前痛点与预期价值</summary><ul className="mt-2 list-inside list-disc space-y-1 text-message-muted">{data.introduction.pains.map(p => <li key={p}>{p}</li>)}</ul><p className="mt-2 leading-relaxed">{data.introduction.value}</p></details> : null}
      </section>
      {blockers.length > 0 && <section className="rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">待补记录</h2>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-message-muted">
          {blockers.slice(0, 3).map((blocker, index) => <li key={index}><strong className="text-message-ink">{blocker.module}：</strong>{blocker.title}</li>)}
        </ul>
      </section>}
      <section aria-label="业务交付里程碑"><h2 className="mb-3 text-base font-semibold">交付里程碑</h2><div className="grid items-start gap-3 lg:grid-cols-2">{business.journeys?.map(journey => <details key={journey.id} className="rounded-xl border bg-card p-3"><summary className="cursor-pointer text-xs font-medium"><span>{journey.title}</span><span className="ml-2 inline-block align-middle"><PulseStatusBadge value={journey.state} label={journey.state === "pending" ? "仍有缺口" : journey.state === "awaiting_acceptance" ? "待验收" : undefined}/></span></summary><div className="mt-3 space-y-2 text-xs leading-relaxed"><p>关联模块：{business.modules.filter(m => journey.moduleIds.includes(m.id)).map(m => m.name).join(" → ")}</p><p className="text-message-muted">阶段记录 {journey.recorded}/{journey.total}</p><p><strong>验收条件：</strong>{journey.acceptance}</p><button className="text-link hover:underline" onClick={() => onFeedback(journey.moduleIds[0]!, journey.id)}>对此交付里程碑提供反馈</button></div></details>)}</div></section>
      <details className="border-t pt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">数据来源</summary><div className="mt-2 space-y-2 leading-relaxed"><p>{business.provenance}</p><p className="break-all">{data.source}</p></div></details>
    </div>
  </div>;
}
