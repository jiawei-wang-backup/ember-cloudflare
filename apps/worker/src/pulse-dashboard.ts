import type { PulseSnapshot } from "@ember/protocol";

interface Report {
  project_key: string;
  owner_name?: string;
  goal: string;
  observed_at: string;
  milestones: Array<{title: string; state: string; evidence: string}>;
}
export interface PulseDashboard {
  projects: Array<{owner_name?: string; repository_id: string; full_name: string; repositories?: string[]; status: string; milestones: PulseSnapshot["milestones"]}>;
  project_reports: Report[];
  workspace_states: Array<{workspace_name: string; status: string}>;
  project_usage: Array<{project_key: string; input_tokens: string | null; output_tokens: string | null}>;
  memberships: Array<{developer_id?: string; display_name: string; full_name: string | null; workspace_name: string | null; session_count: number; last_activity_at: string}>;
  sessions: Array<{full_name: string | null; workspace_name: string | null; display_name: string; title: string | null; display_title?: string | null; summary: string | null; last_activity_at: string}>;
  pulls: Array<PulseSnapshot["pulls"][number] & {full_name: string}>;
}

/** The source scopes Token/activity aggregates by UTC+8 calendar days; PRs/reports are inventory. */
export function dashboardProject(data: PulseDashboard, projectKey: string, days: number, source: string, now = new Date()): PulseSnapshot {
  for (const key of ["projects", "project_reports", "workspace_states", "project_usage", "memberships", "sessions", "pulls"] as const) {
    if (!Array.isArray(data[key])) throw new Error(`Project Pulse 缺少 ${key}`);
  }
  const matches = (value: string | null) => value?.toLowerCase() === projectKey.toLowerCase();
  const project = data.projects.find(p => matches(p.full_name));
  const report = data.project_reports.filter(p => matches(p.project_key)).sort((a, b) => b.observed_at.localeCompare(a.observed_at))[0];
  if (!project && !report) throw new Error("Project Pulse 项目身份不匹配");
  const repositories = project?.repositories?.length ? project.repositories : [project?.full_name || report!.project_key];
  const keys = new Set([projectKey, ...repositories].map(key => key.toLowerCase()));
  const belongs = (fullName: string | null, workspace: string | null) => keys.has((fullName || workspace || "").toLowerCase());
  const usage = data.project_usage.filter(row => keys.has(row.project_key.toLowerCase()));
  const sum = (key: "input_tokens" | "output_tokens") => {
    if (!usage.length || usage.some(row => row[key] === null)) return null;
    if (usage.some(row => !/^\d+$/.test(String(row[key])))) throw new Error("Project Pulse 用量格式不正确");
    return usage.reduce((total, row) => total + BigInt(row[key]!), 0n).toString();
  };
  const members: PulseSnapshot["members"] = [];
  for (const row of data.memberships.filter(row => belongs(row.full_name, row.workspace_name))) {
    const found = members.find(member => row.developer_id ? member.developer_id === row.developer_id
      : member.developer_id === null && member.display_name === row.display_name);
    if (found) {
      found.sessions += row.session_count;
      if (row.last_activity_at > found.last_activity_at) found.last_activity_at = row.last_activity_at;
    } else members.push({developer_id: row.developer_id ?? null, display_name: row.display_name, role: "采集参与者（职责未提供）", last_activity_at: row.last_activity_at, sessions: row.session_count, usage: null});
  }
  const milestones = report ? report.milestones.map(m => ({...m, due_on: null})) : project!.milestones;
  const completed = milestones.filter(m => report ? m.state === "completed" : m.state === "accepted").length;
  const pulls = data.pulls.filter(p => matches(p.full_name)).map(p => ({number: p.number, title: p.title, url: p.url, state: p.state, updated_at: p.updated_at, is_draft: p.is_draft, repository_full_name: p.repository_full_name || new URL(p.url).pathname.split("/").slice(1, 3).join("/")}));
  const fetchedAt = now.toISOString();
  const ownerName = project?.owner_name || report?.owner_name;
  const day = 86_400_000, offset = 8 * 3_600_000;
  return {
    project: {key: projectKey.toLowerCase(), repository_id: project?.repository_id ?? null, full_name: project?.full_name || report!.project_key, repositories, goal: report?.goal, status: project?.status || data.workspace_states.find(s => matches(s.workspace_name))?.status || "unknown", owner: ownerName ? {display_name: ownerName} : null},
    window: {days, since: new Date((Math.floor((now.getTime() + offset) / day) - days + 1) * day - offset).toISOString(), until: fetchedAt, kind: "calendar-utc8"},
    fetched_at: fetchedAt, source,
    usage: {input_tokens: sum("input_tokens"), output_tokens: sum("output_tokens"), cached_input_tokens: null, events: null, updated_at: null},
    members, models: [], pulls, milestones,
    milestone_progress: milestones.length ? {accepted: report ? 0 : completed, completed, total: milestones.length, percent: Math.round(completed / milestones.length * 100), basis: report ? "reported" : "accepted"} : null,
    activities: data.sessions.filter(s => belongs(s.full_name, s.workspace_name)).map(s => ({display_name: s.display_name, title: s.display_title || s.title, summary: s.summary, last_activity_at: s.last_activity_at})),
    latest_report: report ? {goal: report.goal, observed_at: report.observed_at, milestones: report.milestones} : null,
    observation: null,
    cost: {amount: null, label: "未提供项目账单，费用未知"},
    quota: {scope: "project", status: "unknown", reason: "未提供项目额度，不使用全局账号额度"},
    caveats: [
      "Token 和活动使用面板 UTC+8 自然日窗口；PR、项目摘要和参与关系为当前存量，不限于此时间窗。",
      "当前服务未提供可靠项目级 Cached、模型分布、成员用量或用量更新时间；这些字段保留未知，不分摊全局数据。",
      "按演示约定，负责人显示为面板参与成员；任务分工和截止日期未接入。",
      "阶段摘要的已完成是采集记录，不是业务验收；PR 合并不等于已上线。",
      "继承面板列表上限：全局活动最多 100 条，PR 最多 500 条。",
    ],
  };
}
