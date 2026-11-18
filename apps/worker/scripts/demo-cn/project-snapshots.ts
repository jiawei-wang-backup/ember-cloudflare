import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { PulseSnapshot } from "@ember/protocol";
import { dashboardProject, type PulseDashboard } from "../../src/pulse-dashboard.ts";
import { EXPECTED_PROJECTS, MONITOR_URL, type MonitorSnapshot } from "./monitor-source.ts";

export function projectSnapshots(state: string): Record<string, PulseSnapshot> {
  const file = path.join(state, "monitor-snapshot.json");
  if (!existsSync(file)) return {};
  const snapshot = JSON.parse(readFileSync(file, "utf8")) as MonitorSnapshot;
  if (!snapshot.source.startsWith(`${MONITOR_URL}；`) || JSON.stringify(snapshot.projects.map(p => p.name)) !== JSON.stringify(EXPECTED_PROJECTS)) throw new Error("离线快照不是已核验的六项目来源，拒绝加载。");
  return Object.fromEntries(snapshot.projects.map(project => {
    const scoped = snapshot.dashboardProjects?.[project.key];
    if (scoped && scoped.project.key === project.key && scoped.source === MONITOR_URL)
      return [project.key, {...scoped, freshness: {status: "snapshot", captured_at: snapshot.capturedAt}}];
    const raw: PulseDashboard = {
      projects: [{repository_id: project.repositoryId!, full_name: project.key, status: project.status || "unknown", milestones: []}],
      project_reports: project.report ? [project.report] : [], workspace_states: [], project_usage: [],
      memberships: project.sessions.map(s => ({display_name: s.display_name, full_name: project.key, workspace_name: null, session_count: 1, last_activity_at: s.last_activity_at})),
      sessions: project.sessions.map(s => ({...s, full_name: project.key})),
      pulls: project.pulls.map(p => ({...p, full_name: project.key})),
    };
    const data = dashboardProject(raw, project.key, 7, MONITOR_URL, new Date(snapshot.capturedAt));
    data.freshness = {status: "snapshot", captured_at: snapshot.capturedAt};
    data.caveats.push("已导入快照未保存 Token 用量，保留未知；快照活动不按新选择的时间窗重新计算。背景与痛点为依据项目目标整理的介绍。");
    return [project.key, data];
  }));
}
