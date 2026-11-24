import type { PulseSnapshot } from "@ember/protocol";

export type ProjectFacts = {
  goal?: string;
  status?: string;
  progress?: string[];
  milestones?: PulseSnapshot["milestones"];
  pulls?: PulseSnapshot["pulls"];
};

export type ProjectUpdate = {revision: string; observedAt: string; facts: ProjectFacts};
export type StoredProject = ProjectUpdate & {
  repository: string;
  updatedAt: string;
  reporter: {id: string; name: string};
  submittedBy?: string;
};

const statuses = ["on_track", "blocked", "completed", "paused", "unknown"];
const bounded = (value: unknown, max: number) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const instant = (value: unknown): value is string => typeof value === "string" &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function parseProjectUpdate(value: unknown, repository: string): ProjectUpdate | null {
  if (!object(value) || Object.keys(value).some(key => !["revision", "observedAt", "facts"].includes(key)) ||
      typeof value.revision !== "string" || !/^[a-f0-9]{32}$/.test(value.revision) ||
      !instant(value.observedAt) || Date.parse(value.observedAt) > Date.now() + 300_000 || !object(value.facts)) return null;
  const raw = value.facts;
  if (Object.keys(raw).some(key => !["goal", "status", "progress", "milestones", "pulls"].includes(key))) return null;
  const facts: ProjectFacts = {};
  if (raw.goal !== undefined) {
    if (!bounded(raw.goal, 600)) return null;
    facts.goal = (raw.goal as string).trim();
  }
  if (raw.status !== undefined) {
    if (typeof raw.status !== "string" || !statuses.includes(raw.status)) return null;
    facts.status = raw.status;
  }
  if (raw.progress !== undefined) {
    if (!Array.isArray(raw.progress) || raw.progress.length > 8 || raw.progress.some(item => !bounded(item, 600))) return null;
    facts.progress = [...new Set(raw.progress.map((item: string) => item.trim()))];
  }
  if (raw.milestones !== undefined) {
    if (!Array.isArray(raw.milestones) || raw.milestones.length > 24) return null;
    facts.milestones = [];
    for (const item of raw.milestones) {
      if (!object(item) || !bounded(item.title, 160) || !["pending", "completed"].includes(item.state as string) ||
          (item.evidence !== undefined && !bounded(item.evidence, 600)) ||
          (item.due_on != null && (typeof item.due_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.due_on)))) return null;
      facts.milestones.push({title: (item.title as string).trim(), state: item.state as string,
        due_on: (item.due_on as string | undefined) ?? null, ...(typeof item.evidence === "string" && {evidence: item.evidence})});
    }
  }
  if (raw.pulls !== undefined) {
    if (!Array.isArray(raw.pulls) || raw.pulls.length > 30) return null;
    facts.pulls = [];
    for (const pull of raw.pulls) {
      if (!object(pull) || !bounded(pull.title, 180) || typeof pull.number !== "string" ||
          !/^[1-9]\d{0,11}$/.test(pull.number) || !["open", "closed", "merged"].includes(pull.state as string) ||
          !instant(pull.updated_at) || (pull.is_draft !== undefined && typeof pull.is_draft !== "boolean")) return null;
      const url = `https://github.com/${repository}/pull/${pull.number}`;
      if (typeof pull.url !== "string" || pull.url.toLowerCase() !== url) return null;
      facts.pulls.push({number: pull.number, title: (pull.title as string).trim(), url, state: pull.state as string,
        updated_at: pull.updated_at, repository_full_name: repository, is_draft: pull.is_draft === true});
    }
  }
  return Object.keys(facts).length ? {revision: value.revision, observedAt: value.observedAt, facts} : null;
}

export function projectUpdateText(project: StoredProject) {
  const {goal, status, progress, milestones, pulls} = project.facts;
  const statusLabels: Record<string, string> = {on_track: "进行中", blocked: "受阻", completed: "已完成", paused: "已暂停", unknown: "待确认"};
  const notes = (progress ?? []).slice(0, 4).map(line => line.slice(0, 300));
  const lead = notes[0] ?? (milestones?.length
    ? `已完成 ${milestones.filter(item => item.state === "completed").length}/${milestones.length} 项里程碑。`
    : status ? `项目目前${statusLabels[status]}。` : "项目资料已更新。");
  return [
    `项目进展 · ${project.repository}`,
    lead,
    status && `状态 · ${statusLabels[status]}`,
    goal && `目标 · ${goal.slice(0, 200)}`,
    ...notes.slice(1),
    ...((milestones ?? []).slice(0, 6).map(item => `${item.state === "completed" ? "已完成" : "待完成"} · ${item.title}`)),
    ...((pulls ?? []).slice(0, 3).map(pull => `PR #${pull.number} · ${pull.title}`)),
  ].filter(Boolean).join("\n\n");
}

export function projectOverview(project: StoredProject, days: number): PulseSnapshot {
  const {goal, status, milestones = [], pulls = [], progress = []} = project.facts;
  const completed = milestones.filter(item => item.state === "completed").length;
  const until = new Date().toISOString();
  return {
    ember_snapshot: true, source: "Ember 项目快照", fetched_at: project.updatedAt,
    freshness: {status: "live", captured_at: project.updatedAt},
    window: {days, since: new Date(Date.parse(until) - days * 86_400_000).toISOString(), until},
    project: {repository_id: null, key: project.repository, full_name: project.repository, goal, status: status ?? "unknown", owner: null},
    usage: {input_tokens: null, cached_input_tokens: null, output_tokens: null, events: null, updated_at: null},
    members: [], models: [], pulls, milestones,
    milestone_progress: milestones.length ? {accepted: 0, completed, total: milestones.length, percent: Math.round(completed / milestones.length * 100), basis: "reported"} : null,
    activities: progress.map(text => ({display_name: project.reporter.name, title: text, summary: null, last_activity_at: project.updatedAt})),
    latest_report: {observed_at: project.observedAt}, observation: null,
    cost: {amount: null, label: "费用由 Project Pulse 统计"}, quota: {scope: "project", status: "unknown", reason: "暂无用量配额信息"},
    caveats: [],
  };
}
