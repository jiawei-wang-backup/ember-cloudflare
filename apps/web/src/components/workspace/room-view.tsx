import { useContext, useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { Favorites, Invitation, Involvement, Me, Message, PulseSnapshot } from "@ember/protocol";
import { MENTION_CONTENT_TYPE, mentionContent } from "@ember/richtext/dom";
import { MainContent } from "@/components/main-content";
import { PeopleContext, useNameOf } from "@/hooks/use-directory";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMessageEditors } from "@/hooks/use-message-editors";
import { useRoom } from "@/hooks/use-room";
import { useVisit, navigate, permalinkOf } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import type { Room } from "@/lib/api";
import { roomName } from "@/lib/directs";
import { rememberLastRoom } from "@/lib/last-room";
import { projectRoomView, rememberProjectRoomView, type ProjectRoomView } from "@/lib/project-room-view";
import { newestWrittenBy } from "@/lib/messages";
import type { RoomAnswer } from "@/lib/room-list";
import { isPending } from "@/lib/room-state";
import { Composer, RoomDeleted, type ComposerHandle } from "./composer";
import { MessageList } from "./message-list";
import { RoomHeader } from "./room-header";
import { RoomNotice } from "./room-notice";
import { useAccount } from "@/hooks/use-account";
import { ProjectOverview } from "./project-overview";
import { ThreadPanel } from "./thread-panel";
import { ProjectChatTools } from "./project-chat-tools";
import { ProjectAssistantContext, ProjectChatContext, ProjectFeedbackNavigation, type ProjectSelection } from "./project-chat-context";
import {ProjectBusiness} from "./project-business";
import {projectSnapshotSections} from "./project-quick-look";
import {ProjectAssistantChat, type AssistantTurn, type ProjectQuickAnswer} from "./project-assistant-chat";
import {ProjectFeedbackPanel, type FeedbackDraft} from "./project-feedback-panel";
import {ProjectDiscussionFollowUp} from "./project-discussion-follow-up";

/** Where a thread covers its room, rather than showing beside it: below 1180px wide. */
const THREAD_COVERS_ROOM = "(width < 73.75rem)";

interface Props {
  room: Room;
  /** The message whose permalink the address is, which the timeline goes to. */
  messageId?: string;
  /** The message whose thread the address opens beside the room. */
  threadId?: string;
  /** The reply whose permalink the address is, which the thread goes to. */
  replyId?: string;
  /** The welcome card's invitation, when this is the room it's in. */
  invitation: Invitation | null;
  /** Dismisses the welcome card for good, settling once it's gone, or failed to go. */
  onDismissInvitation: () => Promise<void>;
  me: Me;
  /** Whether this person has starred the room. */
  favorite: boolean;
  /** Whether the workspace socket has said the room is gone for this person, as it can before the room's own socket does. */
  gone: boolean;
  /** Called with this person's stars once the room's star saves them. */
  onStarred: (favorites: Favorites) => void;
  /** This person's notification level in the room. */
  involvement: Involvement;
  /** When the room was marked unread as of when it was opened, which the timeline draws a New line at, or null. */
  newSince?: string | null;
  /** Called as its bell saves this person's level in the room, with what gives the room the level the server answers. */
  askForRoom: () => (answer: RoomAnswer) => void;
  onSessionChanged: (me: Me | null) => void;
  /** Says why the room's bell couldn't save a level, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
  /** When the room turns out to be gone for this person: deleted, or no longer theirs. */
  onGone: (room: Room) => void;
  ref?: Ref<RoomViewHandle>;
}

export interface RoomViewHandle {
  /** Gives the composer focus, as opening the room does, except on touch screens. */
  focusComposer(): void;
}

