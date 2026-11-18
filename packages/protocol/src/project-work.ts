import type { User } from "./index.ts";

export interface BusinessMilestone { id: string; title: string; state: string; evidence: string; sourceTitle: string }
export interface BusinessModule {
  id: string; name: string; outcome: string; scenario: string; help: string;
  milestones: BusinessMilestone[]; status: "recorded" | "pending" | "blocked" | "unknown";
  available: string[]; blockers: string[]; acceptance: string; availability: string;
}
export interface BusinessOverview { audience: string; outcome: string; modules: BusinessModule[]; journeys?: Array<{id: string; title: string; moduleIds: string[]; state: "pending" | "awaiting_acceptance" | "blocked"; acceptance: string; recorded: number; total: number}>; provenance: string }

export const feedbackStatuses = {submitted: "待评估", adopted: "已采纳", in_progress: "落实中", blocked: "受阻", awaiting_acceptance: "待验收", accepted: "已验收", rejected: "暂不采纳"} as const;
export type FeedbackStatus = keyof typeof feedbackStatuses;
export type FeedbackAction = "adopt" | "assign" | "start" | "block" | "deliver" | "accept" | "reopen" | "reject" | "comment";
export interface FeedbackEvidence {label: string; url: string}
export interface ProjectFeedback {
  id: string; roomId: string; title: string; description: string; moduleId: string; milestoneId: string | null;
  sourceMessageIds: string[]; proposalMessageId: string | null; status: FeedbackStatus; assignee: User | null;
  dueOn: string | null; criteria: string; evidence: FeedbackEvidence[]; version: number; demo: boolean;
  createdBy: User; createdAt: string; updatedAt: string;
}
export interface FeedbackEvent {id: string; requestId: string; action: FeedbackAction | "submit"; actor: User; from: FeedbackStatus | null; to: FeedbackStatus; note: string; evidence: FeedbackEvidence[]; at: string}
export interface FeedbackPage {items: ProjectFeedback[]; hasMore: boolean; before: string | null; counts: Record<FeedbackStatus, number>; canManage: boolean}
export interface NewFeedback {requestId: string; title: string; description: string; moduleId: string; milestoneId: string | null; sourceMessageIds: string[]; demo: boolean}
export interface ChangeFeedback {requestId: string; version: number; action: FeedbackAction; note: string; moduleId?: string; milestoneId?: string | null; assigneeId?: string | null; dueOn?: string | null; criteria?: string; evidence?: FeedbackEvidence[]}
const id = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v);
const text = (v: unknown, max: number, required = false): v is string => typeof v === "string" && v.length <= max && (!required || !!v.trim());
export function validFeedbackUrl(value: string): boolean {
  if (/^\/rooms\/[a-zA-Z0-9_-]+(?:\/(?:@|threads\/)[a-zA-Z0-9_@/-]+)?$/.test(value)) return true;
  if (/^http:\/\/(?:localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d{1,5})?\/rooms\/[a-zA-Z0-9_@/?=&%.-]+$/.test(value)) return true;
  return /^https:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?::\d{1,5})?(?:[/?#][^\s<>"\\]*)?$/.test(value);
}
export function parseNewFeedback(value: unknown): NewFeedback | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!id(v.requestId) || !text(v.title, 160, true) || !text(v.description, 6000, true) || !id(v.moduleId) || !(v.milestoneId == null || id(v.milestoneId))) return null;
  if (!Array.isArray(v.sourceMessageIds) || v.sourceMessageIds.length > 20 || !v.sourceMessageIds.every(id) || new Set(v.sourceMessageIds).size !== v.sourceMessageIds.length || (v.demo !== undefined && typeof v.demo !== "boolean")) return null;
  return {requestId: v.requestId, title: v.title.trim(), description: v.description.trim(), moduleId: v.moduleId, milestoneId: v.milestoneId as string | null ?? null, sourceMessageIds: v.sourceMessageIds as string[], demo: v.demo === true};
}
export function parseChangeFeedback(value: unknown): ChangeFeedback | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!id(v.requestId) || !Number.isSafeInteger(v.version) || Number(v.version) < 1 || !["adopt", "assign", "start", "block", "deliver", "accept", "reopen", "reject", "comment"].includes(String(v.action)) || !text(v.note, 4000, true)) return null;
  if (v.moduleId !== undefined && !id(v.moduleId) || v.milestoneId != null && !id(v.milestoneId) || v.assigneeId != null && !id(v.assigneeId) || v.criteria !== undefined && !text(v.criteria, 4000)) return null;
  if (v.dueOn != null && !(typeof v.dueOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.dueOn) && Number.isFinite(Date.parse(v.dueOn)) && new Date(v.dueOn).toISOString().slice(0, 10) === v.dueOn)) return null;
  if (v.evidence !== undefined && (!Array.isArray(v.evidence) || v.evidence.length > 10 || v.evidence.some(e => !e || !text(e.label, 160, true) || !text(e.url, 2000, true) || !validFeedbackUrl(e.url)))) return null;
  return v as unknown as ChangeFeedback;
}
