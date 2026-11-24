import { useEffect, useId, useState } from "react";
import { Tabs } from "radix-ui";
import { compactPulseNumber, type PulseSnapshot } from "@ember/protocol";
import { CheckCircle, ClockRotateRight, Group, NavArrowDown, Page, RefreshDouble } from "@/components/icons/iconoir";
import { cn } from "@/lib/utils";
import { PulseStatusBadge } from "./pulse-status";
import {Dialog, DialogContent, DialogTitle, DialogDescription} from "@/components/ui/dialog";

const number = (value: string | null | undefined) => value == null ? "未知" : BigInt(value).toLocaleString("zh-CN");
const time = (value: string | null | undefined) => value ? new Date(value).toLocaleString("zh-CN") : "未提供";
const shortName = (name: string) => name.replace(/\s*[·•]\s*[a-f\d]{8,}$/i, "");
const pullStates: Record<string, string> = {open: "待处理", merged: "已合并", closed: "已关闭"};

function monitorProjectUrl(data: PulseSnapshot) {
  const source = URL.canParse(data.source) ? new URL(data.source) : null;
  if (!source || !["http:", "https:"].includes(source.protocol) || source.pathname !== "/api/v1/dashboard" || source.username || source.password) return null;
  return source.origin + "/#/projects/" + encodeURIComponent(data.project.full_name);
}

function MemberName({name}: {name: string}) {
  const label = shortName(name);
  return <span className="inline-flex min-w-0 items-center gap-1.5" title={name}>
    <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-hover text-[10px] font-semibold text-message-muted">{label.slice(0, 2).toUpperCase()}</span>
    <span className="truncate">{label}</span>
  </span>;
}

function Metric({label, value, note, exact}: {label: string; value: string; note: string; exact?: string}) {
  return <div className="min-w-0 rounded-xl border bg-card px-3 py-2 max-md:px-2.5 max-md:py-1.5">
    <div className="text-[11px] text-muted-foreground">{label}</div>
    <div className="mt-1 truncate text-[21px] leading-tight font-semibold tracking-tight tabular-nums max-md:text-lg" title={exact || value} tabIndex={exact ? 0 : undefined} aria-label={exact ? `${label}：${value}，完整数值 ${exact}` : undefined}>{value}</div>
    <div className="mt-1.5 truncate text-[10px] text-muted-foreground" title={note}>{note}</div>
  </div>;
}

