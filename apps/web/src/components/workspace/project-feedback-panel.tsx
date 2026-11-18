import {useEffect, useRef, useState} from "react";
import {feedbackStatuses, type FeedbackStatus, type FeedbackPage, type FeedbackEvent, type ProjectFeedback, type PulseSnapshot, type Me, type FeedbackAction, type ChangeFeedback, type FeedbackEvidence} from "@ember/protocol";
import {Dialog, DialogContent, DialogTitle, DialogDescription} from "@/components/ui/dialog";
import {PageLink} from "@/components/page-link";
import {clientId} from "@/lib/client-id";

const button = "rounded-md border bg-card px-3 py-1.5 text-xs hover:bg-hover disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring";
const field = "min-w-0 rounded-md border bg-card px-2 py-2 text-sm";
const statusGroups: {label: string; statuses: FeedbackStatus[]}[] = [
  {label: "待评估", statuses: ["submitted"]},
  {label: "推进中", statuses: ["adopted", "in_progress", "blocked"]},
  {label: "待验收", statuses: ["awaiting_acceptance"]},
  {label: "已结束", statuses: ["accepted", "rejected"]},
];
const feedbackPriority: Record<FeedbackStatus, number> = {
  awaiting_acceptance: 0, blocked: 1, submitted: 2, adopted: 3, in_progress: 4, accepted: 5, rejected: 5,
};
const nextStep: Record<FeedbackStatus, string> = {
  awaiting_acceptance: "负责人核对交付依据",
  blocked: "排查卡点后继续落实",
  submitted: "负责人评估是否采纳",
  adopted: "确认执行安排并开始落实",
  in_progress: "完成落实并提交交付依据",
  accepted: "",
  rejected: "",
};
const actions: Record<FeedbackAction, string> = {adopt: "采纳并明确落实", assign: "调整执行安排", start: "开始落实", block: "记录卡点", deliver: "提交产出并申请验收", accept: "确认验收通过", reopen: "退回继续落实", reject: "暂不采纳", comment: "补充信息"};
export interface FeedbackDraft {moduleId: string; milestoneId?: string}
interface Props {roomId: string; data: PulseSnapshot; me: Me; draft?: FeedbackDraft | null; onDraftHandled: () => void; focusId?: string | null}
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {...init, credentials: "same-origin"});
  const value = await response.json().catch(() => {throw new Error("连接中断或服务暂不可用，填写内容已保留，请重试");});
  if (!response.ok) throw new Error(value.error || "操作失败，请稍后重试");
  return value as T;
}
export function FeedbackBadge({item}: {item: ProjectFeedback}) {
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-hover px-2 py-0.5 text-[11px]">{feedbackStatuses[item.status]}{item.demo && <span className="text-muted-foreground">· 流程演示</span>}</span>;
}
export function ProjectFeedbackPanel({roomId, data, me, draft, onDraftHandled, focusId}: Props) {
  const base = `/api/rooms/${roomId}/project/feedback`;
  const [page, setPage] = useState<FeedbackPage | null>(null), [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [filter, setFilter] = useState<(typeof statusGroups)[number] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [detail, setDetail] = useState<{item: ProjectFeedback; events: FeedbackEvent[]; sources?: Array<{id: string; path: string | null}>} | null>(null);
  const [createOpen, setCreateOpen] = useState(false), [title, setTitle] = useState(""), [description, setDescription] = useState("");
  const [moduleId, setModuleId] = useState(data.business?.modules[0]?.id || ""), [milestoneId, setMilestoneId] = useState("");
  const [operation, setOperation] = useState<FeedbackAction | null>(null), [note, setNote] = useState("");
  const [assigneeId, setAssigneeId] = useState(""), [dueOn, setDueOn] = useState(""), [criteria, setCriteria] = useState("");
  const [evidence, setEvidence] = useState<FeedbackEvidence[]>([{label: "", url: ""}]);
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState("");
  const request = useRef<string | null>(null);
  const operationVersion = useRef(0);
  useEffect(() => {if (focusId && /^[a-zA-Z0-9_-]{1,80}$/.test(focusId)) setActive(focusId);}, [focusId]);
  useEffect(() => {const timer = setInterval(() => {if (!document.hidden && !operation && !createOpen && !saving) setRevision(n => n + 1);}, 20_000); return () => clearInterval(timer);}, [operation, createOpen, saving]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    json<FeedbackPage>(base, {signal: controller.signal}).then(value => {if (!controller.signal.aborted) setPage(value);}).catch(cause => {if (!controller.signal.aborted) setError(cause.message);}).finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, [base, revision]);
  useEffect(() => {
    if (!active) {setDetail(null); return;}
    const controller = new AbortController();
    json<{item: ProjectFeedback; events: FeedbackEvent[]}>(`${base}/${active}`, {signal: controller.signal}).then(value => {if (!controller.signal.aborted) setDetail(value);}).catch(cause => {if (!controller.signal.aborted) setError(cause.message);});
    return () => controller.abort();
  }, [active, base, revision]);
  useEffect(() => {
    if (!draft) return;
    setModuleId(draft.moduleId); setMilestoneId(draft.milestoneId || ""); setTitle(""); setDescription(""); setCreateOpen(true); request.current = null; onDraftHandled();
  }, [draft, onDraftHandled]);
  const change = () => {request.current = null; setError("");};
  const module = data.business?.modules.find(m => m.id === moduleId);
  const begin = (action: FeedbackAction) => {
    if (!detail) return;
    operationVersion.current = detail.item.version;
    setOperation(action); setModuleId(detail.item.moduleId); setMilestoneId(detail.item.milestoneId || ""); setAssigneeId(detail.item.assignee?.id || ""); setDueOn(detail.item.dueOn || ""); setCriteria(detail.item.criteria); setNote(""); setEvidence([{label: "", url: ""}]); change();
  };
  const create = async () => {
    setSaving(true); setError(""); request.current ??= clientId();
    try {
      const result = await json<{item: ProjectFeedback}>(base, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({requestId: request.current, title, description, moduleId, milestoneId: milestoneId || null, sourceMessageIds: [], demo: false})});
      setCreateOpen(false); setTitle(""); setDescription(""); setRevision(n => n + 1); setActive(result.item.id); request.current = null; setNotice("已提交，待评估");
    } catch (cause) {setError(cause instanceof Error ? cause.message : "反馈提交失败");} finally {setSaving(false);}
  };
  const update = async () => {
    if (!detail || !operation) return;
    setSaving(true); setError(""); request.current ??= clientId();
    const body: ChangeFeedback = {requestId: request.current, version: operationVersion.current, action: operation, note};
    if (["adopt", "assign"].includes(operation)) Object.assign(body, {moduleId, milestoneId: milestoneId || null, assigneeId: assigneeId || null, dueOn: dueOn || null, criteria});
    if (operation === "deliver") body.evidence = evidence;
    try {
      const result = await json<{item: ProjectFeedback}>(`${base}/${detail.item.id}`, {method: "PATCH", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
      setDetail(previous => previous ? {...previous, item: result.item} : null); setOperation(null); setRevision(n => n + 1); request.current = null; setNotice(`已记录：${actions[operation]}。`);
    } catch (cause) {setError(cause instanceof Error ? cause.message : "更新失败");} finally {setSaving(false);}
  };
  const manage = page?.canManage ?? data.can_adopt ?? false;
  const allowed = (item: ProjectFeedback): FeedbackAction[] => {
    const execute = manage || item.assignee?.id === me.id;
    return [
      ...(manage && item.status === "submitted" ? ["adopt", "reject"] as const : []),
      ...(manage && ["adopted", "in_progress", "blocked"].includes(item.status) ? ["assign"] as const : []),
      ...(execute && ["adopted", "blocked"].includes(item.status) ? ["start"] as const : []),
      ...(execute && item.status === "in_progress" ? ["block", "deliver"] as const : []),
      ...(manage && item.status === "awaiting_acceptance" ? ["accept", "reopen"] as const : []),
      ...(manage && ["accepted", "rejected"].includes(item.status) ? ["reopen"] as const : []),
      "comment",
    ];
  };
  const moduleFields = <div className="grid gap-3 sm:grid-cols-2"><label className="flex flex-col gap-1 text-xs">业务模块<select aria-label="反馈业务模块" className={field} value={moduleId} onChange={e => {setModuleId(e.target.value); setMilestoneId(""); change();}}>{data.business?.modules.filter(m => m.id !== "other").map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label className="flex flex-col gap-1 text-xs">关联里程碑<select aria-label="反馈关联里程碑" className={field} value={milestoneId} onChange={e => {setMilestoneId(e.target.value); change();}}><option value="">整个模块</option><optgroup label="业务交付闭环">{data.business?.journeys?.filter(j => j.moduleIds.includes(moduleId)).map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</optgroup><optgroup label="模块阶段">{module?.milestones.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</optgroup></select></label></div>;
  const visibleItems = page?.items.filter(item => !filter || filter.statuses.includes(item.status))
    .sort((a, b) => feedbackPriority[a.status] - feedbackPriority[b.status]) ?? [];
  return <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 max-md:px-3 max-md:py-3" aria-label="反馈与落实工作台">
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">反馈与落实</h2></div><div className="flex gap-2"><button className={button} onClick={() => setRevision(n => n + 1)}>刷新反馈</button><button className={button} onClick={() => {setCreateOpen(true); setModuleId(data.business?.modules[0]?.id || ""); setMilestoneId(""); setTitle(""); setDescription(""); change();}}>提出反馈</button></div></header>

      <div role="group" aria-label="按状态筛选" className="flex flex-wrap gap-2">
        {statusGroups.map(group => <button key={group.label} className={`${button} ${filter === group ? "ring-1 ring-ring" : ""}`} aria-pressed={filter === group} onClick={() => setFilter(current => current === group ? null : group)}>{group.label}</button>)}
      </div>
      {notice && <p role="status" className="text-xs text-message-muted">{notice}</p>}{error && <p role="alert" className="text-xs text-negative">{error}</p>}
      {loading && <p className="text-xs text-muted-foreground">正在读取反馈…</p>}
      <div className="space-y-2">
        {visibleItems.map(item => <button className="block w-full rounded-xl border bg-card p-4 text-left hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring" key={item.id} onClick={() => {setActive(item.id); setDetail(null); setError("");}}>
          <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-sm font-medium">{item.title}</h3><FeedbackBadge item={item}/></div>
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-message-muted">{item.description}</p>
          {nextStep[item.status] ? <p className="mt-2 text-xs text-muted-foreground">
            {item.assignee ? `执行人 ${item.assignee.name}` : "待分派"} · {nextStep[item.status]}{item.dueOn && ` · ${item.dueOn}`}
          </p> : item.assignee && <p className="mt-2 text-xs text-muted-foreground">执行人 {item.assignee.name}</p>}
        </button>)}
      </div>
      {!loading && page && visibleItems.length === 0 && <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{page.hasMore ? "当前页暂无匹配反馈" : "暂无反馈"}</div>}
      {page?.hasMore && <button className={button} onClick={() => void json<FeedbackPage>(`${base}?before=${page.before}`).then(next => setPage({...next, items: [...page.items, ...next.items]})).catch(cause => setError(cause.message))}>加载更早反馈</button>}
    </div>
    <Dialog open={active !== null} onOpenChange={open => {if (!open && !saving) {setActive(null); setOperation(null); setError("");}}}><DialogContent className="flex max-h-[88dvh] flex-col overflow-y-auto sm:max-w-2xl"><DialogTitle className="pr-5">{detail?.item.title || "反馈详情"}</DialogTitle><DialogDescription className="sr-only">反馈详情与操作记录</DialogDescription>{detail && <>
      <div className="flex flex-wrap items-center gap-2"><FeedbackBadge item={detail.item}/><span className="text-[11px] text-muted-foreground">提出人：{detail.item.createdBy.name} · {new Date(detail.item.createdAt).toLocaleString("zh-CN")}</span></div>
      <p className="text-xs text-message-muted">{data.business?.modules.find(m => m.id === detail.item.moduleId)?.name} · {data.business?.journeys?.find(j => j.id === detail.item.milestoneId)?.title || data.business?.modules.flatMap(m => m.milestones).find(m => m.id === detail.item.milestoneId)?.title || "整个模块"}</p>
      <details><summary className="cursor-pointer text-xs font-medium">反馈内容与方案</summary><p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed">{detail.item.description}</p></details>
      <dl className="grid gap-2 rounded-lg border bg-surface p-3 text-xs"><div>执行人：{detail.item.assignee?.name || "待安排"}</div><div>约定日期：{detail.item.dueOn || "未约定"}</div><div className="whitespace-pre-wrap">验收条件：{detail.item.criteria || "待明确"}</div></dl>
      <div className="space-y-1 text-xs">{detail.item.sourceMessageIds.map((id, index) => {const source = detail.sources?.find(s => s.id === id); return source?.path ? <PageLink key={id} className="mr-3 text-link underline" href={source.path}>原始讨论 {index + 1}</PageLink> : <span key={id} className="mr-3 text-muted-foreground">原始讨论 {index + 1} 已不可用</span>;})}{detail.item.proposalMessageId && <PageLink className="text-link underline" href={`/rooms/${roomId}/@${detail.item.proposalMessageId}`}>采纳方案</PageLink>}</div>
      <div><h3 className="mb-1 text-xs font-semibold">交付依据</h3>{detail.item.evidence.length ? detail.item.evidence.map((e, i) => <a key={i} className="mr-3 block break-all text-xs text-link underline" href={e.url} target="_blank" rel="noreferrer">{e.label}</a>) : <p className="text-xs text-muted-foreground">暂无交付依据</p>}</div>
      <div className="flex flex-wrap gap-2">{allowed(detail.item).map(action => <button key={action} className={button} onClick={() => begin(action)}>{actions[action]}</button>)}</div>
      <details><summary className="cursor-pointer text-xs font-semibold">操作与验收记录（{detail.events.length}）</summary><ol className="mt-2 space-y-3 border-l pl-3">{detail.events.map(event => <li key={event.id} className="text-xs"><p><strong>{event.actor.name}</strong> · {event.from ? `${feedbackStatuses[event.from]} → ` : ""}{feedbackStatuses[event.to]}</p><p className="mt-1 whitespace-pre-wrap text-message-muted">{event.note}</p><time className="text-[10px] text-muted-foreground">{new Date(event.at).toLocaleString("zh-CN")}</time></li>)}</ol></details>
    </>}</DialogContent></Dialog>
    <Dialog open={createOpen} onOpenChange={open => {if (!saving) setCreateOpen(open);}}><DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-xl"><DialogTitle>提出项目反馈</DialogTitle><DialogDescription className="sr-only">填写项目反馈</DialogDescription>{moduleFields}<label className="flex flex-col gap-1 text-xs">反馈标题<input className={field} maxLength={160} value={title} onChange={e => {setTitle(e.target.value); change();}}/></label><label className="flex flex-col gap-1 text-xs">问题与期望<textarea className={`${field} min-h-28`} maxLength={6000} value={description} onChange={e => {setDescription(e.target.value); change();}} placeholder="在哪个场景遇到什么问题？希望怎么改？能提供什么信息？"/></label>{error && <p role="alert" className="text-xs text-negative">{error}</p>}<button className={button} disabled={saving || !title.trim() || !description.trim()} onClick={() => void create()}>{saving ? "正在提交…" : "提交反馈"}</button></DialogContent></Dialog>
    <Dialog open={operation !== null} onOpenChange={open => {if (!open && !saving) {setOperation(null); setError("");}}}><DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-xl"><DialogTitle>{operation ? actions[operation] : "更新反馈"}</DialogTitle><DialogDescription className="sr-only">记录执行安排与交付结果</DialogDescription>
      {operation && ["adopt", "assign"].includes(operation) && <>{moduleFields}<label className="flex flex-col gap-1 text-xs">执行人<select aria-label="反馈执行人" className={field} value={assigneeId} onChange={e => {setAssigneeId(e.target.value); change();}}><option value="">请选择执行人</option>{data.team?.members.filter(m => !m.bot).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label className="flex flex-col gap-1 text-xs">约定日期（可选）<input type="date" className={field} value={dueOn} onChange={e => {setDueOn(e.target.value); change();}}/></label><label className="flex flex-col gap-1 text-xs">验收条件<textarea className={`${field} min-h-20`} maxLength={4000} value={criteria} onChange={e => {setCriteria(e.target.value); change();}} placeholder="明确怎样才算解决，谁提供哪些样本或验证依据。"/></label></>}
      {operation === "deliver" && <div className="space-y-2"><p className="text-xs font-medium">产出或验证记录（至少一条）</p>{evidence.map((entry, index) => <div key={index} className="grid gap-2"><input aria-label={`证据名称 ${index + 1}`} className={field} placeholder="PR、交付文档或验证记录的名称" maxLength={160} value={entry.label} onChange={e => {setEvidence(previous => previous.map((old, i) => i === index ? {...old, label: e.target.value} : old)); change();}}/><input aria-label={`证据链接 ${index + 1}`} className={field} placeholder="https://… 或本项目讨论链接" maxLength={2000} value={entry.url} onChange={e => {setEvidence(previous => previous.map((old, i) => i === index ? {...old, url: e.target.value} : old)); change();}}/></div>)}{evidence.length < 10 && <button className={button} onClick={() => setEvidence(previous => [...previous, {label: "", url: ""}])}>添加一条交付依据</button>}</div>}
      <label className="flex flex-col gap-1 text-xs">本次操作说明<textarea className={`${field} min-h-20`} maxLength={4000} value={note} onChange={e => {setNote(e.target.value); change();}} placeholder={operation === "accept" ? "实际检查了哪些条件？结果与证据是什么？" : "说明本次安排、卡点、交付范围或补充信息。"}/></label>{error && <p role="alert" className="text-xs text-negative">{error}</p>}<button className={button} disabled={saving || !note.trim()} onClick={() => void update()}>{saving ? "正在保存…" : "确认并记录"}</button>
    </DialogContent></Dialog>
  </div>;
}
