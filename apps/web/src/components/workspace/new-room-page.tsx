import { useEffect, useRef, useState } from "react";
import type { NewRoom, Room, RoomIconName, User, UserId } from "@ember/protocol";
import { useFlash } from "@/components/flash";
import { useAccount } from "@/hooks/use-account";
import { useMounted } from "@/hooks/use-mounted";
import { navigate, newRoomPath, roomPath, type Access } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { ApiError, createRoom, fetchNewRoomForm, isSignedOut } from "@/lib/api";
import { AccessSwitch, CheckMark, RoomForm, withChoice } from "./room-form";
import { workspaceSectionPath } from "./settings-navigation";
import { PageHeading, Panel, SettingsPage } from "./settings-page";
import { UnsavedChanges } from "./unsaved-changes";

/** What New room's name starts as. */
const DEFAULT_ROOM_NAME = "New room";

/** The Everyone switch moves between New room's two forms, keeping the draft. */
const isNewRoomPath = (path: string) => path.split("?")[0] === newRoomPath("open") || path.split("?")[0] === newRoomPath("closed");

interface Props {
  /** Which of the two forms the address shows: a room for everyone, or a private one. */
  access: Access;
  me: User;
  /** Lists the room made, for the sidebar. The page then shows it, unless it was left first. */
  onCreated: (room: Room) => void;
  /** Says why something failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * The New room pages, for an open room and a private one. The Everyone switch swaps one for the other in
 * place, keeping what's been filled in, and leaving with anything filled in asks first. While only
 * administrators can create rooms, anyone else is sent to workspace settings with an alert.
 */
export function NewRoomPage({ access, me, onCreated, onFailed }: Props) {
  const param = new URLSearchParams(location.search).get("group");
  const group = useAccount().name === "Project Pulse · 研发协作中心" && (param === "project" || param === "team") ? param : undefined;
  const title = group === "project" ? "新建项目频道" : group === "team" ? "新建团队协作频道" : "New room";
  useTitle(title);
  const [people, setPeople] = useState<User[] | null>(null);
  const [name, setName] = useState(group ? "" : DEFAULT_ROOM_NAME);
  const [icon, setIcon] = useState<RoomIconName | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<UserId>>(new Set());
  const [saving, setSaving] = useState(false);
  // The room the unsaved changes dialog's Save made, while the app goes on to where the person was going.
  const [created, setCreated] = useState<Room | null>(null);
  // The form the page opened on, which the Everyone switch can move away from and back to.
  const [opened] = useState(access);
  const roomForm = useRef<HTMLFormElement>(null);
  const flash = useFlash();
  const mounted = useMounted();

  useEffect(() => {
    let stopped = false;
    fetchNewRoomForm().then(
      (form) => !stopped && setPeople(form.people),
      (error: unknown) => {
        // A page left before its form loads only reports a session that's ended, which goes to sign in.
        if (stopped && !isSignedOut(error)) return;
        if (!(error instanceof ApiError && error.status === 403)) return onFailed(error);
        // To Rooms and permissions, which says who makes rooms.
        navigate(workspaceSectionPath("channel-settings"), { replace: true });
        flash("alert", error.message);
      },
    );
    return () => void (stopped = true);
  }, [flash, onFailed]);

  /** Creates the room and lists it in the sidebar. */
  const send = () => {
    // The private form lists its creator with a check mark and sends them as one of its members.
    const room: NewRoom = access === "open" ? { kind: access, name, icon: icon ?? "" } : { kind: access, name, icon: icon ?? "", memberIds: [me.id, ...chosen] };
    return createRoom(group ? {...room, channelGroup: group} : room).then((room) => {
      onCreated(room);
      setCreated(room);
      return room;
    });
  };

  const save = () => {
    // A room made already isn't made twice: Save shows it, as it does a room it makes.
    if (created) return navigate(roomPath(created.id));
    setSaving(true);
    // An answer that comes after the page was left lists the room, but leaves the page shown then alone.
    send().then(
      (room) => {
        if (mounted.current) navigate(roomPath(room.id));
      },
      (error: unknown) => {
        // Once the page is left, only a session that's ended matters, which goes to sign in from any page.
        if (!mounted.current && !isSignedOut(error)) return;
        setSaving(false);
        onFailed(error);
      },
    );
  };

  // Anything filled in, or the other form, which the page didn't open on, until the room's made.
  const changed =
    people !== null && !saving && !created && (name !== (group ? "" : DEFAULT_ROOM_NAME) || icon !== null || access !== opened || (access === "closed" && chosen.size > 0));
  return (
    // Go Back returns to Rooms and permissions.
    <SettingsPage back={workspaceSectionPath("channel-settings")}>
      <Panel aria-busy={people === null}>
        <PageHeading title={title}>{group ? undefined : "Create a place for a team, topic, or project."}</PageHeading>
        {people && (
          <RoomForm
            canAdminister
            name={name}
            onNameChange={setName}
            icon={icon}
            onIconChange={setIcon}
            everyone={{ on: access === "open", onFlip: () => navigate(newRoomPath(access === "open" ? "closed" : "open") + (group ? `?group=${group}` : ""), { replace: true }) }}
            groups={[people]}
            mark={(person) =>
              access === "open" || person.id === me.id ? (
                <CheckMark />
              ) : (
                <AccessSwitch person={person} checked={chosen.has(person.id)} onCheckedChange={(checked) => setChosen((chosen) => withChoice(chosen, person, checked))} />
              )
            }
            saving={saving}
            onSave={save}
            ref={roomForm}
          />
        )}
      </Panel>
      {/* Should the page stay after the dialog's Save, as it does when signing out fails, it shows the room
          made, as its own Save does, rather than a form for another. */}
      <UnsavedChanges changed={changed} stays={isNewRoomPath} onSave={send} onStayAfterSave={(room) => navigate(roomPath(room.id))} form={roomForm} />
    </SettingsPage>
  );
}
