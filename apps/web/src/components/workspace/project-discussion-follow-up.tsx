import {useEffect, useState} from "react";
import type {ProjectFollowUp} from "@ember/protocol";
import {FeedbackBadge} from "./project-feedback-panel";

export function ProjectDiscussionFollowUp({roomId, onOpen, onTrack}: {
  roomId: string;
  onOpen: (id: string) => void;
  onTrack: (snapshot: string) => void;
}) {
  const [followUp, setFollowUp] = useState<ProjectFollowUp | null>(null);
  useEffect(() => {
    let request: AbortController | undefined;
    const refresh = async () => {
      if (document.hidden) return;
      request?.abort();
      const current = request = new AbortController();
      try {
        const response = await fetch(`/api/rooms/${roomId}/project/feedback?followUp=1`, {signal: current.signal});
        const value = response.ok ? await response.json() as ProjectFollowUp : null;
        if (!current.signal.aborted) setFollowUp(value);
      } catch {
        if (!current.signal.aborted) setFollowUp(null);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 20_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      request?.abort();
    };
  }, [roomId]);
  if (!followUp?.item && !followUp?.snapshot) return null;
  const {item, snapshot} = followUp;
  return <section aria-label="待跟进" className="flex shrink-0 flex-wrap items-start gap-x-2 gap-y-1 border-b px-4 py-2 text-xs max-md:px-3">
    <h2 className="shrink-0 font-semibold">待跟进</h2>
    <div className="min-w-0 flex-1 break-words">
      <p className="line-clamp-2">{item?.title ?? snapshot}</p>
      {item && <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-message-muted">
        <FeedbackBadge item={item}/><span>{item.assignee ? `执行人 ${item.assignee.name}` : "待分派"}</span>
      </p>}
    </div>
    {item
      ? <button type="button" className="shrink-0 text-link hover:underline" onClick={() => onOpen(item.id)}>查看落实</button>
      : <button type="button" className="shrink-0 text-link hover:underline" onClick={() => onTrack(snapshot!)}>转为跟进事项</button>}
  </section>;
}
