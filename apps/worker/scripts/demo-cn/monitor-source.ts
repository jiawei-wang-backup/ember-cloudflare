import {dashboardProject, type PulseDashboard} from "../../src/pulse-dashboard.ts";
import type {PulseSnapshot} from "@ember/protocol";
export const MONITOR_URL="http://192.168.20.189:4185/api/v1/dashboard?days=7";
export const EXPECTED_PROJECTS=["project-pulse","jxaccount","mfa-approval","wzwx-score","deltaforce-game-library","xiaoxing-voice-changer"] as const;
export const monitorProjectFullNames=["jiawei-wang-dev/project-pulse","JUXON-AI/jxaccount","JUXON-AI/mfa-approval","JUXON-AI/wzwx-score","juxon-ai/deltaforce-game-library","juxon-ai/xiaoxing-voice-changer"];
export interface SourceSession {device_id?:string;session_id:string;workspace_name:string|null;repository_id:string|null;full_name:string|null;title:string|null;summary:string|null;display_name:string;project_state:string|null;last_activity_at:string}
export interface SourceReport {device_id?:string;source_session_id?:string;project_key:string;goal:string;observed_at:string;milestones:Array<{title:string;state:string;evidence:string}>}
export interface SourcePull {repository_id:string;number:string;title:string;url:string;state:string;is_draft:boolean;updated_at:string}
export interface MonitorProject {key:string;name:string;repositoryId:string|null;fullName?:string;status?:string;sessions:SourceSession[];report:SourceReport|null;pulls:SourcePull[]}
export interface MonitorSnapshot {capturedAt:string;projects:MonitorProject[];source:string; dashboardProjects?:Record<string,PulseSnapshot>}
interface Dashboard {
  projects:Array<{repository_id:string;full_name:string;status:string}>;
  sessions:Array<{session_id:string;workspace_name:string|null;full_name:string|null;title:string|null;display_title?:string|null;summary:string|null;display_name:string;last_activity_at:string}>;
  pulls:Array<SourcePull&{full_name:string}>;
  project_reports:SourceReport[];
  workspace_states?:Array<{workspace_name:string;status:string}>;
}
/** Fail closed before any Ember mutation when the source is not the screenshot projects. */
export function normalizeMonitor(data:Dashboard):MonitorSnapshot {
  if(!Array.isArray(data.projects)||!Array.isArray(data.sessions)||!Array.isArray(data.pulls)||!Array.isArray(data.project_reports))throw new Error("监控服务响应不完整，拒绝同步。");
  const projects=monitorProjectFullNames.map((fullName,index)=>{
    const match=(value:string|null)=>value?.toLowerCase()===fullName.toLowerCase();
    const registered=data.projects.find(p=>match(p.full_name));
    const report=data.project_reports.filter(p=>match(p.project_key)).sort((a,b)=>b.observed_at.localeCompare(a.observed_at))[0]??null;
    if(!registered&&!report)throw new Error(`数据源不匹配截图：缺少 ${EXPECTED_PROJECTS[index]}，未修改 Ember。`);
    const status=registered?.status??data.workspace_states?.find(s=>match(s.workspace_name))?.status??"unknown";
    const sessions=data.sessions.filter(s=>match(s.full_name)||(!s.full_name&&match(s.workspace_name))).map(s=>({session_id:s.session_id,workspace_name:s.workspace_name,repository_id:registered?.repository_id??null,full_name:registered?.full_name??null,title:s.display_title||s.title,summary:s.summary,display_name:s.display_name,project_state:status,last_activity_at:s.last_activity_at}));
    const pulls=data.pulls.filter(p=>match(p.full_name)).map(p=>({repository_id:p.repository_id,number:p.number,title:p.title,url:p.url,state:p.state,is_draft:p.is_draft,updated_at:p.updated_at}));
    return {key:fullName.toLowerCase(),name:EXPECTED_PROJECTS[index]!,fullName,repositoryId:registered?.repository_id??null,status,sessions,report,pulls};
  });
  return {capturedAt:new Date().toISOString(),projects,source:`${MONITOR_URL}；截图对应的局域网监控服务。项目按明确仓库标识或完整工作区标识归属，不使用本机旧库或模糊名称匹配。`};
}
export async function readMonitorSnapshot():Promise<MonitorSnapshot> {
  const response=await fetch(MONITOR_URL,{redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`正确监控服务不可用（${response.status}），拒绝退回旧数据源。`);
  const data = await response.json() as Dashboard & PulseDashboard;
  const snapshot = normalizeMonitor(data);
  snapshot.dashboardProjects = Object.fromEntries(snapshot.projects.map(({key}) =>
    [key, dashboardProject(data, key, 7, MONITOR_URL, new Date(snapshot.capturedAt))]));
  return snapshot;
}