function ProjectDetails({data}: {data: PulseSnapshot}) {
  const reported = data.milestone_progress?.basis === "reported";
  const tabs = [["stages", "阶段证据", data.milestones.length], ["pulls", "产出文档", data.pulls.length], ["people", "成员与活动", data.members.length], ["source", "统计口径", null]] as const;
  const panel = "min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3 pr-1 outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=inactive]:hidden";
  return <Tabs.Root defaultValue="stages" className="flex min-h-0 flex-1 flex-col">
    <Tabs.List aria-label="项目详情" className="flex shrink-0 gap-4 overflow-x-auto border-b max-md:gap-3">
      {tabs.map(([value, title, count]) => <Tabs.Trigger key={value} value={value} className="flex shrink-0 items-center gap-1.5 border-b-2 border-transparent pb-2.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:border-foreground data-[state=active]:font-semibold data-[state=active]:text-foreground">{title}{count !== null && <span className="rounded bg-hover px-1.5 py-0.5 text-[10px] tabular-nums">{count}</span>}</Tabs.Trigger>)}
    </Tabs.List>
    <Tabs.Content value="stages" className={panel}>
      <p className="mb-2 text-[11px] text-muted-foreground">{reported ? "阶段记录完成不等于业务验收；以下保留监控摘要中的证据。" : "以下为已配置的里程碑。"}</p>
      <div className="divide-y">{data.milestones.map((m, i) => {
        const done = ["completed", "accepted"].includes(m.state);
        const Icon = done ? CheckCircle : ClockRotateRight;
        return <div className="flex items-start gap-2.5 py-2.5" key={i}>
          <Icon className={cn("mt-0.5 size-4 shrink-0", done ? "text-positive" : "text-muted-foreground")}/>
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-xs font-medium">{m.title}</span><PulseStatusBadge value={done ? reported ? "recorded" : "accepted" : "pending"} label={!done ? "待完成 / 待确认" : undefined}/></div>{m.evidence && <p className="mt-1 text-xs leading-relaxed text-message-muted">{m.evidence}</p>}{m.due_on && <p className="mt-1 text-[10px] text-muted-foreground">截止日期：{m.due_on}</p>}</div>
        </div>;
      })}</div>
      {!data.milestones.length && <p className="py-4 text-xs text-muted-foreground">暂无里程碑记录。</p>}
    </Tabs.Content>
    <Tabs.Content value="pulls" className={panel}>
      <p className="mb-2 text-[11px] text-muted-foreground">面板当前收录 {data.pulls.length} 份产出；PR 合并不等于上线或业务验收。</p>
      <div className="divide-y">{data.pulls.map(p => <div className="py-2.5" key={p.url}>
        <div className="flex items-start gap-2"><PulseStatusBadge value={p.is_draft ? "draft" : p.state}/>{/^https:\/\/github\.com\//.test(p.url) ? <a className="min-w-0 break-words text-xs font-medium hover:underline" href={p.url} target="_blank" rel="noreferrer">#{p.number} {p.title}</a> : <span className="text-xs">#{p.number} {p.title}</span>}</div>
        <p className="mt-1.5 break-all text-[10px] text-muted-foreground">{p.repository_full_name || data.project.full_name} · {time(p.updated_at)}{p.is_draft && ` · ${pullStates[p.state] || p.state}`}</p>
      </div>)}</div>
      {!data.pulls.length && <p className="py-4 text-xs text-muted-foreground">暂无已采集 PR。</p>}
    </Tabs.Content>
    <Tabs.Content value="people" className={panel}>
      <p className="mb-2 text-[11px] text-muted-foreground">{data.project.owner_basis === "participants" ? "负责人按参与成员展示。" : "以下为项目参与成员。"}</p>
      <div className="flex flex-wrap gap-2">{data.members.map((m, i) => <div className="min-w-0 max-w-full rounded-lg border bg-card px-3 py-2" key={m.developer_id || `${m.display_name}-${i}`}><div className="text-xs font-medium"><MemberName name={m.display_name}/></div><p className="mt-1.5 text-[10px] text-muted-foreground">{m.sessions} 个采集会话 · 最近活跃 {time(m.last_activity_at)}</p></div>)}</div>
      {!data.members.length && <p className="py-3 text-xs text-muted-foreground">暂无参与成员记录。</p>}
      <h3 className="mt-4 text-xs font-semibold">近期研发活动</h3>
      <div className="mt-1 divide-y">{data.activities.map((a, i) => <div className="py-2.5" key={i}><p className="text-[10px] text-muted-foreground">{shortName(a.display_name)} · {time(a.last_activity_at)}</p><p className="mt-1 text-xs font-medium">{a.title || "未命名会话"}</p>{a.summary && <p className="mt-1 text-xs leading-relaxed text-message-muted">{a.summary}</p>}</div>)}</div>
      {!data.activities.length && <p className="py-3 text-xs text-muted-foreground">此窗口暂无已采集活动。</p>}
    </Tabs.Content>
    <Tabs.Content value="source" className={cn(panel, "space-y-2 text-xs leading-relaxed text-message-muted")}>
      <p className="break-all">来源：{data.source}</p><p>查询时间：{time(data.fetched_at)} · 用量更新时间：{time(data.usage.updated_at)}</p>
      <p>{data.window.kind === "calendar-utc8" ? "Token 与活动按所选 UTC+8 自然日窗口统计；PR、参与关系和阶段摘要为面板当前存量。" : "统计为所选时间窗，非生命周期累计。"}</p>
      <p>输入 Token：{number(data.usage.input_tokens)} · 输出 Token：{number(data.usage.output_tokens)} · 缓存输入：{number(data.usage.cached_input_tokens)}（计入输入）</p>
      <p>{data.cost.label}；{data.quota.reason}。</p>
      <div><h3 className="font-medium text-message-ink">模型用量</h3>{data.models.length ? data.models.map((m, i) => <p key={i}>{m.provider || "未知供应商"} / {m.model || "未知模型"} · 输入 {number(m.input_tokens)} / 输出 {number(m.output_tokens)} / 缓存 {number(m.cached_input_tokens)}</p>) : <p>来源未提供此项目的模型用量明细。</p>}</div>
      {data.caveats?.map(caveat => <p key={caveat}>{caveat}</p>)}
    </Tabs.Content>
  </Tabs.Root>;
}

export function ProjectOverview({roomId, onData, compact = false}: {roomId: string; onData?: (data: PulseSnapshot | null) => void; compact?: boolean}) {
  const [data, setData] = useState<PulseSnapshot | null>(null);
  const [error, setError] = useState("");
  const [days, setDays] = useState(7);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  useEffect(() => {onData?.(data);}, [data, onData]);
  useEffect(() => {setData(null); setError(""); setExpanded(false);}, [roomId]);
  useEffect(() => {
    setError(""); setLoading(true);
    const controller = new AbortController();
    let followup: ReturnType<typeof setTimeout> | undefined;
    let bound = false;
    let pending = false;
    const load = async (refresh: boolean, initial = false) => {
      if (controller.signal.aborted || pending) return;
      pending = true;
      try {
        const url = `/api/rooms/${encodeURIComponent(roomId)}/project?days=${days}${refresh ? "&refresh=1" : ""}`;
        const response = await fetch(url, {signal: controller.signal, credentials: "same-origin", cache: "no-store"});
        if (controller.signal.aborted) return;
        if (response.status === 404 || response.status === 403) {
          const missing = response.status === 404 && await response.json().catch(() => null);
          if (controller.signal.aborted) return;
          if (missing?.code === "project_not_reported") {
            bound = true;
            setData(null);
            setError("项目尚未上报到 Project Pulse");
            return;
          }
          bound = false;
          setData(null);
          setError(response.status === 403 ? "没有此项目的数据权限" : "");
          return;
        }
        if (!response.ok) throw new Error("项目数据暂不可用");
        const snapshot = await response.json() as PulseSnapshot | null;
        if (!snapshot?.project || !snapshot.usage || !Array.isArray(snapshot.members)) throw new Error("项目数据格式有误");
        if (controller.signal.aborted) return;
        bound = true;
        setData(snapshot);
        setError("");
        if (initial && snapshot.business && snapshot.freshness?.status === "snapshot") {
          followup = setTimeout(() => {if (!document.hidden) void load(false);}, 9_000);
        }
      } catch (cause) {
        if (!controller.signal.aborted && initial) {
          setData(null);
          setError(cause instanceof Error ? cause.message : "项目数据暂不可用");
        }
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    const refreshVisible = () => {if (bound && !document.hidden) void load(false);};
    void load(revision > 0, true);
    const timer = setInterval(refreshVisible, 60_000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      controller.abort();
      clearTimeout(followup);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [roomId, days, revision]);
  if (error) return <div role="alert" className="flex shrink-0 items-center justify-between border-b px-4 py-2 text-xs">{error}<button className="rounded border px-2 py-1 hover:bg-hover" onClick={() => setRevision(n => n + 1)}>重试</button></div>;
  // Keep the room-header statistics slot visible while loading and on unbound rooms.
  if (!data && compact) return <div role="status" className="ml-auto flex min-h-8 shrink-0 items-center rounded-md border bg-card px-2.5 text-xs text-message-muted">{loading ? "正在加载项目统计…" : "此频道尚未绑定 Project Pulse"}</div>;
  // The full project overview must not gain and then lose a header while the 404 arrives.
  if (!data) return null;
  const progress = data.milestone_progress;
  const reported = progress?.basis === "reported";
  const owners = data.project.owner_basis === "participants" ? data.members.map(member => member.display_name) : data.project.owner ? [data.project.owner.display_name] : [];
  const ownerLabel = owners.map(shortName).join("、") || "暂无参与记录";
  const {input_tokens: input, output_tokens: output} = data.usage;
  const totalTokens = input == null || output == null ? null : (BigInt(input) + BigInt(output)).toString();
  const monitorUrl = monitorProjectUrl(data);
  if (compact) return <Dialog open={expanded} onOpenChange={setExpanded}>
    <div className="ml-auto flex shrink-0 items-center gap-1.5">
      {monitorUrl && <a href={monitorUrl} target="_blank" rel="noreferrer" className="whitespace-nowrap rounded-md px-2 py-1.5 text-xs text-message-muted hover:bg-hover hover:text-message-ink">监控面板 ↗</a>}
    <button className="shrink-0 whitespace-nowrap rounded-md border bg-card px-2.5 py-1.5 text-xs hover:bg-hover" onClick={() => setExpanded(true)}>项目统计</button>
    </div>
    <DialogContent className="flex h-[min(85dvh,680px)] min-h-0 flex-col sm:max-w-3xl"><DialogTitle>项目统计与原始依据</DialogTitle><DialogDescription className="sr-only">项目用量、成员及产出</DialogDescription>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>参与成员：{ownerLabel}</span><div className="flex items-center gap-2"><select aria-label="项目统计时间窗" className="rounded border bg-card px-2 py-1" value={days} onChange={e => setDays(Number(e.target.value))}><option value={1}>近 1 天</option><option value={7}>近 7 天</option><option value={30}>近 30 天</option></select><button className="rounded border px-2 py-1 hover:bg-hover" disabled={loading} onClick={() => setRevision(n => n + 1)}>刷新统计</button></div></div>
      {data.freshness?.status === "snapshot" && <p className="text-xs text-message-muted">快照 · {time(data.freshness.captured_at)}</p>}
      <div className="grid shrink-0 grid-cols-3 gap-2">
        <Metric label="Token 用量" value={compactPulseNumber(totalTokens)} note={`近 ${days} 天`}/>
        <Metric label="待处理 PR" value={String(data.pulls.filter(p => p.state === "open").length)} note={`共 ${data.pulls.length} 份产出`}/>
        <Metric label="阶段记录完成" value={progress ? `${progress.completed ?? progress.accepted}/${progress.total}` : "未配置"} note="采集记录，非业务验收"/>
      </div>
      <ProjectDetails data={data}/>
    </DialogContent>
  </Dialog>;
  return <section aria-label="Project Pulse 项目概览" className="shrink-0 border-b bg-surface text-message-ink">
    <button type="button" aria-label={expanded ? "收起项目统计" : "展开项目统计"} className="flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-md:gap-2 max-md:px-3" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(value => !value)}>
      <Page className="size-4 shrink-0 text-muted-foreground"/><span className="shrink-0 text-xs font-semibold">项目概览</span><PulseStatusBadge value={data.project.status}/>
      {progress && progress.total > 0 && <span className="ml-auto flex min-w-0 items-center gap-2"><span role="progressbar" aria-label="项目阶段记录进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress.completed ?? progress.accepted) / progress.total * 100)} aria-valuetext={`${progress.completed ?? progress.accepted}/${progress.total} 阶段记录完成，非业务验收`} className="h-1.5 w-20 overflow-hidden rounded-full bg-hover max-md:w-10"><span className="block h-full rounded-full bg-positive" style={{width: `${Math.round((progress.completed ?? progress.accepted) / progress.total * 100)}%`}}/></span><span className="text-[11px] tabular-nums">{progress.completed ?? progress.accepted}/{progress.total}</span></span>}
      <span className={cn("flex min-w-0 items-center gap-1.5 text-[11px] text-message-muted", !progress && "ml-auto")} title={`负责人：${owners.join("、") || "暂无参与记录"}`}><Group className="size-3.5 shrink-0"/><span className="max-w-40 truncate max-md:hidden">{ownerLabel}</span></span>
      <span className="shrink-0 text-[11px] text-muted-foreground max-md:sr-only">{expanded ? "收起统计" : "展开统计"}</span><NavArrowDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", expanded && "rotate-180")}/>
    </button>
    {data.freshness?.status === "snapshot" && <p role="status" className="border-t px-4 py-1 text-[10px] text-message-muted max-md:px-3">监控未连接 · {time(data.freshness.captured_at)} 核验快照 · Token 用量未保存，显示未知</p>}
    {data.introduction && <details className="border-t px-4 py-1.5 text-xs max-md:px-3"><summary className="cursor-pointer font-medium">项目背景与痛点</summary><div className="space-y-2 py-2 leading-relaxed text-message-muted"><p>{data.introduction.background}</p><ul className="list-inside list-disc space-y-1">{data.introduction.pains.map(pain => <li key={pain}>{pain}</li>)}</ul><p><strong className="text-message-ink">预期价值：</strong>{data.introduction.value}</p><p className="text-[10px] text-muted-foreground">依据项目目标整理，实施状态以阶段证据为准。</p></div></details>}
    <div id={detailsId} hidden={!expanded}>
      <div className="flex h-[min(44dvh,400px)] min-h-0 flex-col gap-2.5 border-t px-4 py-3 max-md:h-[min(48dvh,390px)] max-md:gap-2 max-md:px-3 max-md:py-2" aria-busy={loading}>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 max-w-full items-center gap-2 text-xs"><span className="shrink-0 text-muted-foreground">负责人</span><span className="min-w-0 break-words font-medium" title={owners.join("、")}>{ownerLabel}</span></div>
          <div className="flex items-center gap-2"><select aria-label="项目统计时间窗" className="h-7 rounded-md border bg-card px-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring" value={days} onChange={e => setDays(Number(e.target.value))}><option value={1}>近 1 天</option><option value={7}>近 7 天</option><option value={30}>近 30 天</option></select><button className="flex size-7 items-center justify-center rounded-md border bg-card text-muted-foreground hover:bg-hover disabled:opacity-50" aria-label="刷新项目统计" title="刷新项目统计" disabled={loading} onClick={() => setRevision(n => n + 1)}><RefreshDouble className={cn("size-3.5", loading && "animate-spin motion-reduce:animate-none")}/></button></div>
        </div>
        <div className="grid shrink-0 grid-cols-4 gap-2 max-md:grid-cols-2">
          <Metric label="Input Tokens" value={compactPulseNumber(data.usage.input_tokens)} exact={number(data.usage.input_tokens)} note={`近 ${days} 天 · Cached ${compactPulseNumber(data.usage.cached_input_tokens)}`}/>
          <Metric label="Output Tokens" value={compactPulseNumber(data.usage.output_tokens)} exact={number(data.usage.output_tokens)} note={`近 ${days} 天输出`}/>
          <Metric label="待处理 PR" value={String(data.pulls.filter(p => p.state === "open").length)} note={`共 ${data.pulls.length} 份产出文档`}/>
          <Metric label={reported ? "阶段记录完成" : "里程碑验收"} value={progress ? `${progress.completed ?? progress.accepted}/${progress.total}` : "未配置"} note={reported ? "采集记录，非业务验收" : "已配置的里程碑"}/>
        </div>
        {data.project.goal && <p className="line-clamp-1 shrink-0 text-xs leading-relaxed text-message-muted max-md:hidden" title={data.project.goal}>{data.project.goal}</p>}
        <ProjectDetails data={data}/>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-2 text-[10px] text-muted-foreground"><span>数据来自 Project Pulse</span><span title={time(data.fetched_at)}>更新于 {new Date(data.fetched_at).toLocaleTimeString("zh-CN", {hour: "2-digit", minute: "2-digit"})}</span></div>
      </div>
    </div>
  </section>;
}
