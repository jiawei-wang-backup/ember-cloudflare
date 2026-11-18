import {afterEach, expect, it, vi} from "vitest";
import {render, screen, fireEvent, waitFor} from "@testing-library/react";
import type {PulseSnapshot} from "@ember/protocol";
import {ProjectChatTools, filterDate} from "./project-chat-tools";

afterEach(() => vi.unstubAllGlobals());
const editors = {open: vi.fn(), close: vi.fn(), returnFocus: vi.fn(), attach: vi.fn(), reply: vi.fn()};
const data = {team: {people: 1, bots: 1, members: [{id: "human", name: "成员甲", bot: false}, {id: "bot", name: "项目助手", bot: true}]}} as PulseSnapshot;

it("leaves unbound conversations untouched and offers adoption only to authorised people", () => {
  const {rerender} = render(<ProjectChatTools roomId="a" data={null} me={{id: "human", name: "成员甲", administrator: false}} editors={editors} actions={null}><p>原有聊天</p></ProjectChatTools>);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  rerender(<ProjectChatTools roomId="a" data={data} me={{id: "human", name: "成员甲", administrator: false}} editors={editors} actions={null}><p>原有聊天</p></ProjectChatTools>);
  expect(screen.getByText("原有聊天")).toBeVisible();
  expect(screen.queryByRole("button", {name: "选择讨论并采纳"})).not.toBeInTheDocument();
});
it("queries server history for bot, person and local-date filters and resets cleanly", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({messages: [], hasMore: false, before: null}));
  vi.stubGlobal("fetch", fetch);
  render(<ProjectChatTools roomId="a" data={data} me={{id: "human", name: "成员甲", administrator: true}} editors={editors} actions={null}><p>原有聊天</p></ProjectChatTools>);
  fireEvent.click(screen.getByRole("button", {name: "筛选消息"}));
  fireEvent.change(screen.getByLabelText("消息类型"), {target: {value: "bot"}});
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/rooms/a/project/messages?kind=bot", expect.anything()));
  fireEvent.change(screen.getByLabelText("发言人"), {target: {value: "bot"}});
  fireEvent.change(screen.getByLabelText("开始日期"), {target: {value: "2026-11-16"}});
  fireEvent.change(screen.getByLabelText("结束日期"), {target: {value: "2026-11-17"}});
  await waitFor(() => {
    const url = new URL(fetch.mock.calls.at(-1)![0], "http://test");
    expect(url.searchParams.get("author")).toBe("bot");
    expect(url.searchParams.get("until")).toBe(filterDate("2026-11-17", true));
  });
  fireEvent.click(screen.getByRole("button", {name: "清除筛选"}));
  expect(screen.getByText("原有聊天")).toBeVisible();
});
