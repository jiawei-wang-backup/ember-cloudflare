export type ProjectRoomView = "discussion" | "overview" | "assistant" | "feedback";

const key = (roomId: string, userId: string) => `ember:project-view:${userId}:${roomId}`;

function asView(value: string | null): ProjectRoomView | undefined {
  if (value === "discussion" || value === "overview" || value === "assistant" || value === "feedback") return value;
}

export function projectRoomView(roomId: string, userId: string, search: string, opensMessage = false): ProjectRoomView {
  if (opensMessage) return "discussion";
  const requested = asView(new URLSearchParams(search).get("view"));
  if (requested) return requested;
  try {
    return asView(localStorage.getItem(key(roomId, userId))) ?? "discussion";
  } catch {
    return "discussion";
  }
}

export function rememberProjectRoomView(roomId: string, userId: string, view: ProjectRoomView): void {
  try {
    localStorage.setItem(key(roomId, userId), view);
  } catch {
    // Links still select their requested view when storage is unavailable.
  }
}
