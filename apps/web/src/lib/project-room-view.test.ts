import { afterEach, expect, it, vi } from "vitest";
import { projectRoomView, rememberProjectRoomView } from "./project-room-view";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it("defaults to discussion and remembers the last tab per account and room", () => {
  expect(projectRoomView("room", "user", "")).toBe("discussion");
  rememberProjectRoomView("room", "user", "overview");
  expect(projectRoomView("room", "user", "")).toBe("overview");
  expect(projectRoomView("other", "user", "")).toBe("discussion");
  expect(projectRoomView("room", "other", "")).toBe("discussion");
});

it("honors explicit links and message permalinks while keeping the saved tab", () => {
  rememberProjectRoomView("room", "user", "assistant");
  expect(projectRoomView("room", "user", "?view=overview")).toBe("overview");
  expect(projectRoomView("room", "user", "?view=feedback")).toBe("feedback");
  expect(projectRoomView("room", "user", "?view=overview", true)).toBe("discussion");
  expect(projectRoomView("room", "user", "?view=invalid")).toBe("assistant");
});

it("still opens discussion when storage is blocked", () => {
  const denied = () => { throw new Error("storage blocked"); };
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(denied);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(denied);
  expect(() => rememberProjectRoomView("room", "user", "overview")).not.toThrow();
  expect(projectRoomView("room", "user", "")).toBe("discussion");
  expect(projectRoomView("room", "user", "?view=overview")).toBe("overview");
});
