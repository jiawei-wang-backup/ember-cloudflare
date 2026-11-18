import { readFileSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage,ServerResponse } from "node:http";
import { type PulseSnapshot } from "@ember/protocol";
import { callbackToken } from "./demo-bot.ts";
import { state } from "./local.ts";
import {factsReply, quickFactQuestion} from "./project-facts.ts";
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
      if (quickFactQuestion(q)) {
        res.writeHead(200, {"Content-Type":"text/html; charset=utf-8"}).end(factsReply(data, body.room.id, q));
        return;
      }
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
      const prefix = modelUnavailable ? "<p>模型暂未响应。</p>" : "";
      res.writeHead(200, {"Content-Type":"text/html; charset=utf-8"}).end(prefix + factsReply(data, body.room.id, q));
    }catch{res.writeHead(200,{"Content-Type":"text/plain; charset=utf-8"}).end("项目查询暂不可用，未生成项目结论。请检查 Project Pulse 服务与项目授权。");}
  })();return true;
}
