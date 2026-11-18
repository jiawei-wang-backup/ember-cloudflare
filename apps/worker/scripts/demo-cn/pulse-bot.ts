import { readFileSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage,ServerResponse } from "node:http";
import { compactPulseNumber, pulseStatusLabels, type PulseSnapshot, type PulseStatus } from "@ember/protocol";
import { callbackToken } from "./demo-bot.ts";
import { state } from "./local.ts";
import { paragraph } from "../seed/markup.ts";
import { modelReply } from "./pulse-model.ts";
import { acceptanceReply, isAcceptanceQuestion } from "./pulse-acceptance.ts";
import { leadershipBrief, wantsLeadershipBrief } from "./pulse-brief.ts";

export function handleProjectBot(req:IncomingMessage,res:ServerResponse):boolean {
  if(!req.url?.startsWith("/__pulse_bot/"))return false;
  if(req.method!=="POST"||req.url!==`/__pulse_bot/${callbackToken()}`){res.writeHead(404).end();return true;}
  void (async()=>{
    try{
      const chunks:Buffer[]=[];let size=0;
      for await(const part of req){size+=part.length;if(size>65536){res.writeHead(413).end();return;}chunks.push(part);}
      const body=JSON.parse(Buffer.concat(chunks).toString());
      const link=JSON.parse(readFileSync(path.join(state,"pulse-link.json"),"utf8"));
      const binding=link.bindings[body.room?.id];
      if(!binding||!binding.memberIds.includes(body.user?.id)){res.writeHead(403).end();return;}
      const session=JSON.parse(readFileSync(path.join(state,"pulse-session.json"),"utf8"));
      const settingsResponse=await fetch(`http://localhost:5174/api/rooms/${body.room.id}/settings`,{headers:{Cookie:session.cookie},signal:AbortSignal.timeout(5000)});
      if(!settingsResponse.ok)throw new Error("频道权限不可用");
      const settings=await settingsResponse.json() as {room:{kind:string};people:Array<{id:string;member:boolean}>};
      if(settings.room.kind!=="closed"||!settings.people.some(person=>person.id===body.user?.id&&person.member)){res.writeHead(403).end();return;}
      const q=String(body.message?.body?.plain||"");
      const days=/近\s*30\s*天|30天|一个月/.test(q)?30:/近\s*1\s*天|今天|今日/.test(q)?1:7;
      const answer=await fetch(`http://localhost:5174/api/rooms/${body.room.id}/project?days=${days}&audience=room`,{headers:{Cookie:session.cookie},signal:AbortSignal.timeout(10000)});
      if(!answer.ok)throw new Error("项目服务或频道授权不可用，请重新运行关联配置。");
      const data=await answer.json() as PulseSnapshot;
      if (isAcceptanceQuestion(data, q)) {
        const reply = await acceptanceReply(data, body.room.id, session.cookie, q, body.message?.path);
        res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"}).end(reply);
        return;
      }
      if (wantsLeadershipBrief(data, q)) {
        const reply = await leadershipBrief(data, body.room.id, session.cookie, q);
        res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"}).end(reply);
        return;
      }
      let modelUnavailable = false;
      try {
        const reply = await modelReply(data, body.room.id, session.cookie, q, body.message?.id);
        if (reply) {res.writeHead(200, {"Content-Type":"text/html; charset=utf-8"}).end(reply); return;}
      } catch (error) {
        modelUnavailable = true;
        console.error("项目助手模型调用失败", error instanceof Error ? error.message : "unknown");
      }
      const all=/周报|进度|整体|风险|延期|模块|能用|卡点|业务/.test(q);
      const parts=[`【结构化查询模式，非 LLM 分析】${data.project.full_name}`];
      if (modelUnavailable) parts.push("模型暂不可用，以下是监控面板的项目数据。");
      const owner=data.members.map(member=>member.display_name.replace(/\s*[·•]\s*[a-f\d]{8,}$/i,"")).join("、")||"暂无参与成员记录";
      const progress=data.milestone_progress;
      const pending=data.milestones.filter(m=>!["completed","accepted"].includes(m.state));
      parts.push(`负责人：${owner}`);
      parts.push(`进度：${pulseStatusLabels[data.project.status as PulseStatus]||"待确认"} · ${progress?`${progress.completed??progress.accepted}/${progress.total} ${progress.basis==="reported"?"阶段记录完成，非业务验收":"里程碑已验收"}`:"暂无阶段记录"}`);
      parts.push(`接下来要做：${pending.length?pending.slice(0,2).map(m=>m.title).join("；")+(pending.length>2?` 等 ${pending.length} 项待确认事项`:""):"暂无待完成记录，业务验收仍以实际确认为准"}`);
      if (data.business) {
        parts.push(`业务目标：${data.business.outcome}\n面向：${data.business.audience}`);
        parts.push("业务模块：" + data.business.modules.map(m => `${m.name}：${m.outcome}；${m.available.length ? `已有阶段记录：${m.available.join("、")}` : "暂无完成记录"}；${m.blockers.length ? `待确认：${m.blockers.join("、")}` : "当前完整使用仍需复验"}`).join("\n"));
        parts.push("现在能用什么：已有能力仅代表监控中记录的交付范围，当前可用性需按模块验收条件确认；卡点、协作入口及反馈落实请查看项目总览与“反馈与落实”。");
      }
      parts.push("本次调用：输入 0 Token · 输出 0 Token · 模型费用 0（结构化查询，未调用 LLM）");
      parts.push(`项目用量：近 ${days} 天输入 ${compactPulseNumber(data.usage.input_tokens)} · 输出 ${compactPulseNumber(data.usage.output_tokens)}；${data.cost.label}`);
      if (data.freshness?.status === "snapshot") parts.push(`快照：${data.freshness.captured_at} · 监控暂未连接，以上为最近核验记录，不是当前实时数据`);
      if(all||!/成员|负责|谁|Token|token|费用|额度|PR|里程碑/.test(q))parts.push(`目标：${data.project.goal||"未提供"}\n状态：${data.project.status}；负责人：${data.project.owner?.display_name||"未配置"}；阶段记录：${data.milestone_progress?`${data.milestone_progress.completed??data.milestone_progress.accepted}/${data.milestone_progress.total} ${data.milestone_progress.basis==="reported"?"记录完成（非业务验收）":"已验收"}`:"未配置，不能推测整体进度"}`);
      if(all||/成员|负责|谁/.test(q))parts.push(`${data.project.owner_basis==="participants"?"负责人（参与成员）":"参与成员"}：`+(data.members.map(m=>`${m.display_name} · ${m.sessions} 个采集会话`).join("；")||"暂无参与成员记录"));
      if(all||/Token|token|费用|额度/.test(q))parts.push(`近 ${days} 天 Input：${compactPulseNumber(data.usage.input_tokens)}；Output：${compactPulseNumber(data.usage.output_tokens)}；Cached：${compactPulseNumber(data.usage.cached_input_tokens)}（包含在 Input 内）。完整数值 Input ${data.usage.input_tokens??"未知"} / Output ${data.usage.output_tokens??"未知"}。${data.cost.label}；${data.quota.reason}。`);
      if(all||/PR|交付|产出|文档/.test(q))parts.push(`PR / 产出文档：共 ${data.pulls.length} 条，以下最多展示 5 条。\n`+(data.pulls.slice(0,5).map(p=>`${p.repository_full_name||data.project.full_name} #${p.number} ${p.title} [${p.state}${p.is_draft?" · 草稿":""}] ${p.url}`).join("\n")||"暂无已采集 PR")+"\nPR 为面板当前存量；合并不等于业务验收。");
      if(all||/里程碑|任务/.test(q))parts.push("阶段证据："+(data.milestones.map(m=>`${m.title} [${m.state==="completed"?"记录完成":m.state}]${m.evidence?`：${m.evidence}`:""}`).join("；")||"未配置")+"；采集记录不等于业务验收；未接入任务分配与截止日期，不判断延期。");
      if(all||/最近|开发|活动/.test(q))parts.push("近期活动："+(data.activities.slice(0,5).map(a=>`${a.display_name}：${a.summary||a.title||"无摘要"}`).join("；")||"此窗口没有可靠映射的活动"));
      parts.push(`来源：${data.source}；查询时间：${data.fetched_at}；数据窗口：${data.window.since} 至 ${data.window.until}。${data.window.kind==="calendar-utc8"?"Token/活动按 UTC+8 自然日窗口；PR、阶段证据与成员关系为当前存量。":""}需要自然语言推理时配置 Ember AI。`);
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}).end(parts.map(part=>paragraph(part).body).join(""));
    }catch{res.writeHead(200,{"Content-Type":"text/plain; charset=utf-8"}).end("项目查询暂不可用，未生成项目结论。请检查 Project Pulse 服务与项目授权。");}
  })();return true;
}
