import { Fragment, useContext, useEffect, useId, useMemo, useState, type ReactNode, type MouseEvent } from "react";
import type { Favorites, LiveHuddle, Me, RoomId, SidebarRoom, User, UserId, PulseProjectSummary } from "@ember/protocol";
import { ChatPlusIn, Headset, NavArrowRight, StarSolid } from "@/components/icons/iconoir";
import { PageLink } from "@/components/page-link";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RoomIcon } from "@/components/icons/room-icon";
import { useAccount } from "@/hooks/use-account";
import { PeopleContext, useNameOf } from "@/hooks/use-directory";
import { useRoomDrag, type OrderStatus } from "@/hooks/use-room-drag";
import { useMounted } from "@/hooks/use-mounted";
import { leave, NEW_DIRECT_PATH, newRoomPath, roomSettingsPath, roomPath } from "@/hooks/use-route";
import { useStarOrder } from "@/hooks/use-star-order";
import { membersShown } from "@/lib/directs";
import { inItsHuddle } from "@/lib/huddle-people";
import { apart, inDirectOrder, inSidebarOrder, markedUnread, type DirectSidebarRoom } from "@/lib/room-list";
import { cn } from "@/lib/utils";
import { AgentBadge, useIsWithAgent } from "./agent-badge";
import { opensNewDirect } from "./new-direct-dialog";
import { UserAvatar } from "./user-avatar";

/** A row of the list, a room's or a DM's. */
const ROW =
  "flex min-h-9 items-center gap-2.5 rounded-lg px-[9px] py-[7px] text-sm leading-[22px] text-foreground no-underline touch:min-h-11 hover:bg-hover aria-[current=page]:bg-hover aria-[current=page]:font-semibold";

/** How many avatars a group DM's row shows. */
const MAX_FACES = 4;

/** How many of the people in a huddle its room's row shows the faces of. */
const MAX_HUDDLE_FACES = 2;
const PULSE_PROJECTS = new Map([
  ["project-pulse", "研发进度看板"],
  ["jxaccount", "飞书统一登录"],
  ["mfa-approval", "登录验证码审批"],
  ["wzwx-score", "赛事报名与成绩管理"],
  ["deltaforce-game-library", "三角洲行动资料库"],
  ["xiaoxing-voice-changer", "小猩直播变声器"],
]);
const PULSE_GROUPS = ["项目频道", "团队协作", "交付汇总"] as const;
const pulseGroup = (name: string) => PULSE_PROJECTS.has(name) ? PULSE_GROUPS[0] : name === "交付与验收 · Pulse" ? PULSE_GROUPS[2] : PULSE_GROUPS[1];

interface Props {
  /** The workspace's name, which heads the list. */
  workspaceName: string;
  /** Who the sidebar is for, whose DMs name the others in them. */
  meId: UserId;
  administrator?: boolean;
  /** Someone's rooms and DMs, in the order they were put in them, which the rooms neither starred nor ranked keep. */
  rooms: SidebarRoom[];
  /** Whether their list has come, before which nothing says there's nothing in it. */
  loaded: boolean;
  /** The rooms they've starred, whose rows come first, end with a star, and can be moved among themselves. */
  favorites: Favorites;
  /** The rooms the workspace's shared order ranks, which come next, in its order. */
  sharedOrder: RoomId[];
  /** The huddles going on in their rooms, by room, whose rows say who's in them. */
  huddles: Record<RoomId, LiveHuddle>;
  currentRoomId: string | null;
  /** Whether Activity is on, which shows only the rows marked unread. */
  unreadOnly: boolean;
  /** How many AI agents they can ask, which Available Agents says, under the DMs, while there are any. */
  agents: number;
  /** Whether Available Agents is open. */
  agentsOpen: boolean;
  onSelect: (roomId: string) => void;
  /** Opens New direct message, which the DMs heading's link does in place, from the link that opened it. */
  onNewDirect: (opener: HTMLElement) => void;
  /** Opens Available Agents, from the row that says how many there are. */
  onOpenAgents: (opener: HTMLElement) => void;
  /** Called with this person's stars as the server answers them, once a new order for them is saved. */
  onStarred: (favorites: Favorites) => void;
  /** Called with null when the session has expired. */
  onSessionChanged: (me: Me | null) => void;
}

