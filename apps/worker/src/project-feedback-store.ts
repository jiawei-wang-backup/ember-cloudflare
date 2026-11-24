import {feedbackStatuses, type ProjectFeedback, type FeedbackEvent, type NewFeedback, type ChangeFeedback, type User, type FeedbackStatus, type FeedbackPage} from "@ember/protocol";
import {statement, type Db} from "./db";

export class FeedbackError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {super(message); this.status = status;}
}
export class ProjectFeedbackStore {
  readonly db: Db;
  readonly roomId: string;
  constructor(db: Db, roomId: string) {this.db = db; this.roomId = roomId;}
  async get(id: string): Promise<ProjectFeedback | null> {
    const [row] = await this.db.all<{record: string}>("SELECT record FROM project_feedback WHERE room_id = ? AND id = ?", this.roomId, id);
    return row ? JSON.parse(row.record) : null;
  }
  async event(requestId: string): Promise<FeedbackEvent & {feedbackId: string} | null> {
    const [row] = await this.db.all<{record: string; feedback_id: string}>("SELECT record, feedback_id FROM project_feedback_events WHERE room_id = ? AND request_id = ?", this.roomId, requestId);
    return row ? {...JSON.parse(row.record), feedbackId: row.feedback_id} : null;
  }
  async openFollowUp(): Promise<ProjectFeedback | null> {
    const [row] = await this.db.all<{record: string}>(
      "SELECT record FROM project_feedback WHERE room_id = ? AND status IN ('submitted', 'adopted', 'in_progress', 'blocked', 'awaiting_acceptance') AND json_extract(record, '$.demo') = 0 ORDER BY CASE WHEN status = 'awaiting_acceptance' THEN 0 WHEN status = 'blocked' THEN 1 ELSE 2 END, updated_at DESC, id DESC LIMIT 1",
      this.roomId,
    );
    return row ? JSON.parse(row.record) : null;
  }
  async list(before?: string): Promise<Omit<FeedbackPage, "canManage">> {
    const rows = before ? await this.db.all<{record: string}>("SELECT record FROM project_feedback WHERE room_id = ? AND (created_at, id) < (SELECT created_at, id FROM project_feedback WHERE room_id = ? AND id = ?) ORDER BY created_at DESC, id DESC LIMIT 101", this.roomId, this.roomId, before) : await this.db.all<{record: string}>("SELECT record FROM project_feedback WHERE room_id = ? ORDER BY created_at DESC, id DESC LIMIT 101", this.roomId);
    const items = rows.slice(0, 100).map(r => JSON.parse(r.record) as ProjectFeedback);
    const counts = Object.fromEntries(Object.keys(feedbackStatuses).map(status => [status, 0])) as Record<FeedbackStatus, number>;
    for (const row of await this.db.all<{status: FeedbackStatus; n: number}>("SELECT status, count(*) AS n FROM project_feedback WHERE room_id = ? GROUP BY status", this.roomId)) counts[row.status] = row.n;
    return {items, counts, hasMore: rows.length > 100, before: items.at(-1)?.id ?? null};
  }
  async history(id: string): Promise<FeedbackEvent[]> {
    return (await this.db.all<{record: string}>("SELECT record FROM project_feedback_events WHERE room_id = ? AND feedback_id = ? ORDER BY version DESC LIMIT 100", this.roomId, id)).map(r => JSON.parse(r.record) as FeedbackEvent).reverse();
  }
  async create(input: NewFeedback, actor: User, adopted = false, proposalMessageId: string | null = null): Promise<ProjectFeedback> {
    const previous = await this.event(input.requestId);
    if (previous) return (await this.get(previous.feedbackId))!;
    const now = new Date().toISOString();
    const item: ProjectFeedback = {id: crypto.randomUUID(), roomId: this.roomId, title: input.title, description: input.description, moduleId: input.moduleId, milestoneId: input.milestoneId, sourceMessageIds: input.sourceMessageIds, proposalMessageId, status: adopted ? "adopted" : "submitted", assignee: null, dueOn: null, criteria: "", evidence: [], version: 1, demo: input.demo, createdBy: actor, createdAt: now, updatedAt: now};
    const event: FeedbackEvent = {id: crypto.randomUUID(), requestId: input.requestId, action: adopted ? "adopt" : "submit", actor, from: null, to: item.status, note: adopted ? "从已采纳讨论建立落实事项；执行人和验收条件待确认。" : input.description, evidence: [], at: now};
    await this.db.batch([
      statement("INSERT INTO project_feedback (room_id, id, status, created_at, updated_at, version, last_request_id, record) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", this.roomId, item.id, item.status, now, now, 1, input.requestId, JSON.stringify(item)),
      statement("INSERT INTO project_feedback_events (room_id, feedback_id, version, request_id, created_at, record) VALUES (?, ?, ?, ?, ?, ?)", this.roomId, item.id, 1, input.requestId, now, JSON.stringify(event)),
    ]);
    return item;
  }
  async change(id: string, input: ChangeFeedback, actor: User, canManage: boolean, assignee?: User | null): Promise<ProjectFeedback> {
    const previous = await this.event(input.requestId);
    if (previous) {if (previous.feedbackId !== id) throw new FeedbackError(409, "该请求编号已用于另一条反馈"); return (await this.get(id))!;}
    const item = await this.get(id);
    if (!item) throw new FeedbackError(404, "反馈不存在");
    if (item.version !== input.version) throw new FeedbackError(409, "反馈已被更新，请刷新后重试");
    const executes = canManage || item.assignee?.id === actor.id;
    const from = item.status;
    const permitted: Record<ChangeFeedback["action"], FeedbackStatus[]> = {adopt: ["submitted"], assign: ["adopted", "in_progress", "blocked"], start: ["adopted", "blocked"], block: ["in_progress"], deliver: ["in_progress"], accept: ["awaiting_acceptance"], reopen: ["awaiting_acceptance", "accepted", "rejected"], reject: ["submitted", "adopted"], comment: Object.keys(feedbackStatuses) as FeedbackStatus[]};
    if (!permitted[input.action].includes(from)) throw new FeedbackError(409, "当前状态不能执行此操作");
    if (["adopt", "assign", "accept", "reject", "reopen"].includes(input.action) ? !canManage : input.action !== "comment" && !executes) throw new FeedbackError(403, "你没有执行此操作的权限");
    const next = {...item, version: item.version + 1, updatedAt: new Date().toISOString()};
    if (["adopt", "assign"].includes(input.action)) {
      if (input.moduleId) next.moduleId = input.moduleId;
      if (input.milestoneId !== undefined) next.milestoneId = input.milestoneId;
      if (assignee !== undefined) next.assignee = assignee;
      if (input.dueOn !== undefined) next.dueOn = input.dueOn;
      if (input.criteria !== undefined) next.criteria = input.criteria.trim();
      if (!next.assignee || !next.criteria) throw new FeedbackError(422, "采纳和分派时需明确执行人及验收条件");
    }
    const states: Partial<Record<ChangeFeedback["action"], FeedbackStatus>> = {adopt: "adopted", start: "in_progress", block: "blocked", deliver: "awaiting_acceptance", accept: "accepted", reopen: "in_progress", reject: "rejected"};
    next.status = input.action === "reopen" && from === "rejected" ? "submitted" : states[input.action] ?? from;
    if (["start", "deliver"].includes(input.action) && (!next.assignee || !next.criteria)) throw new FeedbackError(422, "请先补齐执行人和验收条件");
    if (input.action === "deliver") {
      if (!input.evidence?.length) throw new FeedbackError(422, "提交验收必须提供 PR、产出文档或验证记录链接");
      next.evidence = input.evidence;
    }
    if (input.action === "accept" && (!next.evidence.length || !next.criteria)) throw new FeedbackError(422, "缺少交付证据或验收条件，不能标记已验收");
    const event: FeedbackEvent = {id: crypto.randomUUID(), requestId: input.requestId, action: input.action, actor, from, to: next.status, note: input.note, evidence: input.evidence ?? [], at: next.updatedAt};
    const result = await this.db.batch([
      statement("UPDATE project_feedback SET status = ?, updated_at = ?, version = ?, last_request_id = ?, record = ? WHERE room_id = ? AND id = ? AND version = ? RETURNING id", next.status, next.updatedAt, next.version, input.requestId, JSON.stringify(next), this.roomId, id, item.version),
      statement("INSERT INTO project_feedback_events (room_id, feedback_id, version, request_id, created_at, record) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM project_feedback WHERE room_id = ? AND id = ? AND version = ? AND last_request_id = ?)", this.roomId, id, next.version, input.requestId, next.updatedAt, JSON.stringify(event), this.roomId, id, next.version, input.requestId),
    ]);
    if (!result[0]?.length) throw new FeedbackError(409, "反馈已被其他人更新，请刷新");
    return next;
  }
}
