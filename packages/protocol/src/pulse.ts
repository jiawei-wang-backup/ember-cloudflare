export interface PulseUsage { input_tokens: string | null; cached_input_tokens: string | null; output_tokens: string | null }
export interface PulseIntroduction { background: string; pains: string[]; value: string }
export interface PulseTeam { people: number; bots: number; owner?: {id: string; name: string} | null; members: Array<{id: string; name: string; bot: boolean}> }
export interface PulseMessageFilter { author?: string; kind?: "all" | "bot" | "me"; since?: string; until?: string; before?: string }
export interface PulseMessagePage { messages: import("./index.ts").Message[]; before: string | null; hasMore: boolean }
export interface PulseProjectSummary { roomId: string; name: string; progress: PulseSnapshot["milestone_progress"]; freshness?: PulseSnapshot["freshness"] }
export interface PulseAdoptionRequest { messageIds: string[]; note: string; clientMessageId: string; moduleId?: string }
export interface PulseAdoptionAnswer { message: import("./index.ts").Message | null; mode: "llm" | "structured"; warning?: string; feedback?: import("./project-work.ts").ProjectFeedback }
export function parsePulseAdoption(value: unknown): PulseAdoptionRequest | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.messageIds) || !data.messageIds.length || data.messageIds.length > 20 || data.messageIds.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) || new Set(data.messageIds).size !== data.messageIds.length) return null;
  if (typeof data.note !== "string" || data.note.length > 1000 || typeof data.clientMessageId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data.clientMessageId)) return null;
  if (data.moduleId !== undefined && (typeof data.moduleId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(data.moduleId))) return null;
  return {messageIds: data.messageIds as string[], note: data.note.trim(), clientMessageId: data.clientMessageId, ...(data.moduleId ? {moduleId: data.moduleId as string} : {})};
}

/** Keep integer precision; the abbreviated value is for display, the original stays available. */
export function compactPulseNumber(value: string | null | undefined): string {
  if (value == null) return "未知";
  const integer = BigInt(value);
  const unit = integer >= 100_000_000n ? [100_000_000n, "亿"] as const : integer >= 10_000n ? [10_000n, "万"] as const : null;
  if (!unit) return integer.toLocaleString("zh-CN");
  const hundredths = (integer * 100n + unit[0] / 2n) / unit[0];
  const decimal = String(hundredths % 100n).padStart(2, "0").replace(/0+$/, "");
  return `${hundredths / 100n}${decimal ? `.${decimal}` : ""} ${unit[1]}`;
}

export const pulseStatusLabels = {
  on_track: "进行中", blocked: "已阻塞", paused: "已暂停", completed: "已完成", unknown: "待确认",
  open: "待处理", merged: "已合并", closed: "已关闭", draft: "草稿", pending: "待确认", awaiting_acceptance: "待验收", recorded: "记录完成", accepted: "已验收",
} as const;
export type PulseStatus = keyof typeof pulseStatusLabels;
export interface PulseSnapshot {
  ember_snapshot?: boolean;
  metrics_source?: string;
  freshness?: {status: "live" | "snapshot"; captured_at: string; reason?: string};
  team?: PulseTeam;
  introduction?: PulseIntroduction;
  can_adopt?: boolean;
  business?: import("./project-work.ts").BusinessOverview;
  project: { repository_id: string | null; key?: string; full_name: string; repositories?: string[]; goal?: string; status: string; owner: {display_name: string} | null; owner_basis?: "participants" };
  window: {days: number; since: string; until: string; kind?: "calendar-utc8"}; fetched_at: string; source: string;
  usage: PulseUsage & {events: number | null; updated_at: string | null};
  members: Array<{developer_id: string | null; display_name: string; role: string; last_activity_at: string; sessions: number; usage: PulseUsage | null}>;
  models: Array<PulseUsage & {provider: string | null; model: string | null}>;
  pulls: Array<{number: string; title: string; url: string; state: string; updated_at: string; repository_full_name?: string; is_draft?: boolean}>;
  milestones: Array<{title: string; state: string; due_on: string | null; ember_message_id?: string; evidence?: string}>;
  milestone_progress: {accepted: number; completed?: number; total: number; percent: number; basis?: "reported" | "accepted"} | null;
  activities: Array<{display_name: string; title: string | null; summary: string | null; last_activity_at: string}>;
  latest_report: unknown; observation: unknown;
  cost: {amount: null; label: string}; quota: {scope: string; status: string; reason: string}; caveats: string[];
}
