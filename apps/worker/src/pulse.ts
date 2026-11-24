import { isRoomId, type RoomId, type UserId, type PulseSnapshot, type SharedRoom } from "@ember/protocol";
import { credentialsOf } from "./auth";
import { workspace } from "./workspace";
import type { Env } from "./env";
import type { EmberTool, Unlogged } from "./assistant/tool-calls";
import { dashboardProject, ProjectNotReported } from "./pulse-dashboard";
import {DashboardCache, fetchDashboard, type BackgroundWork} from "./pulse-dashboard-cache";
import { pulseIntroduction } from "./pulse-context";
import { businessOverview } from "./pulse-business";

const dashboards = new DashboardCache();

function demoSnapshot(env: Env, projectId: string, days: number, source: URL): PulseSnapshot | null {
  try {
    const data = JSON.parse(env.PULSE_DEMO_SNAPSHOTS || "{}")[projectId] as PulseSnapshot | undefined;
    if (!data || data.project.key !== projectId || data.source !== new URL("/api/v1/dashboard?days=7", source).toString() || !data.freshness?.captured_at || !Number.isFinite(Date.parse(data.freshness.captured_at))) return null;
    return {...data, window: {...data.window, days}, freshness: {...data.freshness, status: "snapshot", reason: "最近核验快照"}};
  } catch { return null; }
}

export function pulseBinding(env: Env, roomId: string): {projectId: string; memberIds: string[]; allRoomMembers?: boolean; ownerId?: UserId} | null {
  try {
    const value = JSON.parse(env.PULSE_ROOMS || "{}")[roomId];
    const validId = env.PULSE_SOURCE === "dashboard" ? /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(value?.projectId) : /^[0-9a-f-]{36}$/i.test(value?.projectId);
    return value && validId && Array.isArray(value.memberIds) && value.memberIds.every((x: unknown) => typeof x === "string") ? value : null;
  } catch { return null; }
}
function teamProjectKey(env: Env, room: Pick<SharedRoom, "kind" | "channelGroup">, key?: string): string | undefined {
  if (env.PULSE_TEAM_PROJECT_CHANNELS !== "true" || env.PULSE_SOURCE !== "dashboard" ||
      room.kind !== "closed" || room.channelGroup !== "project") return undefined;
  if (!key) return undefined;
  // Never infer grants for a repository whose channel is explicitly governed.
  try {
    const bindings = Object.values(JSON.parse(env.PULSE_ROOMS ?? "{}") as Record<string, {projectId: string}>);
    return bindings.some(binding => binding.projectId.toLowerCase() === key) ? undefined : key;
  } catch {return undefined;}
}