export function RoomView({ room, messageId, threadId, replyId, invitation, onDismissInvitation, me, favorite, gone, onStarred, involvement, newSince = null, askForRoom, onSessionChanged, onFailed, onGone, ref }: Props) {
  const projectWorkspace = useAccount().name === "Project Pulse · 研发协作中心" ||
    (room.kind !== "direct" && room.channelGroup === "project");
  const [project, setProject] = useState<PulseSnapshot | null>(null);
  const [selection, setSelection] = useState<ProjectSelection | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState<FeedbackDraft | null>(null);
  // The project endpoint has already authenticated this room and resolved its repository binding.
  const currentProject = projectWorkspace && room.kind !== "direct" ? project : null;
  const assistantEnabled = projectWorkspace && room.kind !== "direct" &&
    (room.channelGroup === "project" || Boolean(currentProject?.business));
  const owner = currentProject?.team?.owner;
  const followUp = currentProject && currentProject.project.status !== "completed" &&
    projectSnapshotSections(currentProject).sections.get("下一步");
  const [mentionOwner, setMentionOwner] = useState(false);
  const [assistantTurns, setAssistantTurns] = useState<AssistantTurn[]>([]);
  const [assistantMessage, setAssistantMessage] = useState<Message | null>(null);
  const people = useContext(PeopleContext);
  const ownerProfile = owner && people.get(owner.id);
  const assistantBot = assistantEnabled ? [...people.values()].find(person => person.role === "bot" && person.name === "项目助手") : undefined;
  const nextAssistantTurn = useRef(0);
  useEffect(() => {setProject(null); setFeedbackDraft(null); setAssistantTurns([]); setAssistantMessage(null);}, [room.id]);
  const visit = useVisit();
  const view = projectRoomView(room.id, me.id, location.search, Boolean(messageId || threadId));
  const roomPath = `/rooms/${room.id}`;
  const overviewPath = `${roomPath}?view=overview`;
  const openFeedback = (id: string) => {
    rememberProjectRoomView(room.id, me.id, "feedback");
    navigate(`${roomPath}?view=feedback&feedback=${encodeURIComponent(id)}`);
  };
  const setView = (next: ProjectRoomView) => {
    rememberProjectRoomView(room.id, me.id, next);
    if (view !== next) navigate(`${roomPath}?view=${next}`);
  };
  const assistantView = assistantEnabled && view === "assistant";
  const discussion = !assistantView && (!currentProject?.business || view === "discussion");
  const { state, frames, postMessage, postFiles, typing, loadOlder, loadNewer, jump, messageActions, dismissNotice } = useRoom(room.id, me, onSessionChanged, messageId);
  const nameOf = useNameOf();
  const name = roomName(room, me.id, nameOf);
  const direct = room.kind === "direct";
  useTitle(name);
  // The room shown is remembered, for home and Go Back to return to.
  useEffect(() => rememberLastRoom(room.id), [room.id]);
  const foundGone = state.status === "gone";
  const roomGone = useEffectEvent(() => onGone(room));
  useEffect(() => {
    if (foundGone) roomGone();
  }, [foundGone]);
  const deleted = gone || foundGone;
  async function shareProjectAnswer(answer: ProjectQuickAnswer) {
    const address = location.pathname + location.search;
    const permission = await fetch(answer.requiresPulseGrant ? `/api${roomPath}/project?audience=room` : `/api${roomPath}/project/assistant-context`, {
      method: answer.requiresPulseGrant ? "GET" : "HEAD", signal: AbortSignal.timeout(8000),
    });
    if (permission.status === 403) throw new Error("频道成员未全部获得项目授权，暂不能分享。");
    if (!permission.ok) throw new Error("暂时无法核对分享权限，请重试。");
    if (address !== location.pathname + location.search || deleted || state.offline) throw new Error("频道已切换或连接中断，请重试。");

    const body = document.createElement("div");
    const heading = body.appendChild(document.createElement("p"));
    heading.appendChild(document.createElement("strong")).textContent = `项目助手 · ${answer.question}`;
    const reply = new DOMParser().parseFromString(answer.html, "text/html");
    // The same room composer sanitizes shared replies before storing them.
    body.append(...reply.body.childNodes);
    if (!Array.from(body.querySelectorAll("a")).some(link => link.getAttribute("href") === overviewPath)) {
      const source = body.appendChild(document.createElement("p")).appendChild(document.createElement("a"));
      source.setAttribute("href", overviewPath);
      source.textContent = "项目总览";
    }
    if (!postMessage(body.innerHTML)) throw new Error("发送失败，请重试。");
  }

  // The room opens at the message its address names. Following its permalink, or one to another message
  // in it, or the room's own link, goes there, or to the newest, even when it's the page shown. One
  // followed while the room is away goes there once the room lets the page in again. Opening a thread,
  // even at a permalink, whose address the thread's takes the place of, going to one of its replies, or
  // closing it leaves the room's messages as they are.
  const visited = useRef({ messageId, visit, threadId });
  const goTo = useEffectEvent((messageId: string | null) => jump(messageId));
  useEffect(() => {
    const last = visited.current;
    if (last.messageId === messageId && last.visit === visit) return;
    const inThread = threadId !== undefined || (last.threadId !== undefined && last.messageId === messageId);
    if (inThread || goTo(messageId ?? null)) visited.current = { messageId, visit, threadId };
  }, [messageId, visit, threadId, state.connections]);
  const typingUsers = Object.values(state.typing)
    .map((t) => t.user)
    .filter((u) => u.id !== me.id);
  const composer = useRef<ComposerHandle>(null);
  useEffect(() => {
    if (!mentionOwner || !discussion || !composer.current || !ownerProfile) return;
    setMentionOwner(false);
    const attachment = document.createElement("action-text-attachment");
    attachment.setAttribute("content-type", MENTION_CONTENT_TYPE);
    attachment.setAttribute("sgid", ownerProfile.id);
    attachment.setAttribute("content", mentionContent(ownerProfile));
    composer.current.replace(`<p>${attachment.outerHTML}&nbsp;</p>`, true);
  }, [mentionOwner, discussion, ownerProfile]);
  const { editing, editors } = useMessageEditors(composer);
  useImperativeHandle(ref, () => ({ focusComposer: editors.returnFocus }), [editors]);
  // A thread that covers the room leaves nothing of it to reach until it's closed.
  const covered = useMediaQuery(THREAD_COVERS_ROOM) && threadId !== undefined;

  // Up Arrow edits the newest message you wrote, unless it's still on its way, or the timeline is reading
  // older history and may not hold it.
  const editLastMessage = () => {
    if (state.hasNewer) return;
    const newest = newestWrittenBy(state.messages, me.id);
    if (newest && !isPending(newest)) editors.open(newest.id);
  };

  return (
    <ProjectAssistantContext value={assistantEnabled && !deleted ? {bot: assistantBot, askPrivately: message => {
      setAssistantMessage(message);
      setView("assistant");
    }} : null}>
    <ProjectFeedbackNavigation value={currentProject?.business ? () => setView("feedback") : null}><ProjectChatContext value={selection}>
      {/* The room's header and messages, placed in the page's grid as if they were its own. */}
      <div className="contents" inert={covered}>
        <RoomHeader
          room={room}
          name={name}
          meId={me.id}
          present={state.present}
          status={state.status}
          offline={state.offline}
          favorite={favorite}
          onStarred={onStarred}
          involvement={involvement}
          askForRoom={askForRoom}
          onSessionChanged={onSessionChanged}
          onFailed={onFailed}
          team={currentProject?.team}
        />
        {/* Backgrounds run under a landscape phone's notch; the room's contents stay clear of it. */}
        <MainContent className="relative flex min-h-0 min-w-0 flex-col bg-background pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]">
          <RoomNotice notice={state.notice} onDismiss={dismissNotice} />
          <div className={currentProject || assistantEnabled ? "flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b bg-surface px-3 py-2" : "contents"}>
          {assistantEnabled && <nav aria-label="项目工作区" className="flex min-w-0 flex-wrap items-center gap-1">{([["discussion", "项目讨论"], ["overview", "项目总览"], ["assistant", "项目助手"], ["feedback", "反馈与落实"]] as const)
            .filter(([value]) => currentProject?.business || value === "discussion" || value === "assistant")
            .map(([value, label]) => <button key={value} aria-current={(discussion ? value === "discussion" : view === value) ? "page" : undefined} className="rounded-md px-2.5 py-1.5 text-xs text-message-muted hover:bg-hover aria-[current=page]:bg-hover aria-[current=page]:font-semibold aria-[current=page]:text-message-ink whitespace-nowrap max-md:px-1.5" onClick={() => setView(value)}>{label}</button>)}</nav>}
          {projectWorkspace && !direct && <ProjectOverview key={room.id} roomId={room.id} onData={setProject} compact/>}
          {(owner || (assistantEnabled && !deleted)) && <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs text-message-muted md:order-1 md:w-auto">
            {owner && <span>负责人 <strong className="font-medium text-message-ink">{owner.name}</strong></span>}
            {assistantEnabled && !assistantView && !deleted && <button type="button" className="rounded-md border bg-card px-2 py-1 text-link hover:bg-hover md:hidden" onClick={() => setView("assistant")}>问项目助手</button>}
            {owner && ownerProfile && owner.id !== me.id && !deleted && !state.offline &&
              <button type="button" className="rounded-md border bg-card px-2 py-1 text-message-ink hover:bg-hover" onClick={() => {
                setMentionOwner(true);
                if (!discussion) setView("discussion");
              }}>@ 负责人</button>}
          </div>}
          {owner === null && <p className="w-full text-xs text-message-muted">原负责人账号已不可用，请用现用账号重新接入项目。</p>}
          </div>
          {currentProject?.business && view === "overview" && <ProjectBusiness roomId={room.id} key={`overview:${room.id}`} data={currentProject} onDiscussion={() => setView("discussion")} onFeedback={(moduleId, milestoneId) => {setFeedbackDraft({moduleId, milestoneId}); setView("feedback");}} />}
          {assistantView && <ProjectAssistantChat key={`assistant:${room.id}`} roomId={room.id} turns={assistantTurns} me={me} bot={assistantBot}
            reference={assistantMessage?.roomId === room.id ? {
              text: assistantMessage.plainText || "附件",
              author: nameOf(assistantMessage.creator), link: permalinkOf(assistantMessage),
            } : null} onClearReference={() => setAssistantMessage(null)}
            onAnswer={answer => {const id = ++nextAssistantTurn.current; setAssistantTurns(turns => [...turns, {...answer, id}]);}}
            onShared={id => setAssistantTurns(turns => turns.map(turn => turn.id === id ? {...turn, shared: true} : turn))}
            onShare={shareProjectAnswer} shareDisabled={deleted || state.offline} onDiscussion={() => setView("discussion")}/>}
          {currentProject?.business && view === "feedback" && <ProjectFeedbackPanel key={`feedback:${room.id}`} roomId={room.id} data={currentProject} me={me} draft={feedbackDraft} onDraftHandled={() => setFeedbackDraft(null)} focusId={new URLSearchParams(location.search).get("feedback")}/>}
          {discussion && !deleted && currentProject?.business && <ProjectDiscussionFollowUp key={`follow-up:${room.id}`} roomId={room.id} onOpen={openFeedback} onTrack={snapshotFollowUp => {
            setFeedbackDraft({moduleId: currentProject.business!.modules.find(module => module.id !== "other")?.id ?? "", snapshotFollowUp});
            setView("feedback");
          }}/>}
          {discussion && followUp && !deleted && !currentProject?.business && <section aria-label="待跟进" className="flex shrink-0 items-start gap-2 border-b px-4 py-2 text-xs max-md:px-3">
            <h2 className="shrink-0 font-semibold">待跟进</h2>
            <p className="min-w-0 flex-1 break-words text-message-muted">{followUp}</p>
          </section>}
          {discussion && <ProjectChatTools key={`discussion-tools:${room.id}`} roomId={room.id} data={currentProject} me={me} actions={deleted ? null : messageActions} editors={editors} onSelectionChange={setSelection} onAdopted={openFeedback}>
          <MessageList
            roomName={name}
            direct={direct}
            invitation={invitation}
            onDismissInvitation={onDismissInvitation}
            state={state}
            me={me}
            actions={deleted ? null : messageActions}
            editing={editing}
            editors={editors}
            onLoadOlder={loadOlder}
            onLoadNewer={loadNewer}
            onJumpToNewest={() => jump(null)}
            onDropFiles={(files) => composer.current?.addFiles(files)}
            openThread={threadId}
            newSince={newSince}
          />
          </ProjectChatTools>}
          {discussion && (deleted ? (
            <RoomDeleted />
          ) : (
            <Composer
              ref={composer}
              roomId={room.id}
              roomName={name}
              direct={direct}
              userId={me.id}
              typing={typingUsers}
              disabled={state.offline}
              // Only while the room's first messages are on their way, not once it's been out of reach a while.
              deferEditor={state.status === "connecting" && !state.offline}
              // The thread open beside the room takes focus as it opens.
              autoFocus={threadId === undefined}
              onSend={postMessage}
              onSendFiles={postFiles}
              onTyping={typing}
              onEditLastMessage={editLastMessage}
            />
          ))}
        </MainContent>
      </div>
      {threadId !== undefined && (
        <ThreadPanel
          key={threadId}
          room={room}
          name={name}
          me={me}
          parentId={threadId}
          replyId={replyId}
          frames={frames}
          status={state.status}
          offline={state.offline}
          deleted={deleted}
          roomNotice={covered ? state.notice : null}
          onDismissRoomNotice={dismissNotice}
        />
      )}
    </ProjectChatContext></ProjectFeedbackNavigation></ProjectAssistantContext>
  );
}