/**
 * The conversation list: rooms, then DMs, under the workspace name, and under that in small type the
 * tagline an administrator gave it, if it has one. The starred rooms come first, then the ones the
 * shared order ranks, in its order, then the rest in the order they were put in them, so a new room
 * comes last, and a starred room's row ends with a star, with no grip, both as the project's owner
 * chose: held, the row can be dragged among the other starred rows, or moved with Alt and an arrow
 * (`useStarOrder`). The DMs follow, only the ones they're in, as the project's owner chose, rather than
 * Campfire's people to start one with too, latest active first, and a DM's row shows who else is in it.
 * A room or DM marked unread is bold with a dot at the end of its row, and one with a huddle going on
 * ends its row with who's in it. With Activity on, only the unread rows show, and with none it says
 * everything's read; with it off and nothing to list, it says it found nothing. Under them all,
 * Available Agents says how many AI agents this person can ask, and opens the list of them, as the
 * project's owner chose (2026-11-15), unless there are none, or Activity is on.
 */
export function Sidebar({
  workspaceName,
  meId, administrator,
  rooms,
  loaded,
  favorites,
  sharedOrder,
  huddles,
  currentRoomId,
  unreadOnly,
  agents,
  agentsOpen,
  onSelect,
  onNewDirect,
  onOpenAgents,
  onStarred,
  onSessionChanged,
}: Props) {
  const { tagline, restrictRoomCreation } = useAccount();
  const { shared, directs } = useMemo(() => apart(unreadOnly ? rooms.filter((room) => markedUnread(room, currentRoomId)) : rooms), [rooms, unreadOnly, currentRoomId]);
  const shown = useMemo(() => new Set(shared.map((room) => room.id)), [shared]);
  const nameOf = (roomId: RoomId) => {
    const room = rooms.find((r) => r.id === roomId);
    return room && room.kind !== "direct" ? room.name : "";
  };
  const stars = useStarOrder({ favorites, shown, nameOf, onSaved: onStarred, onSessionChanged });
  const listed = useMemo(() => inSidebarOrder(shared, stars.order, sharedOrder), [shared, stars.order, sharedOrder]);
  const grouped = workspaceName === "Project Pulse · 研发协作中心";
  const storageKey = `ember-pulse-channel-order-${meId}`;
  const [saved, setSaved] = useState<{key: string; ids: RoomId[]}>();
  const [groupStatus, setGroupStatus] = useState<OrderStatus | null>(null);
  useEffect(() => {
    if (!grouped) return;
    try {
      const ids: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(ids)) setSaved({key: storageKey, ids: ids.filter(id => typeof id === "string")});
    } catch {
      // This browser may not provide local storage.
    }
  }, [grouped, storageKey]);
  const savedIds = saved?.key === storageKey ? saved.ids : [];
  const ranked = grouped ? inSidebarOrder(listed, savedIds) : listed;
  const roomGroups = new Map(ranked.map(room => [room.id, (room.channelGroup === "project" ? PULSE_GROUPS[0] : room.channelGroup === "team" ? PULSE_GROUPS[1] : pulseGroup(room.name))]));
  const groupedIds = grouped ? PULSE_GROUPS.flatMap(group => ranked.filter(room => roomGroups.get(room.id) === group).map(room => room.id)) : [];
  const groupedDrag = useRoomDrag({
    order: groupedIds,
    movable: grouped && !unreadOnly ? groupedIds : [],
    groupOf: id => roomGroups.get(id),
    holdMs: 400,
    dragOnPointerMove: true,
    isLocked: () => false,
    onDrag: id => setGroupStatus({message: `正在移动 ${nameOf(id)}，松开即可保存。`, error: false}),
    onCancel: () => setGroupStatus({message: "已取消移动。", error: false}),
    onMove: ids => {
      const next = [...ids, ...savedIds.filter(id => !ids.includes(id))];
      setSaved({key: storageKey, ids: next});
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
        setGroupStatus({message: "频道顺序已保存。", error: false});
      } catch {
        setGroupStatus({message: "当前浏览器无法保存频道顺序。", error: true});
      }
    },
  });
  const {listRef, scrollerRef, listProps, moving} = grouped ? groupedDrag : stars;
  const status = grouped ? groupStatus : stars.status;
  const [projects, setProjects] = useState<PulseProjectSummary[]>([]);
  useEffect(() => {
    if (!grouped) return;
    const controller = new AbortController();
    const load = () => fetch("/api/pulse/projects", {signal: controller.signal, credentials: "same-origin"}).then(async response => {if (response.ok) setProjects((await response.json()).projects);}).catch(() => {});
    void load();
    const timer = setInterval(() => {if (!document.hidden) void load();}, 60_000);
    return () => {controller.abort(); clearInterval(timer);};
  }, [grouped, meId]);
  const draggedOrder = grouped ? inSidebarOrder(ranked, groupedDrag.order) : listed;
  const displayed = grouped
    ? PULSE_GROUPS.flatMap(group => draggedOrder.filter(room => roomGroups.get(room.id) === group))
    : listed;
  const starred = useMemo(() => new Set(stars.order), [stars.order]);
  const groupSizes = new Map(PULSE_GROUPS.map(group => [group, displayed.filter(room => roomGroups.get(room.id) === group).length]));
  const canCreate = administrator || !restrictRoomCreation;
  const groupHeading = (group: typeof PULSE_GROUPS[number]) => <div key={group} className="flex items-center gap-2 px-[9px] pt-2 text-xs text-muted-foreground">
    <h3 className="flex-1 font-medium">{group}</h3><span className="text-[10px] tabular-nums">{groupSizes.get(group)}</span>
    {canCreate && group !== "交付汇总" && <PageLink href={newRoomPath(group === "项目频道" ? "closed" : "open") + (group === "项目频道" ? "?group=project" : "?group=team")}
      aria-label={`新建${group}`} title={`新建${group}`} className="grid size-7 place-items-center rounded-md text-lg hover:bg-hover">+</PageLink>}
  </div>;
  const directsListed = useMemo(() => inDirectOrder(directs), [directs]);
  const empty = loaded && listed.length === 0 && directsListed.length === 0;
  const helpId = useId();
  const unreadId = useId();
  const huddleId = useId();
  // A row followed in place shows its room here, and one opened elsewhere, as in a new tab, leaves this page be.
  const select = (event: MouseEvent, roomId: RoomId) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    onSelect(roomId);
  };
  return (
    <div ref={scrollerRef} className="flex h-full flex-col gap-3.5 overflow-y-auto overflow-x-hidden bg-surface px-3 pt-5 pb-[max(20px,env(safe-area-inset-bottom))] [scrollbar-gutter:stable] narrow:px-2 max-md:gap-4 max-md:px-2.5 max-md:pt-4 max-md:pb-[max(16px,env(safe-area-inset-bottom))]">
      {/* The workspace's heading, as an hgroup, HTML's element for a heading and its tagline. At 900px and
          below the drawer's close button sits at the end of the name's row, and the tagline keeps clear of it
          too. A long name wraps rather than running under the sidebar's edge, and so does a tagline in a
          narrower sidebar or wider letters than its length allows for. */}
      <hgroup className="px-1.5 max-md:pr-10">
        <h2 className="flex min-h-7 items-center gap-2 text-[17px] leading-6 font-[650] wrap-anywhere">{workspaceName}</h2>
        {!grouped && tagline && <p className="text-[13px] leading-[18px] text-muted-foreground wrap-anywhere">{tagline}</p>}
      </hgroup>

      <section aria-label="Rooms" className="flex flex-col">
        <p id={helpId} className="sr-only">
          {grouped ? "按住频道可在同一分组内拖动，也可以按 Alt 加上下方向键调整顺序。" : "Hold a starred room to drag it, or press Alt and the up or down arrow to reorder your favorites. Other rooms follow the workspace order."}
        </p>
        <span id={unreadId} hidden>
          Unread
        </span>
        <div ref={listRef} {...listProps} className={cn("flex flex-col gap-[3px]", moving && "select-none")}>
          {grouped && loaded && !unreadOnly && canCreate && PULSE_GROUPS.slice(0,2).filter(group => !groupSizes.get(group)).map(groupHeading)}
          {displayed.map((room,index) => {
            const unread = markedUnread(room, currentRoomId);
            const star = starred.has(room.id);
            const projectName = grouped ? PULSE_PROJECTS.get(room.name) : undefined;
            const label = projectName ? `${projectName}（${room.name}）` : room.name;
            const group = roomGroups.get(room.id)!;
            const movable = grouped ? !unreadOnly && (groupSizes.get(group) ?? 0) > 1 : star;
            const huddle = huddles[room.id];
            // The words for who's in the room's huddle, which come with its mark.
            const inHuddleId = `${huddleId}-${room.id}`;
            return (
              <Fragment key={room.id}>
              {grouped && (index === 0 || roomGroups.get(displayed[index-1]!.id) !== group) && groupHeading(group)}
              <ChatRowMenu enabled={grouped} room={room}>
              <a
                data-room-id={room.id}
                href={roomPath(room.id)}
                draggable={false}
                aria-current={room.id === currentRoomId ? "page" : undefined}
                // Every row says how the stars are reordered, a marked one says it's unread, which the eye sees
                // by its weight and dot, and one with a huddle says who's in it, which the eye sees by its mark.
                aria-describedby={[huddle && inHuddleId, unread && unreadId, helpId].filter(Boolean).join(" ")}
                aria-keyshortcuts={movable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                onClick={(event) => select(event, room.id)}
                className={cn(
                  ROW,
                  "[-webkit-touch-callout:none]",
                  unread && "font-[650]",
                  movable && "cursor-grab",
                  room.id === moving && "relative z-[1] cursor-grabbing bg-background! shadow-[0_4px_14px_var(--color-drag-shadow)] outline outline-muted-foreground",
                )}
              >
                <RoomIcon icon={room.icon} size={19} className="w-[18px] shrink-0 text-center text-[22px] leading-none text-muted-foreground" />
                <span className="min-w-0 flex-1"><span className="block truncate" title={projectName ? label : undefined}>{label}</span>{grouped && (() => {
                  const project = projects.find(p => p.roomId === room.id), progress = project?.progress;
                  if (!progress || !progress.total) return null;
                  const percent = Math.round((progress.completed ?? progress.accepted) / progress.total * 100);
                  return <span className="mt-0.5 flex items-center gap-2" title={`${progress.completed ?? progress.accepted}/${progress.total} 阶段记录完成，非业务验收${project.freshness?.status === "snapshot" ? `；快照 ${project.freshness.captured_at}` : ""}`}><span role="progressbar" aria-label={`${room.name} 阶段记录进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1 flex-1 overflow-hidden rounded-full bg-border"><span className="block h-full rounded-full bg-positive/70" style={{width: `${percent}%`}}/></span><span className="text-[10px] leading-3 text-muted-foreground tabular-nums">{percent}%</span></span>;
                })()}</span>
                {/* The huddle's mark, the dot and the star sit together at the row's end, pushed there by one auto
                    margin. The star's muted at 65%. */}
                {huddle && <HuddleMark huddle={huddle} meId={meId} wordsId={inHuddleId} className="ml-auto" />}
                {unread && <span aria-hidden="true" className={cn("size-[7px] shrink-0 rounded-full bg-foreground", !huddle && "ml-auto")} />}
                {star && <StarSolid aria-label="Favorite" className={cn("size-3.5 shrink-0 text-muted-foreground/65", !huddle && !unread && "ml-auto")} />}
              </a>
              </ChatRowMenu>
              </Fragment>
            );
          })}
        </div>
        {/* Moves are told to screen readers, and a save that fails is shown. */}
        <p role="status" className={status?.error ? "mx-[9px] my-1 text-xs leading-normal text-negative wrap-anywhere" : "sr-only"}>
          {status?.message}
        </p>
      </section>

      <section aria-labelledby="directs-heading" className="flex flex-col gap-[3px]">
        <div className="mb-[5px] flex items-center gap-2 px-[9px] text-xs font-medium text-muted-foreground">
          <h3 id="directs-heading">{grouped ? "私聊" : "DMs"}</h3>
          <a
            href={NEW_DIRECT_PATH}
            title={grouped ? "发起私聊" : "New direct message"}
            aria-label={grouped ? "发起私聊" : "New direct message"}
            onClick={opensNewDirect(onNewDirect)}
            className="ml-auto flex size-7 items-center justify-center rounded-lg text-foreground hover:bg-hover touch:size-11"
          >
            <ChatPlusIn className="size-[15px]" />
          </a>
        </div>
        {directsListed.map((room) => (
          <ChatRowMenu key={room.id} enabled={grouped} room={room}><DirectRow
            key={room.id}
            room={room}
            meId={meId}
            current={room.id === currentRoomId}
            unreadId={markedUnread(room, currentRoomId) ? unreadId : null}
            huddle={huddles[room.id]}
            onClick={(event) => select(event, room.id)}
          /></ChatRowMenu>
        ))}
      </section>
      {empty && (
        <p className="px-[9px] text-[13px] text-muted-foreground">{unreadOnly ? "You’re all caught up. No unread conversations." : "No conversations found."}</p>
      )}
      {agents > 0 && !unreadOnly && <AgentsRow count={agents} open={agentsOpen} onOpen={onOpenAgents} />}
    </div>
  );
}

/**
 * Available Agents: a heading, as the DMs' is, that's a button, with how many AI agents this person can
 * ask on a pill, as the Agent badge's is, and an arrow, since it opens the list of them.
 */
function AgentsRow({ count, open, onOpen }: { count: number; open: boolean; onOpen: (opener: HTMLElement) => void }) {
  return (
    <section aria-label="Agents" className="flex flex-col">
      <button
        type="button"
        // Named in one piece, since a browser reads a space between the parts of a row laid out as this one is.
        aria-label={`Available Agents, ${count} to ask`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => onOpen(event.currentTarget)}
        className="flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-lg px-[9px] text-start text-xs font-medium text-muted-foreground touch:min-h-11 hover:bg-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground"
      >
        <span>Available Agents</span>
        <span aria-hidden="true" className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-foreground/8 px-1.5 text-[11px] leading-none font-semibold tabular-nums text-message-muted">
          {count}
        </span>
        <NavArrowRight className="ml-auto size-[15px]" />
      </button>
    </section>
  );
}

interface HuddleMarkProps {
  huddle: LiveHuddle;
  /** Who the sidebar is for, whom the words call you. */
  meId: UserId;
  /** The id of the words that say who's in the huddle, for the row to be described by. */
  wordsId: string;
  className?: string;
}

/**
 * What a room's row, or a DM's, ends with while a huddle is going on in it, as Slack's does: the faces
 * of the first two people in it, the headphones and how many are in it, in green. Hovering it says who
 * they are, in the words that follow it, hidden, for the row to say to screen readers, which the mark is
 * hidden from.
 */
function HuddleMark({ huddle, meId, wordsId, className }: HuddleMarkProps) {
  const people = useContext(PeopleContext);
  const faces = huddle.userIds.flatMap((userId) => people.get(userId) ?? []).slice(0, MAX_HUDDLE_FACES);
  const others = huddle.userIds.filter((userId) => userId !== meId);
  const who = inItsHuddle(others.flatMap((userId) => people.get(userId)?.name ?? []), others.length, others.length < huddle.userIds.length);
  return (
    <>
      <span aria-hidden="true" title={who} className={cn("flex shrink-0 items-center gap-1 text-xs font-medium text-positive", className)}>
        {/* Each ringed in the sidebar's color, which parts it from the face it overlaps. */}
        <span className="flex -space-x-1">
          {faces.map((person) => (
            <UserAvatar key={person.id} user={person} className="size-4 ring-1 ring-surface" />
          ))}
        </span>
        <Headset className="size-3.5" />
        <span className="tabular-nums">{huddle.userIds.length}</span>
      </span>
      <span id={wordsId} hidden>
        {who}
      </span>
    </>
  );
}

interface DirectRowProps {
  room: DirectSidebarRoom;
  meId: UserId;
  /** Whether it's the DM the tab shows. */
  current: boolean;
  /** The element saying the DM is unread, when it's marked so, or null. */
  unreadId: string | null;
  /** The huddle going on in it, if one is. */
  huddle: LiveHuddle | undefined;
  onClick: (event: MouseEvent) => void;
}

/**
 * A DM's row: the avatar of the one other person in it, or of up to four in a group, at 24px or 14px
 * each, then their names, or yours in a DM with yourself, and the agent badge in a DM with an AI agent
 * alone. It ends with who's in its huddle while one is going on, as a room's does.
 */
function DirectRow({ room, meId, current, unreadId, huddle, onClick }: DirectRowProps) {
  const nameOf = useNameOf();
  const isWithAgent = useIsWithAgent();
  const members = membersShown(room, meId);
  // The words for who's in its huddle, which come with its mark.
  const inHuddleId = useId();
  return (
    <a
      href={roomPath(room.id)}
      aria-current={current ? "page" : undefined}
      aria-describedby={[huddle && inHuddleId, unreadId].filter(Boolean).join(" ") || undefined}
      onClick={onClick}
      className={cn(ROW, unreadId && "font-[650]")}
    >
      {members.length > 1 ? (
        // Campfire's `.avatar__group` (avatars.css): two to a row, centered on the 24px a single avatar takes.
        <span aria-hidden="true" className="grid size-6 shrink-0 grid-cols-2 grid-rows-[min-content] place-content-center gap-px">
          {members.slice(0, MAX_FACES).map((member) => (
            <UserAvatar key={member.id} user={member} className="size-3.5" />
          ))}
        </span>
      ) : (
        members.map((member) => <UserAvatar key={member.id} user={member} className="size-6" />)
      )}
      {/* The space after the hidden words starts the visible line, where it doesn't show. */}
      <span className="min-w-0 flex-1 truncate">
        <span className="sr-only">Direct message with</span> {members.map((member) => `${nameOf(member)}${member.id === meId ? " (you)" : ""}`).join(", ")}
        {isWithAgent(room) && <AgentBadge className="ms-0.5" />}
      </span>
      {huddle && <HuddleMark huddle={huddle} meId={meId} wordsId={inHuddleId} />}
      {unreadId && <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-foreground" />}
    </a>
  );
}
function ChatRowMenu({enabled, room, children}: {enabled: boolean; room: SidebarRoom; children: ReactNode}) {
  const [open, setOpen] = useState(false);
  if (!enabled) return <>{children}</>;
  const label = room.kind === "direct" ? "私聊设置" : "编辑频道";
  return <div className="group/chat relative [&>a]:pr-8" onContextMenu={event => {event.preventDefault(); setOpen(true);}}>
    {children}
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={label + "选项"} title={label} className="absolute right-0.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-message-muted opacity-0 hover:bg-hover group-hover/chat:opacity-100 group-focus-within/chat:opacity-100 data-[state=open]:opacity-100 touch:opacity-100">⋯</PopoverTrigger>
      <PopoverContent align="end" className="w-36 p-1"><PageLink href={roomSettingsPath(room.kind, room.id)} onClick={() => setOpen(false)} className="block rounded px-3 py-2 text-sm hover:bg-hover">{label}</PageLink></PopoverContent>
    </Popover>
  </div>;
}