export async function pulseSnapshot(env: Env, projectId: string, days = 7, background?: BackgroundWork, refresh = false): Promise<PulseSnapshot> {
  if (!env.PULSE_URL || (env.PULSE_SOURCE !== "dashboard" && !env.PULSE_TOKEN)) throw new Error("Project Pulse 服务未配置");
  if (![1,7,30].includes(days)) throw new Error("无效时间窗");
  const base = new URL(env.PULSE_URL);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && (["localhost", "127.0.0.1"].includes(base.hostname) || base.origin === env.PULSE_HTTP_ORIGIN))) throw new Error("Project Pulse 地址不安全");
  if (env.PULSE_SOURCE === "dashboard") {
    const url = new URL(`/api/v1/dashboard?days=${days}`, base);
    const saved = demoSnapshot(env, projectId, days, url);
    try {
      const result = saved ? await dashboards.read(url, env.PULSE_TOKEN, background, refresh) : {data: await fetchDashboard(url, env.PULSE_TOKEN), capturedAt: Date.now(), stale: false};
      const data = dashboardProject(result.data, projectId, days, url.toString(), new Date(result.capturedAt));
      return {...data, freshness: {status: result.stale ? "snapshot" : "live", captured_at: data.fetched_at}};
    } catch (error) {
      if (saved) return saved;
      throw error;
    }
  }
  const response = await fetch(new URL(`/api/v1/projects/${encodeURIComponent(projectId)}?days=${days}`, base), {headers:{Authorization:`Bearer ${env.PULSE_TOKEN}`},redirect:"manual",signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw new Error(`Project Pulse 返回 ${response.status}`);
  const data = await response.json() as PulseSnapshot;
  if (data.project?.repository_id !== projectId) throw new Error("Project Pulse 项目身份不匹配");
  return data;
}
export async function pulseRoute(request: Request, env: Env, roomId: string, background?: BackgroundWork): Promise<Response> {
  const headers = {"Cache-Control":"no-store"};
  const credentials = await credentialsOf(request, env);
  if (!credentials) return Response.json({error:"未登录"},{status:401,headers});
  const settings = isRoomId(roomId) && await workspace(env).roomSettings(credentials, roomId);
  if (!settings || settings === "not found") return Response.json({error:"频道不可访问"},{status:404,headers});
  const explicit = pulseBinding(env, roomId);
  const registered = env.PULSE_TEAM_PROJECT_CHANNELS === "true" && settings.room.kind === "closed"
    ? (await workspace(env).teamProjectBindings([roomId]))[roomId] : undefined;
  const sharedKey = teamProjectKey(env, settings.room, registered?.repository);
  const binding = explicit ?? (sharedKey ? {
    projectId: sharedKey, memberIds: settings.people.filter(person => person.member).map(person => person.id)
  } : null);
  if (!binding) return Response.json({error:"频道未关联 Project Pulse"},{status:404,headers});
  const user = await workspace(env).authenticate(credentials);
  if (!user || !(explicit?.allRoomMembers === true ? settings.people.some(p => p.member && p.id === user.id) : binding.memberIds.includes(user.id))) return Response.json({error:"没有项目数据权限"},{status:403,headers});
  if(new URL(request.url).searchParams.get("audience")==="room"&&!await workspace(env).canSharePulse(roomId as RoomId,user.id,binding.memberIds,explicit?.allRoomMembers === true))return Response.json({error:"频道读者未全部获得项目授权"},{status:403,headers});
  const days=Number(new URL(request.url).searchParams.get("days") || 7);
  if (![1,7,30].includes(days)) return Response.json({error:"时间窗仅支持 1、7、30 天"},{status:422,headers});
  try {
    const data = await pulseSnapshot(env,binding.projectId,days,background,new URL(request.url).searchParams.get("refresh") === "1");
    const directory = await workspace(env).directory(credentials);
    const members = settings.people.filter(p => p.member).map(person => ({id: person.id, name: person.name, bot: directory?.find(p => p.id === person.id)?.role === "bot"}));
    const ownerId = registered?.ownerId ?? (sharedKey ? settings.creatorId : undefined);
    const owner = members.find(member => member.id === ownerId && !member.bot);
    return Response.json({...data, business: businessOverview(data), can_adopt: settings.canAdminister, introduction: pulseIntroduction(binding.projectId), team: {people: members.filter(p => !p.bot).length, bots: members.filter(p => p.bot).length, members, ...(registered && {owner: owner ? {id: owner.id, name: owner.name} : null})}}, {headers});
  }
  catch (error) {
    if (error instanceof ProjectNotReported) return Response.json({code:"project_not_reported",error:error.message},{status:404,headers});
    console.error("Project Pulse unavailable:",error instanceof Error?error.message:"unknown");
    return Response.json({error:"Project Pulse 暂不可用，请稍后重试"},{status:502,headers});
  }
}

export async function pulseSummaries(request: Request, env: Env, background?: BackgroundWork): Promise<Response> {
  const headers = {"Cache-Control": "no-store"};
  const credentials = await credentialsOf(request, env);
  if (!credentials) return Response.json({error: "未登录"}, {status: 401, headers});
  const [user, sidebar] = await Promise.all([workspace(env).authenticate(credentials), workspace(env).sidebar(credentials)]);
  if (!user || !sidebar) return Response.json({error: "未登录"}, {status: 401, headers});
  const teamKeys = env.PULSE_TEAM_PROJECT_CHANNELS === "true"
    ? await workspace(env).teamProjectBindings(sidebar.rooms.filter(room => room.kind === "closed" && room.channelGroup === "project").map(room => room.id))
    : {};
  const rooms = sidebar.rooms.flatMap(room => {
    if (room.kind === "direct") return [];
    const binding = pulseBinding(env, room.id);
    const projectId = binding ? (binding.allRoomMembers === true || binding.memberIds.includes(user.id) ? binding.projectId : undefined) : teamProjectKey(env, room, teamKeys[room.id]?.repository);
    return projectId ? [{room, projectId}] : [];
  });
  const results = await Promise.all(rooms.map(async ({room, projectId}) => {
    try { const data = await pulseSnapshot(env, projectId, 7, background); return {roomId: room.id, name: room.name, progress: data.milestone_progress, freshness: data.freshness}; }
    catch { return {roomId: room.id, name: room.name, progress: null}; }
  }));
  return Response.json({projects: results}, {headers});
}

export function projectTools(env: Env, roomId: RoomId, askerId: UserId): (Omit<EmberTool, "run"> & {run(input: Record<string, unknown>): Promise<Unlogged>})[] {
  const binding = pulseBinding(env,roomId);
  if (!binding || (binding.allRoomMembers !== true && !binding.memberIds.includes(askerId))) return [];
  const sections = {
    get_project_overview: ["project","business","milestone_progress","observation"],
    get_project_members: ["members"], get_member_activity: ["activities"],
    get_project_usage: ["usage","models","cost"], get_project_quota: ["quota"],
    get_project_pull_requests: ["pulls"], get_project_milestones: ["milestones","latest_report"],
    get_recent_deliveries: ["pulls","milestones"],
  };
  return Object.entries(sections).map(([name,keys])=>({name,description:`查询当前频道明确关联的真实 Project Pulse 项目：${keys.join("、")}。缺失信息不可推测；返回来源和更新时间。`,takes:{type:"object",properties:{days:{type:"integer",enum:[1,7,30]}},additionalProperties:false},run:async input=>{
    if (!await workspace(env).canSharePulse(roomId,askerId,binding.memberIds,binding.allRoomMembers === true)) throw new Error("频道中存在未获项目授权的成员，不能公开回答项目数据");
    const days=input.days ?? 7;
    if (![1,7,30].includes(days as number)) throw new Error("无效时间窗");
    const data=await pulseSnapshot(env,binding.projectId,days as number);
    const record={...data, business: businessOverview(data)} as unknown as Record<string,unknown>;
    return {unlogged: true as const, text: JSON.stringify({project_id:binding.projectId,fetched_at:data.fetched_at,source:data.source,window:data.window,caveats:data.caveats,...Object.fromEntries(keys.map(k=>[k,record[k]]))})};
  }}));
}
