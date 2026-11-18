import {beforeEach, afterEach, it, expect, vi} from "vitest";
import type {PulseSnapshot, PulseAdoptionAnswer, PulseMessagePage} from "@ember/protocol";
import {apiWith, connect, createRoom, freshDeploy, post, signIn} from "./support";
import type {Env} from "../src/env";
import {adoptionExcerpt} from "../src/pulse-collaboration";

beforeEach(freshDeploy);
afterEach(() => vi.restoreAllMocks());
const projectId = "11111111-1111-4111-8111-111111111111";
const snapshot = {project: {repository_id: projectId, full_name: "demo/project-pulse", status: "unknown", owner: null}, milestones: [{title: "真实验收", state: "pending"}], milestone_progress: null, source: "https://pulse.example/api/v1/projects/scoped", fetched_at: "2026-11-16T10:00:00Z"};

it("keeps discussion text while leaving generated import identifiers out of proposals", () => {
  expect(adoptionExcerpt("【生成的演示讨论 · 依据监控快照】\n\n多机回执仍待验收。\n\nPULSEBACKGROUND83c6709ba09fM0")).toBe("多机回执仍待验收。");
});

it("filters persisted history by author and exact date bounds, and refuses outsiders", async () => {
  const ada = await signIn("Ada"), grace = await signIn("Grace"), outsider = await signIn("Outsider");
  const room = await createRoom("Pulse", {as: ada, closedTo: [ada.user.id, grace.user.id]});
  const a = await connect(room.id, ada), g = await connect(room.id, grace);
  try {
    const first = await post(a, "older discussion"), second = await post(g, "latest discussion");
    const bindings: Partial<Env> = {PULSE_ROOMS: JSON.stringify({[room.id]: {projectId, memberIds: [ada.user.id, grace.user.id]}})};
    const query = new URLSearchParams({kind: "me", since: first.createdAt, until: new Date(Date.parse(second.createdAt) + 1000).toISOString()});
    const result = await apiWith(bindings, `/api/rooms/${room.id}/project/messages?${query}`, {headers: {Cookie: ada.cookie}});
    expect(result.status).toBe(200);
    expect((await result.json() as PulseMessagePage).messages.map(m => m.id)).toEqual([first.id]);
    expect((await apiWith(bindings, `/api/rooms/${room.id}/project/messages?kind=bot`, {headers: {Cookie: ada.cookie}})).status).toBe(200);
    expect((await apiWith(bindings, `/api/rooms/${room.id}/project/messages?author=${outsider.user.id}`, {headers: {Cookie: ada.cookie}})).status).toBe(422);
    expect((await apiWith(bindings, `/api/rooms/${room.id}/project/messages?since=2026-11-17T00:00:00.000Z&until=2026-11-16T00:00:00.000Z`, {headers: {Cookie: ada.cookie}})).status).toBe(422);
    expect((await apiWith(bindings, `/api/rooms/${room.id}/project/messages`, {headers: {Cookie: outsider.cookie}})).status).toBe(404);
  } finally {a.ws.close(); g.ws.close();}
});

it("persists an attributed adoption with real references, no fabricated completion, and idempotent retries", async () => {
  const ada = await signIn("Ada"), grace = await signIn("Grace");
  const room = await createRoom("Pulse", {as: ada, closedTo: [ada.user.id, grace.user.id]});
  const client = await connect(room.id, grace);
  try {
    const message = await post(client, "表单提交失败时应保留草稿");
    const bindings: Partial<Env> = {PULSE_URL: "https://pulse.example", PULSE_TOKEN: "secret", PULSE_ROOMS: JSON.stringify({[room.id]: {projectId, memberIds: [ada.user.id, grace.user.id]}})};
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(snapshot));
    const body = JSON.stringify({messageIds: [message.id], note: "优先保留填写内容", clientMessageId: crypto.randomUUID()});
    const path = `/api/rooms/${room.id}/project/adoptions`;
    expect((await apiWith(bindings, path, {method: "POST", headers: {Cookie: grace.cookie}, body})).status).toBe(403);
    const result = await apiWith(bindings, path, {method: "POST", headers: {Cookie: ada.cookie}, body});
    expect(result.status).toBe(201);
    const answer = await result.json() as PulseAdoptionAnswer;
    expect(answer.mode).toBe("structured");
    expect(answer.message?.plainText).toContain("状态：待执行");
    expect(answer.message?.plainText).toContain("0（未调用模型）");
    expect(answer.message?.body).toContain(`/rooms/${room.id}/@${message.id}`);
    expect(answer.message?.plainText).toContain("表单提交失败时应保留草稿");
    fetch.mockClear();
    const retry = await apiWith(bindings, path, {method: "POST", headers: {Cookie: ada.cookie}, body});
    expect(retry.status).toBe(200); expect((await retry.json() as PulseAdoptionAnswer).message).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    const adopted = await apiWith(bindings, `/api/rooms/${room.id}/project/messages?adopted=1`, {headers: {Cookie: grace.cookie}});
    expect((await adopted.json() as PulseMessagePage).messages.map(m => m.id)).toEqual([answer.message!.id]);
    const other = await createRoom("Other", {as: ada, closedTo: [ada.user.id]});
    const denied = await apiWith(bindings, path, {method: "POST", headers: {Cookie: ada.cookie}, body: JSON.stringify({messageIds: [other.id], note: "", clientMessageId: crypto.randomUUID()})});
    expect(denied.status).toBe(409);
  } finally {client.ws.close();}
});

it("serves only an explicitly configured, correctly scoped fallback, labelled with its original date", async () => {
  const ada = await signIn("Ada");
  const room = await createRoom("Pulse", {as: ada, closedTo: [ada.user.id]});
  const key = "demo/project-pulse", source = "http://192.168.16.70:4185/api/v1/dashboard?days=7";
  const saved = {...snapshot, project: {...snapshot.project, key}, source, window: {days: 7}, freshness: {status: "snapshot", captured_at: snapshot.fetched_at}} as PulseSnapshot;
  const bindings: Partial<Env> = {PULSE_SOURCE: "dashboard", PULSE_URL: "http://192.168.16.70:4185", PULSE_HTTP_ORIGIN: "http://192.168.16.70:4185", PULSE_ROOMS: JSON.stringify({[room.id]: {projectId: key, memberIds: [ada.user.id]}}), PULSE_DEMO_SNAPSHOTS: JSON.stringify({[key]: saved})};
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  const response = await apiWith(bindings, `/api/rooms/${room.id}/project`, {headers: {Cookie: ada.cookie}});
  expect(response.status).toBe(200);
  const data = await response.json() as PulseSnapshot;
  expect(data.freshness).toMatchObject({status: "snapshot", captured_at: snapshot.fetched_at});
  expect(data.team?.people).toBe(1); expect(data.team?.bots).toBe(0);
  expect(data.introduction?.pains.length).toBeGreaterThan(0);
  const wrong = {...saved, project: {...saved.project, key: "demo/other"}};
  expect((await apiWith({...bindings, PULSE_DEMO_SNAPSHOTS: JSON.stringify({[key]: wrong})}, `/api/rooms/${room.id}/project`, {headers: {Cookie: ada.cookie}})).status).toBe(502);
});
