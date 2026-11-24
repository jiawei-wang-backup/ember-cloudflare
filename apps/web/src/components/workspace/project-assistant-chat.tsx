import {useEffect, useRef, useState, type FormEvent} from "react";
import {displayBody} from "@ember/richtext/dom";
import type {User} from "@ember/protocol";
import {Xmark} from "@/components/icons/iconoir";
import {PageLink} from "@/components/page-link";
import {UserAvatar} from "./user-avatar";
import {MessageBody} from "./message-body";

const questions = ["项目现在怎么样？", "项目还差什么？", "已经做完了什么？"];
type Reference = {text: string; author: string; link: string};
export type AssistantTurn = {id: number; question: string; html: string; requiresPulseGrant?: boolean; shared?: boolean};
export type ProjectQuickAnswer = Pick<AssistantTurn, "question" | "html" | "requiresPulseGrant">;

export function ProjectAssistantChat({roomId, turns, onAnswer, onShared, onShare, shareDisabled, onDiscussion, me, bot, reference, onClearReference}: {
  roomId: string;
  me: User;
  bot?: User;
  reference: Reference | null;
  onClearReference: () => void;
  turns: AssistantTurn[];
  onAnswer: (answer: ProjectQuickAnswer) => void;
  onShared: (id: number) => void;
  onShare: (answer: ProjectQuickAnswer) => Promise<void>;
  shareDisabled?: boolean;
  onDiscussion: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState<number | null>(null);
  const request = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {if (reference) input.current?.focus();}, [reference?.link]);
  const timeline = useRef<HTMLDivElement>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {if (timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight;}, [turns, pending]);

  async function ask(value: string) {
    const question = value.trim();
    if (!question || request.current || question.length > 1200) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(question);
    setError("");
    try {
      const context = turns.slice(-4).map(turn => {
        const answer = new DOMParser().parseFromString(turn.html, "text/html").body.textContent;
        return "问：" + turn.question + "\n答：" + answer;
      }).join("\n").slice(-4800);
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/project/assistant-chat`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
        body: JSON.stringify({question, context, reference: reference?.text.slice(0, 600)}),
      });
      const result = await response.json().catch(() => ({})) as {html?: string; error?: string; requiresPulseGrant?: boolean};
      if (!response.ok || !result.html) throw new Error(result.error || "项目助手暂未答复，请重试");
      if (!controller.signal.aborted) {
        onAnswer({question, html: result.html, ...(result.requiresPulseGrant && {requiresPulseGrant:true})});
        if (reference) onClearReference();
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setDraft(question);
        setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "项目助手暂未答复，请重试");
      }
    } finally {
      if (!controller.signal.aborted) {request.current = null; setPending("");}
    }
  }

  async function share(turn: AssistantTurn) {
    if (sharing !== null || turn.shared) return;
    setSharing(turn.id);
    setError("");
    try {await onShare(turn); onShared(turn.id);}
    catch (cause) {setError(cause instanceof Error ? cause.message : "发送失败，请重试");}
    finally {setSharing(null);}
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || pending) return;
    void ask(draft);
    setDraft("");
  }

  const avatar = (user: User) => <UserAvatar user={user} className="size-8" label={user.name}/>;
  const assistant = bot ?? {id: "project-assistant", name: "项目助手"};
  const questionRow = (question: string) => <div className="flex justify-end gap-2.5">
    <p className="max-w-[85%] rounded-2xl bg-surface px-4 py-2 text-sm wrap-anywhere">{question}</p>
    {avatar(me)}
  </div>;
  const started = turns.length > 0 || Boolean(pending);

  return <section className="flex min-h-0 flex-1 flex-col" aria-label="项目助手">
    <div ref={timeline} role="log" aria-label="助手对话" aria-busy={Boolean(pending)}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
        {!started && <div className="my-auto pb-8">
          <h2 className="mb-4 text-xl font-semibold">想了解项目的哪一方面？</h2>
          <div className="flex flex-wrap gap-2">
            {questions.map(question => <button key={question} type="button" onClick={() => void ask(question)}
              className="rounded-full border px-3.5 py-2 text-sm hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring">{question}</button>)}
          </div>
        </div>}
        {turns.map(turn => <div key={turn.id} className="space-y-3">
          {questionRow(turn.question)}
          <div className="flex items-start gap-2.5">
            {avatar(assistant)}
            <div className="min-w-0 flex-1 space-y-2">
              <MessageBody nodes={displayBody(turn.html, "", location.hostname)} mentions={[]} className="text-sm leading-relaxed wrap-anywhere"/>
              {turn.shared ? <p className="text-xs text-message-muted">已发到讨论 · <button type="button" className="text-link underline" onClick={onDiscussion}>查看讨论</button></p>
                : <button type="button" disabled={shareDisabled || sharing !== null} onClick={() => void share(turn)}
                  className="rounded-md px-2 py-1.5 text-xs text-message-muted hover:bg-hover hover:text-foreground disabled:opacity-50">{sharing === turn.id ? "正在发送…" : "发到讨论"}</button>}
            </div>
          </div>
        </div>)}
        {pending && <div className="space-y-3">
          {questionRow(pending)}
          <div className="flex items-center gap-2.5">{avatar(assistant)}<p role="status" className="text-xs text-message-muted">正在查看项目资料…</p></div>
        </div>}
      </div>
    </div>
    <form onSubmit={submit} className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4 sm:px-6">
      {error && <p role="alert" className="mb-2 text-xs text-negative">{error}</p>}
      {reference && <div className="mb-2 flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-xs">
        <PageLink href={reference.link} className="min-w-0 flex-1 truncate text-message-muted">引用 {reference.author} · {reference.text}</PageLink>
        <button type="button" disabled={Boolean(pending)} aria-label="移除引用" onClick={onClearReference} className="rounded p-1 hover:bg-hover"><Xmark className="size-4"/></button>
      </div>}
      <div className="flex gap-2 rounded-xl border bg-card p-1.5 focus-within:ring-2 focus-within:ring-ring">
        <input ref={input} aria-label="向项目助手提问" placeholder="问问进度、卡点或下一步" value={draft} onChange={event => setDraft(event.target.value)}
          disabled={Boolean(pending)} maxLength={1200} className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none"/>
        <button type="submit" disabled={!draft.trim() || Boolean(pending)} className="shrink-0 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">发送</button>
      </div>
    </form>
  </section>;
}
