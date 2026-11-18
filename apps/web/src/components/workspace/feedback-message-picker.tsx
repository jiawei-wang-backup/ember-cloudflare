import {useEffect, useState} from "react";
import {threadPath, type FeedbackEvidence, type Message, type PulseMessagePage, type PulseTeam} from "@ember/protocol";

export function FeedbackMessagePicker({roomId, members, existing, onAdd, onClose}: {
  roomId: string; members: PulseTeam["members"]; existing: FeedbackEvidence[];
  onAdd: (items: FeedbackEvidence[]) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState(""), [sender, setSender] = useState("");
  const [before, setBefore] = useState(""), [retry, setRetry] = useState(0);
  const [page, setPage] = useState<PulseMessagePage | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [selected, setSelected] = useState<FeedbackEvidence[]>([]);
  const capacity = 10 - existing.filter(entry => entry.label.trim() || entry.url.trim()).length;
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (sender === "bot" || sender === "me") params.set("kind", sender);
    else if (sender) params.set("author", sender);
    if (before) params.set("before", before);
    setBusy(true); setError("");
    fetch(`/api/rooms/${roomId}/project/messages?${params}`, {signal: controller.signal})
      .then(async response => {
        if (!response.ok) throw new Error();
        const next = await response.json() as PulseMessagePage;
        if (!controller.signal.aborted) setPage(previous => ({
          ...next, messages: [...(before ? previous?.messages ?? [] : []), ...next.messages.slice().reverse()],
        }));
      }).catch(() => {if (!controller.signal.aborted) setError("聊天记录读取失败");})
      .finally(() => {if (!controller.signal.aborted) setBusy(false);});
    return () => controller.abort();
  }, [roomId, sender, before, retry]);

  const keyword = query.trim().toLowerCase();
  const messages = page?.messages.filter(m => !m.deleted && (m.plainText + " " + m.creator.name).toLowerCase().includes(keyword)) ?? [];
  const urlOf = (m: Message) => m.parentId ? threadPath(m.roomId, m.parentId, m.id) : `/rooms/${m.roomId}/@${m.id}`;
  return <section aria-label="选择聊天记录" className="space-y-2 rounded-lg border p-3">
    <div className="flex flex-wrap gap-2">
      <input autoFocus aria-label="搜索聊天记录" placeholder="搜索消息或发言人" value={query} onChange={e => setQuery(e.target.value)} className="min-w-28 flex-1 rounded-md border bg-card px-2 py-1.5 text-sm"/>
      <select aria-label="筛选聊天记录发言人" className="max-w-full rounded-md border bg-card px-2 text-xs" value={sender} onChange={e => {setSender(e.target.value); setBefore(""); setPage(null);}}>
        <option value="">全部发言人</option><option value="bot">机器人</option><option value="me">我发的</option>
        {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </div>
    <div className="max-h-52 divide-y overflow-auto">
      {messages.map(m => {
        const url = urlOf(m);
        const added = existing.some(entry => entry.url === url);
        const checked = selected.some(entry => entry.url === url);
        const title = m.plainText.trim().split("\n")[0] || m.attachment?.name || "聊天消息";
        return <label key={m.id} className="flex items-start gap-2 py-2 text-sm">
          <input type="checkbox" checked={added || checked} disabled={added || (!checked && selected.length >= capacity)} onChange={() => setSelected(prev => checked ? prev.filter(entry => entry.url !== url) : [...prev, {url, label: title.slice(0, 160)}])}/>
          <span className="min-w-0"><span className="block text-xs text-message-muted">{m.creator.name} · {new Date(m.createdAt).toLocaleDateString("zh-CN")}</span><span className="line-clamp-2 wrap-anywhere">{title}</span></span>
        </label>;
      })}
      {!busy && !error && !messages.length && <p className="py-3 text-xs text-muted-foreground">当前记录中没有匹配的消息</p>}
      {error && <button type="button" onClick={() => setRetry(n => n + 1)} className="text-xs text-link">{error} · 重试</button>}
      {busy && <p role="status" className="text-xs text-muted-foreground">正在读取…</p>}
      {!busy && !error && page?.hasMore && page.before && <button type="button" onClick={() => setBefore(page.before!)} className="py-2 text-xs text-link">查看更早消息</button>}
    </div>
    <div className="flex justify-end gap-3 text-xs"><button type="button" onClick={onClose}>取消</button><button type="button" className="rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-40" disabled={!selected.length} onClick={() => onAdd(selected)}>添加所选（{selected.length}）</button></div>
  </section>;
}
