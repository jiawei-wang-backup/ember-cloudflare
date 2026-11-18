import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Me, Message, PulseAdoptionAnswer, PulseMessagePage, PulseSnapshot } from "@ember/protocol";
import { clientId } from "@/lib/client-id";
import { ProjectChatContext, type ProjectSelection } from "./project-chat-context";
import { MessageItem, type MessageActions, type MessageEditors } from "./message-item";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {Popover, PopoverTrigger, PopoverContent} from "@/components/ui/popover";

interface Props {
  roomId: string; data: PulseSnapshot | null; me: Me; children: ReactNode;
  actions: MessageActions | null; editors: MessageEditors;
  onSelectionChange?: (selection: ProjectSelection | null) => void;
  onAdopted?: (id: string) => void;
}

export function filterDate(date: string, following = false): string | undefined {
  if (!date) return undefined;
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d! + (following ? 1 : 0)).toISOString();
}

export function ProjectChatTools({roomId, data, me, children, actions, editors, onSelectionChange, onAdopted}: Props) {
  const [kind, setKind] = useState("all"), [author, setAuthor] = useState("");
  const [since, setSince] = useState(""), [until, setUntil] = useState("");
  const [filterOpen, setFilterOpen] = useState(false), [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlyMap<string, Message>>(new Map());
  const [results, setResults] = useState<PulseMessagePage | null>(null), [loading, setLoading] = useState(false);
  const [error, setError] = useState(""), [adoptOpen, setAdoptOpen] = useState(false), [note, setNote] = useState("");
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState("");
  const [moduleId, setModuleId] = useState(data?.business?.modules[0]?.id || "");
  const requestId = useRef<string | null>(null);
  const [more, setMore] = useState<string | null>(null);
  const active = kind !== "all" || author !== "" || since !== "" || until !== "";
  const canAdopt = !!data && (data.can_adopt ?? me.administrator);
  useEffect(() => {
    if (!active) {setResults(null); setError(""); return;}
    if (since && until && since > until) {setError("开始日期不能晚于结束日期"); setResults(null); return;}
    const controller = new AbortController();
    const params = new URLSearchParams({kind: kind === "adopted" ? "all" : kind});
    if (kind === "adopted") params.set("adopted", "1");
    if (author) params.set("author", author);
    if (since) params.set("since", filterDate(since)!);
    if (until) params.set("until", filterDate(until, true)!);
    if (more) params.set("before", more);
    setLoading(true); setError("");
    fetch(`/api/rooms/${roomId}/project/messages?${params}`, {signal: controller.signal, credentials: "same-origin"}).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "筛选失败");
      if (!controller.signal.aborted) setResults(previous => more && previous ? {...value, messages: [...value.messages, ...previous.messages].filter((m, i, all) => all.findIndex(other => other.id === m.id) === i)} : value);
    }).catch(cause => {if (!controller.signal.aborted) setError(cause.message);}).finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, [roomId, active, kind, author, since, until, more]);
  const resetCursor = () => {setMore(null); setResults(null);};
  const toggle = useCallback((message: Message) => {
    setSelected(previous => {
      const next = new Map(previous);
      if (next.has(message.id)) next.delete(message.id);
      else if (next.size < 20) next.set(message.id, message);
      return next;
    });
    requestId.current = null;
  }, []);
  const adoptOne = useCallback((message: Message) => {setSelected(new Map([[message.id, message]])); setSelecting(true); setAdoptOpen(true); setError(""); requestId.current = null;}, []);
  const addOne = useCallback((message: Message) => {setSelecting(true); setSelected(previous => {const next = new Map(previous); if (next.size < 20) next.set(message.id, message); return next;}); requestId.current = null;}, []);
  const selection = useMemo(() => canAdopt ? {selected, toggle, active: selecting, adopt: adoptOne, add: addOne} : null, [selected, selecting, canAdopt, toggle, adoptOne, addOne]);
  useEffect(() => {onSelectionChange?.(selection);}, [selection, onSelectionChange]);
  useEffect(() => () => onSelectionChange?.(null), [onSelectionChange]);
  const adopt = async () => {
    if (saving || !selected.size) return;
    setSaving(true); setError("");
    requestId.current ??= clientId();
    try {
      const response = await fetch(`/api/rooms/${roomId}/project/adoptions`, {method: "POST", headers: {"Content-Type": "application/json"}, credentials: "same-origin", body: JSON.stringify({messageIds: [...selected.keys()], note, clientMessageId: requestId.current, ...(moduleId ? {moduleId} : {})})});
      const value = await response.json().catch(() => {throw new Error("连接中断，已选讨论和采纳说明已保留，请重试");}) as PulseAdoptionAnswer & {error?: string};
      if (!response.ok) throw new Error(value.error || "采纳失败");
      setAdoptOpen(false); setSelected(new Map()); setSelecting(false); setNote(""); requestId.current = null;
      setNotice(value.warning || (value.mode === "llm" ? "已采纳，AI 优化方案已发布到本项目，状态为待执行。" : "已采纳，结构化优化清单已发布到本项目。当前没有可用 LLM，未调用模型。"));
      if (active) {resetCursor(); setKind("adopted"); setAuthor(""); setSince(""); setUntil("");}
      if (value.feedback) onAdopted?.(value.feedback.id);
    } catch (cause) {setError(cause instanceof Error ? cause.message : "采纳失败，选择已保留，请重试");}
    finally {setSaving(false);}
  };
  const button = "rounded-md border bg-card px-2.5 py-1.5 text-xs hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring";
  const field = "min-w-0 rounded-md border bg-card px-2 py-1.5 text-xs text-message-ink";
  if (!data) return <>{children}</>;
  return <ProjectChatContext value={selection}>
    <div className="shrink-0 space-y-2 border-b bg-surface px-4 py-2 max-md:px-3">
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={filterOpen} onOpenChange={setFilterOpen}><PopoverTrigger asChild><button className={button} aria-expanded={filterOpen}>筛选消息{active ? " · 已启用" : ""}</button></PopoverTrigger><PopoverContent align="start" className="w-[min(640px,calc(100vw-24px))]">
          <div className="mb-3 flex items-center justify-between"><strong className="text-sm">筛选项目讨论</strong><button className="text-xs text-link" onClick={() => setFilterOpen(false)}>完成筛选</button></div>
          <div className="grid grid-cols-2 gap-3" aria-label="项目消息筛选">
            <label className="flex flex-col gap-1 text-xs">消息类型<select aria-label="消息类型" className={field} value={kind} onChange={e => {resetCursor(); setKind(e.target.value);}}><option value="all">全部消息</option><option value="bot">只看 Bot</option><option value="me">只看自己</option><option value="adopted">已采纳方案</option></select></label>
            <label className="flex flex-col gap-1 text-xs">发言人<select aria-label="发言人" className={field} value={author} onChange={e => {resetCursor(); setAuthor(e.target.value);}}><option value="">全部发言人</option>{data.team?.members.map(m => <option key={m.id} value={m.id}>{m.name}{m.bot ? " · Bot" : ""}</option>)}</select></label>
            <label className="flex min-w-0 flex-col gap-1 text-xs">开始日期<input type="date" className={field} value={since} onChange={e => {resetCursor(); setSince(e.target.value);}}/></label>
            <label className="flex min-w-0 flex-col gap-1 text-xs">结束日期<input type="date" className={field} value={until} min={since || undefined} onChange={e => {resetCursor(); setUntil(e.target.value);}}/></label>
          </div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] text-muted-foreground">按本机时区，含结束当天；可继续读取更早历史。</span><button className={button} onClick={() => {resetCursor(); setKind("all"); setAuthor(""); setSince(""); setUntil("");}}>清除筛选</button></div>
        </PopoverContent></Popover>
        <button className={button} onClick={() => {resetCursor(); setFilterOpen(true); setKind("adopted"); setAuthor(""); setSince(""); setUntil("");}}>采纳方案</button>
        {canAdopt && <button className={button} aria-pressed={selecting} onClick={() => {setSelecting(v => !v); setSelected(new Map()); setError("");}}> {selecting ? "退出选择" : "选择讨论并采纳"}</button>}
        {selecting && <><span className="text-xs text-muted-foreground">已选 {selected.size}/20</span><button className={cn(button, "ml-auto bg-primary text-primary-foreground disabled:opacity-40")} disabled={!selected.size} onClick={() => {setAdoptOpen(true); setError("");}}>采纳并生成方案</button></>}
      </div>
      {active && <p className="text-[10px] text-muted-foreground">当前筛选：{kind === "all" ? "全部类型" : kind === "bot" ? "Bot" : kind === "me" ? "自己" : "已采纳方案"}{author ? ` · ${data.team?.members.find(m => m.id === author)?.name || "指定成员"}` : ""}{since || until ? ` · ${since || "不限开始"} 至 ${until || "不限结束"}` : ""}<button className="ml-2 text-link underline" onClick={() => {resetCursor(); setKind("all"); setAuthor(""); setSince(""); setUntil("");}}>清除</button></p>}
      {notice && <p role="status" className="text-xs text-message-muted">{notice}<button className="ml-2 underline" onClick={() => setNotice("")}>关闭</button></p>}
      {error && <p role="alert" className="text-xs text-negative">{error}</p>}
    </div>
    {active ? <div role="log" aria-label="项目消息筛选结果" aria-busy={loading} className="min-h-0 flex-1 overflow-y-auto py-3">
      <p className="px-4 pb-3 text-xs text-muted-foreground">已找到 {results?.messages.length ?? 0} 条{results?.hasMore ? "，可继续筛选更早历史" : ""}{loading ? " · 正在筛选…" : ""}</p>
      {results?.hasMore && <button className={cn(button, "mx-4 mb-3")} disabled={loading} onClick={() => setMore(results.before)}>继续筛选更早消息</button>}
      {results?.messages.map(message => <MessageItem key={message.id} message={message} me={me} threaded={false} editing={false} actions={actions} editors={editors}/>)}
      {!loading && results && !results.messages.length && <p className="p-5 text-center text-sm text-muted-foreground">当前历史页没有符合条件的消息。{results.hasMore ? "可继续检查更早历史。" : "请调整筛选条件。"}</p>}
    </div> : children}
    <Dialog open={adoptOpen} onOpenChange={open => {if (!saving) setAdoptOpen(open);}}><DialogContent showCloseButton={!saving} className="flex max-h-[85dvh] flex-col gap-3 overflow-y-auto p-4 sm:max-w-xl">
        <DialogTitle className="pr-6 text-base font-semibold">采纳讨论，生成项目优化方案</DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">已选 {selected.size} 条讨论，生成方案后安排落实。</DialogDescription>
        <div className="max-h-48 overflow-y-auto rounded-lg border p-3">{[...selected.values()].map(m => <p className="mb-2 text-xs leading-relaxed" key={m.id}><strong>{m.creator.name}：</strong>{m.plainText.slice(0, 260)}</p>)}</div>
        {data.business && <label className="flex flex-col gap-1 text-xs">关联业务模块<select aria-label="采纳业务模块" className={field} value={moduleId} onChange={e => {setModuleId(e.target.value); requestId.current = null;}}>{data.business.modules.filter(m => m.id !== "other").map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
        <label className="flex flex-col gap-1 text-xs">采纳说明<textarea autoFocus className="min-h-20 rounded-md border bg-card p-2" maxLength={1000} placeholder="补充希望解决的问题或验收重点（可选）" value={note} disabled={saving} onChange={e => {setNote(e.target.value); requestId.current = null;}}/></label>
        {error && <p role="alert" className="text-xs text-negative">{error}</p>}
        <div className="flex justify-end gap-2"><button className={button} disabled={saving} onClick={() => setAdoptOpen(false)}>取消</button><button className={cn(button, "bg-primary text-primary-foreground disabled:opacity-50")} disabled={saving} onClick={() => void adopt()}>{saving ? "正在生成并发布…" : "确认采纳并发布方案"}</button></div>
    </DialogContent></Dialog>
  </ProjectChatContext>;
}
