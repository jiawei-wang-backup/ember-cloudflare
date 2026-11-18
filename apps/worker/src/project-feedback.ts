import {isRoomId, parseNewFeedback, parseChangeFeedback, threadPath} from "@ember/protocol";
import {credentialsOf} from "./auth";
import {workspace} from "./workspace";
import {pulseBinding} from "./pulse";
import {businessDefinition, businessJourneys} from "./pulse-business";
import type {Env} from "./env";

const headers = {"Cache-Control": "no-store"};
const problem = (status: number, error: string) => Response.json({error}, {status, headers});
export async function projectFeedbackRoute(request: Request, env: Env, roomId: string, feedbackId?: string): Promise<Response> {
  const authorizedAt = Date.now();
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, "未登录");
  if (!isRoomId(roomId)) return problem(404, "项目不存在");
  const [user, settings] = await Promise.all([workspace(env).authenticate(credentials), workspace(env).roomSettings(credentials, roomId)]);
  if (!user) return problem(401, "未登录");
  if (!settings || settings === "not found") return problem(404, "项目不可访问");
  const binding = pulseBinding(env, roomId);
  if (!binding || !binding.memberIds.includes(user.id)) return problem(403, "没有项目权限");
  const definition = businessDefinition(binding.projectId);
  if (!definition) return problem(404, "此项目未开启业务协作");
  const room = env.CHAT_ROOM.getByName(roomId);
  if (request.method === "GET") {
    if (feedbackId) {
      const result = await room.projectFeedbackHistory(roomId, feedbackId);
      if (!result.item) return problem(404, "反馈不存在");
      const messages = result.item.sourceMessageIds.length ? await room.messagesWithIds(roomId, result.item.sourceMessageIds) : [];
      const sources = result.item.sourceMessageIds.map(id => {const message = messages.find(m => m.id === id); return {id, path: message && !message.deleted ? message.parentId ? threadPath(roomId, message.parentId, id) : `/rooms/${roomId}/@${id}` : null};});
      return Response.json({...result, sources, canManage: settings.canAdminister}, {headers});
    }
    const before = new URL(request.url).searchParams.get("before") || undefined;
    if (before && !/^[a-zA-Z0-9_-]{1,80}$/.test(before)) return problem(422, "分页位置无效");
    return Response.json({...await room.projectFeedback(roomId, before), canManage: settings.canAdminister}, {headers});
  }
  if (!await workspace(env).canSharePulse(roomId, user.id, binding.memberIds)) return problem(403, "项目读者授权已变化，暂不能公开反馈内容");
  let body: unknown;
  try {body = await request.json();} catch {return problem(422, "请求格式无效");}
  const validModule = (moduleId: string, milestoneId?: string | null) => {
    const module = definition.modules.find(m => m.id === moduleId);
    return module && (!milestoneId || module.stages.some((_, index) => `${module.id}-${index}` === milestoneId) || businessJourneys(binding.projectId).some(j => j.id === milestoneId && j.moduleIds.includes(moduleId)));
  };
  if (request.method === "POST" && !feedbackId) {
    const input = parseNewFeedback(body);
    if (!input || !validModule(input.moduleId, input.milestoneId)) return problem(422, "请填写反馈内容并选择本项目的业务模块");
    if (input.sourceMessageIds.length) {
      const sources = await room.messagesWithIds(roomId, input.sourceMessageIds);
      if (sources.length !== input.sourceMessageIds.length || sources.some(m => m.deleted)) return problem(409, "引用讨论已删除或不属于此项目");
    }
    return Response.json({item: await room.createProjectFeedback(roomId, input, user, false, null, authorizedAt)}, {status: 201, headers});
  }
  if (request.method === "PATCH" && feedbackId) {
    const input = parseChangeFeedback(body);
    if (!input) return problem(422, "请填写操作说明及有效的更新信息");
    for (const evidence of input.evidence ?? []) {
      if (evidence.url.startsWith("http://")) {
        const link = new URL(evidence.url), origin = new URL(request.url).origin;
        if (link.origin !== origin || !link.pathname.startsWith("/rooms/")) return problem(422, "本地交付链接必须来自当前 Ember 地址");
        evidence.url = link.pathname + link.search + link.hash;
      }
    }
    const existing = (await room.projectFeedbackHistory(roomId, feedbackId)).item;
    if (!existing) return problem(404, "反馈不存在");
    if (!validModule(input.moduleId ?? existing.moduleId, input.milestoneId === undefined ? existing.milestoneId : input.milestoneId)) return problem(422, "模块与里程碑不匹配");
    let assignee: {id: string; name: string} | null | undefined;
    if (input.assigneeId !== undefined) {
      assignee = input.assigneeId ? settings.people.find(p => p.member && p.id === input.assigneeId) : null;
      const directory = await workspace(env).directory(credentials);
      if (input.assigneeId && (!assignee || directory?.find(p => p.id === input.assigneeId)?.role === "bot")) return problem(422, "请选择本项目的一位实际频道成员作为执行人");
    }
    const result = await room.changeProjectFeedback(roomId, feedbackId, input, user, settings.canAdminister, assignee, authorizedAt);
    return "error" in result && result.error ? problem(result.status ?? 500, result.error) : Response.json(result, {headers});
  }
  return problem(405, "不支持的操作");
}
