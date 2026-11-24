import {beforeEach, it, expect} from "vitest";
import {apiWith, connect, createRoom, freshDeploy, roomSql, roomStub, sharedD1, signIn} from "./support";
import type {NewFeedback, ProjectFeedback, ChangeFeedback, FeedbackEvent, ProjectFollowUp} from "@ember/protocol";
beforeEach(freshDeploy);
async function setup() {
  const manager = await signIn("Manager"), executor = await signIn("Executor"), colleague = await signIn("Colleague"), outsider = await signIn("Outsider");
  const room = await createRoom("Pulse", {as: manager, closedTo: [manager.user.id, executor.user.id, colleague.user.id]});
  const bindings = {PULSE_SOURCE: "dashboard" as const, PULSE_ROOMS: JSON.stringify({[room.id]: {projectId: "jiawei-wang-dev/project-pulse", memberIds: [manager.user.id, executor.user.id, colleague.user.id]}})};
  const url = `/api/rooms/${room.id}/project/feedback`;
  const input: NewFeedback = {requestId: crypto.randomUUID(), title: "业务同事需要核对同步结果", description: "希望看到触发时间与回执，方便复验。", moduleId: "collection", milestoneId: "collection-2", sourceMessageIds: [], demo: false};
  const create = async () => {
    const response = await apiWith(bindings, url, {method: "POST", headers: {Cookie: colleague.cookie}, body: JSON.stringify(input)});
    expect(response.status).toBe(201);
    return (await response.json() as {item: ProjectFeedback}).item;
  };
  return {manager, executor, colleague, outsider, bindings, room, url, input, create};
}
it("lets collaborators submit feedback, while only a project manager can adopt and assign it", async () => {
  const c = await setup(), item = await c.create();
  expect(item.status).toBe("submitted"); expect(item.assignee).toBeNull();
  const update: ChangeFeedback = {requestId: crypto.randomUUID(), version: 1, action: "adopt", note: "采纳，明确验证范围", assigneeId: c.executor.user.id, criteria: "核对三种系统的触发与回执"};
  expect((await apiWith(c.bindings, `${c.url}/${item.id}`, {method: "PATCH", headers: {Cookie: c.colleague.cookie}, body: JSON.stringify(update)})).status).toBe(403);
  expect((await apiWith(c.bindings, `${c.url}/${item.id}`, {method: "PATCH", headers: {Cookie: c.manager.cookie}, body: JSON.stringify({...update, criteria: ""})})).status).toBe(422);
  expect((await apiWith(c.bindings, `${c.url}/${item.id}`, {method: "PATCH", headers: {Cookie: c.manager.cookie}, body: JSON.stringify({...update, assigneeId: c.outsider.user.id})})).status).toBe(422);
  const response = await apiWith(c.bindings, `${c.url}/${item.id}`, {method: "PATCH", headers: {Cookie: c.manager.cookie}, body: JSON.stringify(update)});
  expect(response.status).toBe(200); expect((await response.json() as {item: ProjectFeedback}).item).toMatchObject({status: "adopted", version: 2, assignee: c.executor.user, criteria: update.criteria});
});
it("runs implementation, blocking, delivery, acceptance and reopening with an immutable audit trail", async () => {
  const c = await setup(); let item = await c.create();
  const apply = async (action: ChangeFeedback["action"], who = c.manager, extra = {}) => {
    const input = {requestId: crypto.randomUUID(), version: item.version, action, note: `实际记录：${action}`, ...extra};
    const response = await apiWith(c.bindings, `${c.url}/${item.id}`, {method: "PATCH", headers: {Cookie: who.cookie}, body: JSON.stringify(input)});
    expect(response.status).toBe(200); item = (await response.json() as {item: ProjectFeedback}).item;
    return input;
  };
  await apply("adopt", c.manager, {assigneeId: c.executor.user.id, criteria: "核对回执是否能定位到触发设备"});
  await apply("start", c.executor); await apply("block", c.executor); await apply("start", c.executor);
  const failed = await apiWith(c.bindings, `${c.url}/${item.id}`, {method: "PATCH", headers: {Cookie: c.executor.cookie}, body: JSON.stringify({requestId: crypto.randomUUID(), version: item.version, action: "deliver", note: "尚无证据", evidence: []})});
  expect(failed.status).toBe(422);
  await apply("deliver", c.executor, {evidence: [{label: "验证记录", url: `https://github.com/jiawei-wang-dev/project-pulse/pull/1`}]});
  expect(item.status).toBe("awaiting_acceptance");
  expect((await apiWith(c.bindings, `${c.url}/${item.id}`, {method: "PATCH", headers: {Cookie: c.executor.cookie}, body: JSON.stringify({requestId: crypto.randomUUID(), version: item.version, action: "accept", note: "执行人不能替负责人验收"})})).status).toBe(403);
  const accepted = await apply("accept"); expect(item.status).toBe("accepted");
  const retry = await apiWith(c.bindings, `${c.url}/${item.id}`, {method: "PATCH", headers: {Cookie: c.manager.cookie}, body: JSON.stringify(accepted)});
  expect(retry.status).toBe(200); expect((await retry.json() as {item: ProjectFeedback}).item.version).toBe(item.version);
  await apply("reopen"); expect(item.status).toBe("in_progress");
  const detail = await (await apiWith(c.bindings, `${c.url}/${item.id}`, {headers: {Cookie: c.colleague.cookie}})).json() as {events: FeedbackEvent[]};
  expect(detail.events.map(event => event.to)).toEqual(["submitted", "adopted", "in_progress", "blocked", "in_progress", "awaiting_acceptance", "accepted", "in_progress"]);
  expect(detail.events.at(-1)?.actor.id).toBe(c.manager.user.id);
});
it("refuses stale edits, forged evidence, invalid modules and cross-project reads", async () => {
  const c = await setup(), item = await c.create();
  expect((await apiWith(c.bindings, c.url)).status).toBe(401);
  expect((await apiWith(c.bindings, `${c.url}/${item.id}`, {headers: {Cookie: c.outsider.cookie}})).status).toBe(404);
  expect((await apiWith(c.bindings, c.url, {method: "POST", headers: {Cookie: c.manager.cookie}, body: JSON.stringify({...c.input, requestId: crypto.randomUUID(), moduleId: "not-this-project"})})).status).toBe(422);
  const change = {requestId: crypto.randomUUID(), version: 1, action: "comment", note: "补充一个样本"};
  expect((await apiWith(c.bindings, `${c.url}/${item.id}`, {method: "PATCH", headers: {Cookie: c.colleague.cookie}, body: JSON.stringify(change)})).status).toBe(200);
  expect((await apiWith(c.bindings, `${c.url}/${item.id}`, {method: "PATCH", headers: {Cookie: c.colleague.cookie}, body: JSON.stringify({...change, requestId: crypto.randomUUID()})})).status).toBe(409);
  expect((await apiWith(c.bindings, `${c.url}/${item.id}`, {method: "PATCH", headers: {Cookie: c.manager.cookie}, body: JSON.stringify({...change, requestId: crypto.randomUUID(), version: 2, evidence: [{label: "伪造链接", url: "javascript:alert(1)"}]})})).status).toBe(422);
  const other = await createRoom("Other", {as: c.manager, closedTo: [c.manager.user.id]});
  const bindings = {...c.bindings, PULSE_ROOMS: JSON.stringify({[other.id]: {projectId: "jiawei-wang-dev/project-pulse", memberIds: [c.manager.user.id]}})};
  expect((await apiWith(bindings, `/api/rooms/${other.id}/project/feedback/${item.id}`, {headers: {Cookie: c.manager.cookie}})).status).toBe(404);
});
it("tracks a snapshot follow-up once and removes it from discussion after acceptance", async () => {
  const c = await setup(), repository = "jiawei-wang-dev/project-pulse";
  const snapshot = "补齐上线环境和恢复回执";
  const saveSnapshot = (revision: string, time: number, progress: string[]) => roomStub(c.room.id).syncProjectSnapshot(
    c.room.id, repository, {revision:revision.repeat(32), observedAt:new Date(time).toISOString(), facts:{progress}},
    {user:c.manager.user, tags:[], authorizedAt:Date.now()}, false,
  );
  const now = Date.now();
  await saveSnapshot("a", now - 100, ["下一步：" + snapshot]);
  const followUp = async () => {
    const response = await apiWith(c.bindings, c.url + "?followUp=1", {headers:{Cookie:c.colleague.cookie}});
    expect(response.status).toBe(200);
    return await response.json() as ProjectFollowUp;
  };
  expect(await followUp()).toEqual({item:null, snapshot});
  const track = (snapshotFollowUp: string, who = c.colleague) => apiWith(c.bindings, c.url, {
    method:"POST", headers:{Cookie:who.cookie},
    body:JSON.stringify({...c.input, requestId:crypto.randomUUID(), snapshotFollowUp}),
  });
  expect((await track("已经过期的下一步")).status).toBe(409);
  const [first, second] = await Promise.all([track(snapshot), track(snapshot, c.manager)]);
  expect([first.status, second.status]).toEqual([201, 201]);
  let {item} = await first.json() as {item:ProjectFeedback};
  expect((await second.json() as {item:ProjectFeedback}).item.id).toBe(item.id);
  expect(await followUp()).toMatchObject({item:{id:item.id, status:"submitted"}, snapshot:null});
  await saveSnapshot("b", now, ["最近交付：已经灰度", "下一步：" + snapshot]);
  const apply = async (action: ChangeFeedback["action"], who = c.manager, extra = {}) => {
    const response = await apiWith(c.bindings, `${c.url}/${item.id}`, {
      method:"PATCH", headers:{Cookie:who.cookie},
      body:JSON.stringify({requestId:crypto.randomUUID(), version:item.version, action, note:"核对发布回执", ...extra}),
    });
    expect(response.status).toBe(200);
    ({item} = await response.json() as {item:ProjectFeedback});
  };
  await apply("adopt", c.manager, {assigneeId:c.executor.user.id, criteria:"确认环境和恢复回执"});
  await apply("start", c.executor);
  await apply("deliver", c.executor, {evidence:[{label:"验证记录", url:"https://example.org/release"}]});
  expect(await followUp()).toMatchObject({item:{id:item.id, status:"awaiting_acceptance"}});
  await apply("accept");
  expect(await followUp()).toEqual({item:null, snapshot:null});
  await apply("reopen");
  expect(await followUp()).toMatchObject({item:{id:item.id, status:"in_progress"}});
});
it("tracks a fallback project with an Ember snapshot and no separate Pulse grant", async () => {
  const c = await setup(), repository = "example/observer-bot";
  const created = await apiWith({}, "/api/rooms", {
    method:"POST", headers:{Cookie:c.manager.cookie},
    body:JSON.stringify({kind:"closed", name:"Observer", channelGroup:"project", memberIds:[c.manager.user.id, c.colleague.user.id]}),
  });
  expect(created.status).toBe(201);
  const {room} = await created.json() as {room:{id:string}};
  const snapshot = "核对线上恢复回执";
  await roomStub(room.id).syncProjectSnapshot(room.id, repository, {
    revision:"f".repeat(32), observedAt:new Date().toISOString(), facts:{progress:["下一步：" + snapshot]},
  }, {user:c.manager.user, tags:[], authorizedAt:Date.now()}, false);
  const url = `/api/rooms/${room.id}/project/feedback`;
  const headers = {Cookie:c.colleague.cookie};
  const env = {PULSE_SOURCE:"dashboard" as const, PULSE_TEAM_PROJECT_CHANNELS:"true"};
  expect(await (await apiWith(env, url + "?followUp=1", {headers})).json()).toEqual({item:null, snapshot});
  expect((await apiWith(env, url + "?followUp=1", {headers:{Cookie:c.outsider.cookie}})).status).toBe(404);
  const input = {...c.input, requestId:crypto.randomUUID(), moduleId:"reported", milestoneId:null, snapshotFollowUp:snapshot};
  const response = await apiWith(env, url, {method:"POST", headers, body:JSON.stringify(input)});
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({item:{moduleId:"reported", status:"submitted"}});
});
it("creates workflow tables lazily, leaving ordinary room storage unchanged", async () => {
  if (sharedD1()) return;
  const c = await setup(); const client = await connect(c.room.id, c.manager); client.ws.close();
  const query = "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'project_feedback%' ORDER BY name";
  expect(await roomSql(c.room.id, query)).toEqual([]);
  expect((await apiWith(c.bindings, c.url, {headers: {Cookie: c.manager.cookie}})).status).toBe(200);
  expect(await roomSql(c.room.id, query)).toEqual([{name: "project_feedback"}, {name: "project_feedback_events"}]);
  const ordinary = await createRoom("Ordinary", {as: c.manager}); const connected = await connect(ordinary.id, c.manager); connected.ws.close();
  expect(await roomSql(ordinary.id, query)).toEqual([]);
});
